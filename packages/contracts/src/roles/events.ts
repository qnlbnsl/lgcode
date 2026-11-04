import * as Schema from "effect/Schema"
import * as Tuple from "effect/Tuple"
import { AgentId, EpochMilliseconds, EventSequence } from "../ids.ts"
import { PostId } from "../board/ids.ts"
import { RoleFileHash, RolesSettings } from "./schema.ts"

export const rolesActionKinds = [
  "TeamIdleReported", "StallSeen", "ReplaceAdvised", "RunawayReported", "CapacityRetried",
  "CrashAdmitted", "CrashRetried", "GaveUp", "RoleAdviceBroken", "CacheFlushed",
  "CompactRequested", "StallEnded",
] as const
export const rolesEventTags = [
  "roles.RoleFileSet", "roles.SettingsChanged", "roles.Snoozed", "roles.SheepdogBaseline",
  ...rolesActionKinds.map((kind) => `roles.${kind}` as const),
] as const

const action = {
  agentId: AgentId,
  noticeRecipient: Schema.Union([Schema.Literal("owner"), AgentId]),
  triggerSequence: EventSequence,
  sourceSequence: EventSequence,
  occurrence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
}
// A sent notice to an agent names the post returned by board.post. Owner
// notices are the action event itself, with no board post.
const actionEvent = <const Kind extends typeof rolesActionKinds[number], Fields extends Schema.Struct.Fields>(kind: Kind, fields: Fields) =>
  Schema.TaggedStruct(`roles.${kind}`, {
    ...action, ...fields,
    notice: Schema.Literals(["sent", "board-off"]),
    postId: Schema.optionalKey(Schema.NonEmptyString),
  }).check(Schema.makeFilter((record) => {
    const notice = record as { readonly notice: string; readonly noticeRecipient: string; readonly postId?: string }
    return notice.notice === "sent" ? notice.noticeRecipient === "owner" || notice.postId !== undefined : notice.postId === undefined
  }))

export const RolesAction = Schema.Union([
  actionEvent("TeamIdleReported", { group: Schema.String }),
  actionEvent("StallSeen", { stalledPostId: Schema.optionalKey(PostId) }),
  actionEvent("ReplaceAdvised", { stalledPostId: Schema.optionalKey(PostId) }),
  actionEvent("RunawayReported", {}),
  actionEvent("CapacityRetried", {}),
  actionEvent("CrashAdmitted", {}),
  actionEvent("CrashRetried", {}),
  actionEvent("GaveUp", {
    cause: Schema.Literals(["crash", "resume-refused", "reload-failed", "capacity"]),
    engineAlertOpen: Schema.Boolean,
  }),
  actionEvent("RoleAdviceBroken", {}),
  actionEvent("CacheFlushed", {}),
  actionEvent("CompactRequested", {}),
  actionEvent("StallEnded", {}),
])
export type RolesAction = typeof RolesAction.Type
// Records retain the event's fields and add their durable log position.
export const RolesActionRecord = RolesAction.mapMembers(Tuple.map(Schema.fieldsAssign({
  sequence: EventSequence, noticeRead: Schema.optionalKey(Schema.Boolean),
}))).check(Schema.makeFilter(Schema.is(RolesAction)))
export type RolesActionRecord = typeof RolesActionRecord.Type
export const SheepdogBaseline = Schema.TaggedStruct("roles.SheepdogBaseline", {
  position: EventSequence, on: Schema.Boolean, boardOn: Schema.optionalKey(Schema.Boolean),
})
export const SheepdogRecord = Schema.Union([RolesAction, SheepdogBaseline])
export type SheepdogRecord = typeof SheepdogRecord.Type
export const RolesEvent = Schema.Union([
  Schema.TaggedStruct("roles.RoleFileSet", { content: Schema.String, roleFileHash: RoleFileHash }),
  Schema.TaggedStruct("roles.SettingsChanged", { settings: RolesSettings }),
  Schema.TaggedStruct("roles.Snoozed", { group: Schema.String, until: EpochMilliseconds }),
  SheepdogBaseline,
  ...RolesAction.members,
])
export type RolesEvent = typeof RolesEvent.Type
