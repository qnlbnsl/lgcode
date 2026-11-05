import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import { agentId, mountThread } from "./thread-fixtures.tsx"

it("7.6 prompts the agent from its thread with the entered text", async () => {
  const prompt = vi.fn(() => Effect.succeed({}))
  const container = await mountThread([], { prompt })
  const input = await vi.waitFor(() => {
    const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt agent"]')
    if (field === null) throw new Error("thread prompt field is not rendered")
    return field
  })
  input.value = "Please continue with the next file."
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send prompt"]')
  expect(send).toBeTruthy()
  await act(async () => { send!.click() })
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
    requestId: expect.any(String), agentId, text: "Please continue with the next file."
  })) // catches prompt controls that target the wrong agent or lose the text
})
