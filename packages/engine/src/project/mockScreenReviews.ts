import type { MockScreenReview } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { agentReadReply, type ReadHandler } from "../api/reads.ts"
import { refused, type Input, type Payload, type PiecePlanner } from "../commands/internal.ts"
import { canReadProject } from "./access.ts"
import { own, projectView, projectKey, mockScreenKey } from "./view.ts"

type Selection = Pick<MockScreenReview, "projectId" | "revisionId" | "screenId">
export const screenReview = (input: Input, p: Selection, writing = false) => Effect.gen(function* () {
  const view = projectView(input.snapshot), project = own(view.projects, p.projectId)
  if (project === undefined || project.archiving || project.archivedAt !== undefined || !canReadProject(input.snapshot, input.actor, p.projectId))
    return yield* refused("project is unavailable to this caller")
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
  if (review.comments.length >= 32) return yield* refused("mock screen comment limit reached; record a new revision")
  const candidate = { ...review, comments: [...review.comments, { commentId: p.requestId, author: input.actor, text, at: Number.MAX_SAFE_INTEGER }] }
  if (Buffer.byteLength(JSON.stringify(agentReadReply(p.requestId, { requestId: p.requestId, review: candidate }))) > 192 * 1024)
    return yield* refused("mock screen feedback exceeds the read budget")
  return { events: [{ _tag: "project.MockScreenCommented", projectId: p.projectId, revisionId: p.revisionId, screenId: p.screenId,
    commentId: p.requestId, author: input.actor, text }], reply: () => ({ requestId: p.requestId }) }
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
  yield* screenReview(input, p, true)
  return { events: [{ _tag: "project.MockScreenApprovalSet", projectId: p.projectId, revisionId: p.revisionId, screenId: p.screenId,
    approved: p.approved, author: input.actor }], reply: () => ({ requestId: p.requestId }) }
})
export const mockScreenPlanners = { "project.mocks.comment": comment, "project.mocks.screen.approve": approve }
export const mockScreenReads = { "project.mocks.screen.read": read }
