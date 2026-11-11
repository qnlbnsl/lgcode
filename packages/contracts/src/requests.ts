import * as Schema from "effect/Schema"
import { Actor, PermissionOption } from "./events.ts"
import { AgentId, EpochMilliseconds, EventSequence } from "./ids.ts"
import { ProjectRequestLinkFields, QuestionMetadataFields } from "./questions.ts"
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const RequestDisplay = Schema.Struct({
  ...QuestionMetadataFields,
  inputAvailable: Schema.optionalKey(Schema.Boolean), inputRedacted: Schema.optionalKey(Schema.Boolean), inputTruncated: Schema.optionalKey(Schema.Boolean),
  preview: Schema.String, options: Schema.Array(PermissionOption), optionCount: Count,
  settingsWrite: Schema.optionalKey(Schema.Boolean), toolKind: Schema.optionalKey(Schema.Literals(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other", "unknown"])),
  bytes: Count
})
export const IdentityRow = Schema.Struct({
  openedAt: Schema.optionalKey(EpochMilliseconds),
  id: Schema.NonEmptyString, agentId: AgentId, holder: Actor, sourceSequence: EventSequence,
  display: Schema.optionalKey(RequestDisplay)
})
// A bounded index. Whole request and answer events remain available by sequence.
export const ClientRequest = Schema.Struct({
  ...IdentityRow.fields, ...ProjectRequestLinkFields,
  kind: Schema.Literals(["permission", "question"]),
  status: Schema.Literals(["open", "answered", "cancelled"]),
  openedAt: EpochMilliseconds,
  closedSequence: Schema.optionalKey(EventSequence),
  answeredAt: Schema.optionalKey(EpochMilliseconds),
  answeredBy: Schema.optionalKey(Actor),
  answer: Schema.optionalKey(Schema.String),
  optionId: Schema.optionalKey(Schema.NonEmptyString),
  reason: Schema.optionalKey(Schema.String),
  // A read confirms current state; failed client submissions are never inferred as answers.
  canAnswer: Schema.Boolean
})
export type ClientRequest = typeof ClientRequest.Type
