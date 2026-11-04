import type { AgentId } from "../ids.ts"
import type { SettledInput } from "../settled.ts"
import type { BoardPostView, BoardView } from "./view.ts"

const own = <T>(rows: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(rows, key) ? rows[key] : undefined
const addressedTo = (post: BoardPostView, id: string) =>
  post.status === "open" && post.reply !== "none"
  && post.to.some((target) => target._tag === "agent" && target.agentId === id)

export const holdsIncoming = (agentId: string, view: BoardView): boolean =>
  Object.values(view.posts).some((post) => addressedTo(post, agentId)
    && (own(post.dispositions, agentId) === undefined || own(post.dispositions, agentId) === "no-answer"))

export const holdsUnsettled = (agentId: string, view: BoardView, deliveries: SettledInput["deliveries"]): boolean => {
  if (Object.values(view.completions).some((completion) => completion.authorAgentId === agentId && completion.returns < 2)) return true
  return Object.values(view.posts).some((post) => {
    if (post.status !== "open" || post.reply === "none") return false
    if (post.author._tag === "agent" && post.author.agentId === agentId) return true
    if (!addressedTo(post, agentId) || own(post.dispositions, agentId) !== undefined) return false
    const takenAt = own(post.takenAt, agentId)
    if (takenAt !== undefined) return (own(view.lastTurnEnd, agentId) ?? 0) > takenAt
    return !Object.values(view.wakes).some((wake) => {
      if (wake.targetAgentId !== agentId || !wake.carried.includes(post.postId) || wake.deliveryId === undefined) return false
      const delivery = own(deliveries, wake.deliveryId)
      return delivery?.target === agentId && (delivery.status === "queued" || delivery.status === "sent")
    })
  })
}

export const ownerHeld = (view: BoardView): ReadonlyArray<AgentId> => {
  const authors = new Set<AgentId>()
  for (const post of Object.values(view.posts)) {
    if (post.status === "open" && post.author._tag === "agent" && post.to.some((target) => target._tag === "owner")) {
      authors.add(post.author.agentId)
    }
  }
  return [...authors]
}
