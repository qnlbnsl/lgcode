// Issue 223 (finding B1, SECURITY.md rule 6): a harness adapter can read its
// own login file and print a token from it as ordinary output. The redactor
// removes only values it was given, so every file-backed harness login store
// is read here, and each token in it is handed to the redactor.
import { closeSync, constants, fstatSync, openSync, readSync, statSync, type BigIntStats } from "node:fs";
import { isAbsolute, join } from "node:path";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

// Carries no path, cause or content: a store's text must never reach a
// message, a log line or an event.
export class CredentialSourceUnreadable {
  readonly _tag = "CredentialSourceUnreadable";
}

export interface CredentialSource {
  readonly paths: ReadonlyArray<string>;
  readonly read: Effect.Effect<ReadonlyArray<Redacted.Redacted<string>>, CredentialSourceUnreadable>;
}

// A login store is a few kilobytes. A larger file is not one, so it is
// refused rather than parsed on every redaction.
const largestStore = 1024 * 1024;

// Keys whose values are not credentials but are common, short words that
// would blank ordinary output if they were redacted. The whole value under
// such a key is skipped. Every other string, at any depth, is a leaf: an
// unknown field is treated as a secret, because over-redaction is the safe
// error and a missed field is a leak.
// - `auth_mode`, `last_refresh`: Codex `auth.json` sign-in kind ("chatgpt",
//   "apikey") and refresh time.
// - `scopes`, `subscriptionType`, `rateLimitTier`, `expiresAt`: Claude Code
//   `.credentials.json` scope names, plan name ("max", "pro"), rate tier and
//   expiry time.
// - `scope`, `token_type`, `expiry_date`, `expiry`, `expires_at`: the OAuth
//   2.0 token response fields Gemini's `oauth_creds.json` stores (scope
//   URLs, "Bearer", expiry time), and the same names in other stores.
const nonSecretKeys: ReadonlySet<string> = new Set([
  "auth_mode", "last_refresh",
  "scopes", "subscriptionType", "rateLimitTier", "expiresAt",
  "scope", "token_type", "expiry_date", "expiry", "expires_at",
]);

// Every non-empty string leaf of a parsed store, at any depth, except the
// values under `nonSecretKeys`. Never the whole document as one string:
// output carries individual token fields. Walked without recursion, so a
// deeply nested document cannot exhaust the stack.
export const secretLeaves = (document: unknown): ReadonlyArray<string> => {
  const leaves = new Set<string>();
  const pending: Array<unknown> = [document];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (value.length > 0) leaves.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) if (!nonSecretKeys.has(key)) pending.push(item);
    }
  }
  return [...leaves];
};

// What one store held when it was last read, keyed by the identity of the
// file read. `failed` marks a store that exists but could not be read, so an
// unchanged broken store is not parsed again on every redaction.
interface Snapshot {
  readonly identity: string;
  readonly leaves: ReadonlyArray<Redacted.Redacted<string>>;
  readonly failed: boolean;
}

const missing: Snapshot = { identity: "missing", leaves: [], failed: false };

