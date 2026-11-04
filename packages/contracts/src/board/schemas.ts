import * as Schema from "effect/Schema"
import { AgentId, EventSequence, RequestId } from "../ids.ts"
import { BoardAddressee, BoardAuthor, ChannelId, CloseOutcome, Disposition, PostId, ReplyMode } from "./ids.ts"
import { boardLimits } from "./limits.ts"

export const BoardChannelName = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/))
export const BoardPostText = Schema.String.check(Schema.isMaxCodePoints(boardLimits.postCharacters))
export const BoardAddressees = Schema.Array(BoardAddressee).check(Schema.isMaxLength(boardLimits.addressees))
export const BoardCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
export const BoardDisposition = Schema.Struct({
  addressee: BoardAddressee, disposition: Disposition, replyId: Schema.optionalKey(PostId)
})
export const BoardPostFields = {
  postId: PostId, channelId: ChannelId, author: BoardAuthor, text: BoardPostText,
  to: BoardAddressees, reply: ReplyMode, replyTo: Schema.optionalKey(PostId)
}
export const BoardPost = Schema.Struct({
  ...BoardPostFields, sequence: EventSequence, status: Schema.Literals(["open", "closed"]),
  outcome: Schema.optionalKey(CloseOutcome), acknowledged: Schema.Array(BoardAddressee),
  dispositions: Schema.Array(BoardDisposition)
})
export type BoardPost = typeof BoardPost.Type
export const BoardCompletion = Schema.Struct({
  postId: PostId, outcome: CloseOutcome,
  dispositions: Schema.Array(BoardDisposition).check(Schema.isMaxLength(boardLimits.addressees)),
  replyIds: Schema.Array(PostId).check(Schema.isMaxLength(boardLimits.completionReplyIds)),
  totalReplies: BoardCount,
  replies: Schema.Array(Schema.Struct(BoardPostFields)).check(Schema.isMaxLength(boardLimits.completionReplyIds))
})
export type BoardCompletion = typeof BoardCompletion.Type
export const BoardStatusSummary = Schema.Struct({
  requestId: RequestId, agentId: AgentId, unread: BoardCount, incomingOpen: BoardCount,
  ownOpen: BoardCount, owed: BoardCount, failedCompletions: BoardCount,
  wakeQueued: Schema.Boolean, wakeSent: Schema.Boolean,
  holdsUnsettled: Schema.Boolean, holdsIncoming: Schema.Boolean,
  sequence: EventSequence, disabled: Schema.Boolean
})
export type BoardStatusSummary = typeof BoardStatusSummary.Type
