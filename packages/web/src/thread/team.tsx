import { useConversation } from "../data/ShellDataProvider.tsx"
import { useEffect, useState } from "react"
import type { BoardPost, ChannelId, ProjectId, TeamId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "./client.ts"
import { Composer } from "./composer.tsx"
import { BoundedText } from "./boundedText.tsx"
import { useConversationReading } from "./reading.tsx"
import { conversationKey, type ContextScope } from "./conversationState.tsx"
import { visibleText } from "./text.tsx"

interface TeamConversationProps {
  readonly projectId: ProjectId; readonly teamId: TeamId; readonly channelId: ChannelId; readonly name: string
  readonly scope?: ContextScope; readonly disabled: boolean; readonly onSessionExpired: () => void; readonly sequence?: number
}
export function TeamConversation(props: TeamConversationProps) {
  return <TeamMessages key={conversationKey({ _tag: "team", ...props })} {...props} />
}
function TeamMessages({ projectId, teamId, channelId, name, scope, disabled, onSessionExpired, sequence }: TeamConversationProps) {
  const identity = { _tag: "team" as const, projectId, teamId, channelId }
  const conversation = useConversation(identity)
  const [posts, setPosts] = useState<ReadonlyArray<BoardPost>>([])
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState(false)
  const [generation, setGeneration] = useState(0)
  const count = conversation.state.historyCount
  const reading = useConversationReading(identity, posts, loaded)
  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    const read = async () => {
      if (busy || document.hidden) return
      busy = true
      try {
        const result = await withClient((client) => Effect.gen(function* () {
          const found = new Map<string, BoardPost>(), cursors = new Set<string>()
          let after: string | undefined
          for (;;) {
            // Owner peek intentionally does not advance any agent's read marks.
            const page = yield* client["board.peek"]({ requestId: requestId(), channelId, limit: 100, ...(after === undefined ? {} : { after }) })
            for (const post of page.items) if (post.channelId === channelId) found.set(post.postId, post)
            if (page.next === undefined) return [...found.values()].sort((a, b) => a.sequence - b.sequence)
            if (!page.items.length || cursors.has(page.next)) return yield* Effect.fail(new Error("Board cursor did not advance"))
            cursors.add(page.next); after = page.next
          }
        }), controller.signal)
        if (!controller.signal.aborted) { setPosts(result); setLoaded(true); setAvailable(true) }
      } catch {
        if (!controller.signal.aborted) {
          setAvailable(false)
          try {
            const probe = await fetch("/api/session", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal })
            if (probe.status === 401 && !controller.signal.aborted) { setPosts([]); onSessionExpired() }
          } catch { /* A failed probe leaves the previous conversation readable. */ }
        }
      } finally { busy = false }
    }
    void read()
    const timer = setInterval(() => { void read() }, 5000)
    const visible = () => { if (!document.hidden) void read() }
    document.addEventListener("visibilitychange", visible)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible) }
  }, [projectId, teamId, channelId, sequence, generation])
  return <section className="conversation" aria-label="Team conversation">
    <header className="conversation-heading"><h2>{visibleText(name)}</h2><span role="status">{available ? "Live" : loaded ? "Reconnecting" : "Loading…"}</span>
      <button onClick={() => setGeneration((value) => value + 1)}>Refresh conversation</button></header>
    <div className="conversation-turns" ref={reading.scroller} onScroll={reading.onScroll} tabIndex={0} aria-label="Team messages">
      {!loaded && <p>{available ? "Loading messages…" : "Messages are unavailable until the channel read succeeds."}</p>}
      {loaded && posts.length === 0 && <p>No messages yet.</p>}
      {posts.length > count && <button onClick={() => conversation.entry.update({ historyCount: count + 100 })}>Show earlier messages</button>}
      {posts.slice(-count).map((post) => <article key={post.postId} data-sequence={post.sequence} className={post.author._tag === "owner" ? "owner-turn" : "agent-turn"} aria-label="Team message">
        <h3>{visibleText(post.author._tag === "agent" ? post.author.agentId : post.author._tag === "service" ? post.author.service : "You")}</h3>
        <BoundedText text={post.text} />
        {post.context?.map((ref, index) => <p key={index}>Context: {visibleText(ref._tag === "task" ? ref.taskId : ref.path)}</p>)}
        <details><summary>Message details</summary><p>Post: {visibleText(post.postId)} · {post.status}{post.outcome ? ` · ${post.outcome}` : ""}</p>
          {post.replyTo && <p>Reply to: {visibleText(post.replyTo)}</p>}</details>
      </article>)}
    </div>
    {reading.away && <button className="conversation-latest" onClick={reading.latest}>Latest messages</button>}
    <Composer identity={identity} recipient={name} disabled={disabled || !available} {...(scope === undefined ? {} : { scope })} />
  </section>
}
