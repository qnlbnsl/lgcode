import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { GitEvidence, GitMainReview, type GitEvidenceSet, type Event } from "@lgtm/contracts"
import { type Input, type Payload, type PiecePlanner, refused, CommandUncertain } from "../commands/internal.ts"
import { type ReadHandler } from "../api/reads.ts"
import { canReadProject } from "./access.ts"
import { own, projectKey, projectView } from "./view.ts"
import { gitCall, gitReply, repositoryPath, withGit, workspacePath } from "./gitApi.ts"
import type { GitService } from "./git/index.ts"

const scope = (input: Input, raw: Record<string, unknown>, git: GitService) => Effect.gen(function* () {
  const project = own(projectView(input.snapshot).projects, raw.projectId as string)
  if (project === undefined || !canReadProject(input.snapshot, input.actor, project.projectId)
    || project.worktreeId !== raw.worktreeId || project.archiving || project.archivedAt !== undefined) return yield* refused("project is unavailable to this caller")
  const source = yield* workspacePath(input, raw, git)
  if (source.repoId !== project.repoId || source.machineId !== project.machineId) return yield* refused("project is unavailable to this caller")
  return { project, source }
})
const destination = (input: Input, raw: Record<string, unknown>, git: GitService, repoId: string) => Effect.gen(function* () {
  // Main is outside the project's member workspace set. This helper is used
  // only by owner-checked prepare/approve, never by an ordinary member read.
  const target = yield* workspacePath(input, { worktreeId: raw.destinationId }, git)
  const { repository, location } = yield* repositoryPath(input, repoId)
  if (target.repoId !== repoId || target.checkout !== "main" || target.path !== repository.path || target.path !== location.path
    || !["main", "master"].includes(target.branch)) return yield* refused("main review requires the registered project and its repository base")
  return target
})
const validThread = (input: Input, projectId: string, agentId: string, sequence: number) => Effect.gen(function* () {
  if (own(input.snapshot.agents, agentId) === undefined || own(projectView(input.snapshot).agentProjects, agentId) !== projectId) return false
  const rows = yield* input.runtime.sql<{ thread_agent_id: string | null }>`SELECT thread_agent_id FROM events WHERE sequence = ${sequence}`
    .pipe(Effect.catchTag("SqlError", () => Effect.fail(refused("review thread could not be read"))))
  return rows[0]?.thread_agent_id === agentId
})
const evidenceFor = (input: Input, projectId: string, worktreeId: string, head: string) => Effect.gen(function* () {
  const slot = (kind: "tests" | "review") => Effect.gen(function* () {
    const report = own(projectView(input.snapshot).gitEvidence, projectKey(worktreeId, kind))
    if (report === undefined || report.projectId !== projectId) return { state: "missing" as const, report: null }
    const current = report.head === head && (yield* validThread(input, projectId, report.threadAgentId, report.threadSequence))
    return { state: current ? "current" as const : "stale" as const, report }
  })
  return { tests: yield* slot("tests"), review: yield* slot("review") } satisfies GitEvidenceSet
})
const owner = (input: Input) => input.actor._tag === "owner" ? Effect.void : Effect.fail(refused("Git: owner_required"))
const identity = (input: Input, values: ReadonlyArray<string>) => Effect.gen(function* () {
  for (const value of values) if ((yield* input.runtime.log.redactText(value)) !== value) return yield* refused("review identity contains a registered secret")
})

