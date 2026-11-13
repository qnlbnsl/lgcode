// Pure mapping for the Git tab and the service pages. Missing engine fields stay empty.
import type { Account, ClientRequest, ClientSnapshot, HarnessSettings, ProjectSettings, RolesSettings, Alert, AlertSettings, WebSettings, RoleFile } from "@lgtm/contracts"
import { mapPermission } from "./mapping.ts"

export function mapHarnesses(rows: ReadonlyArray<HarnessSettings>) {
  return Object.fromEntries(rows.map((h) => [h.id, { name: h.id, models: [...h.models], efforts: [...h.efforts], noEffort: [], runMode: h.runMode.toUpperCase() }]))
}

export function mapAccounts(accounts: ReadonlyArray<Account>, statuses: ClientSnapshot["accounts"], harnesses: ReadonlyArray<HarnessSettings>, settings?: ProjectSettings) {
  return accounts.map((a) => {
    const status = statuses?.find((s) => s.id === a.id)?.status
    return { id: a.id, name: a.displayName ?? a.id, harness: a.harness, machine: "", enabled: a.enabled !== false,
      signedIn: status !== "needs-sign-in", status: status ?? "", useForNew: settings?.lead?.account._tag === "named" && settings.lead.account.accountId === a.id,
      model: harnesses.find((h) => h.id === a.harness)?.defaultModel ?? "", account: null, usage: null, window: null }
  })
}

export function mapServiceSettings(project: ProjectSettings | undefined, harnesses: ReadonlyArray<HarnessSettings>, roles: RolesSettings, web: WebSettings, roleFile: RoleFile | null) {
  const lead = project?.lead, harness = harnesses.find((h) => h.id === lead?.harness)
  return { defaultHarness: lead?.harness ?? "", defaultModel: lead?.model ?? harness?.defaultModel ?? "", defaultEffort: lead?.effort ?? harness?.defaultEffort ?? "",
    defaultPermission: lead ? mapPermission(lead.permission) : "", webEnabled: web.enabled, port: web.port, checkIn: web.heartbeatSeconds,
    proxyMode: web.proxyMode, publicAddress: web.publicAddress ?? "", stallWatch: roles.stallWatch ?? null, standingRules: roles.standingRules ?? null,
    stallWorker: roles.limits?.stallMinutes ?? null, stallLead: null, stallAssigned: null, capacityBackoff: roles.limits?.capacityBackoffMinutes ?? null,
    capacityRetries: roles.limits?.capacityRetries ?? null, crashRetries: roles.limits?.crashRetries ?? null, teamIdle: roles.limits?.teamIdleMinutes ?? null,
    roleFile, needToKnow: null, removeCredits: null, autoNudge: null, replaceAfter: null, workflowPath: "", maxRounds: null,
    testsDefault: null, reviewDefault: null, gitModel: "", version: "", commit: "", dataFolder: "" }
}

export function mapAlertSettings(settings: AlertSettings) {
  return { ntfyServer: settings.carrier._tag === "ntfy" ? settings.carrier.server : "", ntfyTopic: settings.carrier._tag === "ntfy" ? settings.carrier.topic : "",
    ntfyToken: "", tokenSet: settings.tokenSet, notifyOn: Object.fromEntries(settings.kinds.map((k) => [k.kind === "failure" ? "failed" : k.kind, k.push])),
    quiet: { on: null, from: "", to: "", failed: null } }
}

export function mapPhoneOffer(settings: AlertSettings) {
  return settings.pushPromptDismissed || settings.carrier._tag !== 'none' ? 'declined' : 'open'
}

export function mapAlerts(alerts: ReadonlyArray<Alert>, agents: ReadonlyArray<{ id: string; project: string }>, requests: ReadonlyArray<ClientRequest> = []) {
  return alerts.map((a) => {
    const request = a.subject?._tag === "permission" || a.subject?._tag === "question" ? a.subject.id : null
    const row = requests.find((r) => r.id === request)
    const agent = agents.find((x) => x.id === (a.agentId ?? row?.agentId ?? (a.subject?._tag === "agent" ? a.subject.id : "")))
    const to = agent ? `/p/${encodeURIComponent(agent.project)}/chat/${encodeURIComponent(agent.id)}` : a.subject?._tag === "account" ? "/subscriptions" : null
    return { id: a.alertId, ts: a.raisedAt, kind: a.kind === "failure" ? "failed" : a.kind, title: a.title, agent: agent?.id ?? null, project: agent?.project ?? null,
      request, to, answer: row?.status === 'answered' ? row.answer ?? '' : '', read: a.status === "cleared", delivery: a.delivery?.status === "delivered" ? "sent" : a.delivery?.status ?? "off",
      error: a.delivery?.status === "failed" ? a.delivery.reason : null, generation: a.delivery?.generation, attempt: a.delivery?.attempt }
  }).sort((a, b) => b.ts - a.ts)
}

