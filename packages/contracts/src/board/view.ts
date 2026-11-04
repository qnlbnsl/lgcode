import type { AgentId, DeliveryId, EventSequence } from "../ids.ts"
import type { PermissionLevel } from "../permission.ts"
import type { BoardEvent } from "./events.ts"
import type { BoardAddressee, Disposition, PostId } from "./ids.ts"
import type { BoardCompletion } from "./schemas.ts"

export type BoardChannelView = Extract<BoardEvent, { _tag: "board.ChannelOpened" }> & {
  readonly seatSequence: EventSequence
}
export type BoardPostView = Extract<BoardEvent, { _tag: "board.PostWritten" }> & {
  readonly sequence: EventSequence
  readonly status: "open" | "closed"
  readonly outcome?: BoardCompletion["outcome"]
  // Agent keys are ids; the owner is keyed as "owner".
  readonly dispositions: Readonly<Record<string, Disposition>>
  readonly decidingReplies: Readonly<Record<string, PostId>>
  readonly acknowledged: ReadonlyArray<BoardAddressee>
  readonly takenAt: Readonly<Record<string, EventSequence>>
  readonly reminderAcceptedAt: Readonly<Record<string, EventSequence>>
  readonly replies: ReadonlyArray<PostId>
  readonly returns?: Readonly<Record<string, number>>
}
export type BoardWakeView = Extract<BoardEvent, { _tag: "board.WakeBuilt" }> & {
  readonly deliveryId?: DeliveryId
}
export interface BoardOwedCompletion {
  readonly postId: PostId
  readonly authorAgentId: AgentId
  readonly returns: number
}
export interface BoardNoAnswerNotice {
  readonly postId: PostId
  readonly authorAgentId: AgentId
  readonly addressee: BoardAddressee
  readonly returns: number
}
export interface BoardReadState {
  readonly watermark: EventSequence
  readonly above: ReadonlyArray<PostId>
}
// WS-2 supplies the fold. Delivery statuses belong to the engine, never here.
export interface BoardView {
  readonly channels: Readonly<Record<string, BoardChannelView>>
  readonly posts: Readonly<Record<string, BoardPostView>>
  readonly completions: Readonly<Record<string, BoardOwedCompletion>>
  readonly noAnswers: Readonly<Record<string, BoardNoAnswerNotice>>
  readonly wakes: Readonly<Record<string, BoardWakeView>>
  readonly lastTurnEnd: Readonly<Record<string, EventSequence>>
  readonly ceilings: Readonly<Record<string, PermissionLevel>>
  readonly stopped: ReadonlyArray<AgentId>
  readonly lastStopped: Readonly<Record<string, EventSequence>>
  readonly lastCrashed: Readonly<Record<string, EventSequence>>
  readonly labels: Readonly<Record<string, ReadonlyArray<string>>>
  readonly lastLabelLeft: Readonly<Record<string, Readonly<Record<string, EventSequence>>>>
  readonly lastMemberLeft: Readonly<Record<string, Readonly<Record<string, EventSequence>>>>
  readonly readState: Readonly<Record<string, Readonly<Record<string, BoardReadState>>>>
}
