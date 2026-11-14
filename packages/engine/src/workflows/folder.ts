import { constants as C, promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, resolve, relative } from 'node:path'

export const workflowFolderReason = 'The workflow folder must be absolute, existing, owned by you, outside the service state folder, and have no symbolic links.'
// Pin every component, including parents. A concurrent rename cannot redirect
// a workflow read or write through a newly substituted symbolic link.
export async function withWorkflowFolder<T>(path: string, stateFolder: string, run: (descriptor: string) => Promise<T>): Promise<T> {
  const handles: FileHandle[] = []
  try {
    if (!isAbsolute(path) || path.includes('\0') || path.length > 4096) throw new Error()
    const canonical = resolve(path)
    const state = await fs.realpath(stateFolder)
    const relation = relative(state, canonical)
    if (relation === '' || !relation.startsWith('../') && relation !== '..' && !isAbsolute(relation)) throw new Error()
    handles.push(await fs.open('/', C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW))
    // Do not normalize away a symlink followed by ".." before checking it.
    if (path.split('/').includes('..')) throw new Error()
    for (const part of path.split('/').filter((p) => p && p !== '.')) {
      handles.push(await fs.open(`/proc/self/fd/${handles.at(-1)!.fd}/${part}`, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW))
    }
    const handle = handles.at(-1)!
    if ((await handle.stat()).uid !== process.getuid?.()) throw new Error()
    return await run(`/proc/self/fd/${handle.fd}`)
  } finally { for (const handle of handles.reverse()) await handle.close() }
}
export async function validateWorkflowFolder(path: string, stateFolder: string): Promise<string> {
  try { return await withWorkflowFolder(path, stateFolder, async () => resolve(path)) }
  catch { throw new Error(workflowFolderReason) }
}
