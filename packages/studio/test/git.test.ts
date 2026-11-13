import { describe, expect, it } from "vitest"
import { mapAccounts, mapAlertSettings, mapAlerts, mapHarnesses, mapPhoneOffer, mapServiceSettings, workspaceIdentity } from "../src/git.ts"
import type { Account, Alert, AlertSettings, HarnessSettings, ProjectSettings } from "@lgtm/contracts"
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import * as Stream from 'effect/Stream'
import { engineConnection } from '../src/connection.ts'
import { engineSnapshot } from './fixtures.ts'
const harness = { id: 'codex', runMode: 'acp', models: ['model'], efforts: ['high'], defaultModel: 'model', defaultPermission: 'ask' } as unknown as HarnessSettings
const account = { id: 'account', harness: 'codex', displayName: 'Build account', enabled: true } as unknown as Account
const project = { workspaceFolder: '/tmp', shell: '/bin/sh', lead: { harness: 'codex', account: { _tag: 'named', accountId: 'account' }, permission: 'edit' } } as unknown as ProjectSettings

describe('service mapping', () => {
  it('maps harness choices without sample models', () => {
    expect(mapHarnesses([harness])).toEqual({ codex: { name: 'codex', models: ['model'], efforts: ['high'], noEffort: [], runMode: 'ACP' } })
  })
  it('maps named accounts and harness defaults without assigning a machine or usage', () => {
    const [row] = mapAccounts([account], [{ id: account.id, status: 'out-of-usage', enabled: true, environment: [] }], [harness], project)
    expect(row).toMatchObject({ name: 'Build account', status: 'out-of-usage', useForNew: true, model: 'model', machine: '', usage: null, window: null, account: null })
    expect(mapAccounts([{ ...account, enabled: false }], [{ id: account.id, status: 'needs-sign-in', enabled: false, environment: [] }], [], undefined)[0]).toMatchObject({ signedIn: false, enabled: false, useForNew: false, model: '' })
  })
  it('maps exact settings and keeps unavailable and unset values empty', () => {
    const result = mapServiceSettings(project, [harness], { stallWatch: false, limits: { stallMinutes: 37, crashRetries: 0 } }, { enabled: true, port: 8793, heartbeatSeconds: 31, proxyMode: false }, null)
    expect(result).toMatchObject({ defaultModel: 'model', defaultPermission: 'Edit files without asking', port: 8793, checkIn: 31, stallWatch: false, stallWorker: 37, crashRetries: 0, stallLead: null, stallAssigned: null, gitModel: '', version: '' })
    expect(mapServiceSettings(undefined, [], {}, { enabled: false, port: 1, heartbeatSeconds: 1, proxyMode: false }, null)).toMatchObject({ defaultHarness: '', capacityRetries: null, stallWatch: null })
  })
  it('never returns a saved token or invents quiet hours', () => {
    const settings = { carrier: { _tag: 'ntfy', server: 'http://127.0.0.1:9999', topic: 'test' }, tokenSet: true, kinds: [{ kind: 'failure', push: true }] } as AlertSettings
    expect(mapAlertSettings(settings)).toEqual({ ntfyServer: 'http://127.0.0.1:9999', ntfyTopic: 'test', ntfyToken: '', tokenSet: true, notifyOn: { failed: true }, quiet: { on: null, from: '', to: '', failed: null } })
  })
  it('joins alerts to agent routes and preserves retry identity', () => {
    const alert = { alertId: 'alert', kind: 'question', title: 'Question', agentId: 'worker', subject: { _tag: 'question', id: 'question' }, raisedAt: 123, status: 'open', delivery: { status: 'failed', reason: 'token missing', generation: 7, attempt: 2, final: true } } as unknown as Alert
    expect(mapAlerts([alert], [{ id: 'worker', project: 'project' }])[0]).toMatchObject({ id: 'alert', read: false, request: 'question', to: '/p/project/chat/worker', generation: 7, attempt: 2, error: 'token missing' })
  })
  it('uses service dismissal and carrier state for the phone offer', () => {
    const settings = { carrier: { _tag: 'none' }, pushPromptDismissed: false } as AlertSettings
    expect(mapPhoneOffer(settings)).toBe('open')
    expect(mapPhoneOffer({ ...settings, pushPromptDismissed: true })).toBe('declined')
    expect(mapPhoneOffer({ ...settings, carrier: { _tag: 'ntfy', server: 'http://127.0.0.1:1', topic: 'test' } })).toBe('declined')
  })
  it('joins answered requests even when the alert has no agent identity', () => {
    const alert = { alertId: 'alert', kind: 'question', title: 'Question', subject: { _tag: 'question', id: 'question' }, raisedAt: 1, status: 'cleared' } as unknown as Alert
    const request = { id: 'question', agentId: 'worker', status: 'answered', answer: 'Proceed' } as import('@lgtm/contracts').ClientRequest
    expect(mapAlerts([alert], [{ id: 'worker', project: 'project' }], [request])[0]).toMatchObject({ read: true, answer: 'Proceed', to: '/p/project/chat/worker' })
  })
})

