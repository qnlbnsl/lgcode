import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import { permissionRequest, mountThread, requestId } from "./thread-fixtures.tsx"

it("7.5 answers a permission request once, even when Allow is tapped twice", async () => {
  const answer = vi.fn(() => Effect.succeed({}))
  const container = await mountThread([permissionRequest()], { answer })
  const allow = await vi.waitFor(() => {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Allow")
    if (button === undefined) throw new Error("permission answer is not rendered")
    return button
  })

  await act(async () => { allow.click(); allow.click() })
  expect(answer).toHaveBeenCalledTimes(1) // catches double submission while a tap is pending
  expect(answer).toHaveBeenCalledWith(expect.objectContaining({
    requestId: expect.any(String), kind: "permission", id: requestId, optionId: "allow-once"
  })) // catches answers detached from their request id or selected option
})
