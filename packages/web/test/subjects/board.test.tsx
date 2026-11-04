import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import { mountThread } from "../thread-fixtures.tsx"

const post = (fields: Record<string, unknown> = {}) => ({
  postId: "post-42", channelId: "channel-7", author: { _tag: "agent", agentId: "worker-1" },
  text: "Please review this change.", to: [{ _tag: "owner" }], reply: "all", sequence: 9,
  status: "open", dispositions: [], acknowledged: [], ...fields,
})
const readReply = (item: ReturnType<typeof post>) => ({ requestId: "read-result", items: [item] })
const readButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button[aria-label="Read post"]')

it("7.1 shows the fixed board alert title and waits for the owner's tap before reading", async () => {
  const read = vi.fn(() => Effect.succeed(readReply(post())))
  const container = await mountThread([], { "board.read": read }, "/thread/worker-1?subject=board:post-42")

  expect(container.textContent).toContain("An agent needs your reply") // catches a missing or agent-controlled alert title
  const button = readButton(container)
  expect(button).toBeTruthy() // catches a subject entry with no explicit read action
  expect(read).not.toHaveBeenCalled() // catches marking the post read just by opening its link

  await act(async () => { button!.click() })
  expect(read).toHaveBeenCalledTimes(1) // catches a tap that issues no read or issues it more than once
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ post: "post-42" })) // catches reading a page instead of this post
})

it("7.2 renders post text as inert text and identifies its author with fixed words and id", async () => {
  const malicious = '<img src=x onerror="window.__boardXss=1"> [open](javascript:window.__boardXss=2) **markdown**'
  const read = vi.fn(() => Effect.succeed(readReply(post({ text: malicious }))))
  const container = await mountThread([], { "board.read": read }, "/thread/worker-1?subject=board:post-42")

  const button = readButton(container)
  expect(button).toBeTruthy() // catches a missing explicit read action before inspecting rendered data
  await act(async () => { button!.click() })
  expect(container.textContent).toContain(malicious) // catches Markdown parsing or text sanitization that hides the original data
  expect(container.querySelector("img")).toBeNull() // catches interpreting an agent's HTML as markup
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull() // catches executable links created from agent text
  expect((window as typeof window & { __boardXss?: number }).__boardXss).toBeUndefined() // catches event-handler or link execution
  expect(container.textContent).toContain("agent worker-1") // catches dropping the fixed author words or substituting a mutable name
})

it("7.3 replies once to the same channel and post, shows closed state, and preserves text after refusal", async () => {
  const read = vi.fn(() => Effect.succeed(readReply(post())))
  const reply = vi.fn(() => Effect.succeed({ requestId: "reply-result", postId: "answer-1" }))
  const container = await mountThread([], { "board.read": read, "board.post": reply }, "/thread/worker-1?subject=board:post-42")
  const button = readButton(container)
  expect(button).toBeTruthy() // catches a missing explicit read action before checking replies
  await act(async () => { button!.click() })
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')
  expect(textarea).toBeTruthy() // catches omitting the answer control for an open post
  await act(async () => {
    textarea!.value = "I will review it."
    textarea!.dispatchEvent(new Event("input", { bubbles: true }))
    textarea!.dispatchEvent(new Event("change", { bubbles: true }))
  })
  const send = Array.from(container.querySelectorAll("button")).find((button) => /send reply/i.test(button.textContent ?? ""))
  expect(send).toBeTruthy()
  await act(async () => {
    send!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    send!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1)) // catches an answer that can be duplicated by a double tap
  expect(reply).toHaveBeenCalledWith(expect.objectContaining({ channelId: "channel-7", replyTo: "post-42", text: "I will review it." })) // catches an unlinked or misdirected answer

  const closed = await mountThread([], { "board.read": () => Effect.succeed(readReply(post({ status: "closed", outcome: "answered" }))), "board.post": reply }, "/thread/worker-1?subject=board:post-42")
  await act(async () => { readButton(closed)!.click() })
  expect(closed.textContent).toMatch(/answered/i) // catches losing the closed post's outcome
  expect(closed.querySelector('textarea[aria-label="Reply"]')).toBeNull() // catches offering replies to a closed post

  const refusal = vi.fn(() => Effect.fail({ reason: "board disabled" }))
  const refused = await mountThread([], { "board.read": read, "board.post": refusal }, "/thread/worker-1?subject=board:post-42")
  await act(async () => { readButton(refused)!.click() })
  const refusedTextarea = refused.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!
  await act(async () => {
    refusedTextarea.value = "Keep this draft."
    refusedTextarea.dispatchEvent(new Event("input", { bubbles: true }))
    refusedTextarea.dispatchEvent(new Event("change", { bubbles: true }))
  })
  const refusedSend = Array.from(refused.querySelectorAll("button")).find((button) => /send reply/i.test(button.textContent ?? ""))!
  await act(async () => { refusedSend.click() })
  await vi.waitFor(() => expect(refused.textContent).toContain("board disabled")) // catches a refusal hidden from the owner
  expect(refusedTextarea.value).toBe("Keep this draft.") // catches discarding text the owner must retry
})

it("7.6 displays acknowledgement and no-answer state for a no-answer board alert", async () => {
  const read = vi.fn(() => Effect.succeed(readReply(post({
    acknowledged: [{ _tag: "agent", agentId: "worker-1" }],
    dispositions: [{ addressee: { _tag: "agent", agentId: "worker-2" }, disposition: "no-answer" }],
  }))))
  const container = await mountThread([], { "board.read": read }, "/thread/worker-1?subject=board:post-42")
  const button = readButton(container)
  expect(button).toBeTruthy() // catches a no-answer notification that is not wired to the shared entry
  await act(async () => { button!.click() })
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ post: "post-42" })) // catches no-answer links that do not resolve to this entry
  expect(container.textContent).toMatch(/acknowledged/i) // catches hiding that an addressee took up the post
  expect(container.textContent).toMatch(/no answer/i) // catches hiding the addressee's disposition
  expect(container.textContent).toContain("worker-2") // catches losing the id of the addressee who did not answer
})
