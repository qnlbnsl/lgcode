import { expect, it, vi } from "vitest"
import { item, mountThread, permissionRequest, requestId } from "./thread-fixtures.tsx"

it("7.12 shows the request title and full tool input before Allow, with the action visually distinct from agent text", async () => {
  const container = await mountThread([
    item(1, { _tag: "ThreadItem", itemId: "message", replay: false, content: { _tag: "text", text: "Agent message before its request." } }),
    permissionRequest({ description: "Open a harmless looking file", toolKind: "execute", toolInput: { command: "rm -rf /tmp/example" } })
  ])
  const allow = await vi.waitFor(() => {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Allow")
    if (button === undefined) throw new Error("permission action is not rendered")
    return button
  })
  expect(container.textContent).toContain("Open a harmless looking file") // catches hiding the title that the owner is asked to approve
  expect(container.textContent).toContain('"command":"rm -rf /tmp/example"') // catches approving from the title without seeing the actual input
  const command = container.querySelector(".request-fields code")!
  expect(command.textContent).toBe("rm -rf /tmp/example")
  expect(command.closest("details:not([open]), [hidden]")).toBeNull()
  expect(command.compareDocumentPosition(allow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const message = [...container.querySelectorAll("article")].find((article) => article.textContent?.includes("Agent message before its request."))
  const request = container.querySelector('[aria-label="Permission request"]')
  expect(message).toBeTruthy() // catches agent text being rendered in the same control region as LGTM Studio actions
  expect(request).toBeTruthy()
  expect(request!.contains(allow)).toBe(true)
  expect(message!.contains(allow)).toBe(false) // catches an approval control that appears to be part of the agent's message
  expect(container.querySelector(`[data-request-id="${requestId}"]`)).toBeTruthy() // catches rendering action context without its request identity
})

it("7.12 uses fixed warnings for hidden input, and shows matching Codex file changes unfolded instead", async () => {
  const hidden = await mountThread([permissionRequest({ description: "Edit file", inputRedacted: true })])
  expect(hidden.textContent).toContain("The action's input is not visible.") // catches silent approval when action input is absent
  expect(hidden.textContent).toContain("Part of the action's input is hidden, because redaction changed it.") // catches missing redaction warning

  const codex = await mountThread([
    permissionRequest({ description: "Edit file", locations: [{ path: "src/target.ts", line: 4 }] }),
    item(3, { _tag: "ThreadItem", itemId: "file-change-item", replay: false, content: { _tag: "file-change", callId: "tool-1", path: "src/target.ts", diff: "+safe change" } })
  ])
  const request = codex.querySelector<HTMLElement>(`[data-request-id="${requestId}"]`)!
  const allow = [...request.querySelectorAll("button")].find((button) => button.textContent === "Allow")!
  const path = [...request.querySelectorAll("pre")].find((node) => node.textContent === "src/target.ts")
  const diff = [...request.querySelectorAll("pre")].find((node) => node.textContent === "+safe change")
  for (const context of [path, diff]) {
    expect(context, "matching context belongs inside this request").toBeTruthy()
    expect(context!.closest("details:not([open]), [hidden]")).toBeNull()
    expect(context!.compareDocumentPosition(allow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
  const article = codex.querySelector('article[aria-label="Agent message"]')!
  expect(article.textContent).toContain("+safe change")
  expect(article.contains(allow)).toBe(false)
  expect(request.textContent).not.toContain("The action's input is not visible.")
})

