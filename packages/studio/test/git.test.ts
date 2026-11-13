import { describe, expect, it } from "vitest"
import { mapAccounts, mapAlertSettings, mapAlerts, mapHarnesses, mapServiceSettings } from "../src/git.ts"
import type { Account, Alert, AlertSettings, HarnessSettings, ProjectSettings } from "@lgtm/contracts"
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
})

import { mapCommitFiles, mapConflict, mapGitChanges, mapGitCommit, mapGitDiff, mapGitState, mapMainReview } from '../src/git.ts'
import type { GitChange, GitCommit, GitConflict, GitMainReview, GitState } from '@lgtm/contracts'
describe('Git mapping', () => {
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