import type { GitChange, GitCommit, GitCommitFile, GitConflict, GitDiff, GitMainReview, GitReview, GitState, GitBranch } from "@lgtm/contracts"
import { parseDiff } from "../../web/src/git/diff.ts"
type Change = typeof GitChange.Type
type Diff = typeof GitDiff.Type
// The existing website's parser checks hunk lengths and incomplete patches. Both clients
// use it so a cut-off patch never appears to be a complete diff.
export function mapGitDiff(diff: Diff) {
  const parsed = parseDiff(diff)
  return { kind: diff.binary ? 'binary' : 'text', size: '', add: diff.additions, del: diff.deletions,
    truncated: diff.truncated, diffError: parsed.complete ? '' : parsed.reason,
    hunks: parsed.complete ? parsed.files.flatMap((f) => f.hunks.map((h) => {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(h.header)!
      return { oldStart: Number(m[1]), oldCount: Number(m[2] ?? 1), newStart: Number(m[3]), newCount: Number(m[4] ?? 1), label: m[5]?.trim() ?? '',
        lines: h.lines.map((l) => ({ t: l.kind === 'added' ? 'add' : l.kind === 'removed' ? 'del' : 'ctx', text: l.text, o: l.old, n: l.next })) }
    })) : [] }
}
export function mapGitChanges(rows: ReadonlyArray<Change>) {
  return rows.flatMap((row) => {
    const sides = row.conflict ? [false] : [...(row.staged ? [true] : []), ...(row.unstaged ? [false] : [])]
    return sides.map((staged) => ({ id: JSON.stringify([row.path, staged]), path: row.path, oldPath: row.originalPath, staged,
      status: row.conflict ? 'C' : row.untracked ? 'A' : (staged ? row.index : row.worktree).trim() || 'M',
      conflict: row.conflict, kind: 'text', add: null as number | null, del: null as number | null, hunks: [], loaded: false }))
  })
}
export function mapGitCommit(commit: typeof GitCommit.Type, branches: ReadonlyArray<typeof GitBranch.Type>) {
  return { hash: commit.head, subject: commit.title, body: '', author: commit.author, ts: Date.parse(commit.at), merge: commit.parents.length > 1,
    refs: branches.filter((b) => b.head === commit.head).map((b) => b.name), files: [], loaded: false }
}
export function mapCommitFiles(files: ReadonlyArray<typeof GitCommitFile.Type>) {
  return files.map((f) => ({ id: f.path, path: f.path, oldPath: f.originalPath, status: f.status[0], staged: false, kind: 'text', add: null as number | null, del: null as number | null, hunks: [], loaded: false }))
}
export function mapGitState(state: typeof GitState.Type, parent: string | null) {
  return { head: state.head, upstream: state.upstream, remoteAhead: state.ahead, remoteBehind: state.behind,
    ahead: parent ? state.pending : state.ahead, behind: null, mergeHead: state.mergeHead, pendingSince: state.pendingSince }
}
export function mapConflict(conflict: typeof GitConflict.Type) {
  let hunk = 0
  return { id: conflict.path, path: conflict.path, resolved: false, selection: { path: conflict.path, head: conflict.head, fingerprint: conflict.fingerprint, choices: [...conflict.choices] },
    parts: conflict.segments.map((s) => s.kind === 'context' ? { ctx: [...s.context], start: s.line } : { id: 'hunk-' + hunk, hunk, ours: [...s.ours], base: [...s.base], theirs: [...s.theirs], choice: conflict.choices[hunk++] ?? null }) }
}
export function mapMainReview(review: GitMainReview, comparison: typeof GitReview.Type | undefined, lead: string) {
  const evidence = (slot: GitMainReview['evidence']['tests']) => ({ ok: slot.state === 'current' && slot.report?.status === 'passed',
    text: slot.report?.summary ?? '', value: slot.state === 'missing' ? 'Missing' : `${slot.state}: ${slot.report?.status ?? ''}`,
    sub: slot.report?.summary ?? '', agent: slot.report?.reportedBy._tag === 'agent' ? slot.report.reportedBy.agentId : null })
  return { id: review.reviewId, kind: 'merge', project: review.projectId, agent: lead, worktreeId: review.worktreeId, destinationId: review.destinationId,
    title: `Merge ${review.branch} into ${review.base}`, source: review.branch, target: review.base, head: review.head, baseHead: review.baseHead,
    status: review.outcome === 'open' ? 'open' : 'answered', outcome: review.outcome, answer: review.outcome === 'merged' ? 'Merged' : review.reason ?? '',
    answeredAt: review.decidedAt, createdAt: review.openedAt, brief: '', body: '', notice: '',
    evidence: { tests: evidence(review.evidence.tests), review: evidence(review.evidence.review), commits: comparison?.commits.items.length ?? null,
      files: comparison?.files.items.length ?? null, add: comparison?.diff.additions, del: comparison?.diff.deletions, conflicts: null },
    files: comparison ? mapCommitFiles(comparison.files.items) : [], truncated: !!(comparison?.files.truncated || comparison?.commits.truncated || comparison?.diff.truncated) }
}

import type { Workspace, Project, Team } from '@lgtm/contracts'
// Registered workspaces are linked from Project and Team records. The workspace itself
// need not carry projectId or teamId, especially when registered by the owner.
export function workspaceIdentity(row: Workspace, workspaces: ReadonlyArray<Workspace>, projects: ReadonlyArray<Project>, teams: ReadonlyArray<Team>) {
  const team = teams.find((t) => t.worktreeId === row.worktreeId && projects.find((p) => p.projectId === t.projectId)?.worktreeId !== row.worktreeId)
  const project = projects.find((p) => p.worktreeId === row.worktreeId || p.projectId === (row.projectId ?? team?.projectId))
  const kind = row.checkout === 'main' ? 'base' : team || row.teamId ? 'team' : project ? 'project' : 'base'
  const parent = workspaces.find((w) => w.worktreeId === row.parentId) ?? (kind === 'project' ? workspaces.find((w) => w.repoId === row.repoId && w.checkout === 'main') : undefined)
  return { kind, project: kind === 'base' ? null : project?.projectId ?? null, team: team?.teamId ?? row.teamId ?? null,
    owner: row.owner ?? (kind === 'project' ? project?.leadAgentId : undefined) ?? null, parent: parent?.branch ?? null, parentId: parent?.worktreeId ?? null } as const
}
