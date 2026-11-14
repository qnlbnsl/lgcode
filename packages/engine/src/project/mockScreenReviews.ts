import type { Event, MockScreenReview } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { agentReadReply, type ReadHandler } from "../api/reads.ts"
import { refused, type Input, type Payload, type PiecePlanner } from "../commands/internal.ts"
import { canReadProject } from "./access.ts"
import { own, projectView, projectKey, mockScreenKey } from "./view.ts"
import { postPlanner } from "../board/commands.ts"
const budgetTime = Number.MAX_SAFE_INTEGER as MockScreenReview["comments"][number]["at"]

const availableProject = (input: Input, projectId: string) => Effect.gen(function* () {
  const project = own(projectView(input.snapshot).projects, projectId)
  if (project === undefined || project.archiving || project.archivedAt !== undefined || !canReadProject(input.snapshot, input.actor, projectId))
    return yield* refused("project is unavailable to this caller")
  return project
})
const projectReviews = (input: Input, projectId: string) => Object.values(projectView(input.snapshot).mockScreenReviews).filter((r) => r.projectId === projectId)
// Reserve space for agent data labelling and future timestamps before writing.
// Existing installations retain the exact-version read if old feedback exceeds
// the bulk budget. Never return a silently incomplete project review.
const feedbackBudget = (input: Input, projectId: string, requestId: string, replacements: ReadonlyArray<MockScreenReview>) => Effect.gen(function* () {
  const keys = new Set(replacements.map((r) => mockScreenKey(r.projectId, r.revisionId, r.screenId)))
  const reviews = [...projectReviews(input, projectId).filter((r) => !keys.has(mockScreenKey(r.projectId, r.revisionId, r.screenId))), ...replacements]
  if (Buffer.byteLength(JSON.stringify(agentReadReply(requestId, { requestId, reviews }))) > 192 * 1024)
    return yield* refused("mock screen feedback exceeds the read budget")
})

