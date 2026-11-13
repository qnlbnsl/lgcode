import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect as baseExpect, type Page } from '@playwright/test'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'
import * as SqliteClient from '../../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts'
import { buildServices } from '../../../engine/src/service.ts'
import { serve } from '../../../engine/src/client/web/server.ts'
import { engineLists } from '../../../engine/src/pieces/lists.ts'
import { Views } from '../../../engine/src/views/Views.ts'
import { projectView } from '../../../engine/src/project/view.ts'
import { Redactor } from '../../../engine/src/log/Redactor.ts'
import { unusedPort } from '../../../engine/test/support/browserWeb.ts'
import { makeFakeRunner } from '../../../engine/test/support/fakeRunner.ts'
import { appendSetup, call, eventOf, harnessSettings, makeFakeSecrets, makeRig, ownerCredential, removeRig, seedAccount, seedAgent, success } from '../../../engine/test/support/handlerRig.ts'
import { registerRebuildCheck } from '../../../engine/test/support/rebuildCheck.ts'
import { buildStudio } from '../../../studio/scripts/build.ts'
import { completedSetup } from './completedSetup.ts'
const expect = baseExpect.configure({ timeout: 30_000 })
const git = (folder: string, ...args: string[]) => execFileSync('/usr/bin/git', ['-C', folder, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commit = (folder: string, message: string) => { git(folder, 'add', '--all'); git(folder, 'commit', '-m', message) }
export async function exerciseStudioGit(page: Page) {
  const rig = makeRig(), previous = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString('base64url'), port = await unusedPort()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    git(rig.work, 'init', '-b', 'main'); git(rig.work, 'config', 'user.name', 'Builder'); git(rig.work, 'config', 'user.email', 'builder@example.invalid'); git(rig.work, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(rig.work, 'file.txt'), 'base\n'); commit(rig.work, 'Initial')
    const remote = join(rig.root, 'remote'); mkdirSync(remote); git(remote, 'init', '--bare')
    git(rig.work, 'remote', 'add', 'origin', remote); git(rig.work, 'push', '-u', 'origin', 'main')
    const studioRoot = await buildStudio(join(rig.root, 'studio')), staticRoot = join(rig.root, 'web'); mkdirSync(staticRoot); writeFileSync(join(staticRoot, 'index.html'), '<title>Test</title>')
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, { redact: (e) => Effect.succeed(e), redactText: (s) => Effect.succeed(s) }))
      yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck(); yield* seedAccount('launch', 'cursor')
        success(yield* call(ownerCredential, 'harnesses', { operation: 'set', harness: harnessSettings('cursor', { adapterPath: process.execPath, reportedModes: [{ id: 'default', level: 'ask' }] }) }))
        success(yield* call(ownerCredential, 'accounts set-secret', { accountId: 'launch', name: 'CURSOR_API_KEY', nonce: 'studio-git-test', value: Redacted.make('synthetic-studio-git-key') }))
        success(yield* call(ownerCredential, 'project.settings.set', { settings: { workspaceFolder: rig.root, shell: 'zsh' } }))
        const repoId = success(yield* call(ownerCredential, 'project.repository.add', { name: 'Git browser repository', path: rig.work, machineId: 'local' })).repoId
        success(yield* call(ownerCredential, 'project.workspace.register', { repoId, path: rig.work, branch: 'main', machineId: 'local', checkout: 'main' }))
        const created = success(yield* call(ownerCredential, 'project.create', { name: 'Git browser project', goal: 'Test Git actions', machineId: 'local', repository: { _tag: 'existing', repoId }, useWorktree: true }))
        const view = projectView(yield* (yield* Views).snapshot), project = view.projects[created.projectId]!, source = view.workspaces[project.worktreeId]!
        yield* completedSetup(project.projectId)
        git(source.path, 'push', '-u', 'origin', source.branch)
        const teamPath = join(rig.root, 'team'); git(source.path, 'worktree', 'add', '-b', 'team-build', teamPath)
        const teamWorkspace = success(yield* call(ownerCredential, 'project.workspace.register', { repoId, path: teamPath, branch: 'team-build', machineId: 'local', checkout: 'worktree', parentId: source.worktreeId }))
        const team = success(yield* call(ownerCredential, 'project.team.create', { projectId: project.projectId, name: 'Build', worktreeId: teamWorkspace.worktreeId }))
        const builderPath = join(rig.root, 'builder'); git(teamPath, 'worktree', 'add', '-b', 'builder-work', builderPath)
        success(yield* call(ownerCredential, 'project.workspace.register', { repoId, path: builderPath, branch: 'builder-work', machineId: 'local', checkout: 'worktree', parentId: teamWorkspace.worktreeId }))
        writeFileSync(join(builderPath, 'builder.txt'), 'Builder change\n'); commit(builderPath, 'Builder contribution')
        writeFileSync(join(teamPath, 'team.txt'), 'Team change\n'); commit(teamPath, 'Team contribution')
        writeFileSync(join(source.path, 'file.txt'), 'browser change\n'); writeFileSync(join(source.path, 'discard.txt'), 'remove me\n')
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists: engineLists, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const url = `http://127.0.0.1:${port}/studio/#/p/${encodeURIComponent(project.projectId)}/git`
          await page.goto(url); await page.locator('#login-password').fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.locator('.tree-row.project')).toBeVisible(); await page.goto(url)
          const refresh = async () => { await page.getByRole('button', { name: 'Refresh Git', exact: true }).click(); await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false') }
          const fileButton = (name: string) => page.getByRole('button', { name, exact: true, includeHidden: true })
          const fileClick = async (name: string) => { const button = fileButton(name); await button.locator('..').locator('..').hover(); await button.click(); await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false') }
          await expect(fileButton('Stage file.txt')).toBeEnabled()
          await expect(page.locator('.diff')).toContainText('browser change')
          await fileClick('Stage file.txt')
          await expect(fileButton('Unstage file.txt')).toBeEnabled()
          await page.getByRole('button', { name: 'Generate', exact: true }).click()
          await expect(page.locator('.toasts')).toContainText('not connected to the service yet')
          // A path can remain on the staged and working sides simultaneously.
          writeFileSync(join(source.path, 'file.txt'), 'browser change\nworking tail\n'); await refresh()
          await expect(fileButton('Stage file.txt')).toHaveCount(1)
          await expect(fileButton('Unstage file.txt')).toHaveCount(1)
          await fileClick('Unstage file.txt')
          await expect(page.getByRole('button', { name: 'Stage all', exact: true })).toBeEnabled()
          await page.getByRole('button', { name: 'Stage all', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Unstage all', exact: true })).toBeEnabled()
          await page.getByRole('button', { name: 'Unstage all', exact: true }).click()
          await expect(fileButton('Discard changes to discard.txt')).toBeEnabled()
          await fileClick('Discard changes to discard.txt')
          await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
          // A removed row is published before the discard's complete readback.
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          await expect(page.getByRole('button', { name: 'Stage discard.txt', exact: true })).toHaveCount(0)
          await fileClick('Stage file.txt')
          await page.getByRole('textbox', { name: 'Commit message', exact: true }).fill('Browser committed change')
          await page.getByRole('button', { name: 'Commit', exact: true }).click()
          await expect(page.getByText('Nothing to commit', { exact: true })).toBeVisible()
          expect(git(source.path, 'log', '-1', '--format=%s')).toBe('Browser committed change')
          await page.getByRole('button', { name: 'History', exact: true }).click()
          await expect(page.locator('.git-log')).toContainText('Browser committed change')
          await expect(page.locator('.commit-files')).toContainText('working tail')
          for (const operation of ['Fetch', 'Pull', 'Push']) { await page.getByRole('button', { name: operation, exact: true }).click(); await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false') }
          expect(git(remote, 'rev-parse', `refs/heads/${source.branch}`)).toBe(git(source.path, 'rev-parse', 'HEAD'))
          await page.getByRole('button', { name: 'Choose a worktree', exact: true }).click()
          await page.getByRole('menuitemradio', { name: /builder-work/ }).click()
          await page.getByRole('button', { name: 'Update from base', exact: true }).click()
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          await page.getByRole('button', { name: /Integrate into/ }).click()
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          expect(readFileSync(join(teamPath, 'builder.txt'), 'utf8')).toBe('Builder change\n')
          await page.getByRole('button', { name: 'Choose a worktree', exact: true }).click()
          await page.getByRole('menuitemradio', { name: /team-build/ }).click()
          await page.getByRole('button', { name: 'Update from base', exact: true }).click()
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          await expect(page.getByRole('button', { name: /Integrate into/ })).toBeEnabled()
          await page.getByRole('button', { name: /Integrate into/ }).click()
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          expect(readFileSync(join(source.path, 'team.txt'), 'utf8')).toBe('Team change\n')
          await page.getByRole('button', { name: 'Choose a worktree', exact: true }).click()
          await page.getByRole('menuitemradio', { name: new RegExp(source.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
          await page.getByRole('button', { name: 'Open merge review', exact: true }).click()
          await expect(page.getByRole('dialog')).toContainText('Missing')
          await page.locator('#pr-title').fill('Unsupported hosted title')
          await expect(page.locator('.toasts')).toContainText('not connected to the service yet')
          await page.getByRole('dialog').getByRole('button', { name: 'Generate', exact: true }).click()
          await expect(page.locator('.toasts')).toContainText('not connected to the service yet')
          await page.getByRole('dialog').getByRole('button', { name: 'Send back', exact: true }).click()
          await page.getByRole('textbox', { name: 'What should change?', exact: true }).fill('Please verify the builder changes.')
          await page.getByRole('dialog').locator('form').getByRole('button', { name: 'Send back', exact: true }).click()
          await expect(page.getByRole('dialog')).toHaveCount(0)
          expect(git(rig.work, 'log', '-1', '--format=%s')).toBe('Initial')
          await page.getByRole('button', { name: 'Open merge review', exact: true }).click()
          await page.getByRole('button', { name: 'Approve without evidence', exact: true }).click()
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          expect(readFileSync(join(rig.work, 'team.txt'), 'utf8')).toBe('Team change\n')
          expect(readFileSync(join(rig.work, 'file.txt'), 'utf8')).toContain('working tail')
          // A conflict is created only in this temporary worktree. The website must
          // carry the engine's selection identity through choices and resolution.
          const beforeConflict = git(source.path, 'rev-parse', 'HEAD')
          const conflictPath = join(rig.root, 'conflict')
          git(source.path, 'worktree', 'add', '-b', 'conflict-side', conflictPath, beforeConflict)
          writeFileSync(join(source.path, 'file.txt'), 'ours\n'); commit(source.path, 'Ours')
          writeFileSync(join(conflictPath, 'file.txt'), 'theirs\n'); commit(conflictPath, 'Theirs')
          expect(() => git(source.path, 'merge', 'conflict-side')).toThrow()
          await page.reload()
          await page.getByRole('tablist', { name: 'Git views' }).getByRole('button', { name: /^Conflicts/ }).click()
          await expect(page.getByRole('button', { name: 'Use ours', exact: true })).toBeEnabled()
          await page.getByRole('button', { name: 'Use ours', exact: true }).click()
          await expect(page.getByText('Using ours', { exact: true })).toBeVisible()
          await page.getByRole('button', { name: 'Use theirs', exact: true }).click()
          await expect(page.getByText('Using theirs', { exact: true })).toBeVisible()
          await page.getByRole('button', { name: 'Use both', exact: true }).click()
          await expect(page.getByText('Using both, ours first', { exact: true })).toBeVisible()
          await page.getByRole('button', { name: 'Abort', exact: true }).click()
          await page.getByRole('dialog').getByRole('button', { name: 'Abort merge', exact: true }).click()
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          expect(git(source.path, 'status', '--porcelain')).toBe('')
          expect(readFileSync(join(source.path, 'file.txt'), 'utf8')).toBe('ours\n')
          expect(() => git(source.path, 'merge', 'conflict-side')).toThrow()
          await refresh()
          await page.getByRole('button', { name: 'Use both', exact: true }).click()
          await page.getByRole('button', { name: 'Mark resolved', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Stage all', exact: true })).toBeEnabled()
          expect(readFileSync(join(source.path, 'file.txt'), 'utf8')).toBe('ours\ntheirs\n')
          await page.reload()
          await page.getByRole('tablist', { name: 'Git views' }).getByRole('button', { name: /^Conflicts/ }).click()
          await page.getByRole('button', { name: 'Reopen', exact: true }).click()
          await page.getByRole('dialog').getByRole('button', { name: 'Reopen file', exact: true }).click()
          await page.getByRole('button', { name: 'Use both', exact: true }).click()
          await page.getByRole('button', { name: 'Mark resolved', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Stage all', exact: true })).toBeEnabled()
          await page.getByRole('button', { name: 'Stage all', exact: true }).click()
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          await page.getByRole('textbox', { name: 'Commit message', exact: true }).fill('Resolve browser conflict')
          await page.getByRole('tablist', { name: 'Git views' }).getByRole('button', { name: /^Conflicts/ }).click()
          await page.getByRole('button', { name: 'Continue merge', exact: true }).click()
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          await page.getByRole('button', { name: 'Changes', exact: true }).click()
          await expect(page.getByText('Nothing to commit', { exact: true })).toBeVisible()
          expect(git(source.path, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3)
          expect(errors).toEqual([])
        })
        const reviewer = yield* seedAgent({ id: 'reviewer', parent: project.leadAgentId, folder: source.path })
        const [thread] = yield* appendSetup([eventOf({ _tag: 'ThreadItem', agentId: reviewer.agentId, itemId: 'browser-report', content: { _tag: 'text', text: 'Synthetic report for the browser journey.' }, replay: false })])
        for (const kind of ['tests', 'review']) success(yield* call(ownerCredential, 'project.review.report', {
          projectId: project.projectId, worktreeId: source.worktreeId, head: git(source.path, 'rev-parse', 'HEAD'), kind, status: 'passed',
          summary: 'Synthetic passed report for the browser journey.', threadAgentId: reviewer.agentId, threadSequence: thread!.sequence
        }))
        yield* Effect.promise(async () => {
          await page.getByRole('button', { name: 'Refresh Git', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Open merge review', exact: true })).toBeEnabled()
          await page.getByRole('button', { name: 'Open merge review', exact: true }).click()
          await expect(page.getByRole('dialog')).toContainText('current: passed')
          await page.getByRole('button', { name: 'Approve and merge', exact: true }).click()
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await expect(page.locator('.git')).toHaveAttribute('aria-busy', 'false')
          expect(readFileSync(join(rig.work, 'file.txt'), 'utf8')).toBe('ours\ntheirs\n')
          expect(errors).toEqual([])
        })
      })).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<void, unknown>)
  } finally { if (previous === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previous; removeRig(rig) }
}
