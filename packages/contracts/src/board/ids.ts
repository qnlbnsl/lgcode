import * as Schema from "effect/Schema"
import { AgentId } from "../ids.ts"

export const ChannelId = Schema.NonEmptyString.pipe(Schema.brand("ChannelId"))
export type ChannelId = typeof ChannelId.Type
export const PostId = Schema.NonEmptyString.pipe(Schema.brand("PostId"))
export type PostId = typeof PostId.Type
export const WakeId = Schema.NonEmptyString.pipe(Schema.brand("WakeId"))
export type WakeId = typeof WakeId.Type

export const ReplyMode = Schema.Literals(["none", "any", "all"])
export type ReplyMode = typeof ReplyMode.Type
export const BoardAddressee = Schema.Union([
  Schema.TaggedStruct("owner", {}),
  Schema.TaggedStruct("agent", { agentId: AgentId })
])
export type BoardAddressee = typeof BoardAddressee.Type
export const BoardAuthor = Schema.Union([
  ...BoardAddressee.members,
  Schema.TaggedStruct("service", { service: Schema.NonEmptyString })
])
export type BoardAuthor = typeof BoardAuthor.Type
export const Disposition = Schema.Literals(["replied", "gone", "removed", "undeliverable", "no-answer"])
export type Disposition = typeof Disposition.Type
export const CloseOutcome = Schema.Literals(["answered", "unanswerable", "withdrawn"])
export type CloseOutcome = typeof CloseOutcome.Type
