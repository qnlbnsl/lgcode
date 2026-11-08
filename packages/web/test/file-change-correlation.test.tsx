import { randomUUID } from "node:crypto"
import { ThreadContent } from "@lgcode/contracts"
import * as Schema from "effect/Schema"
import { expect, it } from "vitest"
import { translate } from "../../engine/src/runner/translate.ts"
import { item, mountThread, permissionRequest } from "./thread-fixtures.tsx"

const translatedItems = (update: unknown, sequence: number) => translate(update, false).map((translated, index) =>
  item(sequence + index, { _tag: "ThreadItem", itemId: randomUUID(), replay: false,
    content: Schema.decodeUnknownSync(ThreadContent)(JSON.parse(JSON.stringify(translated.content))) }))

for (const shape of ["path", "changes"] as const) {
  it(`FR-004 selects only the matching translated ${shape} diff for a locations-only permission, independently of thread-item identity`, async () => {
    const diff = (callId: string, text: string) => ({ sessionUpdate: "tool_call_update", toolCallId: callId,
      content: [shape === "path" ? { type: "diff", path: "src/target.ts", oldText: "old", newText: text }
        : { type: "diff", changes: [{ path: "src/target.ts", operation: "modify" }], patch: { text, format: "git_patch" } }] })
    const container = await mountThread([
      ...translatedItems({ sessionUpdate: "tool_call", toolCallId: "other-read", title: "Unrelated read", status: "completed" }, 3),
      ...translatedItems(diff("tool-1", "+matching edit"), 4),
      ...translatedItems({ sessionUpdate: "tool_call", toolCallId: "other-search", title: "Unrelated search", status: "completed" }, 5),
      ...translatedItems(diff("second-edit", "+other edit of the same path"), 6),
      permissionRequest({ toolKind: "edit", locations: [{ path: "src/target.ts" }] }),
    ])
    const request = container.querySelector('[aria-label="Permission request"]')!
    expect(request.textContent).toContain("+matching edit")
    expect(request.textContent).not.toContain("+other edit of the same path")
    expect(request.textContent).not.toContain("Unrelated read")
    expect(request.textContent).not.toContain("Unrelated search")
    expect(request.textContent).not.toContain("The action's input is not visible.")
  })
}

it("FR-004 keeps missing-context warnings for legacy file changes, even if an item id happens to equal a tool id", async () => {
  const legacy = Schema.decodeUnknownSync(ThreadContent)({ _tag: "file-change", path: "src/target.ts", diff: "+legacy without correlation" })
  const container = await mountThread([
    permissionRequest({ locations: [{ path: "src/target.ts" }] }),
    item(3, { _tag: "ThreadItem", itemId: "tool-1", replay: false, content: legacy }),
  ])
  const request = container.querySelector('[aria-label="Permission request"]')!
  expect(request.textContent).toContain("The action's input is not visible.")
  expect(request.textContent).not.toContain("+legacy without correlation")
})
