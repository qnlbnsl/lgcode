import * as Schema from "effect/Schema"
import { AgentId } from "../ids.ts"
import { BoardAddressee, BoardAuthor, ChannelId, CloseOutcome, Disposition, PostId, WakeId } from "./ids.ts"
import { BoardChannelName, BoardPostFields } from "./schemas.ts"

// Event identity names follow B13; command and read-page names stay unchanged.
const { replyTo, ...postFields } = BoardPostFields
const opened = {
  channelId: ChannelId, name: BoardChannelName, opener: BoardAuthor, members: Schema.Array(BoardAuthor)
}
// One tagged struct keeps ChannelOpened discoverable as one event. Its check
// requires group metadata and forbids a manager on a direct channel.
export const BoardChannelOpened = Schema.TaggedStruct("board.ChannelOpened", {
  ...opened, kind: Schema.Literals(["plain", "group", "direct"]),
  manager: Schema.optionalKey(BoardAddressee), group: Schema.optionalKey(Schema.NonEmptyString),
  anchorAgentId: Schema.optionalKey(AgentId)
}).check(Schema.makeFilter((channel) => channel.kind === "group"
  ? channel.manager !== undefined && channel.group !== undefined && channel.anchorAgentId !== undefined
  : channel.kind === "direct" ? channel.manager === undefined : channel.manager !== undefined))

export const BoardEvent = Schema.Union([
  BoardChannelOpened,
  Schema.TaggedStruct("board.ChannelMembersChanged", {
    channelId: ChannelId, membersAdded: Schema.Array(BoardAddressee), membersRemoved: Schema.Array(BoardAddressee)
  }),
  Schema.TaggedStruct("board.ManagerChanged", { channelId: ChannelId, manager: BoardAddressee }),
  Schema.TaggedStruct("board.PostWritten", { ...postFields, replyToPostId: replyTo }),
  Schema.TaggedStruct("board.PostAcknowledged", { postId: PostId, addressee: BoardAddressee }),
  Schema.TaggedStruct("board.AddresseeResolved", {
    postId: PostId, addressee: BoardAddressee, disposition: Disposition,
    decidingPostId: Schema.optionalKey(PostId), authorIsOwner: Schema.Boolean
  }),
  Schema.TaggedStruct("board.PostClosed", {
    postId: PostId, outcome: CloseOutcome, closer: BoardAuthor, completionOwed: Schema.Boolean
  }),
  Schema.TaggedStruct("board.WakeBuilt", {
    wakeId: WakeId, targetAgentId: AgentId,
    carried: Schema.Array(PostId), mustReply: Schema.Array(PostId), completions: Schema.Array(PostId),
    // Exactly the completions whose captured payload contains reply text.
    // An explicit empty array identifies a metadata-only replacement. Missing
    // on legacy events means the reach check must assume replies were captured.
    completionReplyText: Schema.optionalKey(Schema.Array(PostId)),
    reminders: Schema.Array(PostId),
    noAnswers: Schema.Array(Schema.Struct({ postId: PostId, addressee: BoardAddressee }))
  }),
  Schema.TaggedStruct("board.Read", { channelId: ChannelId, reader: BoardAddressee, postIds: Schema.Array(PostId) })
])
export type BoardEvent = typeof BoardEvent.Type
export const boardEventTags = BoardEvent.members.map((event) => event.fields._tag.schema.literal)
export const boardVisibility = {
  "board.ChannelOpened": "owner-only",
  "board.ChannelMembersChanged": "owner-only",
  "board.ManagerChanged": "owner-only",
  "board.PostWritten": "owner-only",
  "board.PostAcknowledged": "owner-only",
  "board.AddresseeResolved": "owner-only",
  "board.PostClosed": "owner-only",
  "board.WakeBuilt": "owner-only",
  "board.Read": "owner-only"
} as const satisfies Record<BoardEvent["_tag"], "owner-only">
