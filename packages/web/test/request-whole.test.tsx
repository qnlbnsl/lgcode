import { expect, it, vi } from "vitest"
import { item, mountThread, permissionRequest, requestId } from "./thread-fixtures.tsx"

it("7.12 shows the request title and full tool input before Allow, with the action visually distinct from agent text", async () => {
  const container = await mountThread([
    item(2, { _tag: "ThreadItem", itemId: "message", replay: false, content: { _tag: "text", text: "Agent message before its request." } }),
    permissionRequest({ description: "Open a harmless looking file", toolKind: "execute", toolInput: { command: "rm -rf /tmp/example" } })
  ])
  const allow = await vi.waitFor(() => {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Allow")
    if (button === undefined) throw new Error("permission action is not rendered")
    return button
  })
  expect(container.textContent).toContain("Open a harmless looking file") // catches hiding the title that the owner is asked to approve
  expect(container.textContent).toContain('"command":"rm -rf /tmp/example"') // catches approving from the title without seeing the actual input
  expect(container.textContent!.indexOf('"command":"rm -rf /tmp/example"')).toBeLessThan(container.textContent!.indexOf("Allow"))
  const message = [...container.querySelectorAll("article")].find((article) => article.textContent?.includes("Agent message before its request."))
  const request = container.querySelector('[aria-label="Permission request"]')
  expect(message).toBeTruthy() // catches agent text being rendered in the same control region as Shephrd actions
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
    item(3, { _tag: "ThreadItem", itemId: "tool-1", replay: false, content: { _tag: "file-change", path: "src/target.ts", diff: "+safe change" } })
  ])
  expect(codex.textContent).toContain("src/target.ts") // catches hiding the locations that identify Codex's action
  expect(codex.textContent).toContain("+safe change") // catches leaving the matching tool call collapsed or missing
  expect(codex.textContent).not.toContain("The action's input is not visible.") // catches warning when the matching action is visible
})