describe('authenticated screen requests', () => {
  it('keeps an uncertain notification retry receipt and wraps token ingress', async () => {
    const ids: string[] = [], secrets: Redacted.Redacted<string>[] = []
    let ready = false
    const client = {
      'client.snapshot': () => Effect.succeed(engineSnapshot),
      'project.settings': () => Effect.sync(() => { ready = true; return {} }),
      'client.subscribe': () => Stream.never,
      'client.alerts.retry': (p: { requestId: string }) => Effect.suspend(() => {
        ids.push(p.requestId)
        return ids.length === 1 ? Effect.fail({ reason: 'transport lost' }) : Effect.succeed({ accepted: false, reason: 'carrier delivery failed' })
      }),
      'client.alerts.carrier.set-token': (p: { value: Redacted.Redacted<string> }) => Effect.sync(() => {
        expect(Redacted.value(p.value)).toBe('synthetic-token')
        secrets.push(p.value)
        return {}
      })
    }
    const connection = engineConnection({ location: { protocol: 'http:', host: '127.0.0.1' }, fetch: async () => new Response(null, { status: 204 }),
      connect: (() => Effect.succeed(client)) as unknown as NonNullable<import('../src/connection.ts').ConnectionOptions['connect']>, debug() {} })
    connection.open(() => {})
    try {
      await expect.poll(() => ready).toBe(true)
      const retry = { alertId: 'alert', generation: 1, attempt: 1 }
      await expect(connection.request('client.alerts.retry', retry)).rejects.toThrow('transport lost')
      await expect(connection.request('client.alerts.retry', retry)).resolves.toMatchObject({ accepted: false })
      expect(ids[0]).toBe(ids[1])
      await connection.request('client.alerts.retry', retry)
      expect(ids[2]).not.toBe(ids[1])
      await connection.request('client.alerts.carrier.set-token', { origin: 'http://127.0.0.1:1', nonce: 'test', value: 'synthetic-token' })
      expect(() => Redacted.value(secrets[0]!)).toThrow()
      await expect(connection.request('unknown', {})).rejects.toThrow('Unknown service request.')
    } finally { connection.close() }
  })
})

