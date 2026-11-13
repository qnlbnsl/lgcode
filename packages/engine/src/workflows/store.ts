import { constants as C, openSync, closeSync, mkdirSync, readdirSync, readFileSync, writeFileSync, fstatSync, lstatSync, linkSync, renameSync, unlinkSync, fsyncSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateWorkflow, type WorkflowDefinition, type WorkflowSummary } from '@lgtm/contracts/workflows'

const limit = 192 * 1024
const fail = (message: string): never => { throw new Error(message) }
const validId = (id: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || fail('Use a short workflow identifier with letters, numbers and hyphens.')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
export class WorkflowStore {
  readonly home: string;
  readonly repository: string | undefined;
  constructor(home: string, repository?: string) { this.home = home; this.repository = repository; }
  private folder<T>(scope: string, create: boolean, run: (folder: string) => T): T {
    const base = scope === 'user' ? this.home : scope === 'repository' ? this.repository : undefined
    if (!base) return fail('Choose a user or repository workflow folder.')
    // Each child is opened relative to a held directory descriptor. Replacing a
    // pathname while the operation runs cannot redirect it through a symlink.
    const fds: number[] = []
    try {
      fds.push(openSync(base, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW))
      for (const part of ['.lgtm', 'workflows']) {
        const path = `/proc/self/fd/${fds[fds.length - 1]}/${part}`
        if (create) try { mkdirSync(path, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
        fds.push(openSync(path, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW))
      }
      return run(`/proc/self/fd/${fds[fds.length - 1]}`)
    } finally { for (const fd of fds.reverse()) closeSync(fd) }
  }
  private load(path: string): WorkflowDefinition {
    const fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK)
    try {
      const info = fstatSync(fd)
      if (!info.isFile() || info.nlink !== 1 || info.size > limit) return fail('Use one regular workflow file smaller than 192 KiB.')
      let value: unknown
      try { value = JSON.parse(readFileSync(fd, 'utf8')) } catch { return fail('The workflow file must contain valid JSON.') }
      const error = validateWorkflow(value)
      if (error) return fail(error)
      return value as WorkflowDefinition
    } finally { closeSync(fd) }
  }
  list(): WorkflowSummary[] {
    const records: WorkflowSummary[] = [this.summary('default', 'build-loop', this.read('default', 'build-loop').definition)]
    for (const scope of ['user', ...(this.repository ? ['repository'] : [])]) {
      try {
        this.folder(scope, false, (folder) => {
          for (const name of readdirSync(folder).sort()) {
            if (!name.endsWith('.json')) continue
            const id = name.slice(0, -5)
            // Unaddressable files are never offered as a valid API identity.
            if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) { records.push({ scope: scope as 'user' | 'repository', id, name: id, readOnly: false, error: 'Rename this file on disk to use lowercase letters, numbers and hyphens.' }); continue }
            try { records.push(this.summary(scope, id, this.load(join(folder, name)))) }
            catch (error) { records.push({ scope: scope as 'user' | 'repository', id, name: id, readOnly: false, error: error instanceof Error && !('code' in error) ? error.message : 'The workflow file is unavailable or unsafe.' }) }
          }
        })
      } catch (error) { if (!missing(error)) throw new Error('The workflow folder is unavailable or unsafe.') }
    }
    return records
  }
  private summary(scope: string, id: string, definition: WorkflowDefinition): WorkflowSummary {
    return { scope: scope as WorkflowSummary['scope'], id, name: definition.name, readOnly: scope === 'default' }
  }
  read(scope: string, id: string) {
    validId(id)
    const definition = scope === 'default' && id === 'build-loop'
      ? this.load(new URL('../../../../design/mock/workflows/build-loop.json', import.meta.url).pathname)
      : this.folder(scope, false, (folder) => this.load(join(folder, `${id}.json`)))
    return { ...this.summary(scope, id, definition), definition }
  }
  clone(scope: string, id: string, target: string, name: string) {
    const definition = { ...this.read(scope, id).definition, name }
    const newId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
    validId(newId)
    return this.write(target, newId, definition, true)
  }
  save(scope: string, id: string, definition: unknown) { return this.write(scope, id, definition, false) }
  private write(scope: string, id: string, definition: unknown, create: boolean) {
    validId(id)
    if (scope === 'default') return fail('The default workflow is read-only.')
    const error = validateWorkflow(definition)
    if (error) return fail(error)
    const json = JSON.stringify(definition, null, 2) + '\n'
    if (Buffer.byteLength(json) > limit) return fail('Keep the workflow smaller than 192 KiB.')
    this.folder(scope, true, (folder) => {
      const path = join(folder, `${id}.json`)
      if (!create) this.load(path)
      const temp = join(folder, `.save-${randomUUID()}`)
      const fd = openSync(temp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
      try {
        writeFileSync(fd, json); fsyncSync(fd)
        if (create) linkSync(temp, path) // Exclusive creation, including under concurrent clones.
        else renameSync(temp, path) // Replaces the directory entry; never follows its target.
      } finally { closeSync(fd); try { unlinkSync(temp) } catch (e) { if (!missing(e)) throw e } }
    })
    return this.read(scope, id)
  }
  delete(scope: string, id: string): void {
    validId(id)
    if (scope === 'default') return fail('The default workflow is read-only.')
    this.folder(scope, false, (folder) => {
      const path = join(folder, `${id}.json`), info = lstatSync(path)
      if (!info.isFile() || info.nlink !== 1) return fail('Only a regular workflow file can be deleted.')
      unlinkSync(path)
    })
  }
}
