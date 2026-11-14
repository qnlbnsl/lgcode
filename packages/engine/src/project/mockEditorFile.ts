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
export interface MockEditorFileChange { readonly restore: () => Promise<void>; readonly close: () => Promise<void> }
export function saveMockEditorFile(root: string, recordedPath: string, expected: string, bytes: Uint8Array, retain: true): Promise<MockEditorFileChange>
export function saveMockEditorFile(root: string, recordedPath: string, expected: string, bytes: Uint8Array): Promise<void>
export async function saveMockEditorFile(root: string, recordedPath: string, expected: string, bytes: Uint8Array, retain = false): Promise<MockEditorFileChange | void> {
  const handles: FileHandle[] = []
  let temporary: string | undefined, changed = false, retained = false, restore: (() => Promise<void>) | undefined
  const close = async () => {
    if (temporary !== undefined) await unlink(temporary).catch(() => {})
    temporary = undefined
    for (const directory of handles.splice(0).reverse()) await directory.close().catch(() => {})
  }
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
    const stillRecorded = async (wanted: string) => {
      await filePath(root, recordedPath)
      const current = await lstat(originalParent)
      if (current.dev !== identity.dev || current.ino !== identity.ino || await realpath(parent) !== originalParent) throw new Error()
      if (fingerprint(await smallFile(destination, 1024 * 1024)) !== wanted) throw new Error()
    }
    await stillRecorded(expected)
    const original = await smallFile(destination, 1024 * 1024)
    if (fingerprint(original) !== expected) throw new Error()
    const mode = (await lstat(destination)).mode & 0o7777
    const replace = async (content: Uint8Array, wanted: string) => {
      await stillRecorded(wanted)
      temporary = `${parent}/.lgtm-editor-${randomUUID()}`
      const output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await output.writeFile(content); await output.chmod(mode); await output.sync() } finally { await output.close() }
      await stillRecorded(wanted)
      await rename(temporary, destination)
      changed = true
      temporary = undefined
      await directory.sync()
    }
    restore = () => replace(original, fingerprint(bytes))
    await replace(bytes, expected)
    if (retain) { retained = true; return { restore, close } }
  } catch {
    if (changed) {
      try { await restore!() } catch { throw new MockEditorFileError(true) }
    }
    throw new MockEditorFileError(false)
  } finally { if (!retained) await close() }
}
