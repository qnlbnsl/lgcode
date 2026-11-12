import { useEffect, useRef, useState, type FormEvent } from "react"
import { boardAlertTitles, Caller, type BoardAuthor, type BoardPost, type PostId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { requestId, withClient } from "../client.ts"
import { DataText, visibleText } from "../text.tsx"
import type { SubjectProps } from "./index.tsx"
import { useConversation, useMutationDisabled } from "../../data/ShellDataProvider.tsx"

const authorLabel = (author: BoardAuthor) => author._tag === "agent" ? `agent ${author.agentId}`
  : author._tag === "service" ? `service ${author.service}` : "owner"
const reason = (error: unknown, fallback: string) => typeof error === "object" && error !== null
  && "reason" in error && typeof error.reason === "string" ? visibleText(error.reason) : fallback

export function Board({ id, alertKind }: SubjectProps) {
  const disabled = useMutationDisabled()
  const [post, setPost] = useState<BoardPost>()
  const [answer, setAnswer] = useState<BoardPost>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const controller = useRef<AbortController | undefined>(undefined)
  const locked = useRef(false)
  const { state, entry, session } = useConversation({ _tag: "board", postId: id as PostId })
  const field = useRef<HTMLTextAreaElement>(null)
  const sending = state.boardAttempt?.status === "sending"
  const sent = state.boardReplyId !== undefined
  useEffect(() => {
    const action = new AbortController()
    controller.current = action
    return () => { action.abort(); if (field.current) field.current.value = "" }
  }, [])

  useEffect(() => { const node = field.current; return () => { if (node) node.value = "" } }, [post?.postId, sent])

  const read = async () => {
    const signal = controller.current?.signal
    if (signal === undefined || signal.aborted || locked.current || !id || disabled) return
    locked.current = true
    setBusy(true)
    setMessage("")
    try {
      const result = await withClient((client) => Effect.result(client["board.read"]({ requestId: requestId(), post: id as PostId })), signal)
      if (signal.aborted) return
      if (result._tag === "Failure") setMessage(reason(result.failure, "Could not read the post. Try again."))
      else {
        const item = "items" in result.success ? result.success.items.find((row) => row.postId === id) : undefined
        if (item === undefined) setMessage("The post was not returned. Try again.")
        else setPost(item)
      }
    } catch { if (!signal.aborted) setMessage("Could not read the post. Try again.") }
    finally { if (!signal.aborted) { locked.current = false; setBusy(false) } }
  }

  // Error strings can arrive after the client's internal retries. Only an
  // immutable refusal event for this owner and exact request retires a key.
  const refusedOutcome = async (attempt: NonNullable<typeof state.boardAttempt>) => {
    if (attempt.after === undefined) return undefined
    try {
      return await withClient((client) => Effect.gen(function* () {
        const head = yield* client["client.sequence"]({ requestId: requestId() })
        // This bounded positive check never interprets a missing event as a
        // refusal. A busy log or unavailable read leaves recovery frozen.
        for (let sequence = attempt.after! + 1; sequence <= Math.min(head.sequence, attempt.after! + 64); sequence++) {
          const row = yield* client["client.event"]({ requestId: requestId(), sequence: sequence as typeof head.sequence })
          if ("envelope" in row && row.envelope.requestId === attempt.payload.requestId && Schema.is(Caller)(row.envelope.caller) && row.envelope.caller._tag === "owner"
            && row.envelope.event._tag === "CommandRefused" && row.envelope.event.command === "board.post") return row.envelope.event.reason
        }
        return undefined
      }), AbortSignal.any([session.controller.signal, AbortSignal.timeout(2000)]))
    } catch { return undefined }
  }
  const reply = async (form?: HTMLFormElement) => {
    if (disabled || session.controller.signal.aborted || entry.state.boardAttempt?.status === "sending" || entry.state.boardReplyId !== undefined) return
    const previous = entry.state.boardAttempt
    if (form !== undefined && previous !== undefined) return
    const text = form === undefined ? entry.state.draft : (form.elements.namedItem("reply") as HTMLTextAreaElement).value
    if (!previous && (post?.status !== "open" || !text.trim())) return
    let attempt: NonNullable<typeof state.boardAttempt> = previous ?? { payload: { requestId: requestId(), text, channelId: post!.channelId,
      replyTo: post!.postId, to: post!.author._tag === "agent" ? [post!.author] : [], reply: "none" }, status: "sending" }
    entry.update({ ...(form === undefined ? {} : { draft: text }), boardAttempt: { ...attempt, status: "sending" }, boardMessage: "" })
    try {
      const result = await withClient((client) => Effect.gen(function* () {
        if (attempt.after === undefined) {
          const before = yield* client["client.sequence"]({ requestId: requestId() })
          attempt = { ...attempt, after: before.sequence }
          entry.update({ boardAttempt: { ...attempt, status: "sending" } })
        }
        return yield* Effect.result(client["board.post"](attempt.payload))
      }), session.controller.signal)
      if (session.controller.signal.aborted) return
      if (result._tag === "Failure") {
        const refusal = await refusedOutcome(attempt)
        if (session.controller.signal.aborted) return
        entry.update(refusal === undefined ? { boardAttempt: { ...attempt, status: "uncertain" }, boardMessage: `Could not confirm the reply. ${reason(result.failure, "Recover the original reply before sending another.")}` }
          : { boardAttempt: undefined, boardMessage: `The engine refused this reply: ${visibleText(refusal)}. Your draft is kept.` })
        return
      }
      entry.update({ boardAttempt: undefined, boardReplyId: result.success.postId, boardMessage: "Reply sent.",
        ...(entry.state.draft === attempt.payload.text ? { draft: "" } : {}) })
      // Read stored, redacted data after the confirmed write. These reads
      // cannot turn an acknowledged reply back into a sendable attempt.
      const refreshed = await withClient((client) => Effect.gen(function* () {
        const parent = yield* Effect.result(client["board.read"]({ requestId: requestId(), post: attempt.payload.replyTo }))
        const response = yield* Effect.result(client["board.read"]({ requestId: requestId(), post: result.success.postId }))
        return { parent, response }
      }), session.controller.signal)
      if (session.controller.signal.aborted || controller.current?.signal.aborted) return
      if (refreshed.parent._tag === "Success" && "items" in refreshed.parent.success) {
        const item = refreshed.parent.success.items.find((row) => row.postId === attempt.payload.replyTo)
        if (item !== undefined) setPost(item)
      }
      if (refreshed.response._tag === "Success" && "items" in refreshed.response.success) setAnswer(refreshed.response.success.items.find((row) => row.postId === result.success.postId))
    } catch {
      if (!session.controller.signal.aborted && entry.state.boardReplyId === undefined) entry.update({ boardAttempt: { ...attempt, status: "uncertain" }, boardMessage: "Could not confirm the reply. Recover the original reply before sending another." })
    }
  }

  return <section aria-label="Board post">
    <h4>Board post</h4>
    <p>{boardAlertTitles[alertKind === "board.no-answer" ? "board.no-answer" : "board.post"]}</p>
    <button aria-label="Read post" disabled={busy || sending || !id || disabled} onClick={() => { void read() }}>{busy ? "Working…" : "Read post"}</button>
    {post !== undefined && <>
      <p>Author: {visibleText(authorLabel(post.author))}</p>
      <p>Post: {visibleText(post.postId)}</p>
      <p>Status: {post.status}{post.outcome === undefined ? "" : ` · ${post.outcome}`}</p>
      <p>Post text</p><DataText text={post.text} />
      <p>Acknowledged: {post.acknowledged.length === 0 ? "Nobody yet." : post.acknowledged.map((author) => visibleText(authorLabel(author))).join(", ")}</p>
      {post.dispositions.map((row, index) => <p key={index}>
        {visibleText(authorLabel(row.addressee))}: {row.disposition === "no-answer" ? "no answer" : row.disposition}
      </p>)}
      {post.status === "open" && !sent && <form aria-label="Reply to post" onSubmit={(event) => { event.preventDefault(); void reply(event.currentTarget) }}>
        <label>Reply<textarea ref={field} name="reply" aria-label="Reply" required disabled={busy || sending} value={state.draft} onInput={(event) => entry.update({ draft: event.currentTarget.value })} onChange={(event) => entry.update({ draft: event.currentTarget.value })} /></label>
        <button type="submit" disabled={busy || disabled || state.boardAttempt !== undefined}>Send reply</button>
      </form>}
    </>}
    {answer !== undefined && <><p>Your reply</p><DataText text={answer.text} /></>}
    {(sent || post?.status === "closed") && state.draft && <section aria-label="Unsent reply draft"><h4>Your newer unsent draft is kept</h4><DataText text={state.draft} /></section>}
    {state.boardAttempt?.status === "uncertain" && <button disabled={disabled || busy} onClick={() => { void reply() }}>Recover original reply</button>}
    {state.boardMessage && <p role="status">{state.boardMessage}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}
