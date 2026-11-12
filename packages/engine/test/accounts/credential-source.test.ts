import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

// Import inside each test so the not-yet-built interface reports a separate
// RED result for every behavior, rather than preventing test discovery.
interface SourceModule {
  readonly secretLeaves: (document: unknown) => ReadonlyArray<string>;
  readonly credentialSourceFor: (input: { harnessId: string; home: string; variables: Readonly<Record<string, string>> }) => {
    readonly paths: ReadonlyArray<string>;
    readonly read: Effect.Effect<ReadonlyArray<Redacted.Redacted<string>>, { readonly _tag: "CredentialSourceUnreadable" }>;
  };
  readonly CredentialSourceUnreadable: new () => { readonly _tag: "CredentialSourceUnreadable" };
}
const sourceModule = (): Promise<SourceModule> => import("../../src/accounts/credentialSource.ts");
let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync("/tmp/sh-credential-source-");
  home = join(root, "home");
  mkdirSync(home);
  for (const [name, value] of Object.entries({
    HOME: home, LGTM_HOME: join(root, "state"), XDG_STATE_HOME: join(root, "xdg"),
    CODEX_HOME: join(home, ".codex"), CLAUDE_CONFIG_DIR: join(home, ".claude"),
  })) vi.stubEnv(name, value);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

const plant = (path: string, document: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(document), { mode: 0o600 });
};

it("B1 CS1: secretLeaves finds individual string leaves in objects and arrays at any depth, never the serialized document", async () => {
  const { secretLeaves } = await sourceModule();
  const document = { tokens: { access_token: "access-planted", refresh_token: "refresh-planted" },
    extra: [null, 123, false, "array-planted", { nested: [{ id_token: "deep-planted" }] }] };
  expect([...secretLeaves(document)].sort()).toEqual(["access-planted", "array-planted", "deep-planted", "refresh-planted"]);
  expect(secretLeaves(document)).not.toContain(JSON.stringify(document));
  expect(secretLeaves(null)).toEqual([]);
});

it("B1 CS2: secretLeaves excludes named login metadata without discarding unknown token fields", async () => {
  const { secretLeaves } = await sourceModule();
  expect(secretLeaves({ auth_mode: "chatgpt", last_refresh: "2026-11-02T00:00:00Z",
    tokens: { future_provider_field: "unknown-secret-planted" } })).toEqual(["unknown-secret-planted"]);
});

for (const [harnessId, relative] of [
  ["codex", ".codex/auth.json"], ["claude", ".claude/.credentials.json"], ["gemini", ".gemini/oauth_creds.json"],
] as const) {
  it(`B1 CS3 ${harnessId}: reads each default login leaf as Redacted, without returning the whole document`, async () => {
    const { credentialSourceFor } = await sourceModule();
    const path = join(home, relative);
    plant(path, { nested: { access_token: "synthetic-access-leaf", refresh_token: "synthetic-refresh-leaf" } });
    const source = credentialSourceFor({ harnessId, home, variables: {} });
    expect(source.paths).toContain(path);
    const leaves = await Effect.runPromise(source.read);
    expect(leaves.every(Redacted.isRedacted)).toBe(true);
    expect(leaves.map((leaf) => Redacted.value(leaf)).sort()).toEqual(["synthetic-access-leaf", "synthetic-refresh-leaf"]);
    expect(JSON.stringify(leaves)).not.toContain("synthetic-access-leaf");
  });
}

it("B1 CS4: a missing login store is empty and a later sign-in is discovered by the same source", async () => {
  const { credentialSourceFor } = await sourceModule();
  const source = credentialSourceFor({ harnessId: "codex", home, variables: {} });
  expect(await Effect.runPromise(source.read)).toEqual([]);
  plant(join(home, ".codex/auth.json"), { tokens: { access_token: "signed-in-after-first-read" } });
  expect((await Effect.runPromise(source.read)).map((leaf) => Redacted.value(leaf))).toContain("signed-in-after-first-read");
});