const report: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.review.report">
  const { project, source } = yield* withGit(input, (git) => scope(input, raw, git))
  if (input.actor._tag !== "owner" && (input.actor._tag !== "agent" || input.actor.agentId !== p.threadAgentId)) return yield* refused("review report requires the caller's project thread")
  if (!(yield* validThread(input, project.projectId, p.threadAgentId, p.threadSequence))) return yield* refused("review report requires an existing project thread item")
  yield* withGit(input, (git) => Effect.gen(function* () {
    if ((yield* gitCall(git.state(source.path))).head !== p.head) return yield* refused("Git: stale_state")
  }))
  yield* identity(input, [p.head])
  const value = Schema.decodeUnknownSync(GitEvidence)({ reportId: p.requestId, projectId: project.projectId, worktreeId: source.worktreeId,
    head: p.head, kind: p.kind, status: p.status, summary: p.summary, threadAgentId: p.threadAgentId, threadSequence: p.threadSequence,
    reportedBy: input.actor, provenance: "reported", recordedAt: yield* Clock.currentTimeMillis })
  return { events: [{ _tag: "project.GitEvidenceReported", report: value }], reply: () => ({ requestId: p.requestId }) }
})
const prepare: PiecePlanner = (input, raw) => Effect.gen(function* () {
  yield* owner(input)
  const p = raw as Payload<"project.review.prepare">
  const { project, source, target, comparison } = yield* withGit(input, (git) => Effect.gen(function* () {
    const { project, source } = yield* scope(input, raw, git)
    const target = yield* destination(input, raw, git, project.repoId)
    const comparison = yield* gitCall(git.reviewMain(source.path, target.path))
    return { project, source, target, comparison }
  }))
    yield* identity(input, [comparison.head, comparison.baseHead, comparison.branch, comparison.base])
    const review = Schema.decodeUnknownSync(GitMainReview)({ reviewId: p.requestId, projectId: project.projectId,
      worktreeId: source.worktreeId, destinationId: target.worktreeId, head: comparison.head, baseHead: comparison.baseHead,
      branch: comparison.branch, base: comparison.base, evidence: yield* evidenceFor(input, project.projectId, source.worktreeId, comparison.head),
      openedAt: yield* Clock.currentTimeMillis, decision: null, outcome: "open", mergeHead: null, reason: null, decidedAt: null })
    // Budget and redact the complete comparison before recording an available
    // review. A partial/oversized reply cannot produce an approvable ticket.
    const reply = yield* gitReply(input, p.requestId, { review, comparison })
    return { events: [{ _tag: "project.MainReviewOpened" as const, review }], reply: () => reply }
})
export const admitMainReview = (input: Input, raw: Record<string, unknown>) => Effect.gen(function* () {
  yield* owner(input)
  const p = raw as Payload<"project.review.approve">
  if (p.confirmed !== true) return yield* refused("Git: confirmation_required")
  const review = own(projectView(input.snapshot).gitReviews, p.worktreeId)
  if (review === undefined || review.reviewId !== p.reviewId || review.projectId !== p.projectId || review.outcome !== "open"
    || review.head !== p.expectedHead || review.baseHead !== p.expectedBaseHead) return yield* refused("main review is unavailable; prepare a new review")
  return review
})
const approve: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.review.approve">
  const review = yield* admitMainReview(input, raw)
  return yield* withGit(input, (git) => Effect.gen(function* () {
    const { project, source } = yield* scope(input, raw, git)
    const target = yield* destination(input, { ...raw, destinationId: review.destinationId }, git, project.repoId)
    // Evidence is recorded data. Both choices explicitly authorize this
    // reviewed pair; no test result or reviewer verdict is a merge policy.
    const result = yield* git.approveMain(source.path, target.path, review, input.actor, p.confirmed).pipe(Effect.result)
    if (result._tag === "Failure" && result.failure.uncertain) return yield* new CommandUncertain({ reason: "Git outcome is uncertain; refresh Git state" })
    const decided: GitMainReview = { ...review, decision: p.decision, decidedAt: (yield* Clock.currentTimeMillis) as GitMainReview["decidedAt"],
      outcome: result._tag === "Success" ? "merged" : "refused", mergeHead: result._tag === "Success" ? result.success : null,
      reason: result._tag === "Failure" ? result.failure.reason : null }
    const reply = yield* gitReply(input, p.requestId, decided).pipe(Effect.mapError((error) => result._tag === "Success" ? new CommandUncertain({ reason: "Git outcome is uncertain; refresh Git state" }) : error))
    return { events: [{ _tag: "project.MainReviewDecided", review: decided }] as Event[], reply: () => reply }
  }))
})
const status: ReadHandler = (input, raw) => Effect.gen(function* () {
  const { project, source, head } = yield* withGit(input, (git) => Effect.gen(function* () {
    const { project, source } = yield* scope(input, raw, git)
    const state = yield* gitCall(git.state(source.path))
    return { project, source, head: state.head ?? "" }
  }))
  // Release the Git gate before reading SQL thread evidence, retaining the
  // exact head observed and avoiding an inverted gate/transaction dependency.
  const review = own(projectView(input.snapshot).gitReviews, source.worktreeId)
  return { reply: yield* gitReply(input, raw.requestId, { review: review?.projectId === project.projectId ? review : null,
    evidence: yield* evidenceFor(input, project.projectId, source.worktreeId, head) }, true) }
})
export const reviewPlanners = { "project.review.report": report, "project.review.prepare": prepare, "project.review.approve": approve }
export const reviewReads = { "project.review.status": status }
