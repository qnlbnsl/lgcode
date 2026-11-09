import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import { checkedMetadata, cleanText, directory, filePath, inside, slug, smallFile } from "./paths.ts";
import { parseChanges, parseConflict, parseFiles, parseHistory, parseNumstat } from "./parse.ts";
import { boundedUtf8, gitProcess, processFailure, type ProcessReply } from "./process.ts";
import { GitFailure, type Bounded, type Change, type Conflict, type ConflictChoice, type Diff, type DiscardPlan,
  type GitFailureReason, type GitService, type Repository, type Review, type Worktree } from "./types.ts";
export * from "./types.ts";

export interface GitConfiguration {
  /** Trusted engine setting, never an agent-supplied root. */
  readonly workspaceFolder: string;
  readonly maxOutputBytes?: number;
  readonly maxDiffBytes?: number;
  readonly maxEntries?: number;
  readonly timeoutMs?: number;
  readonly operationTimeoutMs?: number;
}
const fail = (reason: GitFailureReason): never => { throw new GitFailure({ reason }); };
const hash = (...parts: ReadonlyArray<string | Buffer>) => {
  const value = createHash("sha256");
  for (const part of parts) { value.update(String(Buffer.byteLength(part))); value.update(":"); value.update(part); }
  return value.digest("hex");
};
const exists = async (path: string) => {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
};
const bound = (requested: number | undefined, fallback: number, maximum: number) =>
  requested === undefined ? fallback : Number.isSafeInteger(requested) && requested > 0 && requested <= maximum ? requested : fail("output_limit");

/** Raw, bounded local data. W04 must authorize the caller/project and redact
 * every returned string through the production redactor before API delivery.
 * This service neither registers commands nor writes project events. */
