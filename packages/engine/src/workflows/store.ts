import { constants as C, promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { validateWorkflow, type WorkflowDefinition, type WorkflowSummary, type WorkflowFolder } from '@lgtm/contracts/workflows'

const limit = 192 * 1024
const listingLimit = 100
const fail = (message: string): never => { throw new Error(message) }
const validId = (id: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || fail('Use a short workflow identifier with letters, numbers and hyphens.')
const code = (error: unknown) => (error as NodeJS.ErrnoException).code
const reason = (error: unknown) => error instanceof Error && !('code' in error) ? error.message : 'The workflow file is unavailable or unsafe.'
const removal = 'Remove or replace this entry manually in your workflow folder before using it.'

export class WorkflowStore {
  readonly home: string
  readonly repository: string | undefined
  constructor(home: string, repository?: string) { this.home = home; this.repository = repository }
  private async ready() {
    try { await fs.access('/proc/self/fd') }
    catch { fail('Workflow storage requires the descriptor filesystem on this system.') }
  }
  private async folder<T>(scope: string, create: boolean, run: (folder: string) => Promise<T>): Promise<T> {
    await this.ready()
    const base = scope === 'user' ? this.home : scope === 'repository' ? this.repository : undefined
    if (!base) return fail('Choose a user or repository workflow folder.')
    // Hold each directory open. Every child operation uses the held descriptor,
    // so replacing a pathname cannot redirect an operation into another folder.
    const handles: FileHandle[] = []
    try {
      handles.push(await fs.open(base, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW))
      for (const part of ['.lgtm', 'workflows']) {
        const path = `/proc/self/fd/${handles.at(-1)!.fd}/${part}`
        if (create) try { await fs.mkdir(path, { mode: 0o700 }) } catch (e) { if (code(e) !== 'EEXIST') throw e }
        handles.push(await fs.open(path, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW))
      }
      return await run(`/proc/self/fd/${handles.at(-1)!.fd}`)
    } finally { for (const handle of handles.reverse()) await handle.close() }
  }
  private async regular(path: string): Promise<FileHandle> {
    const handle = await fs.open(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.nlink !== 1) fail('Use one regular workflow file. ' + removal)
      return handle
    } catch (error) { await handle.close(); throw error }
  }
  private async load(path: string): Promise<WorkflowDefinition> {
    const handle = await this.regular(path)
    try {
      if ((await handle.stat()).size > limit) fail('Use a workflow file smaller than 192 KiB.')
      // Read at most limit + 1, even if the file grows after stat. Never allocate
      // or parse an unbounded readFile result from an owner-writable file.
      const buffer = Buffer.alloc(limit + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > limit) fail('Use a workflow file smaller than 192 KiB.')
      let value: unknown
      try { value = JSON.parse(buffer.toString('utf8', 0, length)) } catch { return fail('The workflow file must contain valid JSON.') }
      const error = validateWorkflow(value)
      if (error) fail(error)
      return value as WorkflowDefinition
    } finally { await handle.close() }
  }
  async list(): Promise<{ items: WorkflowSummary[]; folders: WorkflowFolder[] }> {
    await this.ready()
    const items: WorkflowSummary[] = [this.summary('default', 'build-loop', (await this.read('default', 'build-loop')).definition)]
    const folders: WorkflowFolder[] = []
    for (const scope of (this.repository ? ['user', 'repository'] as const : ['user'] as const)) {
      const status: { scope: 'user' | 'repository'; limit: number; truncated: boolean; error?: string } = { scope, limit: listingLimit, truncated: false }
      folders.push(status)
      try {
        await this.folder(scope, false, async (folder) => {
          const dir = await fs.opendir(folder)
          try {
            // Count all directory entries, including non-JSON files. A folder
            // with millions of unrelated entries must also remain bounded.
            for (let count = 0; ; count++) {
              const entry = await dir.read()
              if (!entry) break
              if (count === listingLimit) { status.truncated = true; break }
              if (!entry.name.endsWith('.json')) continue
              const id = entry.name.slice(0, -5), path = join(folder, entry.name)
              try {
                validId(id)
                items.push(this.summary(scope, id, await this.load(path)))
              } catch (error) {
                let canDelete = false
                try { validId(id); const handle = await this.regular(path); await handle.close(); canDelete = true } catch {}
                items.push({ scope, id, name: id, readOnly: false, canDelete, error: reason(error) + (canDelete ? '' : ' ' + removal) })
              }
            }
          } finally { await dir.close() }
        })
      } catch (error) { if (code(error) !== 'ENOENT') status.error = 'The workflow folder is unavailable or unsafe. Check this folder manually.' }
    }
    return { items, folders }
  }
  private summary(scope: string, id: string, definition: WorkflowDefinition): WorkflowSummary {
    return { scope: scope as WorkflowSummary['scope'], id, name: definition.name, readOnly: scope === 'default', canDelete: scope !== 'default' }
  }
  async read(scope: string, id: string) {
    await this.ready(); validId(id)
    const definition = scope === 'default' && id === 'build-loop'
      ? await this.load(fileURLToPath(new URL('./build-loop.json', import.meta.url)))
      : await this.folder(scope, false, (folder) => this.load(`${folder}/${id}.json`))
    return { ...this.summary(scope, id, definition), definition }
  }
  async clone(scope: string, id: string, target: string, name: string) {
    const definition = { ...(await this.read(scope, id)).definition, name }
    const newId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || `workflow-${randomUUID()}`
    return this.write(target, newId, definition, true)
  }
  async save(scope: string, id: string, definition: unknown) { return this.write(scope, id, definition, false) }
  private async write(scope: string, id: string, definition: unknown, create: boolean) {
    await this.ready(); validId(id)
    if (scope === 'default') return fail('The default workflow is read-only.')
    const error = validateWorkflow(definition)
    if (error) return fail(error)
    const json = JSON.stringify(definition, null, 2) + '\n'
    if (Buffer.byteLength(json) > limit) return fail('Keep the workflow smaller than 192 KiB.')
    try {
      await this.folder(scope, create, async (folder) => {
        const path = `${folder}/${id}.json`
        // Verify the existing entry's safety, independently of its JSON. This
        // lets a valid save repair a malformed regular file.
        if (!create) { const existing = await this.regular(path); await existing.close() }
        const temp = join(folder, `.save-${randomUUID()}`)
        const handle = await fs.open(temp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
        try {
          await handle.writeFile(json); await handle.sync()
          if (create) await fs.link(temp, path)
          else await fs.rename(temp, path)
        } finally { await handle.close(); try { await fs.unlink(temp) } catch (e) { if (code(e) !== 'ENOENT') throw e } }
      })
    } catch (error) {
      if (create && code(error) === 'EEXIST') fail('A workflow with that identifier already exists.')
      if (!create && code(error) === 'ENOENT') fail('The workflow to save no longer exists.')
      throw error
    }
    return { ...this.summary(scope, id, definition as WorkflowDefinition), definition: definition as WorkflowDefinition }
  }
  async delete(scope: string, id: string): Promise<void> {
    await this.ready(); validId(id)
    if (scope === 'default') return fail('The default workflow is read-only.')
    try {
      await this.folder(scope, false, async (folder) => {
        const path = `${folder}/${id}.json`, handle = await this.regular(path)
        try { await fs.unlink(path) } finally { await handle.close() }
      })
    } catch (error) { if (code(error) === 'ENOENT') fail('The workflow to delete no longer exists.'); throw error }
  }
}
