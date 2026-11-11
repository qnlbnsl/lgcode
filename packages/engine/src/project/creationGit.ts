import { constants } from "node:fs"
import { lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { CreationFolderIdentity, ProjectCreation } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { refused } from "../commands/internal.ts"
import type { GitService } from "./git/index.ts"
import { directory, smallFile } from "./git/paths.ts"
import { gitProcess, processFailure } from "./git/process.ts"

export type FolderIdentity = typeof CreationFolderIdentity.Type
export const folderIdentity = async (path: string): Promise<FolderIdentity> => {
  const info = await lstat(path, { bigint: true })
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error()
  return { device: String(info.dev), inode: String(info.ino) }
}
const same = (a: FolderIdentity, b: FolderIdentity) => a.device === b.device && a.inode === b.inode
export const exists = async (path: string) => {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error }
}
export const creationIo = <A>(body: (signal: AbortSignal) => Promise<A>) => Effect.tryPromise({
  try: body, catch: () => refused("project creation is unfinished; inspect project.creations and retry the original request")
})
export const creationGit = async (path: string, args: string[], signal: AbortSignal) => {
  const reply = await gitProcess(path, args, { bytes: 128 * 1024, timeoutMs: 10_000 }, signal)
  if (reply.code !== 0) throw processFailure(reply)
  return reply.stdout.trimEnd()
}
const markerName = ".lgcode-project-creation"
// The marker bridges mkdir and the claim append. Existing directories without
// this intent's witness are refused, even when empty. An interruption between
// mkdir and marker creation remains visible in the owner recovery read and
// requires the owner to resolve that ambiguous path; no path is deleted.
export const claimFolder = (root: string, path: string, owner: string, known?: FolderIdentity) => creationIo(async () => {
  await directory(root, dirname(path))
  if (!await exists(path)) {
    if (known !== undefined) throw new Error()
    await mkdir(path, { mode: 0o700 })
    const file = await open(join(path, markerName), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await file.writeFile(owner); await file.sync() } finally { await file.close() }
  }
  const identity = await folderIdentity(path)
  if (known !== undefined) {
    if (!same(known, identity)) throw new Error()
  } else {
    const contents = await readdir(path)
    if (contents.length !== 1 || contents[0] !== markerName || (await smallFile(join(path, markerName), 512)).toString("utf8") !== owner) throw new Error()
  }
  return identity
})
// Remove only our exact witness, after its directory identity is durable.
export const clearFolderClaim = (root: string, path: string, owner: string, known: FolderIdentity) => creationIo(async () => {
  await directory(root, path)
  if (!same(known, await folderIdentity(path))) throw new Error()
  const marker = join(path, markerName)
  if (!await exists(marker)) return
  if ((await smallFile(marker, 512)).toString("utf8") !== owner) throw new Error()
  await unlink(marker)
})
export const verifyFolder = (root: string, path: string, known: FolderIdentity) => creationIo(async () => {
  await directory(root, path)
  if (!same(known, await folderIdentity(path))) throw new Error()
})

