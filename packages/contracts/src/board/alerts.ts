import type { EventEnvelope } from "../events.ts"
import type { AgentId } from "../ids.ts"
import type { PostId } from "./ids.ts"

export type BoardAlertAction = {
  readonly _tag: "raise"
  readonly key: string
  readonly kind: "board.post" | "board.no-answer"
  readonly agentId: AgentId
  readonly subject: PostId
} | { readonly _tag: "end"; readonly key: string }

export const boardAlertSources: ReadonlyArray<(envelope: EventEnvelope) => BoardAlertAction | undefined> = [
  ({ event }) => {
    if (event._tag === "board.PostWritten" && event.reply !== "none" && event.author._tag === "agent"
      && event.to.some((target) => target._tag === "owner")) {
      return { _tag: "raise", key: `post:${event.postId}`, kind: "board.post", agentId: event.author.agentId, subject: event.postId }
    }
    if (event._tag === "board.PostClosed") return { _tag: "end", key: `post:${event.postId}` }
    return undefined
  },
  ({ event }) => {
    if (event._tag === "board.AddresseeResolved" && event.disposition === "no-answer" && event.authorIsOwner && event.addressee._tag === "agent") {
      return { _tag: "raise", key: `no-answer:${event.postId}`, kind: "board.no-answer", agentId: event.addressee.agentId, subject: event.postId }
    }
    if (event._tag === "board.PostClosed") return { _tag: "end", key: `no-answer:${event.postId}` }
    return undefined
  }
]
export const boardAlertTitles = {
  "board.post": "An agent needs your reply",
  "board.no-answer": "An agent has not answered your post"
} as const