export const makeGitService = (configuration: GitConfiguration): GitService => {
  const outputBytes = bound(configuration.maxOutputBytes, 1024 * 1024, 2 * 1024 * 1024);
  const diffBytes = bound(configuration.maxDiffBytes, 128 * 1024, 256 * 1024);
  const entries = bound(configuration.maxEntries, 200, 500);
  const timeoutMs = bound(configuration.timeoutMs, 10_000, 60_000);
  const operationMs = bound(configuration.operationTimeoutMs, 60_000, 120_000);
  let rootIdentity: { path: string; dev: number; ino: number } | undefined;
  const root = async () => {
    const path = await directory(resolve(configuration.workspaceFolder), configuration.workspaceFolder);
    const info = await stat(path);
    if (rootIdentity === undefined) rootIdentity = { path, dev: info.dev, ino: info.ino };
    else if (rootIdentity.path !== path || rootIdentity.dev !== info.dev || rootIdentity.ino !== info.ino) fail("invalid_path");
    return path;
  };
  // A finite queue serializes service mutations, including both sides of a
  // merge. Separate processes and terminal edits still require fingerprints.
  let tail: Promise<void> = Promise.resolve(), queued = 0;
  const operation = <A>(body: (signal: AbortSignal) => Promise<A>) => Effect.tryPromise({
    try: async (interrupted) => {
      if (queued >= 64) return fail("busy");
      queued++;
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((done) => { release = done; });
      try {
        await previous;
        const signal = AbortSignal.any([interrupted, AbortSignal.timeout(operationMs)]);
        if (signal.aborted) return fail("cancelled");
        return await body(signal);
      } finally { queued--; release(); }
    },
    catch: (error) => error instanceof GitFailure ? error : new GitFailure({ reason: "invalid_path" }),
  });
  const run = async (folder: string, args: ReadonlyArray<string>, signal: AbortSignal, truncate = false, bytes = outputBytes): Promise<ProcessReply> => {
    await directory(await root(), folder);
    return gitProcess(folder, args, { bytes, timeoutMs }, signal, truncate);
  };
  const git = async (folder: string, args: ReadonlyArray<string>, signal: AbortSignal) => {
    const reply = await run(folder, args, signal);
    if (reply.code !== 0) throw processFailure(reply);
    return reply.stdout;
  };
  const repository = async (folder: string, signal: AbortSignal): Promise<Repository> => {
    const base = await root(), path = await directory(base, folder);
    if (!await exists(join(path, ".git"))) return fail("not_repository");
    const commonDirectory = await checkedMetadata(base, path);
    const actualCommon = (await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).trimEnd();
    if (await directory(base, actualCommon) !== commonDirectory) return fail("invalid_path");
    const top = (await git(path, ["rev-parse", "--show-toplevel"], signal)).trimEnd();
    if (await realpath(top) !== path) return fail("not_repository");
    return { path, name: basename(path), commonDirectory };
  };
  const list = <A>(items: ReadonlyArray<A>, maximum = entries): Bounded<A> => ({ items: items.slice(0, maximum), truncated: items.length > maximum });
  const completeChanges = async (folder: string, signal: AbortSignal): Promise<Change[]> => {
    const changes = parseChanges(await git(folder, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], signal));
    if (changes.length > entries) return fail("output_limit");
    return changes;
  };
  const head = async (folder: string, signal: AbortSignal): Promise<string | null> => {
    const reply = await run(folder, ["rev-parse", "--verify", "--quiet", "HEAD"], signal);
    if (reply.code === 1) return null;
    if (reply.code !== 0) throw processFailure(reply);
    return reply.stdout.trim();
  };
  const branch = async (folder: string, signal: AbortSignal): Promise<string | null> => {
    const reply = await run(folder, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal);
    if (reply.code === 1) return null;
    if (reply.code !== 0) throw processFailure(reply);
    return reply.stdout.trim();
  };
  const ref = async (folder: string, value: string, signal: AbortSignal): Promise<string> => {
    // Deliberately accepts branch names and object IDs, not revision syntax,
    // reflog selectors, option prefixes or paths.
    if (!cleanText(value, 256) || value.startsWith("-") || /[~^:@{}\s\\]/.test(value)) return fail("invalid_ref");
    const reply = await run(folder, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`], signal);
    if (reply.code !== 0) return fail("invalid_ref");
    return reply.stdout.trim();
  };
  const localBranch = async (folder: string, name: string, signal: AbortSignal) => {
    if (!cleanText(name, 256) || name.startsWith("-")) return fail("invalid_ref");
    if ((await run(folder, ["check-ref-format", "--branch", name], signal)).code !== 0) return fail("invalid_ref");
    return ref(folder, `refs/heads/${name}`, signal);
  };
  const history = async (folder: string, revision: string, signal: AbortSignal, maximum = entries) =>
    list(parseHistory(await git(folder, ["log", `--max-count=${maximum + 1}`, "-z", "--format=%H%x00%P%x00%an%x00%cI%x00%s", revision, "--"], signal)), maximum);
  const filesBetween = async (folder: string, args: string[], signal: AbortSignal) =>
    list(parseFiles(await git(folder, [...args, "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", "--"], signal)));
  const patch = async (folder: string, args: string[], signal: AbortSignal, paths: string[] = []): Promise<Diff> => {
    const reply = await run(folder, [...args, "--no-ext-diff", "--no-textconv", "--no-color", "--patch", "--", ...paths], signal, true, diffBytes);
    if (reply.code !== 0 && !reply.truncated && !(args.includes("--no-index") && reply.code === 1)) throw processFailure(reply);
    const stats = await run(folder, [...args, "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--", ...paths], signal);
    if (stats.code !== 0 && !(args.includes("--no-index") && stats.code === 1)) throw processFailure(stats);
    return { patch: reply.stdout, ...parseNumstat(stats.stdout), truncated: reply.truncated };
  };
  const diff = async (folder: string, options: { path?: string; staged?: boolean; commit?: string }, signal: AbortSignal): Promise<Diff> => {
    const path = options.path;
    if (path !== undefined) await filePath(folder, path);
    if (options.commit !== undefined) {
      const commit = await ref(folder, options.commit, signal);
      return patch(folder, ["show", "--format=", "--first-parent", commit], signal, path === undefined ? [] : [path]);
    }
    const currentHead = options.staged === undefined ? await head(folder, signal) : null;
    const diffArgs = ["diff", ...(options.staged === true ? ["--cached"] : currentHead === null ? [] : [currentHead])];
    if (path !== undefined) {
      const changes = await completeChanges(folder, signal);
      const change = changes.find((item) => item.path === path);
      if ((change?.untracked || options.staged === undefined && currentHead === null && change?.index === "A") && options.staged !== true) return patch(folder, ["diff", "--no-index"], signal, ["/dev/null", await filePath(folder, path)]);
      if (change?.originalPath !== null && change?.originalPath !== undefined) await filePath(folder, change.originalPath);
      return patch(folder, diffArgs, signal, change?.originalPath ? [change.originalPath, path] : [path]);
    }
    const tracked = options.staged === undefined && currentHead === null
      ? { patch: "", additions: 0, deletions: 0, binary: false, truncated: false }
      : await patch(folder, diffArgs, signal);
    if (options.staged === true) return tracked;
    let result = tracked;
    for (const change of await completeChanges(folder, signal)) {
      if ((!change.untracked && !(options.staged === undefined && currentHead === null && change.index === "A")) || result.truncated) continue;
      const next = await diff(folder, { path: change.path }, signal);
      const joined = Buffer.from(result.patch + next.patch);
      result = { patch: boundedUtf8(joined, diffBytes), additions: result.additions + next.additions,
        deletions: result.deletions + next.deletions, binary: result.binary || next.binary,
        truncated: next.truncated || joined.length > diffBytes };
    }
    return result;
  };
  const worktrees = async (folder: string, signal: AbortSignal): Promise<Bounded<Worktree>> => {
    const fields = (await git(folder, ["worktree", "list", "--porcelain", "-z"], signal)).split("\0"), items: Worktree[] = [];
    let current: { path: string; head: string | null; branch: string | null; locked: boolean; available: boolean } | undefined;
    for (const field of fields) {
      if (field.startsWith("worktree ")) {
        if (current !== undefined) items.push(current);
        const path = field.slice(9);
        let available = false;
        try { await repository(path, signal); available = true; } catch (error) { if (!(error instanceof GitFailure) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        // Do not disclose paths of linked worktrees outside the configured root.
        current = inside(await root(), path) ? { path, head: null, branch: null, locked: false, available } : undefined;
      } else if (current !== undefined) {
        if (field.startsWith("HEAD ")) current.head = /^0+$/.test(field.slice(5)) ? null : field.slice(5);
        if (field.startsWith("branch refs/heads/")) current.branch = field.slice(18);
        if (field.startsWith("locked")) current.locked = true;
      }
    }
    if (current !== undefined) items.push(current);
    return list(items);
  };
  const resetPaths = async (folder: string, paths: string[], signal: AbortSignal) => {
    if (paths.length === 0) return;
    for (const path of paths) await filePath(folder, path);
    if (await head(folder, signal) === null) await git(folder, ["rm", "--cached", "-f", "--", ...paths], signal);
    else await git(folder, ["reset", "--quiet", "HEAD", "--", ...paths], signal);
  };
  const changePaths = (change: Change) => change.originalPath === null ? [change.path] : [change.originalPath, change.path];
  // A staged rename has already removed the original path from the index.
  // add must update its destination only; reset still needs both paths.
  const stagePaths = (change: Change) => /[RC]/.test(change.index) ? [change.path] : changePaths(change);
  const planDiscard = async (folder: string, requested: ReadonlyArray<string> | undefined, signal: AbortSignal): Promise<DiscardPlan> => {
    const changes = await completeChanges(folder, signal);
    if (requested !== undefined && (requested.length > entries || requested.some((path) => !changes.some((change) => change.path === path && !change.conflict)))) return fail("invalid_path");
    const paths = changes.filter((change) => !change.conflict && change.unstaged && (requested === undefined || requested.includes(change.path))).map((change) => change.path);
    const parts: (string | Buffer)[] = [folder, await head(folder, signal) ?? "", JSON.stringify(changes),
      await git(folder, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--raw", "--no-abbrev", "-z", "--"], signal)];
    for (const path of paths) {
      const file = await filePath(folder, path);
      parts.push(path, await exists(file) ? await smallFile(file, outputBytes) : "<deleted>");
    }
    return { paths, fingerprint: hash(...parts) };
  };
  const conflict = async (folder: string, path: string, signal: AbortSignal): Promise<Conflict> => {
    const file = await filePath(folder, path);
    if (!(await completeChanges(folder, signal)).some((change) => change.path === path && change.conflict)) return fail("conflicts");
    const index = await git(folder, ["ls-files", "--unmerged", "-z", "--", path], signal);
    const stages = new Map<string, string>();
    for (const row of index.split("\0").filter(Boolean)) {
      const match = /^(\d+) ([0-9a-f]+) ([123])\t/.exec(row);
      if (match === null || match[1] !== "100644" && match[1] !== "100755") return fail("unsupported_conflict");
      stages.set(match[3]!, match[2]!);
    }
    if (stages.size !== 3) return fail("unsupported_conflict");
    const blobs: string[] = [];
    for (const stage of ["2", "1", "3"]) {
      const blob = await git(folder, ["cat-file", "blob", stages.get(stage)!], signal);
      if (blob.includes("\0") || blob.includes("\ufffd")) return fail("unsupported_conflict");
      blobs.push(blob);
    }
    const current = await smallFile(file, outputBytes), currentHead = await head(folder, signal);
    if (currentHead === null) return fail("unsupported_conflict");
    const temporary = await mkdtemp(join(tmpdir(), "lgcode-git-conflict-"));
    let merged: ProcessReply;
    // Existing marker-like source text cannot become a synthetic hunk.
    let markerSize = 7;
    for (const blob of blobs) {
      for (const match of blob.matchAll(/^(<+|\|+|=+|>+)(?: |\r?$)/gm)) markerSize = Math.max(markerSize, match[1]!.length + 1);
    }
    try {
      const paths = ["ours", "base", "theirs"].map((name) => join(temporary, name));
      for (let i = 0; i < paths.length; i++) await writeFile(paths[i]!, blobs[i]!, { mode: 0o600 });
      merged = await run(folder, ["merge-file", "--stdout", "--diff3", `--marker-size=${markerSize}`, "-L", "ours", "-L", "base", "-L", "theirs", "--", ...paths], signal);
      if (merged.code < 0 || merged.code > 127) return fail("unsupported_conflict");
    } finally { await rm(temporary, { recursive: true, force: true }); }
    const segments = parseConflict(merged.stdout, markerSize);
    // merge-file adds a separator newline before a closing marker when a
    // source has no final newline. It is not part of that source side.
    const last = segments.at(-1);
    if (last?.kind === "conflict") {
      for (const [side, blob] of [[last.ours, blobs[0]!], [last.base, blobs[1]!], [last.theirs, blobs[2]!]] as const) {
        if (!blob.endsWith("\n") && side.length > 0) (side as string[])[side.length - 1] = side.at(-1)!.replace(/\n$/, "");
      }
    }
    if (!segments.some((segment) => segment.kind === "conflict")) return fail("unsupported_conflict");
    return { path, fingerprint: hash(folder, path, currentHead, index, current), head: currentHead,
      ours: blobs[0]!, base: blobs[1]!, theirs: blobs[2]!, segments,
      choices: segments.filter((segment) => segment.kind === "conflict").map(() => null) };
  };
  const checkedSelection = async (folder: string, selection: Conflict, signal: AbortSignal) => {
    const actual = await conflict(folder, selection.path, signal);
    if (actual.fingerprint !== selection.fingerprint || actual.head !== selection.head) return fail("stale_state");
    if (selection.choices.length !== actual.choices.length || selection.choices.some((choice) => choice !== null && !["ours", "theirs", "both"].includes(choice))) return fail("incomplete_choices");
    return actual;
  };
  const review = async (folder: string, base: string, signal: AbortSignal): Promise<Review> => {
    const currentBranch = await branch(folder, signal), currentHead = await head(folder, signal);
    if (currentBranch === null || currentHead === null) return fail("invalid_ref");
    const baseHead = await localBranch(folder, base, signal);
    return { head: currentHead, baseHead, branch: currentBranch, base,
      commits: await history(folder, `${baseHead}..${currentHead}`, signal),
      files: await filesBetween(folder, ["diff", `${baseHead}...${currentHead}`], signal),
      diff: await patch(folder, ["diff", `${baseHead}...${currentHead}`], signal) };
  };
  const remote = async (folder: string, signal: AbortSignal) => {
    if (!(await git(folder, ["remote"], signal)).split("\n").includes("origin")) return fail("missing_remote");
  };
  const upstream = async (folder: string, signal: AbortSignal) => {
    const reply = await run(folder, ["rev-parse", "--verify", "--quiet", "@{upstream}"], signal);
    if (reply.code !== 0) return fail("missing_upstream");
    return reply.stdout.trim();
  };
  const mergeHead = async (folder: string, signal: AbortSignal): Promise<string | null> => {
    const reply = await run(folder, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], signal);
    if (reply.code === 1) return null;
    if (reply.code !== 0) throw processFailure(reply);
    return reply.stdout.trim();
  };
  const mainComparison = async (source: string, destination: string, signal: AbortSignal) => {
    const from = await repository(source, signal), to = await repository(destination, signal);
    if (from.commonDirectory !== to.commonDirectory || from.path === to.path) return fail("invalid_path");
    const base = await branch(to.path, signal), sourceBranch = await branch(from.path, signal);
    if (base === null || !["main", "master"].includes(base) || sourceBranch === null || ["main", "master"].includes(sourceBranch)) return fail("invalid_ref");
    const comparison = await review(from.path, base, signal);
    if (comparison.baseHead !== await head(to.path, signal)) return fail("stale_state");
    // A binary or bounded partial patch is not an all-files review. This path
    // refuses honestly instead of letting an approval imply unseen contents.
    if (comparison.commits.truncated || comparison.files.truncated || comparison.diff.truncated || comparison.diff.binary) return fail("unsupported_review");
    return { from, to, comparison };
  };
  const withRepo = <A>(folder: string, body: (path: string, signal: AbortSignal) => Promise<A>) => operation(async (signal) => body((await repository(folder, signal)).path, signal));
  const excludeManagedWorktrees = async (common: string) => {
    const info = join(common, "info");
    if (!await exists(info)) await mkdir(info, { mode: 0o700 });
    if (await directory(await root(), info) !== info) return fail("invalid_path");
    const path = join(info, "exclude");
    const previous = await exists(path) ? (await smallFile(path, 65_536)).toString("utf8") : "";
    if (previous.split(/\r?\n/).some((line) => line === "/.worktrees/" || line === ".worktrees/")) return;
    // Keep generated checkouts out of the parent's untracked changes without
    // changing a tracked .gitignore or the user's existing exclude rules.
    const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      if (!(await file.stat()).isFile()) return fail("invalid_path");
      await file.write(`${previous.endsWith("\n") || previous === "" ? "" : "\n"}/.worktrees/\n`);
    } finally { await file.close(); }
  };
  return {
    discover: () => operation(async (signal) => {
      const base = await root(), pending = [{ path: base, depth: 0 }], items: Repository[] = [];
      let visited = 0, truncated = false;
      while (pending.length > 0) {
        const next = pending.shift()!;
        if (++visited > 500 || signal.aborted) { truncated = true; break; }
        if (await exists(join(next.path, ".git"))) {
          try { items.push(await repository(next.path, signal)); } catch (error) { if (error instanceof GitFailure && ["timeout", "cancelled", "output_limit", "git_unavailable"].includes(error.reason)) throw error; }
          if (items.length > entries) { truncated = true; break; }
          continue;
        }
        if (next.depth >= 3) { truncated = true; continue; }
        const directoryHandle = await opendir(next.path);
        for await (const entry of directoryHandle) {
          if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
          if (pending.length + visited >= 500) { truncated = true; break; }
          pending.push({ path: join(next.path, entry.name), depth: next.depth + 1 });
        }
      }
      return { items: items.slice(0, entries), truncated };
    }),
    register: (folder) => operation((signal) => repository(folder, signal)),
    createRepository: (name) => operation(async (signal) => {
      const base = await root(), path = join(base, slug(name));
      if (await exists(path)) return fail("collision");
      await mkdir(path, { mode: 0o700 });
      await git(path, ["init", "--initial-branch=main", "--", path], signal);
      return repository(path, signal);
    }),
    branches: (folder) => withRepo(folder, async (path, signal) => {
      const current = await branch(path, signal);
      const text = await git(path, ["for-each-ref", `--count=${entries + 1}`, "--format=%(refname:short)%00%(objectname)%00%(upstream:short)", "refs/heads/"], signal);
      return list(text.split("\n").filter(Boolean).map((row) => {
        const [name, head, upstream] = row.split("\0");
        return { name: name!, head: head!, current: name === current, upstream: upstream || null };
      }));
    }),
    worktrees: (folder) => withRepo(folder, worktrees),
    createWorktree: (folder, name, from = "HEAD") => withRepo(folder, async (path, signal) => {
      const repo = await repository(path, signal);
      const currentHead = await head(path, signal);
      const start = currentHead === null && (from === "HEAD" || from === await branch(path, signal)) ? null : await ref(path, from, signal);
      const stem = slug(name);
      const main = dirname(repo.commonDirectory), directoryPath = join(main, ".worktrees");
      if (await exists(directoryPath)) {
        if ((await lstat(directoryPath)).isSymbolicLink() || await directory(await root(), directoryPath) !== directoryPath) return fail("invalid_path");
      } else await mkdir(directoryPath, { mode: 0o700 });
      await excludeManagedWorktrees(repo.commonDirectory);
      for (let i = 1; i <= 100; i++) {
        const name = i === 1 ? stem : `${stem}-${i}`, target = join(directoryPath, name);
        if (await exists(target) || (await run(path, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], signal)).code === 0) continue;
        const reply = await run(path, ["worktree", "add", ...(start === null ? ["--orphan"] : []), "-b", name, "--", target, ...(start === null ? [] : [start])], signal);
        if (reply.code !== 0) {
          if (/already exists|already registered/i.test(reply.stderr)) continue;
          throw processFailure(reply);
        }
        return { path: target, branch: name, head: start, locked: false, available: true };
      }
      return fail("collision");
    }),
    changes: (folder) => withRepo(folder, async (path, signal) => list(parseChanges(await git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], signal)))),
    diff: (folder, options = {}) => withRepo(folder, (path, signal) => diff(path, options, signal)),
    history: (folder, limit) => withRepo(folder, async (path, signal) => await head(path, signal) === null ? list([]) : history(path, "HEAD", signal, bound(limit, entries, entries))),
    commitFiles: (folder, commit) => withRepo(folder, async (path, signal) => filesBetween(path, ["diff-tree", "--root", "--no-commit-id", "-r", "-m", "--first-parent", await ref(path, commit, signal)], signal)),
    state: (folder, target) => withRepo(folder, async (path, signal) => {
      const currentHead = await head(path, signal), currentBranch = await branch(path, signal);
      const upstreamReply = await run(path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], signal);
      const upstreamName = upstreamReply.code === 0 ? upstreamReply.stdout.trim() : null;
      let ahead = 0, behind = 0, pending = 0, pendingSince: string | null = null;
      if (currentHead !== null && upstreamName !== null) {
        const counts = (await git(path, ["rev-list", "--left-right", "--count", `${await ref(path, upstreamName, signal)}...${currentHead}`, "--"], signal)).trim().split(/\s+/);
        behind = Number(counts[0]); ahead = Number(counts[1]);
      }
      if (currentHead !== null && target !== undefined) {
        const range = `${await ref(path, target, signal)}..${currentHead}`;
        pending = Number((await git(path, ["rev-list", "--count", range, "--"], signal)).trim());
        if (pending > 0) {
          const dates = (await git(path, ["log", "--format=%cI", range, "--"], signal)).trim().split("\n");
          pendingSince = dates.reduce((oldest, date) => Date.parse(date) < Date.parse(oldest) ? date : oldest);
        }
      }
      return { head: currentHead, branch: currentBranch, upstream: upstreamName, mergeHead: await mergeHead(path, signal), ahead, behind, pending, pendingSince };
    }),
    stage: (folder, requested) => withRepo(folder, async (path, signal) => {
      const change = (await completeChanges(path, signal)).find((change) => change.path === requested);
      if (change === undefined) return fail("invalid_path");
      if (change.conflict) return fail("conflicts");
      const paths = stagePaths(change);
      for (const file of paths) await filePath(path, file);
      await git(path, ["add", "--", ...paths], signal);
    }),
    unstage: (folder, requested) => withRepo(folder, async (path, signal) => {
      const change = (await completeChanges(path, signal)).find((change) => change.path === requested && change.staged);
      if (change === undefined) return fail("invalid_path");
      await resetPaths(path, changePaths(change), signal);
    }),
    stageAll: (folder) => withRepo(folder, async (path, signal) => {
      const paths = (await completeChanges(path, signal)).filter((change) => !change.conflict).flatMap(stagePaths);
      for (const file of paths) await filePath(path, file);
      if (paths.length > 0) await git(path, ["add", "--", ...new Set(paths)], signal);
    }),
    unstageAll: (folder) => withRepo(folder, async (path, signal) => resetPaths(path, (await completeChanges(path, signal)).filter((change) => change.staged && !change.conflict).flatMap(changePaths), signal)),
    planDiscard: (folder, paths) => withRepo(folder, (path, signal) => planDiscard(path, paths, signal)),
    discard: (folder, plan, confirmed) => withRepo(folder, async (path, signal) => {
      if (confirmed !== true) return fail("confirmation_required");
      const actual = await planDiscard(path, plan.paths, signal);
      if (actual.fingerprint !== plan.fingerprint || JSON.stringify(actual.paths) !== JSON.stringify(plan.paths)) return fail("stale_state");
      const changes = await completeChanges(path, signal);
      for (const file of actual.paths) {
        const change = changes.find((change) => change.path === file)!;
        const full = await filePath(path, file);
        if (change.untracked) await rm(full);
        else await git(path, ["restore", "--worktree", "--", file], signal);
      }
    }),
    commit: (folder, message) => withRepo(folder, async (path, signal) => {
      if (typeof message !== "string" || message.trim() === "" || message.includes("\0") || Buffer.byteLength(message) > 16_384) return fail("invalid_message");
      const changes = await completeChanges(path, signal);
      if (changes.some((change) => change.conflict)) return fail("conflicts");
      if (!changes.some((change) => change.staged) && await mergeHead(path, signal) === null) return fail("nothing_staged");
      await git(path, ["commit", "-m", message], signal);
      return (await head(path, signal))!;
    }),
    fetch: (folder) => withRepo(folder, async (path, signal) => { await remote(path, signal); await git(path, ["fetch", "--prune", "origin"], signal); }),
    pull: (folder) => withRepo(folder, async (path, signal) => {
      if ((await completeChanges(path, signal)).length > 0) return fail("dirty_destination");
      await remote(path, signal); await upstream(path, signal);
      const reply = await run(path, ["pull", "--ff-only", "--no-rebase"], signal);
      if (reply.code !== 0) { if (/fast-forward|divergent/i.test(reply.stderr)) return fail("pull_diverged"); throw processFailure(reply); }
    }),
    push: (folder) => withRepo(folder, async (path, signal) => {
      await remote(path, signal);
      const name = await branch(path, signal);
      if (name === null) return fail("invalid_ref");
      await localBranch(path, name, signal);
      await git(path, ["push", "--set-upstream", "origin", `refs/heads/${name}:refs/heads/${name}`], signal);
    }),
    mergeTeam: (source, destination, expectedHead) => operation(async (signal) => {
      const from = await repository(source, signal), to = await repository(destination, signal);
      if (from.commonDirectory !== to.commonDirectory || from.path === to.path) return fail("invalid_path");
      const destinationBranch = await branch(to.path, signal);
      if (destinationBranch === null) return fail("invalid_ref");
      if (["main", "master"].includes(destinationBranch)) return fail("base_requires_review");
      if ((await completeChanges(to.path, signal)).length > 0 || await mergeHead(to.path, signal) !== null) return fail("dirty_destination");
      if ((await completeChanges(from.path, signal)).length > 0 || await mergeHead(from.path, signal) !== null) return fail("dirty_source");
      const sourceHead = await head(from.path, signal);
      if (sourceHead !== expectedHead) return fail("stale_state");
      const reply = await run(to.path, ["-c", "merge.conflictStyle=diff3", "merge", "--no-edit", "--no-autostash", sourceHead!], signal);
      if (reply.code !== 0) {
        if ((await completeChanges(to.path, signal)).some((change) => change.conflict)) return fail("conflicts");
        throw processFailure(reply);
      }
      return (await head(to.path, signal))!;
    }),
    review: (folder, base) => withRepo(folder, (path, signal) => review(path, base, signal)),
    reviewMain: (source, destination) => operation(async (signal) => (await mainComparison(source, destination, signal)).comparison),
    approveMain: (source, destination, reviewed, caller, confirmed) => operation(async (signal) => {
      // Check trusted authority again at execution, including caller-less and
      // piece callers. No report or payload boolean supplies this credential.
      if (caller?._tag !== "owner") return fail("owner_required");
      if (confirmed !== true) return fail("confirmation_required");
      const { from, to, comparison } = await mainComparison(source, destination, signal);
      if (comparison.head !== reviewed.head || comparison.baseHead !== reviewed.baseHead
        || comparison.branch !== reviewed.branch || comparison.base !== reviewed.base) return fail("stale_state");
      if ((await completeChanges(to.path, signal)).length > 0 || await mergeHead(to.path, signal) !== null) return fail("dirty_destination");
      if ((await completeChanges(from.path, signal)).length > 0 || await mergeHead(from.path, signal) !== null) return fail("dirty_source");
      // Terminal edits are outside the engine queue. Recheck both heads and
      // branch identities immediately before launching Git, then merge the
      // reviewed object ID rather than resolving a mutable source branch.
      if (await head(from.path, signal) !== reviewed.head || await head(to.path, signal) !== reviewed.baseHead
        || await branch(from.path, signal) !== reviewed.branch || await branch(to.path, signal) !== reviewed.base) return fail("stale_state");
      // This approval promises a committed merge of this object. Repository
      // merge defaults must not turn it into a squash, an uncommitted merge,
      // a different strategy, or a fast-forward-only refusal on divergence.
      const reply = await run(to.path, ["-c", `branch.${reviewed.base}.mergeOptions=`, "-c", "merge.conflictStyle=diff3",
        "merge", "--strategy=ort", "--ff", "--no-squash", "--commit", "--no-edit", "--no-autostash", reviewed.head], signal);
      if (reply.code !== 0) {
        if ((await completeChanges(to.path, signal)).some((change) => change.conflict)) return fail("conflicts");
        throw processFailure(reply);
      }
      // A zero exit alone is insufficient. Read back the actual destination
      // and prove it contains the reviewed object before any durable success.
      // An already-contained object is a valid no-op; HEAD need not move.
      const merged = await head(to.path, signal);
      if (merged === null || await branch(to.path, signal) !== reviewed.base) return fail("stale_state");
      const ancestry = await run(to.path, ["merge-base", "--is-ancestor", reviewed.head, merged], signal);
      if (ancestry.code === 1) return fail("git_failed");
      if (ancestry.code !== 0) throw processFailure(ancestry);
      return merged;
    }),
    openReview: (folder, base, expectedHead) => withRepo(folder, async (path, signal) => {
      const evidence = await review(path, base, signal);
      if (evidence.head !== expectedHead) return fail("stale_state");
      await remote(path, signal);
      const url = (await git(path, ["remote", "get-url", "origin"], signal)).trim();
      const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
      if (match === null) return fail("unsupported_provider");
      const published = await git(path, ["ls-remote", "--heads", "origin", `refs/heads/${evidence.branch}`], signal);
      if (published.split(/\s/)[0] !== evidence.head) return fail("push_required");
      return { head: evidence.head, url: `https://github.com/${match[1]}/${match[2]}/compare/${encodeURIComponent(base)}...${encodeURIComponent(evidence.branch)}?expand=1` };
    }),
    conflict: (folder, path) => withRepo(folder, (base, signal) => conflict(base, path, signal)),
    choose: (folder, selection, hunk, choice) => withRepo(folder, async (path, signal) => {
      const actual = await checkedSelection(path, selection, signal);
      if (!Number.isInteger(hunk) || hunk < 0 || hunk >= actual.choices.length || !["ours", "theirs", "both"].includes(choice)) return fail("incomplete_choices");
      const choices = [...selection.choices]; choices[hunk] = choice;
      return { ...actual, choices };
    }),
    resolve: (folder, selection) => withRepo(folder, async (path, signal) => {
      const actual = await checkedSelection(path, selection, signal);
      if (selection.choices.some((choice) => choice === null)) return fail("incomplete_choices");
      let index = 0;
      const content = actual.segments.map((segment) => {
        if (segment.kind === "context") return segment.context.join("");
        const choice: ConflictChoice = selection.choices[index++]!;
        if (choice === "ours") return segment.ours.join("");
        if (choice === "theirs") return segment.theirs.join("");
        const ours = segment.ours.join(""), theirs = segment.theirs.join("");
        return ours + (ours !== "" && theirs !== "" && !ours.endsWith("\n") ? "\n" : "") + theirs;
      }).join("");
      const full = await filePath(path, actual.path), info = await stat(full);
      const temporary = join(dirname(full), `.lgcode-resolve-${randomUUID()}.tmp`);
      let created = false;
      try {
        await writeFile(temporary, content, { flag: "wx", mode: info.mode & 0o777 });
        created = true;
        await checkedSelection(path, selection, signal);
        await rename(temporary, full);
      } finally { if (created) await rm(temporary, { force: true }); }
      // Clear unmerged stages back to HEAD, preserving the resolved working
      // file for the mock's separate review-and-stage step.
      await resetPaths(path, [actual.path], signal);
    }),
  };
};
