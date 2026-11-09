import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { AgentId, EpochMilliseconds, EventSequence, RequestId } from "../ids.ts"
import { ProjectId, ProjectName, ProjectPath, ProjectText, RepositoryId, WorkspaceId } from "./schema.ts"

const text = Schema.String.check(Schema.isMaxCodePoints(1024 * 1024))
const nullable = Schema.NullOr(text)
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const items = <S extends Schema.Constraint>(item: S) => Schema.Struct({ items: Schema.Array(item).check(Schema.isMaxLength(200)), truncated: Schema.Boolean })
export const GitBranch = Schema.Struct({ name: text, head: text, current: Schema.Boolean, upstream: nullable })
export const GitCheckout = Schema.Struct({ path: text, head: nullable, branch: nullable, locked: Schema.Boolean, available: Schema.Boolean })
export const GitChange = Schema.Struct({ path: text, originalPath: nullable, index: text, worktree: text, staged: Schema.Boolean, unstaged: Schema.Boolean, conflict: Schema.Boolean, untracked: Schema.Boolean })
export const GitDiff = Schema.Struct({ patch: text, additions: count, deletions: count, binary: Schema.Boolean, truncated: Schema.Boolean })
export const GitCommit = Schema.Struct({ head: text, parents: Schema.Array(text), author: text, at: text, title: text })
export const GitCommitFile = Schema.Struct({ path: text, originalPath: nullable, status: text })
export const GitState = Schema.Struct({ head: nullable, branch: nullable, upstream: nullable, mergeHead: nullable, ahead: count, behind: count, pending: count, pendingSince: nullable })
export const GitChoice = Schema.Literals(["ours", "theirs", "both"])
export const GitSelection = Schema.Struct({ path: ProjectPath, fingerprint: ProjectName, head: ProjectName, choices: Schema.Array(Schema.NullOr(GitChoice)).check(Schema.isMaxLength(8192)) })
export const GitConflict = Schema.Struct({ ...GitSelection.fields, ours: text, base: text, theirs: text,
  segments: Schema.Array(Schema.Union([
    Schema.Struct({ kind: Schema.Literal("context"), line: count, context: Schema.Array(text) }),
    Schema.Struct({ kind: Schema.Literal("conflict"), ours: Schema.Array(text), base: Schema.Array(text), theirs: Schema.Array(text) })
  ])) })
export const GitDiscardPlan = Schema.Struct({ fingerprint: ProjectName, paths: Schema.Array(ProjectPath).check(Schema.isMaxLength(200)) })
export const GitReview = Schema.Struct({ head: text, baseHead: text, branch: text, base: text, commits: items(GitCommit), files: items(GitCommitFile), diff: GitDiff })
// Reports describe observed work. They are never approval credentials or
// engine-executed test proof. The thread reference must exist in this project.
export const GitEvidenceKind = Schema.Literals(["tests", "review"])
export const GitEvidenceStatus = Schema.Literals(["passed", "failed"])
export const GitEvidence = Schema.Struct({ reportId: RequestId, projectId: ProjectId, worktreeId: WorkspaceId,
  head: ProjectName, kind: GitEvidenceKind, status: GitEvidenceStatus, summary: ProjectText,
  threadAgentId: AgentId, threadSequence: EventSequence,
  reportedBy: Schema.Union([Schema.TaggedStruct("owner", {}), Schema.TaggedStruct("agent", { agentId: AgentId })]),
  provenance: Schema.Literal("reported"), recordedAt: EpochMilliseconds })
export type GitEvidence = typeof GitEvidence.Type
export const GitEvidenceSlot = Schema.Struct({ state: Schema.Literals(["missing", "current", "stale"]), report: Schema.NullOr(GitEvidence) })
export const GitEvidenceSet = Schema.Struct({ tests: GitEvidenceSlot, review: GitEvidenceSlot })
export type GitEvidenceSet = typeof GitEvidenceSet.Type
export const GitApprovalDecision = Schema.Literals(["approve", "approve_without_evidence"])
export const GitMainReview = Schema.Struct({ reviewId: RequestId, projectId: ProjectId, worktreeId: WorkspaceId,
  destinationId: WorkspaceId, head: ProjectName, baseHead: ProjectName, branch: ProjectName, base: ProjectName,
  evidence: GitEvidenceSet, openedAt: EpochMilliseconds,
  decision: Schema.NullOr(GitApprovalDecision), outcome: Schema.Literals(["open", "merged", "refused"]),
  mergeHead: nullable, reason: nullable, decidedAt: Schema.NullOr(EpochMilliseconds) })
