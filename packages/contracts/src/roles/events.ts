import * as Schema from "effect/Schema"
import { AgentId, EpochMilliseconds, EventSequence } from "../ids.ts"
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
// A sent notice always names the post returned by board.post.
const actionEvent = <const Kind extends typeof rolesActionKinds[number], Fields extends Schema.Struct.Fields>(kind: Kind, fields: Fields) =>
  Schema.TaggedStruct(`roles.${kind}`, {
    ...action, ...fields,
    notice: Schema.Literals(["sent", "board-off"]),
    postId: Schema.optionalKey(Schema.NonEmptyString),
  }).check(Schema.makeFilter((record) => {
    const notice = record as { readonly notice: string; readonly postId?: string }
    return notice.notice === "sent" ? notice.postId !== undefined : notice.postId === undefined
  }))

export const RolesAction = Schema.Union([
  actionEvent("TeamIdleReported", { group: Schema.String }),
  actionEvent("StallSeen", {}),
  actionEvent("ReplaceAdvised", {}),
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
export const RolesEvent = Schema.Union([
  Schema.TaggedStruct("roles.RoleFileSet", { content: Schema.String, roleFileHash: RoleFileHash }),
  Schema.TaggedStruct("roles.SettingsChanged", { settings: RolesSettings }),
  Schema.TaggedStruct("roles.Snoozed", { group: Schema.String, until: EpochMilliseconds }),
  Schema.TaggedStruct("roles.SheepdogBaseline", { position: EventSequence, on: Schema.Boolean }),
  ...RolesAction.members,
])
export type RolesEvent = typeof RolesEvent.Type