// This is the exact, recoverable New project mutation. The general Git
// service and its public signatures stay unchanged for existing callers.
export const ensureRepository = (plan: ProjectCreation) => creationIo(async (signal) => {
  if (plan.repositoryIdentity === undefined) throw new Error()
  await directory(plan.workspaceFolder, plan.repository.path)
  if (!same(plan.repositoryIdentity, await folderIdentity(plan.repository.path))) throw new Error()
  if (!await exists(join(plan.repository.path, ".git"))) {
    if (!plan.newRepository || (await readdir(plan.repository.path)).length !== 0) throw new Error()
    await creationGit(plan.repository.path, ["init", "--initial-branch=main", "--", plan.repository.path], signal)
  }
  if (plan.newRepository) {
    const head = await gitProcess(plan.repository.path, ["rev-parse", "--verify", "--quiet", "HEAD"], { bytes: 4096, timeoutMs: 5000 }, signal)
    if (head.code === 1) {
      // Bootstrap only an empty tree. A retry may find owner-staged bytes;
      // those must never be folded into the initialization commit.
      const tree = await creationGit(plan.repository.path, ["mktree"], signal)
      const commit = await creationGit(plan.repository.path, ["-c", "user.name=LGcode", "-c", "user.email=lgcode@localhost", "commit-tree", tree, "-m", "Initialize LGcode repository"], signal)
      await creationGit(plan.repository.path, ["update-ref", "refs/heads/main", commit, ""], signal)
    } else if (head.code !== 0) throw processFailure(head)
  }
})
export const ensureWorktreeParent = (plan: ProjectCreation) => creationIo(async () => {
  const path = dirname(plan.workspace.path)
  if (!await exists(path)) await mkdir(path, { mode: 0o700 })
  if (await directory(plan.workspaceFolder, path) !== path || (await lstat(path)).isSymbolicLink()) throw new Error()
})
export const ensureWorktree = (plan: ProjectCreation, service: GitService) => Effect.gen(function* () {
  const repository = yield* service.register(plan.repository.path).pipe(Effect.mapError(() => refused("repository is unavailable")))
  if (dirname(repository.commonDirectory) !== plan.repository.path) return yield* refused("main repository checkout is required")
  if (plan.workspace.checkout === "main") return
  yield* creationIo(async (signal) => {
    if (plan.folderIdentity === undefined || !same(plan.folderIdentity, await folderIdentity(plan.workspace.path))) throw new Error()
    if (await exists(join(plan.workspace.path, ".git"))) return
    if ((await readdir(plan.workspace.path)).length !== 0) throw new Error()
    const head = await gitProcess(plan.repository.path, ["rev-parse", "--verify", "--quiet", "HEAD"], { bytes: 4096, timeoutMs: 5000 }, signal)
    if (head.code !== 0 && head.code !== 1) throw processFailure(head)
    // Append one exact rule. Existing exclusions, including negations, are
    // never rewritten or removed. NOFOLLOW rejects a redirected exclude file.
    const info = join(repository.commonDirectory, "info")
    if (!await exists(info)) await mkdir(info, { mode: 0o700 })
    if (await directory(plan.workspaceFolder, info) !== info) throw new Error()
    const exclude = join(info, "exclude")
    const previous = await exists(exclude) ? (await smallFile(exclude, 65_536)).toString("utf8") : ""
    if (!previous.split(/\r?\n/).includes("/.worktrees/")) {
      const file = await open(exclude, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
      try {
        if (!(await file.stat()).isFile()) throw new Error()
        await file.write(`${previous === "" || previous.endsWith("\n") ? "" : "\n"}/.worktrees/\n`)
      } finally { await file.close() }
    }
    await creationGit(plan.repository.path, ["worktree", "add", ...(head.code === 1 ? ["--orphan"] : []), "-b", plan.workspace.branch,
      "--", plan.workspace.path, ...(head.code === 1 ? [] : [head.stdout.trim()])], signal)
  })
})
export const verifyCreation = (plan: ProjectCreation, service: GitService) => Effect.gen(function* () {
  if (plan.repositoryIdentity === undefined) return yield* refused("repository is unavailable")
  yield* verifyFolder(plan.workspaceFolder, plan.repository.path, plan.repositoryIdentity)
  if (plan.workspace.checkout === "worktree") {
    if (plan.folderIdentity === undefined) return yield* refused("repository is unavailable")
    yield* verifyFolder(plan.workspaceFolder, plan.workspace.path, plan.folderIdentity)
  }
  const repo = yield* service.register(plan.repository.path).pipe(Effect.mapError(() => refused("repository is unavailable")))
  const checkout = yield* service.register(plan.workspace.path).pipe(Effect.mapError(() => refused("repository is unavailable")))
  const state = yield* service.state(checkout.path).pipe(Effect.mapError(() => refused("repository is unavailable")))
  if (repo.commonDirectory !== checkout.commonDirectory || state.branch !== plan.workspace.branch) return yield* refused("checkout does not match the repository, branch and type")
})