export type GitMainReview = typeof GitMainReview.Type
const request = { requestId: RequestId }
const workspace = { ...request, worktreeId: WorkspaceId, projectId: Schema.optionalKey(ProjectId) }
const repository = { ...request, repoId: RepositoryId }
const error = Schema.TaggedStruct("CommandError", { ...request, reason: Schema.String })
const ack = Schema.Struct(request)
const reply = <S extends Schema.Constraint>(result: S) => Schema.Struct({ ...request, result })
const readReply = <S extends Schema.Constraint>(result: S) => Schema.Union([reply(result), Schema.Struct({ ...request, data: Schema.String })])
export const ProjectGitRpcGroup = RpcGroup.make(
  Rpc.make("repository.discover", { payload: request, success: reply(items(Schema.Struct({ path: text, name: text }))), error }),
  Rpc.make("branches", { payload: repository, success: reply(items(GitBranch)), error }),
  Rpc.make("checkouts", { payload: repository, success: reply(items(GitCheckout)), error }),
  Rpc.make("changes", { payload: workspace, success: readReply(items(GitChange)), error }),
  Rpc.make("diff", { payload: { ...workspace, path: Schema.optionalKey(ProjectPath), staged: Schema.optionalKey(Schema.Boolean), commit: Schema.optionalKey(ProjectName) }, success: readReply(GitDiff), error }),
  Rpc.make("history", { payload: { ...workspace, limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))) }, success: readReply(items(GitCommit)), error }),
  Rpc.make("commit.files", { payload: { ...workspace, commit: ProjectName }, success: readReply(items(GitCommitFile)), error }),
  Rpc.make("git.state", { payload: { ...workspace, target: Schema.optionalKey(ProjectName) }, success: readReply(GitState), error }),
  Rpc.make("stage", { payload: { ...workspace, path: ProjectPath }, success: ack, error }),
  Rpc.make("unstage", { payload: { ...workspace, path: ProjectPath }, success: ack, error }),
  Rpc.make("stage.all", { payload: workspace, success: ack, error }),
  Rpc.make("unstage.all", { payload: workspace, success: ack, error }),
  Rpc.make("discard.plan", { payload: { ...workspace, paths: Schema.optionalKey(GitDiscardPlan.fields.paths) }, success: reply(GitDiscardPlan), error }),
  Rpc.make("discard", { payload: { ...workspace, plan: GitDiscardPlan, confirmed: Schema.Boolean }, success: ack, error }),
  Rpc.make("commit", { payload: { ...workspace, message: ProjectText }, success: reply(Schema.Struct({ head: text })), error }),
  Rpc.make("fetch", { payload: workspace, success: ack, error }),
  Rpc.make("pull", { payload: workspace, success: ack, error }),
  Rpc.make("push", { payload: workspace, success: ack, error }),
  Rpc.make("integrate", { payload: { ...workspace, destinationId: WorkspaceId, expectedHead: ProjectName }, success: reply(Schema.Struct({ head: text })), error }),
  Rpc.make("review", { payload: { ...workspace, base: ProjectName }, success: readReply(GitReview), error }),
  Rpc.make("review.open", { payload: { ...workspace, base: ProjectName, expectedHead: ProjectName }, success: reply(Schema.Struct({ head: text, url: text, kind: Schema.Literal("compare"), opened: Schema.Literal(false) })), error }),
  Rpc.make("review.report", { payload: { ...workspace, projectId: ProjectId, head: ProjectName, kind: GitEvidenceKind,
    status: GitEvidenceStatus, summary: ProjectText, threadAgentId: AgentId, threadSequence: EventSequence }, success: ack, error }),
  Rpc.make("review.prepare", { payload: { ...workspace, projectId: ProjectId, destinationId: WorkspaceId },
    success: reply(Schema.Struct({ review: GitMainReview, comparison: GitReview })), error }),
  Rpc.make("review.status", { payload: { ...workspace, projectId: ProjectId },
    success: readReply(Schema.Struct({ review: Schema.NullOr(GitMainReview), evidence: GitEvidenceSet })), error }),
  Rpc.make("review.approve", { payload: { ...workspace, projectId: ProjectId, reviewId: RequestId,
    expectedHead: ProjectName, expectedBaseHead: ProjectName, confirmed: Schema.Boolean, decision: GitApprovalDecision },
    success: reply(GitMainReview), error }),
  Rpc.make("conflict", { payload: { ...workspace, path: ProjectPath }, success: readReply(GitConflict), error }),
  Rpc.make("conflict.choose", { payload: { ...workspace, selection: GitSelection, hunk: count, choice: GitChoice }, success: reply(GitConflict), error }),
  Rpc.make("conflict.resolve", { payload: { ...workspace, selection: GitSelection }, success: ack, error })
).prefix("project.")
const owner = ["owner"] as const
const member = ["owner", "agent"] as const
export const projectGitAccess = {
  "project.repository.discover": owner, "project.branches": owner, "project.checkouts": owner,
  "project.changes": member, "project.diff": member, "project.history": member, "project.commit.files": member, "project.git.state": member,
  "project.stage": owner, "project.unstage": owner, "project.stage.all": owner, "project.unstage.all": owner, "project.discard.plan": owner, "project.discard": owner,
  "project.commit": owner, "project.fetch": owner, "project.pull": owner, "project.push": owner, "project.integrate": owner, "project.review": member,
  "project.review.open": owner, "project.conflict": member, "project.conflict.choose": owner, "project.conflict.resolve": owner,
  "project.review.report": member, "project.review.prepare": owner, "project.review.status": member, "project.review.approve": owner
} satisfies Record<import("effect/rpc/Rpc").Tag<RpcGroup.Rpcs<typeof ProjectGitRpcGroup>>, ReadonlyArray<import("../commands.ts").CallerKind>>
