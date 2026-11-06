import { useEffect, useRef, useState, type FormEvent } from "react"
import { boardAlertTitles, type BoardAuthor, type BoardPost, type PostId } from "@sheprd/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../client.ts"
import { DataText, visibleText } from "../text.tsx"
import type { SubjectProps } from "./index.tsx"

const authorLabel = (author: BoardAuthor) => author._tag === "agent" ? `agent ${author.agentId}`
  : author._tag === "service" ? `service ${author.service}` : "owner"
const reason = (error: unknown, fallback: string) => typeof error === "object" && error !== null
  && "reason" in error && typeof error.reason === "string" ? visibleText(error.reason) : fallback

export function Board({ id, alertKind }: SubjectProps) {
  const [post, setPost] = useState<BoardPost>()
  const [answer, setAnswer] = useState<BoardPost>()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState("")
  const controller = useRef<AbortController | undefined>(undefined)
  const locked = useRef(false)
  const attempt = useRef<{ text: string; requestId: ReturnType<typeof requestId> } | undefined>(undefined)
  useEffect(() => {
    const action = new AbortController()
    controller.current = action
    return () => action.abort()
  }, [])

  const read = async () => {
    const signal = controller.current?.signal
    if (signal === undefined || signal.aborted || locked.current || !id) return
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

  const reply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const signal = controller.current?.signal
    if (signal === undefined || signal.aborted || locked.current || sent || post?.status !== "open") return
    const field = event.currentTarget.elements.namedItem("reply") as HTMLTextAreaElement
    const text = field.value
    if (!text.trim()) return
    locked.current = true
    setBusy(true)
    setMessage("")
    // Keep the same key when retrying an unconfirmed reply with unchanged text.
    if (attempt.current?.text !== text) attempt.current = { text, requestId: requestId() }
    const payload = { ...attempt.current!, channelId: post.channelId, replyTo: post.postId,
      to: post.author._tag === "agent" ? [post.author] : [], reply: "none" as const }
    try {
      const result = await withClient((client) => Effect.result(client["board.post"](payload)), signal)
      if (signal.aborted) return
      if (result._tag === "Failure") {
        // A server refusal ends this attempt, even when its receipt is final.
        // A deliberate send after correction gets a new key and keeps the draft.
        // Transport failures leave the outcome uncertain and must reuse the key.
        if (result.failure._tag === "CommandError") attempt.current = undefined
        setMessage(reason(result.failure, "Could not confirm the reply. You can retry the same text."))
        return
      }
      setSent(true)
      field.value = ""
      attempt.current = undefined
      setMessage("Reply sent.")
      // A confirmed write is never retried because its follow-up read failed.
      // Render the stored reply, including the engine's redaction, rather than
      // substituting the submitted text for the server's result.
      const refreshed = await withClient((client) => Effect.gen(function* () {
        const parent = yield* Effect.result(client["board.read"]({ requestId: requestId(), post: post.postId }))
        const response = yield* Effect.result(client["board.read"]({ requestId: requestId(), post: result.success.postId }))
        return { parent, response }
      }), signal)
      if (signal.aborted) return
      if (refreshed.parent._tag === "Success" && "items" in refreshed.parent.success) {
        const item = refreshed.parent.success.items.find((row) => row.postId === post.postId)
        if (item !== undefined) setPost(item)
      }
      if (refreshed.response._tag === "Success" && "items" in refreshed.response.success) {
        setAnswer(refreshed.response.success.items.find((row) => row.postId === result.success.postId))
      }
    } catch {
      if (!signal.aborted) setMessage("Could not confirm the current state. Read the post again before retrying.")
    } finally { if (!signal.aborted) { locked.current = false; setBusy(false) } }
  }

  return <section aria-label="Board post">
    <h4>Board post</h4>
    <p>{boardAlertTitles[alertKind === "board.no-answer" ? "board.no-answer" : "board.post"]}</p>
    <button aria-label="Read post" disabled={busy || !id} onClick={() => { void read() }}>{busy ? "Working…" : "Read post"}</button>
    {post !== undefined && <>
      <p>Author: {visibleText(authorLabel(post.author))}</p>
      <p>Post: {visibleText(post.postId)}</p>
      <p>Status: {post.status}{post.outcome === undefined ? "" : ` · ${post.outcome}`}</p>
      <p>Post text</p><DataText text={post.text} />
      <p>Acknowledged: {post.acknowledged.length === 0 ? "Nobody yet." : post.acknowledged.map((author) => visibleText(authorLabel(author))).join(", ")}</p>
      {post.dispositions.map((row, index) => <p key={index}>
        {visibleText(authorLabel(row.addressee))}: {row.disposition === "no-answer" ? "no answer" : row.disposition}
      </p>)}
      {post.status === "open" && !sent && <form aria-label="Reply to post" onSubmit={(event) => { void reply(event) }}>
        <label>Reply<textarea name="reply" aria-label="Reply" required disabled={busy} /></label>
        <button type="submit" disabled={busy}>Send reply</button>
      </form>}
    </>}
    {answer !== undefined && <><p>Your reply</p><DataText text={answer.text} /></>}
    {message && <p role="status">{message}</p>}
  </section>
}
