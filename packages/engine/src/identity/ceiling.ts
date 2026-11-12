import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, realpathSync, statSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

import {
  acpPermissionOptionKinds, comparePermission, permissionForOptionKind,
  type Actor, type PermissionLevel,
} from "@lgtm/contracts";
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

// `readMountInfo` replaces the read of `/proc/self/mountinfo`, for tests.
interface Dependencies {
  readonly readMountInfo?: (() => string) | undefined;
}

interface Identity {
  readonly dev: bigint;
  readonly ino: bigint;
}

class FolderGrant {
  readonly realPath: string;
  readonly #request: FolderRequest;
  readonly #dependencies: Dependencies;
  readonly #identity: Identity;
  constructor(realPath: string, request: FolderRequest, dependencies: Dependencies, identity: Identity) {
    this.realPath = realPath;
    this.#request = request;
    this.#dependencies = dependencies;
    this.#identity = identity;
  }
  static request(grant: FolderGrant): FolderRequest { return grant.#request; }
  static dependencies(grant: FolderGrant): Dependencies { return grant.#dependencies; }
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
// an agent-written file cannot redirect or stall the check. Anything but a
// readable regular file of at most 4 KiB reads as absent.
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
  } catch {
    return undefined;
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

// The git common directory of a folder that holds `.git`, read from `.git`,
// `commondir` and `gitdir` directly; `git` is never run (decision row 56).
// A `.git` directory (a main checkout) is its own common directory. A `.git`
// file must be a registered linked worktree, checked both ways (fix round 1,
// ruling 8): its `gitdir:` names `<common directory>/worktrees/<name>`, that
// folder's `commondir` names the common directory, and that folder's
// `gitdir` back-link, a readable regular file, names this folder's `.git`
// by device and inode. A missing or unreadable back-link refuses.
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
  if (backLink === undefined) return undefined;
  try {
    if (!sameIdentity(identityOf(resolve(gitdir, firstLine(backLink))), identityOf(dotGit))) return undefined;
  } catch {
    return undefined;
  }
  return identityOf(common);
};

// The repository a parent works in: the first folder, from the parent's
// own folder up to the root, that holds `.git` (fix round 1, ruling 9).
const parentCommonDirectory = (parentReal: string): Identity | undefined => {
  for (let path = parentReal; ; path = dirname(path)) {
    let present = true;
    try {
      lstatSync(join(path, ".git"));
    } catch {
      present = false;
    }
    if (present) return commonDirectory(path);
    if (path === parse(path).root) return undefined;
  }
};

// The mount points listed in a `/proc/<pid>/mountinfo` text: the fifth
// field, with the kernel's octal escapes for space, tab, newline and
// backslash undone.
const mountPoints = (table: string): ReadonlyArray<string> =>
  table.split("\n").flatMap((line) => {
    const field = line.split(" ")[4];
    return field === undefined || field === ""
      ? []
      : [field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))];
  });

const readMountTable = (dependencies: Dependencies): string | undefined => {
  if (dependencies.readMountInfo !== undefined) return dependencies.readMountInfo();
  if (process.platform !== "linux") return undefined;
  return readFileSync("/proc/self/mountinfo", "utf8");
};

// A protected folder, or an ancestor of one, mounted at or beneath the
// requested folder (decision row 65, "or contains"; fix round 1, ruling 10).
// The ancestor walk cannot see a mount below the folder, so every mount point
// there is compared by device and inode. On Linux an unreadable mount table
// refuses; other platforms have no table, as issue 49 records.
const containsMountedProtected = (
  dependencies: Dependencies, real: string, protectedIdentities: ReadonlyArray<Identity>,
): boolean => {
  let table: string | undefined;
  try {
    table = readMountTable(dependencies);
  } catch {
    throw new Refusal("the mount table cannot be read");
  }
  if (table === undefined) return false;
  const below = real === parse(real).root ? real : real + sep;
  for (const mountPoint of mountPoints(table)) {
    if (mountPoint !== real && !mountPoint.startsWith(below)) continue;
    let identity: Identity;
    try {
      identity = identityOf(mountPoint);
    } catch {
      throw new Refusal("a mount point inside the folder cannot be checked");
    }
    if (protectedIdentities.some((protectedIdentity) => sameIdentity(protectedIdentity, identity))) return true;
  }
  return false;
};

