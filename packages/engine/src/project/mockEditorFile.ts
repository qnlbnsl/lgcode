import { constants } from "node:fs"
import { lstat, open, realpath, rename, unlink, type FileHandle } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { fingerprint, validArtifactPath } from "./artifacts.ts"
import { filePath, smallFile } from "./git/paths.ts"

export class MockEditorFileError extends Error {
  readonly uncertain: boolean
  constructor(uncertain: boolean) { super("mock editor file save failed"); this.uncertain = uncertain }
}

// Linux directory descriptors pin every directory. A swapped path component
// cannot redirect the temporary file or rename through a symbolic link.
// The destination is an existing registered file, never a caller-chosen path.
export async function saveMockEditorFile(root: string, recordedPath: string, expected: string, bytes: Uint8Array) {
  const handles: FileHandle[] = []
  let temporary: string | undefined, changed = false
  try {
    if (process.platform !== "linux" || !validArtifactPath(recordedPath) || dirname(recordedPath) === ".") throw new Error()
    if (await realpath(root) !== root) throw new Error()
    await filePath(root, recordedPath)
    const parts = recordedPath.split("/")
    let directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    handles.push(directory)
    for (const part of parts.slice(0, -1)) {
      directory = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      handles.push(directory)
    }
    const parent = `/proc/self/fd/${directory.fd}`, destination = `${parent}/${parts.at(-1)!}`
    const originalParent = join(root, ...parts.slice(0, -1))
    const identity = await directory.stat()
    const stillRecorded = async () => {
      await filePath(root, recordedPath)
      const current = await lstat(originalParent)
      if (current.dev !== identity.dev || current.ino !== identity.ino || await realpath(parent) !== originalParent) throw new Error()
      if (fingerprint(await smallFile(destination, 1024 * 1024)) !== expected) throw new Error()
    }
    await stillRecorded()
    const mode = (await lstat(destination)).mode & 0o777
    temporary = `${parent}/.lgtm-editor-${randomUUID()}`
    const output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await output.writeFile(bytes); await output.chmod(mode); await output.sync() } finally { await output.close() }
    await stillRecorded()
    changed = true
    await rename(temporary, destination)
    temporary = undefined
    await directory.sync()
  } catch { throw new MockEditorFileError(changed) }
  finally {
    if (temporary !== undefined) await unlink(temporary).catch(() => {})
    for (const directory of handles.reverse()) await directory.close().catch(() => {})
  }
}
