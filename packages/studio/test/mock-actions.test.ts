import { afterEach, beforeAll, expect, it, vi } from "vitest"

globalThis.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
let lib: any, engine: any, controls: any
beforeAll(async () => {
  lib = await import("../../../design/mock/js/lib.js" as string)
  engine = await import("../../../design/mock/js/engine.js" as string)
  controls = await import("../../../design/mock/js/live/mock-controls.js" as string)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); lib.live.on = false; engine.setConnection(null) })
const project = { id: "project", repo: "repository" }, screen = { id: "home", rev: "v1", status: "draft" }
const mocks = { revisionId: "v1", designRevision: "design", screens: [screen], changes: [{ screen: "home", to: "v1", seen: false }] }
const file = { name: "../../ignored-name.pen", size: 6, arrayBuffer: async () => new TextEncoder().encode("export").buffer }
const cases = [
  ["comment", "project.mocks.comment", "mock-comment:home", () => controls.comment(project, screen, "<script>data</script> $(touch escaped)")],
  ["approval", "project.mocks.screen.approve", "mock-approve:home", () => controls.approve(project, screen)],
  ["seen", "project.mocks.seen.batch", "mock-seen:project", () => controls.markSeen(project, mocks)],
  ["editor", "project.mocks.editor.save", "mock-editor:project", () => {
    controls.saveEditor(project, mocks, file)
    return lib.store.state.dialog?.onConfirm()
  }]
] as const

for (const [label, command, key, action] of cases) for (const rejected of [false, true]) it(`${label} waits for the engine, exposes pending state and preserves records on ${rejected ? "refusal" : "acknowledgement until read"}`, async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const held = new Promise<void>((resolve) => { finish = resolve })
  const authoritative = { ...mocks, persisted: true }
  lib.live.on = true
  lib.store.state = lib.guardStore({ mocks: { project: structuredClone(mocks) }, design: {}, session: { status: "in" }, ui: {}, boardRevision: 1, toasts: [] })
  const request = vi.fn(async (tag: string, _payload?: unknown) => {
    if (tag === command) { await held; if (rejected) throw new Error("mock revision changed; refresh and retry"); return { requestId: "ack" } }
    if (tag === "client.sequence") return { sequence: 1 }
    if (tag === "project.mocks.read") return { items: [] }
    if (tag === "project.design.read") return { result: { _tag: "registered", record: { revisionId: "design", design: { worktreeId: "workspace" } } } }
    throw new Error("unexpected request: " + tag)
  })
  engine.setConnection({ request, mocks: { mapMocks: () => authoritative, mapDesign: () => ({ persisted: true }) } })
  const before = JSON.stringify(lib.store.state.mocks)
  const pending = action()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(lib.store.state.ui.boardBusy[key]).toBe(true)
  expect(JSON.stringify(lib.store.state.mocks)).toBe(before)
  expect(request.mock.calls.some(([tag]) => tag === command)).toBe(true)
  // A repeated click while pending does not issue a second mutation.
  await action()
  expect(request.mock.calls.filter(([tag]) => tag === command)).toHaveLength(1)
  finish(); await pending
  expect(lib.store.state.ui.boardBusy[key]).toBeUndefined()
  if (rejected) {
    // Seen marks reload even after a partial batch refusal, so only returned
    // records may replace the old snapshot in that one path.
    if (label !== "seen") expect(JSON.stringify(lib.store.state.mocks)).toBe(before)
    expect(lib.store.state.toasts.at(-1)).toMatchObject({ text: "mock revision changed; refresh and retry", tone: "error" })
  } else expect(lib.store.state.mocks.project.persisted).toBe(true)
  if (label === "editor") expect(request.mock.calls.find(([tag]) => tag === command)?.[1]).toEqual({ projectId: "project", revisionId: "v1", designRevision: "design", worktreeId: "workspace", confirmed: true, content: "ZXhwb3J0" })
})

it("review item 1: marks all displayed unseen versions with one engine request", async () => {
  vi.useFakeTimers()
  lib.live.on = true
  lib.store.state = lib.guardStore({ mocks: { project: structuredClone(mocks) }, design: {}, session: { status: "in" }, ui: {}, boardRevision: 1, toasts: [] })
  const request = vi.fn(async (tag: string, _payload?: unknown) => {
    if (tag === "client.sequence") return { sequence: 1 }
    if (tag === "project.mocks.read") return { items: [] }
    if (tag === "project.mocks.reviews.read") return { reviews: [] }
    return { requestId: "ack" }
  })
  engine.setConnection({ request, mocks: { mapMocks: () => mocks } })
  await controls.markSeen(project, { ...mocks, changes: [
    { screen: "home", to: "v1", seen: false }, { screen: "home", to: "v2", seen: false }, { screen: "other", to: "v2", seen: true }
  ] })
  const mutations = request.mock.calls.filter(([tag]) => tag.startsWith("project.mocks.seen"))
  expect(mutations).toHaveLength(1)
  expect(mutations[0]?.[1]).toMatchObject({ projectId: "project", versions: [
    { revisionId: "v1", screenId: "home" }, { revisionId: "v2", screenId: "home" }
  ] })
})

it("review item 5: asks before an editor save and sends explicit confirmation only after acceptance", async () => {
  vi.useFakeTimers()
  lib.live.on = true
  lib.store.state = lib.guardStore({ mocks: { project: structuredClone(mocks) }, design: {}, session: { status: "in" }, ui: {}, boardRevision: 1, toasts: [], dialog: null })
  const request = vi.fn(async (tag: string, _payload?: unknown) => {
    if (tag === "client.sequence") return { sequence: 1 }
    if (tag === "project.mocks.read") return { items: [] }
    if (tag === "project.mocks.reviews.read") return { reviews: [] }
    if (tag === "project.design.read") return { result: { _tag: "registered", record: { revisionId: "design", design: { worktreeId: "workspace" } } } }
    return { requestId: "ack" }
  })
  engine.setConnection({ request, mocks: { mapMocks: () => mocks, mapDesign: () => ({}) } })
  const pending = controls.saveEditor(project, mocks, file)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(request.mock.calls.some(([tag]) => tag === "project.mocks.editor.save")).toBe(false)
  expect(lib.store.state.dialog).toMatchObject({ type: "confirm", body: expect.stringContaining("Design") })
  expect(lib.store.state.dialog.body).toContain("overall approval")
  await lib.store.state.dialog.onConfirm()
  await pending
  expect(request.mock.calls.find(([tag]) => tag === "project.mocks.editor.save")?.[1]).toMatchObject({ confirmed: true })
})