for (const kind of ["directory", "FIFO", "over 1 MiB", "unreadable permissions", "invalid JSON"] as const) {
  it(`B1 CS5 ${kind}: fails promptly with CredentialSourceUnreadable and no path or document in the failure`, async () => {
    const { credentialSourceFor, CredentialSourceUnreadable } = await sourceModule();
    const path = join(home, ".codex", "auth.json");
    mkdirSync(dirname(path), { recursive: true });
    switch (kind) {
      case "directory": mkdirSync(path); break;
      case "FIFO": execFileSync("mkfifo", [path]); break;
      case "over 1 MiB": writeFileSync(path, JSON.stringify({ access_token: "oversized-secret-" + "x".repeat(1024 * 1024) })); break;
      case "unreadable permissions":
        plant(path, { access_token: "unreadable-secret-planted" });
        chmodSync(path, 0o000);
        // Establish the operating system refused access, rather than silently
        // running a meaningless permissions case as a privileged user.
        expect(() => readFileSync(path)).toThrow(expect.objectContaining({ code: "EACCES" }));
        break;
      case "invalid JSON": writeFileSync(path, '{"secret":"invalid-json-secret-planted",'); break;
    }
    try {
      if (kind === "FIFO") {
        // A mistaken synchronous readFile on a FIFO blocks the JavaScript
        // thread, so an Effect timeout alone cannot stop that regression.
        // Bound a child we own, rather than leaving the whole suite hung.
        const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
          import { credentialSourceFor } from ${JSON.stringify(new URL("../../src/accounts/credentialSource.ts", import.meta.url).href)};
          import * as Effect from "effect/Effect";
          import * as Cause from "effect/Cause";
          import * as Exit from "effect/Exit";
          const source = credentialSourceFor(${JSON.stringify({ harnessId: "codex", home, variables: {} })});
          const exit = await Effect.runPromiseExit(source.read);
          const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined;
          process.stdout.write(JSON.stringify({ failed: Exit.isFailure(exit),
            tag: error?._tag === "Some" ? error.value._tag : undefined,
            diagnostic: JSON.stringify(exit) + (Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "") }));
        `], { encoding: "utf8", timeout: 5_000 });
        expect(JSON.parse(output)).toMatchObject({ failed: true, tag: "CredentialSourceUnreadable" });
        expect(output).not.toContain(root);
        expect(output).not.toContain("auth.json");
        return;
      }
      const source = credentialSourceFor({ harnessId: "codex", home, variables: {} });
      const exit = await Effect.runPromise(Effect.exit(source.read).pipe(Effect.timeout(2_000)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause);
        expect(error._tag).toBe("Some");
        if (error._tag === "Some") {
          expect(error.value).toBeInstanceOf(CredentialSourceUnreadable);
          expect(error.value).toMatchObject({ _tag: "CredentialSourceUnreadable" });
        }
        const diagnostic = JSON.stringify(exit) + String(Cause.squash(exit.cause));
        expect(diagnostic).not.toContain(root);
        expect(diagnostic).not.toContain("auth.json");
        expect(diagnostic).not.toContain("secret-planted");
        expect(diagnostic).not.toContain("access_token");
      }
    } finally { if (kind === "unreadable permissions") chmodSync(path, 0o600); }
  });
}

it("B1 CS6: follows a symbolic link to a regular login file", async () => {
  const { credentialSourceFor } = await sourceModule();
  const target = join(root, "linked-login.json");
  plant(target, { tokens: { access_token: "symlink-token-planted" } });
  mkdirSync(join(home, ".codex"));
  symlinkSync(target, join(home, ".codex/auth.json"));
  const source = credentialSourceFor({ harnessId: "codex", home, variables: {} });
  expect((await Effect.runPromise(source.read)).map((leaf) => Redacted.value(leaf))).toEqual(["symlink-token-planted"]);
});

for (const [harnessId, variable, filename, defaultFile] of [
  ["codex", "CODEX_HOME", "auth.json", ".codex/auth.json"],
  ["claude", "CLAUDE_CONFIG_DIR", ".credentials.json", ".claude/.credentials.json"],
] as const) {
  it(`B1 CS7 ${variable}: the resolved account variable moves the active store away from the default home`, async () => {
    const { credentialSourceFor } = await sourceModule();
    plant(join(home, defaultFile), { token: "inactive-default-token" });
    const moved = join(root, "account-login");
    plant(join(moved, filename), { token: "active-account-token" });
    const source = credentialSourceFor({ harnessId, home, variables: { [variable]: moved } });
    expect(source.paths).toContain(join(moved, filename));
    expect((await Effect.runPromise(source.read)).map((leaf) => Redacted.value(leaf))).toEqual(["active-account-token"]);
  });
}

it("B1 CS8: re-reads a replaced store through the original source instead of freezing the first token", async () => {
  const { credentialSourceFor } = await sourceModule();
  const path = join(home, ".codex/auth.json");
  plant(path, { token: "original-token-planted" });
  const source = credentialSourceFor({ harnessId: "codex", home, variables: {} });
  expect((await Effect.runPromise(source.read)).map((leaf) => Redacted.value(leaf))).toContain("original-token-planted");
  rmSync(path);
  plant(path, { token: "replacement-token-with-a-different-size-planted" });
  expect((await Effect.runPromise(source.read)).map((leaf) => Redacted.value(leaf))).toContain("replacement-token-with-a-different-size-planted");
  // Lifetime retention belongs to the service registry, not this interface.
  // harness-login-token.test.ts prints the original token after refresh/exit.
});

// Fix round 1 of issue 223 (security review of b88b876). The token is the
// review's synthetic counterexample.
const reviewToken = 'review-SYNTHETIC-+/"\\ space-漢࿿-login-credential-987654321';
const metadataNames = ["auth_mode", "last_refresh", "scopes", "subscriptionType", "rateLimitTier", "expiresAt",
  "scope", "token_type", "expiry_date", "expiry", "expires_at"] as const;

for (const name of metadataNames) {
  it(`B1 F2 ${name}: a token under the metadata name, as the value or nested below it, is still a leaf`, async () => {
    const { secretLeaves } = await sourceModule();
    expect(secretLeaves({ [name]: reviewToken })).toEqual([reviewToken]);
    expect(secretLeaves({ [name]: { access_token: reviewToken } })).toEqual([reviewToken]);
    expect(secretLeaves({ [name]: { nested: { token: reviewToken } } })).toEqual([reviewToken]);
    expect(secretLeaves({ [name]: [reviewToken] })).toEqual([reviewToken]);
  });
}

it("B1 F2: metadata of its expected shape is still skipped, so ordinary words are not redacted", async () => {
  const { secretLeaves } = await sourceModule();
  expect(secretLeaves({
    auth_mode: "chatgpt", last_refresh: "2026-11-02T19:20:43.105467Z",
    claudeAiOauth: { scopes: ["user:inference", "user:profile"], subscriptionType: "max", rateLimitTier: "default_claude_max_20x", expiresAt: 1793648397166 },
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email openid",
    token_type: "Bearer", expiry_date: 1793648397166, expiry: "2026-11-02T20:00:00-07:00", expires_at: "2026-11-02",
    tokens: { access_token: "kept-access-leaf" },
  })).toEqual(["kept-access-leaf"]);
  // A long single word, such as a JSON Web Token, is not a scope word.
  const jwtLike = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl";
  expect(secretLeaves({ scope: jwtLike, token_type: jwtLike })).toEqual([jwtLike]);
});

it("B1 F5: GEMINI_CLI_HOME moves the Gemini store, and a relative one fails closed", async () => {
  const { credentialSourceFor } = await sourceModule();
  plant(join(home, ".gemini/oauth_creds.json"), { access_token: "inactive-default-gemini-token" });
  const moved = join(root, "gemini-home");
  plant(join(moved, ".gemini/oauth_creds.json"), { access_token: "active-moved-gemini-token" });
  const source = credentialSourceFor({ harnessId: "gemini", home, variables: { GEMINI_CLI_HOME: moved } });
  expect(source.paths).toEqual([join(moved, ".gemini/oauth_creds.json")]);
  expect((await Effect.runPromise(source.read)).map((leaf) => Redacted.value(leaf))).toEqual(["active-moved-gemini-token"]);
  const relative = credentialSourceFor({ harnessId: "gemini", home, variables: { GEMINI_CLI_HOME: "relative-gemini-home" } });
  expect(Exit.isFailure(await Effect.runPromiseExit(relative.read))).toBe(true);
});

it("B1 F7: a store with more than 256 distinct leaves fails closed, and the review's 24,000-leaf store is refused at open", async () => {
  const { credentialSourceFor } = await sourceModule();
  const { makeCredentialRegistry } = await import("../../src/accounts/credentialSource.ts");
  const path = join(home, ".codex/auth.json");
  const leaves = (count: number) => Array.from({ length: count }, (_, index) => `synthetic-secret-${String(index).padStart(5, "0")}-XY`);
  plant(path, { tokens: leaves(256) });
  const source = credentialSourceFor({ harnessId: "codex", home, variables: {} });
  expect(await Effect.runPromise(source.read)).toHaveLength(256);
  plant(path, { tokens: leaves(257) });
  expect(Exit.isFailure(await Effect.runPromiseExit(source.read))).toBe(true);
  const document = JSON.stringify({ tokens: leaves(24_000) });
  expect(Buffer.byteLength(document)).toBeLessThan(1024 * 1024);
  writeFileSync(path, document);
  const registry = makeCredentialRegistry();
  expect(Exit.isFailure(Effect.runSyncExit(registry.open(credentialSourceFor({ harnessId: "codex", home, variables: {} }))))).toBe(true);
  expect(registry.secrets()).toEqual([]);
});
