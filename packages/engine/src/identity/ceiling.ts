import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

import {
  acpPermissionOptionKinds, comparePermission, permissionForOptionKind,
  type Actor, type PermissionLevel,
} from "@shepherd/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

// Every reason is fixed text. None names a path, because a refused path can
// be the location of a secret.
class FolderRefused extends Data.TaggedError("FolderRefused")<{
  readonly reason: string;
}> {}

type Operation = "start" | "resume" | "reload";

// Trusted service configuration plus the caller and the requested folder.
// `home`, `stateFolder` and `pluginRoot` never come from an agent's request:
// the service reads them from its own settings and its own script path.
interface FolderRequest {
  readonly caller: Actor;
  readonly parentFolder: string;
  readonly folder: string;
  readonly home: string;
  readonly stateFolder: string;
  readonly pluginRoot: string;
}

interface Identity {
  readonly dev: bigint;
  readonly ino: bigint;
}

class FolderGrant {
  readonly realPath: string;
  readonly #request: FolderRequest;
  readonly #identity: Identity;
  constructor(realPath: string, request: FolderRequest, identity: Identity) {
    this.realPath = realPath;
    this.#request = request;
    this.#identity = identity;
  }
  static request(grant: FolderGrant): FolderRequest { return grant.#request; }
  static identity(grant: FolderGrant): Identity { return grant.#identity; }
}

class Refusal {
  readonly reason: string;
  constructor(reason: string) { this.reason = reason; }
}

const identityOf = (path: string): Identity => {
  const stats = statSync(path, { bigint: true });
  return { dev: stats.dev, ino: stats.ino };
};

const sameIdentity = (a: Identity, b: Identity): boolean => a.dev === b.dev && a.ino === b.ino;

const realDirectory = (path: string, reason: string): string => {
  if (!isAbsolute(path)) throw new Refusal(reason);
  try {
    const real = realpathSync(path);
    if (!statSync(real).isDirectory()) throw new Refusal(reason);
    return real;
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(reason);
  }
};

// The identities of a resolved path and of each of its ancestors up to the
// root. Because the path is already resolved, no component is a symbolic
// link, so these are the directories the kernel would walk (decision row 65).
const ancestry = (real: string): ReadonlyArray<Identity> => {
  const identities: Array<Identity> = [];
  for (let path = real; ; path = dirname(path)) {
    identities.push(identityOf(path));
    if (path === parse(path).root) return identities;
  }
};

// Opens without following a symbolic link and without blocking on a FIFO, so
// an agent-written `.git` cannot redirect or stall the check.
const readSmallFile = (path: string): string | undefined => {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size > 4096) return undefined;
    const buffer = Buffer.alloc(stats.size);
    let read = 0;
    while (read < buffer.byteLength) {
      const count = readSync(fd, buffer, read, buffer.byteLength - read, read);
      if (count === 0) break;
      read += count;
    }
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
};

const firstLine = (text: string): string => text.split("\n", 1)[0]!.replace(/\r$/, "");

const resolvedDirectory = (base: string, path: string): string | undefined => {
  try {
    const real = realpathSync(resolve(base, path));
    return lstatSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
};

// The git common directory of a folder, read from `.git` and `commondir`
// directly; `git` is never run (decision row 56). A `.git` directory (a main
// checkout) is its own common directory. A `.git` file must name a linked
// worktree's private folder, which git always keeps at
// `<common directory>/worktrees/<name>` with a `commondir` file; when that
// folder also holds git's `gitdir` back-link, it must point at this folder's
// `.git`. A `.git` file that simply names another repository's common
// directory is not accepted.
const commonDirectory = (folder: string): Identity | undefined => {
  const dotGit = join(folder, ".git");
  let stats;
  try {
    stats = lstatSync(dotGit);
  } catch {
    return undefined;
  }
  if (stats.isDirectory()) return identityOf(dotGit);
  if (!stats.isFile()) return undefined;
  const text = readSmallFile(dotGit);
  const match = text === undefined ? null : /^gitdir: (.+)$/.exec(firstLine(text));
  if (match === null) return undefined;
  const gitdir = resolvedDirectory(folder, match[1]!);
  if (gitdir === undefined) return undefined;
  const commondir = readSmallFile(join(gitdir, "commondir"));
  if (commondir === undefined) return undefined;
  const common = resolvedDirectory(gitdir, firstLine(commondir));
  if (common === undefined) return undefined;
  const worktrees = resolvedDirectory(common, "worktrees");
  if (worktrees === undefined || !sameIdentity(identityOf(dirname(gitdir)), identityOf(worktrees))) return undefined;
  const backLink = readSmallFile(join(gitdir, "gitdir"));
  if (backLink !== undefined) {
    try {
      if (!sameIdentity(identityOf(resolve(gitdir, firstLine(backLink))), identityOf(dotGit))) return undefined;
    } catch {
      return undefined;
    }
  }
  return identityOf(common);
};

const check = (request: FolderRequest): FolderGrant => {
  const real = realDirectory(request.folder, "folder is not an existing directory");
  const identity = identityOf(real);
  if (request.caller._tag === "owner") return new FolderGrant(real, request, identity);

  // Refused folders (decision rows 56 and 65): the folder may not be, be
  // inside, or contain the owner's home folder, the state folder or the
  // plugin root, compared by device and inode. A protected folder that
  // cannot be resolved refuses every agent-started child.
  const own = ancestry(real);
  for (const protectedPath of [request.home, request.stateFolder, request.pluginRoot]) {
    const protectedReal = realDirectory(protectedPath, "a protected folder cannot be resolved");
    const protectedIdentity = identityOf(protectedReal);
    if (own.some((ancestor) => sameIdentity(ancestor, protectedIdentity))) {
      throw new Refusal("folder is, or is inside, a protected folder");
    }
    if (ancestry(protectedReal).some((ancestor) => sameIdentity(ancestor, identity))) {
      throw new Refusal("folder contains a protected folder");
    }
  }

  // Containment (decision row 35a), by identity rather than by spelling.
  const parentReal = realDirectory(request.parentFolder, "parent folder is not an existing directory");
  const parentIdentity = identityOf(parentReal);
  if (own.some((ancestor) => sameIdentity(ancestor, parentIdentity))) return new FolderGrant(real, request, identity);
  const childCommon = commonDirectory(real);
  const parentCommon = commonDirectory(parentReal);
  if (childCommon !== undefined && parentCommon !== undefined && sameIdentity(childCommon, parentCommon)) {
    return new FolderGrant(real, request, identity);
  }
  throw new Refusal("folder is outside the parent's folder and its repository");
};

const run = <A>(body: () => A): Effect.Effect<A, FolderRefused> =>
  Effect.try({
    try: body,
    catch: (error) => new FolderRefused({
      reason: error instanceof Refusal ? error.reason : "folder check failed",
    }),
  });

// The ceiling's folder rule (criterion 5.12, task 5a.2). The grant keeps the
// folder's resolved real path and its device and inode, and the original
// request, so every later spawn can check it all again.
export const checkFolder = (request: FolderRequest): Effect.Effect<FolderGrant, FolderRefused> =>
  run(() => check(request));

// Called immediately before every spawn, `resume` and reload (decision rows
// 56 and 65). The original request is checked again from the start, the
// requested spelling must still resolve to the stored real path, and that
// path must still be the same directory. The runner spawns in, and passes to
// `session/new`, only the path this returns.
export const folderForSpawn = (grant: FolderGrant, operation: Operation): Effect.Effect<string, FolderRefused> =>
  run(() => {
    if (!(grant instanceof FolderGrant)) throw new Refusal("folder grant is not valid");
    const again = check(FolderGrant.request(grant));
    const stored = grant.realPath;
    if (again.realPath !== stored || realpathSync(stored) !== stored) {
      throw new Refusal(`folder moved before ${operation}`);
    }
    if (!sameIdentity(identityOf(stored), FolderGrant.identity(grant))
      || !sameIdentity(FolderGrant.identity(again), FolderGrant.identity(grant))) {
      throw new Refusal(`folder was replaced before ${operation}`);
    }
    return stored;
  });

// An agent may give a child its own mode or a lower one; the owner may give
// any mode (decision row 35).
export const canUseMode = (caller: Actor, parentMode: PermissionLevel, requestedMode: PermissionLevel): boolean =>
  caller._tag === "owner" || comparePermission(requestedMode, parentMode) <= 0;

// Harness settings that change what a harness may do beyond this session
// (decision rows 56 and 65). Segments are compared without case, so a
// differently cased spelling is still caught.
const isHarnessSettings = (path: string): boolean => {
  const segments = path.split(sep).map((segment) => segment.toLowerCase());
  return segments.some((segment, index) =>
    segment === ".claude" || segment === ".codex" || segment === ".gemini" || segment === ".cursor"
    || (segment === ".mcp.json" && index === segments.length - 1));
};

const isInside = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

// The spellings of a path to check: as written, and with its longest existing
// ancestor resolved, so a symbolic link to a settings file is caught.
const spellings = (path: string): ReadonlyArray<string> => {
  const written = resolve(path);
  const rest: Array<string> = [];
  for (let current = written; ; current = dirname(current)) {
    try {
      return [written, join(realpathSync(current), ...rest)];
    } catch {
      if (current === parse(current).root) return [written];
      rest.unshift(basename(current));
    }
  }
};

// Who may choose a permission option (decision rows 35b, 56 and 65). The
// owner may choose any. For an agent: an unknown kind, an option that
// persists beyond the session (by its flag or its kind) and a write to a
// harness settings path go to the owner whatever the agent's mode; an option
// above the agent's mode is refused; anything else is allowed.
export const canAnswerOption = (request: {
  readonly caller: Actor;
  readonly mode: PermissionLevel;
  readonly option: { readonly kind: string; readonly level: PermissionLevel; readonly persistent: boolean };
  readonly settingsPath?: string | undefined;
  readonly configDir?: string | undefined;
}): "allow" | "owner" | "refuse" => {
  if (request.caller._tag === "owner") return "allow";
  const { kind, level, persistent } = request.option;
  if (!(acpPermissionOptionKinds as ReadonlyArray<string>).includes(kind)) return "owner";
  const implied = permissionForOptionKind(kind);
  if (persistent || implied.persistent) return "owner";
  if (request.settingsPath !== undefined) {
    const paths = spellings(request.settingsPath);
    if (paths.some(isHarnessSettings)) return "owner";
    if (request.configDir !== undefined) {
      const folders = spellings(request.configDir);
      if (paths.some((path) => folders.some((folder) => isInside(path, folder)))) return "owner";
    }
  }
  const effective = comparePermission(level, implied.level) >= 0 ? level : implied.level;
  return comparePermission(effective, request.mode) <= 0 ? "allow" : "refuse";
};