const identityOf = (stats: BigIntStats): string =>
  `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;

// One `stat` per call; the file is opened and parsed only when its identity
// changed. A missing store has no leaves: the account is not signed in yet,
// and a later sign-in changes the identity. A store that is not a regular
// file after following links, is too large, cannot be read or is not JSON
// fails. The file is opened without blocking and checked again through its
// descriptor, so a store swapped for a pipe between the two checks is refused
// rather than waited on.
const readStore = (path: string, previous: Snapshot | undefined): Snapshot => {
  let stats: BigIntStats;
  try {
    stats = statSync(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing;
    return { identity: "unstattable", leaves: [], failed: true };
  }
  const identity = identityOf(stats);
  if (previous !== undefined && previous.identity === identity) return previous;
  if (!stats.isFile() || stats.size > BigInt(largestStore)) return { identity, leaves: [], failed: true };
  try {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOCTTY);
    try {
      const opened = fstatSync(descriptor, { bigint: true });
      if (!opened.isFile() || opened.size > BigInt(largestStore)) return { identity, leaves: [], failed: true };
      const buffer = Buffer.alloc(largestStore + 1);
      let length = 0;
      for (;;) {
        const count = readSync(descriptor, buffer, length, buffer.length - length, null);
        if (count === 0) break;
        length += count;
        if (length > largestStore) return { identity, leaves: [], failed: true };
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
      const leaves = secretLeaves(JSON.parse(text)).map((leaf) => Redacted.make(leaf));
      return { identity: identityOf(opened), leaves, failed: false };
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return { identity, leaves: [], failed: true };
  }
};

// A source over fixed store paths. Each path keeps its last snapshot, so a
// read costs one `stat` per store while nothing changed. `read` is
// synchronous inside, so the redactor's registry can run it per redaction.
const fileSource = (paths: ReadonlyArray<string>): CredentialSource => {
  const snapshots = new Map<string, Snapshot>();
  return {
    paths,
    read: Effect.suspend(() => {
      const leaves: Array<Redacted.Redacted<string>> = [];
      let failed = false;
      for (const path of paths) {
        if (!isAbsolute(path)) { failed = true; continue; }
        const snapshot = readStore(path, snapshots.get(path));
        snapshots.set(path, snapshot);
        if (snapshot.failed) failed = true;
        else leaves.push(...snapshot.leaves);
      }
      return failed ? Effect.fail(new CredentialSourceUnreadable()) : Effect.succeed(leaves);
    }),
  };
};

// A directory named by a variable is used as given. A relative one is
// resolved by the adapter against its own working folder, which this module
// does not know, so it is left relative and the read fails closed.
const directory = (configured: string | undefined, fallback: string): string =>
  configured !== undefined && configured.trim().length > 0 ? configured : fallback;

// The login store of each file-backed harness, in the environment the
// adapter is spawned with. `home` is that environment's home folder and
// `variables` its variables after the Codex home step, so `CODEX_HOME` and
// `CLAUDE_CONFIG_DIR` are honoured.
// - Codex: `<CODEX_HOME or HOME/.codex>/auth.json`. The copied managed
//   layout keeps `auth.json` private to each shadow home and the "codex"
//   instance on the shared home (third_party/t3code/provider-instance/src/
//   CodexHomeLayout.ts:33-34, accounts/shadowHome.ts), and the shadow home is
//   passed to the adapter as `CODEX_HOME`.
// - Claude Code: `<CLAUDE_CONFIG_DIR or HOME/.claude>/.credentials.json`.
//   The config folder follows third_party/t3code/provider-instance/src/
//   ClaudeHome.ts:21-27; the file name is from the lead's design for issue
//   223, not from a source in this repository.
// - Gemini: `HOME/.gemini/oauth_creds.json`, from the lead's design for
//   issue 223, not from a source in this repository.
// - Cursor, and any other harness: no file store is established in this
//   repository (.plans/plans/shepherd-engine/scouting.md:89 names only
//   `CURSOR_API_KEY` and `agent login`), so the source has no paths.
export const credentialSourceFor = (input: {
  readonly harnessId: string;
  readonly home: string;
  readonly variables: Readonly<Record<string, string>>;
}): CredentialSource => {
  switch (input.harnessId) {
    case "codex":
      return fileSource([join(directory(input.variables.CODEX_HOME, join(input.home, ".codex")), "auth.json")]);
    case "claude":
      return fileSource([join(directory(input.variables.CLAUDE_CONFIG_DIR, join(input.home, ".claude")), ".credentials.json")]);
    case "gemini":
      return fileSource([join(input.home, ".gemini", "oauth_creds.json")]);
    default:
      return fileSource([]);
  }
};

// Every credential source opened in this service's life, re-read on each
// redaction. A leaf seen once stays registered for the service's whole life:
// a token refreshed away may still be valid until it expires, and an
// adapter's final output can arrive after its process is gone. The set only
// grows by the tokens a store has held, which is a handful per account.
export interface CredentialRegistry {
  // Registers the source, then reads it. A failed read refuses the caller's
  // launch; the source stays registered, so a store that becomes readable
  // later is still covered.
  readonly open: (source: CredentialSource) => Effect.Effect<void, CredentialSourceUnreadable>;
  // Every leaf ever read, after re-reading each source. A source whose
  // re-read fails keeps its earlier leaves.
  readonly secrets: () => ReadonlyArray<Redacted.Redacted<string>>;
}

export const makeCredentialRegistry = (): CredentialRegistry => {
  const sources = new Map<string, CredentialSource>();
  const seen = new Set<string>();
  let current: ReadonlyArray<Redacted.Redacted<string>> = [];
  const remember = (leaves: ReadonlyArray<Redacted.Redacted<string>>) => {
    let added = false;
    for (const leaf of leaves) {
      const value = Redacted.value(leaf);
      if (!seen.has(value)) { seen.add(value); added = true; }
    }
    if (added) current = [...seen].map((value) => Redacted.make(value));
  };
  return {
    open: (source) => Effect.suspend(() => {
      // One source per set of paths keeps one snapshot cache per store.
      const key = JSON.stringify(source.paths);
      const kept = sources.get(key) ?? source;
      sources.set(key, kept);
      return kept.read.pipe(Effect.map(remember));
    }),
    secrets: () => {
      for (const source of sources.values()) {
        const exit = Effect.runSyncExit(source.read);
        if (Exit.isSuccess(exit)) remember(exit.value);
      }
      return current;
    },
  };
};
