import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import type { CallerKind } from "../commands.ts"
import { AgentId, EventSequence, RequestId } from "../ids.ts"
import { BoardAddressee, BoardAuthor, ChannelId, CloseOutcome, PostId, ReplyMode, WakeId } from "./ids.ts"
import { BoardAddressees, BoardChannelName, BoardCount, BoardDisposition, BoardPost, BoardPostText, BoardStatusSummary } from "./schemas.ts"

const request = { requestId: RequestId }
const Refused = Schema.TaggedStruct("CommandError", { ...request, reason: Schema.String })
const page = <S extends Schema.Constraint>(item: S) => Schema.Struct({
  ...request, items: Schema.Array(item), next: Schema.optionalKey(Schema.NonEmptyString)
})
const paging = {
  after: Schema.optionalKey(Schema.NonEmptyString),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)))
}
const post = {
  ...request, text: BoardPostText, to: BoardAddressees, reply: ReplyMode, replyTo: Schema.optionalKey(PostId)
}
const channel = Schema.Struct({
  channelId: ChannelId, name: BoardChannelName, kind: Schema.Literals(["plain", "group", "direct"]),
  manager: Schema.optionalKey(BoardAddressee), members: Schema.Array(BoardAuthor),
  group: Schema.optionalKey(Schema.NonEmptyString), anchorAgentId: Schema.optionalKey(AgentId)
})
const statusDetail = Schema.Struct({
  postId: PostId, channelId: ChannelId, reply: ReplyMode, to: BoardAddressees,
  dispositions: Schema.Array(BoardDisposition), acknowledged: Schema.Array(BoardAddressee),
  outcome: Schema.optionalKey(CloseOutcome), deliveryFailed: Schema.optionalKey(Schema.Boolean)
})
export const BoardRpcGroup = RpcGroup.make(
  Rpc.make("open", {
    payload: { ...request, name: BoardChannelName, group: Schema.optionalKey(Schema.NonEmptyString), anchorAgentId: Schema.optionalKey(AgentId) },
    success: Schema.Struct({ ...request, channelId: ChannelId }), error: Refused
  }),
  Rpc.make("members", {
    payload: { ...request, channelId: ChannelId, add: Schema.Array(AgentId), remove: Schema.Array(AgentId) },
    success: Schema.Struct({ ...request, memberCount: BoardCount }), error: Refused
  }),
  Rpc.make("post", {
    payload: Schema.Union([
      Schema.Struct({ ...post, channelId: ChannelId }),
      Schema.Struct({ ...post, direct: BoardAddressee })
    ]),
    success: Schema.Struct({ ...request, postId: PostId }), error: Refused
  }),
  Rpc.make("close", {
    payload: { ...request, postId: PostId },
    success: Schema.Struct({ ...request, postId: PostId, outcome: CloseOutcome }), error: Refused
  }),
  Rpc.make("acknowledge", {
    payload: { ...request, postId: PostId },
    success: Schema.Struct({ ...request, postId: PostId }), error: Refused
  }),
  Rpc.make("read", {
    payload: Schema.Union([
      Schema.Struct({ ...request, ...paging, channelId: ChannelId }),
      Schema.Struct({ ...request, ...paging, open: Schema.Literal(true) }),
      Schema.Struct({ ...request, ...paging, incoming: Schema.Literal(true) }),
      Schema.Struct({ ...request, ...paging, repliesTo: PostId }),
      Schema.Struct({ ...request, post: PostId })
    ]),
    // Agent reads use the engine's data envelope rather than a raw page.
    success: Schema.Union([page(BoardPost), Schema.Struct({ ...request, data: Schema.String })]), error: Refused
  }),
  Rpc.make("channels", {
    payload: { ...request, ...paging }, success: page(channel), error: Refused
  }),
  Rpc.make("status", {
    payload: { ...request, ...paging, agentId: Schema.optionalKey(AgentId), detail: Schema.optionalKey(Schema.Literals(["incoming", "own", "completions"])) },
    success: Schema.Union([
      BoardStatusSummary,
      Schema.Struct({
        ...request, holdsUnsettled: Schema.Array(AgentId), holdsIncoming: Schema.Array(AgentId),
        ownerHeld: Schema.Array(AgentId), sequence: EventSequence, disabled: Schema.Boolean
      }),
      page(statusDetail)
    ]), error: Refused
  }),
  Rpc.make("flush", {
    payload: { ...request, agentId: AgentId },
    success: Schema.Struct({ ...request, wakeId: Schema.optionalKey(WakeId) }), error: Refused
  })
).prefix("board.")

export const boardAccess = {
  "board.open": ["owner", "agent"], "board.members": ["owner", "agent"],
  "board.post": ["owner", "agent", "service"], "board.close": ["owner", "agent", "service"],
  "board.acknowledge": ["owner", "agent"], "board.read": ["owner", "agent"],
  "board.channels": ["owner", "agent"], "board.status": ["owner", "agent", "service"],
  "board.flush": ["owner", "service"]
} satisfies Record<Rpc.Tag<RpcGroup.Rpcs<typeof BoardRpcGroup>>, ReadonlyArray<CallerKind>>