const check = (request: FolderRequest, dependencies: Dependencies): FolderGrant => {
  const real = realDirectory(request.folder, "folder is not an existing directory");
  const identity = identityOf(real);
  if (request.caller._tag === "owner") return new FolderGrant(real, request, dependencies, identity);

  // Refused folders (decision rows 56 and 65): the folder may not be, be
  // inside, or contain the owner's home folder, the state folder or the
  // plugin root, compared by device and inode. A protected folder that
  // cannot be resolved refuses every agent-started child.
  const own = ancestry(real);
  const protectedLines: Array<Identity> = [];
  for (const protectedPath of [request.home, request.stateFolder, request.pluginRoot]) {
    const protectedReal = realDirectory(protectedPath, "a protected folder cannot be resolved");
    const protectedIdentity = identityOf(protectedReal);
    if (own.some((ancestor) => sameIdentity(ancestor, protectedIdentity))) {
      throw new Refusal("folder is, or is inside, a protected folder");
    }
    const line = ancestry(protectedReal);
    if (line.some((ancestor) => sameIdentity(ancestor, identity))) {
      throw new Refusal("folder contains a protected folder");
    }
    protectedLines.push(...line);
  }
  if (containsMountedProtected(dependencies, real, protectedLines)) {
    throw new Refusal("folder contains a mounted protected folder");
  }

  // Containment (decision row 35a), by identity rather than by spelling.
  const parentReal = realDirectory(request.parentFolder, "parent folder is not an existing directory");
  const parentIdentity = identityOf(parentReal);
  if (own.some((ancestor) => sameIdentity(ancestor, parentIdentity))) return new FolderGrant(real, request, dependencies, identity);
  const childCommon = commonDirectory(real);
  const parentCommon = parentCommonDirectory(parentReal);
  if (childCommon !== undefined && parentCommon !== undefined && sameIdentity(childCommon, parentCommon)) {
    return new FolderGrant(real, request, dependencies, identity);
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
export const checkFolder = (
  request: FolderRequest, dependencies: Dependencies = {},
): Effect.Effect<FolderGrant, FolderRefused> =>
  run(() => check(request, dependencies));

// Called immediately before every spawn, `resume` and reload (decision rows
// 56 and 65). The original request is checked again from the start, the
// requested spelling must still resolve to the stored real path, and that
// path must still be the same directory. The runner spawns in, and passes to
// `session/new`, only the path this returns. Issue 49 records the gap left
// between this check and the spawn.
export const folderForSpawn = (grant: FolderGrant, operation: Operation): Effect.Effect<string, FolderRefused> =>
  run(() => {
    if (!(grant instanceof FolderGrant)) throw new Refusal("folder grant is not valid");
    const again = check(FolderGrant.request(grant), FolderGrant.dependencies(grant));
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
    segment === ".claude" || segment === ".codex" || segment === ".gemini" || segment === ".cursor" || segment === ".lgtm" || segment === ".lgcode"
    || (segment === ".mcp.json" && index === segments.length - 1));
};

const isInside = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

// The kernel's symbolic-link limit on Linux.
const maximumLinks = 40;

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

// Resolves a path the way the kernel would open it (fix round 1, ruling 7):
// one component at a time, following each existing symbolic link before the
// next `..` is applied. Only components missing past the last existing one
// are kept as written, and `..` among them is not resolved. Returns
// undefined for anything the kernel would refuse or that cannot be read,
// such as a link loop, a denied component or a file used as a folder.
const resolveLikeKernel = (path: string): string | undefined => {
  if (!isAbsolute(path)) return undefined;
  const pending = path.split(sep).filter((part) => part !== "" && part !== ".");
  let current = parse(path).root;
  let links = 0;
  while (pending.length > 0) {
    const part = pending.shift()!;
    if (part === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    let stats;
    try {
      stats = lstatSync(next);
    } catch (error) {
      if (errorCode(error) !== "ENOENT" || pending.includes("..")) return undefined;
      return join(next, ...pending);
    }
    if (stats.isSymbolicLink()) {
      if (++links > maximumLinks) return undefined;
      let target: string;
      try {
        target = readlinkSync(next);
      } catch {
        return undefined;
      }
      pending.unshift(...target.split(sep).filter((piece) => piece !== "" && piece !== "."));
      if (isAbsolute(target)) current = parse(target).root;
      continue;
    }
    if (pending.length > 0 && !stats.isDirectory()) return undefined;
    current = next;
  }
  return current;
};

// Who may choose a permission option (decision rows 35b, 56 and 65). The
// owner may choose any. For an agent: an unknown kind, an option that
// persists beyond the session (by its flag or its kind) and a write to a
// harness settings path go to the owner whatever the agent's mode; a
// settings path that cannot be resolved goes to the owner too. An option
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
    const resolved = resolveLikeKernel(request.settingsPath);
    if (resolved === undefined) return "owner";
    const paths = [resolve(request.settingsPath), resolved];
    if (paths.some(isHarnessSettings)) return "owner";
    if (request.configDir !== undefined) {
      const folders = [resolve(request.configDir), resolveLikeKernel(request.configDir) ?? resolve(request.configDir)];
      if (paths.some((path) => folders.some((folder) => isInside(path, folder)))) return "owner";
    }
  }
  const effective = comparePermission(level, implied.level) >= 0 ? level : implied.level;
  return comparePermission(effective, request.mode) <= 0 ? "allow" : "refuse";
};