type Selection = Pick<MockScreenReview, "projectId" | "revisionId" | "screenId">
export const screenReview = (input: Input, p: Selection, writing = false) => Effect.gen(function* () {
  const view = projectView(input.snapshot)
  yield* availableProject(input, p.projectId)
  const revision = own(view.mockRevisions, projectKey(p.projectId, p.revisionId))
  if (revision === undefined || !revision.bundle.screens.some((row) => row.screenId === p.screenId)) return yield* refused("mock screen is unavailable")
  if (writing && own(view.mockHeads, p.projectId) !== p.revisionId) return yield* refused("mock revision changed; refresh and retry")
  return own(view.mockScreenReviews, mockScreenKey(p.projectId, p.revisionId, p.screenId)) ?? { projectId: p.projectId, revisionId: p.revisionId, screenId: p.screenId, comments: [] } as MockScreenReview
})
const comment: PiecePlanner = (input, raw) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  const p = raw as Payload<"project.mocks.comment">, review = yield* screenReview(input, p, true)
  const text = yield* input.runtime.log.redactText(p.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").trim())
  if (!text.trim() || text.length > 4096) return yield* refused("mock comment must contain between 1 and 4096 characters")
  if (review.comments.length >= 32) return yield* refused("mock screen comment limit reached")
  const candidate = { ...review, comments: [...review.comments, { commentId: p.requestId, author: input.actor, text, at: budgetTime }] }
  yield* feedbackBudget(input, p.projectId, p.requestId, [candidate])
  const project = yield* availableProject(input, p.projectId), view = projectView(input.snapshot)
  const available = (agent: Input["snapshot"]["agents"][string] | undefined) => agent !== undefined
    && agent.state._tag !== "stopped" && agent.state._tag !== "crashed" && (agent.state._tag !== "interrupted" || agent.reloadable === true)
  const designer = Object.values(input.snapshot.agents).find((agent) => agent.role === "designer"
    && own(view.agentProjects, agent.agentId) === p.projectId && available(agent))
  const lead = own(input.snapshot.agents, project.leadAgentId)
  const targetId = designer?.agentId ?? (available(lead) ? project.leadAgentId : undefined)
  const event: Event = { _tag: "project.MockScreenCommented", projectId: p.projectId, revisionId: p.revisionId, screenId: p.screenId,
    commentId: p.requestId, author: input.actor, text }
  if (targetId === undefined || input.runtime.lists?.boardEnabled === false)
    return { events: [event], reply: () => ({ requestId: p.requestId, notified: false, notificationReason: "No available designer or project lead was notified." }) }
  const target = { _tag: "agent", agentId: targetId } as const
  const board = yield* postPlanner()(input, { requestId: p.requestId, direct: target, to: [target], reply: "all",
    text: `The owner commented on mock screen ${p.screenId}, revision ${p.revisionId}.\n${text}` })
  return { ...board, events: [...board.events, event], reply: () => ({ requestId: p.requestId, notified: true }) }
})
const readProject: ReadHandler = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.mocks.reviews.read">
  yield* availableProject(input, p.projectId)
  const view = projectView(input.snapshot), revisionId = own(view.mockHeads, p.projectId)
  const approval = Object.values(view.mockApprovals).find((row) => row.projectId === p.projectId && row.revisionId === revisionId)
  const body = { requestId: p.requestId, ...(revisionId === undefined ? {} : { revisionId }),
    ...(approval === undefined ? {} : { approval }), reviews: projectReviews(input, p.projectId) }
  const reply = input.actor._tag === "agent" ? agentReadReply(p.requestId, body) : body
  if (Buffer.byteLength(JSON.stringify(reply)) > 256 * 1024) return yield* refused("mock screen feedback exceeds the read budget")
  return { reply }
})
const read: ReadHandler = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.mocks.screen.read">, review = yield* screenReview(input, p)
  const body = { requestId: p.requestId, review }
  const reply = input.actor._tag === "agent" ? agentReadReply(p.requestId, body) : body
  if (Buffer.byteLength(JSON.stringify(reply)) > 256 * 1024) return yield* refused("mock screen feedback exceeds the read budget")
  return { reply }
})
const approve: PiecePlanner = (input, raw) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  const p = raw as Payload<"project.mocks.screen.approve">
  const review = yield* screenReview(input, p, true)
  yield* feedbackBudget(input, p.projectId, p.requestId, [{ ...review, approval: { approved: p.approved, author: input.actor, at: budgetTime } }])
  return { events: [{ _tag: "project.MockScreenApprovalSet", projectId: p.projectId, revisionId: p.revisionId, screenId: p.screenId,
    approved: p.approved, author: input.actor }], reply: () => ({ requestId: p.requestId }) }
})
const seen: PiecePlanner = (input, raw) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  const p = raw as Payload<"project.mocks.seen">
  // Historical versions may be marked explicitly. Their marks never apply to a new head.
  const review = yield* screenReview(input, p)
  yield* feedbackBudget(input, p.projectId, p.requestId, [{ ...review, seen: { author: input.actor, at: budgetTime } }])
  return { events: [{ _tag: "project.MockScreenSeen", projectId: p.projectId, revisionId: p.revisionId, screenId: p.screenId, author: input.actor }], reply: () => ({ requestId: p.requestId }) }
})
const seenBatch: PiecePlanner = (input, raw) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  const p = raw as Payload<"project.mocks.seen.batch">, keys = new Set<string>(), reviews: MockScreenReview[] = []
  for (const version of p.versions) {
    const review = yield* screenReview(input, { projectId: p.projectId, ...version })
    const key = mockScreenKey(p.projectId, version.revisionId, version.screenId)
    if (keys.has(key)) return yield* refused("mock screen is unavailable")
    keys.add(key)
    reviews.push({ ...review, seen: { author: input.actor, at: Number.MAX_SAFE_INTEGER as MockScreenReview["comments"][number]["at"] } })
  }
  yield* feedbackBudget(input, p.projectId, p.requestId, reviews)
  return { events: [{ _tag: "project.MockScreensSeen", projectId: p.projectId, versions: p.versions, author: input.actor }], reply: () => ({ requestId: p.requestId }) }
})
export const mockScreenPlanners = { "project.mocks.comment": comment, "project.mocks.screen.approve": approve, "project.mocks.seen": seen, "project.mocks.seen.batch": seenBatch }
export const mockScreenReads = { "project.mocks.screen.read": read, "project.mocks.reviews.read": readProject }
