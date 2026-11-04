import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import { mountThread } from "../thread-fixtures.tsx"

const post = {
  postId: "post-42", channelId: "channel-7", author: { _tag: "agent", agentId: "worker-1" },
  text: "Please review.", to: [{ _tag: "owner" }], reply: "all", sequence: 9,
  status: "open", dispositions: [], acknowledged: [],
}
const click = async (container: HTMLElement, label: string) => {
  const button = Array.from(container.querySelectorAll("button")).find((row) => row.textContent === label)!
  expect(button).toBeTruthy()
  await act(async () => { button.click() })
}

it.each(["/#/thread/worker-1", "/#/thread/worker-1?subject=board:post-42"])("resolves a no-answer subject from paged alert metadata without reading any post: %s", async (path) => {
  const alert = (agentId: string, id: string) => ({
    alertId: `alert-${id}`, alertKey: `no-answer:${id}`, kind: "board.no-answer", agentId,
    subject: { _tag: "piece", namespace: "board", id }, title: "Untrusted title is not a control",
    status: "open", raisedAt: 1, sourceSequence: 1,
  })
  const read = vi.fn(() => Effect.succeed({ items: [post] }))
  const list = vi.fn(({ after }: { after: number }) => Effect.succeed(after === 0
    ? { items: [alert("other-agent", "other-post")], next: 10 }
    : { items: [alert("worker-1", "post-42")] }))
  const container = await mountThread([], { "client.alerts.list": list, "board.read": read }, path)
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ after: 10, status: "open" }))
  expect(container.querySelectorAll('button[aria-label="Read post"]')).toHaveLength(1)
  expect(container.textContent).toContain("An agent has not answered your post")
  expect(container.textContent).not.toContain("Untrusted title")
  expect(read).not.toHaveBeenCalled()
  await click(container, "Read post")
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ post: "post-42" }))
})

it("keeps a refused draft and reuses its request id when the owner retries", async () => {
  const reply = vi.fn().mockReturnValueOnce(Effect.fail({ reason: "board disabled" }))
    .mockReturnValue(Effect.succeed({ postId: "answer-1" }))
  const container = await mountThread([], {
    "board.read": () => Effect.succeed({ items: [post] }), "board.post": reply,
  }, "/#/thread/worker-1?subject=board:post-42")
  await click(container, "Read post")
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!
  field.value = "Keep my answer."
  await click(container, "Send reply")
  expect(container.textContent).toContain("board disabled")
  expect(field.value).toBe("Keep my answer.")
  await click(container, "Send reply")
  expect(reply).toHaveBeenCalledTimes(2)
  expect(reply.mock.calls[1]![0].requestId).toBe(reply.mock.calls[0]![0].requestId)
})

it("renders the stored reply and never resends a confirmed write after a failed refresh", async () => {
  const reply = vi.fn(() => Effect.succeed({ postId: "answer-1" }))
  const read = vi.fn().mockReturnValueOnce(Effect.succeed({ items: [post] }))
    .mockReturnValueOnce(Effect.fail({ reason: "board disabled" }))
    .mockReturnValueOnce(Effect.succeed({ items: [{ ...post, postId: "answer-1", text: "Stored [REDACTED] answer." }] }))
  const container = await mountThread([], { "board.read": read, "board.post": reply }, "/#/thread/worker-1?subject=board:post-42")
  await click(container, "Read post")
  container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!.value = "Submitted answer."
  await click(container, "Send reply")
  expect(container.textContent).toContain("Stored [REDACTED] answer.")
  expect(container.textContent).not.toContain("Submitted answer.")
  expect(container.querySelector('textarea[aria-label="Reply"]')).toBeNull()
  expect(reply).toHaveBeenCalledTimes(1)
})