import { mapCommitFiles, mapConflict, mapGitChanges, mapGitCommit, mapGitDiff, mapGitState, mapMainReview } from '../src/git.ts'
import type { GitChange, GitCommit, GitConflict, GitMainReview, GitState } from '@lgtm/contracts'
describe('Git mapping', () => {
  it('joins registered project and team worktrees to their real parent branches', () => {
    const base = { worktreeId: 'base', repoId: 'repo', branch: 'main', checkout: 'main' } as import('@lgtm/contracts').Workspace
    const source = { worktreeId: 'source', repoId: 'repo', branch: 'project', checkout: 'worktree' } as import('@lgtm/contracts').Workspace
    const team = { worktreeId: 'team', repoId: 'repo', branch: 'build', checkout: 'worktree', parentId: 'source' } as import('@lgtm/contracts').Workspace
    const project = { projectId: 'project', worktreeId: 'source', leadAgentId: 'lead' } as import('@lgtm/contracts').Project
    const teams = [{ teamId: 'build', projectId: 'project', worktreeId: 'team' }] as import('@lgtm/contracts').Team[]
    expect(workspaceIdentity(source, [base, source, team], [project], teams)).toEqual({ kind: 'project', project: 'project', team: null, owner: 'lead', parent: 'main' })
    expect(workspaceIdentity(team, [base, source, team], [project], teams)).toEqual({ kind: 'team', project: 'project', team: 'build', owner: null, parent: 'project' })
  })
  it('keeps both indexed and working sides of a partially staged file', () => {
    const rows = mapGitChanges([{ path: 'file.txt', originalPath: 'old.txt', staged: true, unstaged: true, conflict: false, untracked: false, index: 'R', worktree: 'M' }])
    expect(rows.map((r) => [r.status, r.staged, r.path, r.oldPath])).toEqual([['R', true, 'file.txt', 'old.txt'], ['M', false, 'file.txt', 'old.txt']])
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
    expect(rows[0]?.add).toBeNull()
  })
  it('maps untracked and conflicted files without inventing a diff', () => {
    const row = { path: 'file', originalPath: null, staged: false, unstaged: true, conflict: false, untracked: true, index: '?', worktree: '?' }
    expect(mapGitChanges([row])[0]).toMatchObject({ status: 'A', loaded: false })
    expect(mapGitChanges([{ ...row, conflict: true, staged: true }])[0]).toMatchObject({ status: 'C', staged: false })
  })
  it('maps unified hunk ranges, counts and literal text', () => {
    const mapped = mapGitDiff({ patch: 'diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -3,2 +3,2 @@ label\n context\n-old\n+<script>literal</script>\n', additions: 1, deletions: 1, binary: false, truncated: false })
    expect(mapped.hunks[0]).toMatchObject({ oldStart: 3, oldCount: 2, newStart: 3, newCount: 2, label: 'label', lines: [{ t: 'ctx', o: 3, n: 3 }, { t: 'del', o: 4, n: null }, { t: 'add', o: null, n: 4 }] })
    expect(mapped.hunks[0]?.lines[2]?.text).toBe('<script>literal</script>')
    for (const truncated of [true, false]) expect(mapGitDiff({ patch: 'diff --git a/f b/f\n@@ -1 +1 @@\n-old\n', additions: 1, deletions: 1, binary: false, truncated }).diffError).not.toBe('')
    expect(mapGitDiff({ patch: '', additions: 0, deletions: 0, binary: true, truncated: false })).toMatchObject({ kind: 'binary', size: '', hunks: [] })
  })
  it('preserves full commit identities and branch heads, and leaves bodies empty', () => {
    const row = { head: 'full-head', parents: ['a', 'b'], title: 'Commit title', author: 'Builder <builder@example.invalid>', at: '2026-11-13T00:00:00Z' }
    expect(mapGitCommit(row, [{ name: 'topic', head: 'full-head', current: true, upstream: null }])).toMatchObject({ hash: 'full-head', merge: true, author: row.author, refs: ['topic'], body: '', files: [] })
    expect(mapCommitFiles([{ path: 'new', originalPath: 'old', status: 'R100' }])[0]).toMatchObject({ path: 'new', oldPath: 'old', status: 'R', add: null })
  })
  it('distinguishes upstream counts from commits pending against the parent', () => {
    expect(mapGitState({ head: 'head', branch: 'topic', upstream: 'origin/topic', mergeHead: null, ahead: 9, behind: 4, pending: 2, pendingSince: null }, 'main')).toMatchObject({ ahead: 2, behind: null, remoteAhead: 9, remoteBehind: 4 })
  })
  it('maps conflict hunks and choices without changing their fingerprint', () => {
    const row = { path: 'file', head: 'head', fingerprint: 'fingerprint', choices: ['both'], ours: '', base: '', theirs: '', segments: [{ kind: 'context', line: 4, context: ['context'] }, { kind: 'conflict', ours: ['ours'], base: ['base'], theirs: ['theirs'] }] } as unknown as typeof GitConflict.Type
    expect(mapConflict(row)).toMatchObject({ selection: { head: 'head', fingerprint: 'fingerprint', choices: ['both'] }, parts: [{ start: 4, ctx: ['context'] }, { id: 'hunk-0', hunk: 0, choice: 'both', ours: ['ours'] }] })
  })
  it('does not claim stale reported evidence passes', () => {
    const report = { summary: 'Reported result', status: 'passed', reportedBy: { _tag: 'owner' } }
    const review = { reviewId: 'review', projectId: 'project', worktreeId: 'worktree', destinationId: 'main', head: 'head', baseHead: 'base', branch: 'topic', base: 'main', evidence: { tests: { state: 'stale', report }, review: { state: 'missing', report: null } }, openedAt: 1, outcome: 'open', decidedAt: null } as unknown as GitMainReview
    expect(mapMainReview(review, undefined, 'project-lead')).toMatchObject({ head: 'head', baseHead: 'base', status: 'open', notice: '', evidence: { tests: { ok: false, value: 'stale: passed' }, review: { ok: false, value: 'Missing' }, conflicts: null } })
  })
})
