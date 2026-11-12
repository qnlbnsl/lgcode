import { act, useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { MockRevision, ProjectId, RequestId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { afterEach, expect, it, vi } from "vitest"
import { Mocks as MockPage } from "../src/project/mocks.tsx"
import { MockApprovalSession } from "../src/project/mockApproval.ts"
import { RepositoryDesign } from "../src/project/design.tsx"
import { Setup } from "../src/project/setup.tsx"
import { OwnerSetup } from "../src/project/ownerSetup.tsx"
import { NewProjectSession } from "../src/project/creation.ts"
import { IsolatedDisplay } from "../src/project/display.tsx"
import { setupHarnessGuidance } from "../src/setup-guidance.ts"

// This is a controlled presentation transport, not authenticated engine proof.
// website-review.test.ts exercises these helpers against real RPC/persistence.
const transport = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock("@lgtm/client/browser", () => ({ connect: () => Effect.succeed(transport.client) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Array<{ root: Root; container: HTMLDivElement }> = []
function Mocks(props: Omit<React.ComponentProps<typeof MockPage>, "approvals">) {
  const [approvals] = useState(() => new MockApprovalSession())
  useEffect(() => () => approvals.dispose(), [approvals])
  return <MockPage approvals={approvals} {...props} />
}
const projectId = "project" as ProjectId, revisionId = "revision" as RequestId
const row: MockRevision = { projectId, revisionId, author: { _tag: "agent", agentId: "designer" as never }, at: 123456,
  artifacts: [{ sourceId: "page" as never, fingerprint: "a".repeat(64) }], comparisons: [],
  bundle: { sources: [{ sourceId: "page" as never, worktreeId: "worktree" as never, path: "screen.html", kind: "screens", previewOrigin: "http://127.0.0.1:4178" }],
    screens: [{ screenId: "home" as never, sourceId: "page" as never, name: "<img src=x onerror=alert(1)>\u202e", route: "/home", scenarioRoutes: [] }], scenarios: [], components: [], draftedFields: [] } }
const mount = async (element: React.ReactNode) => {
  const container = document.createElement("div"), root = createRoot(container)
  roots.push({ root, container }); document.body.append(container)
  await act(async () => { root.render(element) })
  return { container, root }
}
const click = async (container: HTMLElement, label: string) => {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label)
  expect(button, label).toBeTruthy()
  await act(async () => { button!.click() })
}
afterEach(async () => {
  for (const { root, container } of roots.splice(0)) { await act(async () => { root.unmount() }); container.remove() }
  vi.unstubAllGlobals(); transport.client = undefined
})

it.each([
  { selection: { _tag: "editor", repoId: "repo" as never } as const, sandbox: "allow-scripts allow-same-origin", inert: false },
  { selection: { _tag: "mock", projectId, revisionId, screenId: "home" } as const, sandbox: "allow-scripts", inert: false },
  { selection: { _tag: "component", repoId: "repo" as never, revisionId, componentId: "card" } as const, sandbox: "allow-scripts", inert: true }
])("embeds only an actual owner endpoint frame with $sandbox and closes that exact identity", async ({ selection, sandbox, inert }) => {
  const calls: Array<{ path: string; body: unknown; credentials: unknown }> = []
  const frame = { id: "controlled-owner-frame", url: "https://display.example/recorded?private=controlled", displayOrigin: "https://display.example", expiresAt: Date.now() + 60_000 }
  vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(options.body)), credentials: options.credentials })
    return path.endsWith("/open") ? new Response(JSON.stringify(frame), { status: 200 }) : new Response(null, { status: 204 })
  })
  const { container, root } = await mount(<IsolatedDisplay title="Controlled preview" action="Open preview" inert={inert} selection={selection} onSessionExpired={() => {}} />)
  expect(container.querySelector("iframe")).toBeNull()
  await click(container, "Open preview")
  const iframe = container.querySelector("iframe")!
  expect(iframe.getAttribute("sandbox")).toBe(sandbox)
  expect(iframe.parentElement!.hasAttribute("inert")).toBe(inert)
  expect(iframe.tabIndex).toBe(inert ? -1 : 0)
  expect(iframe.getAttribute("src") === frame.url).toBe(true)
  expect(calls[0]).toEqual({ path: "/api/display/open", body: selection, credentials: "same-origin" })
  await act(async () => { iframe.dispatchEvent(new Event("load")) })
  expect(container.textContent).not.toMatch(/ready|rendered|imported/i)
  await act(async () => { root.render(<p>Another page</p>) })
  expect(calls[1]).toEqual({ path: "/api/display/close", body: { id: frame.id }, credentials: "same-origin" })
})

it("closes a pending owner's real returned frame after navigation instead of displaying it on the next page", async () => {
  let complete!: (response: Response) => void
  const closed: string[] = []
  vi.stubGlobal("fetch", async (path: string, options: RequestInit) => {
    if (path.endsWith("/open")) return new Promise<Response>((resolve) => { complete = resolve })
    closed.push(JSON.parse(String(options.body)).id)
    return new Response(null, { status: 204 })
  })
  const { container, root } = await mount(<IsolatedDisplay title="Pending preview" action="Open preview" selection={{ _tag: "editor", repoId: "repo" as never }} onSessionExpired={() => {}} />)
  await click(container, "Open preview")
  await act(async () => { root.render(<p>Another page</p>) })
  await act(async () => { complete(new Response(JSON.stringify({ id: "late-frame", url: "https://display.example/", displayOrigin: "https://display.example", expiresAt: Date.now() + 60_000 }))) })
  expect(closed).toEqual(["late-frame"])
  expect(container.querySelector("iframe")).toBeNull()
})

it("renders current stale artifact text safely and never turns preview metadata into an iframe or executable HTML", async () => {
  transport.client = {
    "client.sequence": () => Effect.succeed({ sequence: 1 }),
    "project.mocks.read": () => Effect.succeed({ items: [row] }),
    "project.mocks.artifact": () => Effect.succeed({ result: { _tag: "available", text: '<script>window.stolen=true</script>\u202e', fingerprint: "b".repeat(64) } })
  }
  const { container } = await mount(<Mocks projectId={projectId} onSessionExpired={() => {}} />)
  await click(container, "Read current artifacts")
  expect(container.textContent).toContain("stale")
  expect(container.textContent).toContain("<script>window.stolen=true</script>\\u202e")
  expect(container.querySelector("script,img,iframe")).toBeNull()
  expect(container.textContent).toContain("No display is open.")
  expect(container.querySelector<HTMLButtonElement>('button[title*="editor"]')!.disabled).toBe(true)
})

it("keeps an uncertain approval locked to the same request and displays the authoritative worklist after recovery", async () => {
  const attempts: Array<{ requestId: string; revisionId: string }> = []
  let approval: unknown, incomplete = false
  transport.client = {
    "client.sequence": () => Effect.succeed({ sequence: 1 }),
    "project.mocks.read": ({ after }: { after?: string }) => Effect.succeed({ items: incomplete && after !== undefined ? [] : [row], ...(incomplete ? { next: revisionId } : {}), ...(approval === undefined ? {} : { approval }) }),
    "project.mocks.artifact": () => Effect.succeed({ result: { _tag: "available", text: "Current source", fingerprint: "a".repeat(64) } }),
    "project.mocks.approve": (payload: { requestId: string; revisionId: string }) => {
      attempts.push(payload)
      if (attempts.length === 1) return Effect.fail({ _tag: "CommandError", reason: "database write failed" })
      approval = { projectId, revisionId, approvalId: payload.requestId, leadAgentId: "actual-lead", at: 123459, worklist: { screens: ["home"], drafts: [], schemaChanges: [], draftedFields: [] } }
      return Effect.succeed({ requestId: payload.requestId })
    }
  }
  const approvals = new MockApprovalSession()
  const { container, root } = await mount(<MockPage approvals={approvals} projectId={projectId} onSessionExpired={() => {}} />)
  await click(container, "Read current artifacts")
  await click(container, "Approve mocks"); await click(container, "Confirm approval")
  expect(container.textContent).toContain("Approval is unconfirmed")
  expect(container.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true)
  await act(async () => { root.render(<p>Another project view</p>) })
  await act(async () => { root.render(<MockPage approvals={approvals} projectId={projectId} onSessionExpired={() => {}} />) })
  incomplete = true
  await click(container, "Retry unconfirmed approval")
  expect(container.textContent).toContain("Retry unconfirmed approval")
  expect(approvals.get(projectId)).toEqual(attempts[0])
  expect(attempts).toHaveLength(1)
  incomplete = false
  await click(container, "Retry unconfirmed approval")
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0])
  expect(container.textContent).toContain("Recorded implementation worklist")
  expect(container.textContent).toContain("actual-lead")
  expect(container.textContent).not.toContain("Retry unconfirmed approval")
  approvals.dispose(); expect(approvals.get(projectId)).toBeUndefined()
})

it("offers only supplied supported scenario routes and leaves other scenario combinations absent", async () => {
  const sparse: MockRevision = { ...row, bundle: { ...row.bundle,
    scenarios: [{ scenarioId: "supported" as never, name: "Supported", description: "Declared route" }, { scenarioId: "other" as never, name: "Unsupported combination", description: "No route for Home" }],
    screens: [{ ...row.bundle.screens[0]!, scenarioRoutes: [{ scenarioId: "supported" as never, route: "/home?case=supported" }] }] } }
  transport.client = { "client.sequence": () => Effect.succeed({ sequence: 1 }), "project.mocks.read": () => Effect.succeed({ items: [sparse] }) }
  const { container } = await mount(<Mocks projectId={projectId} onSessionExpired={() => {}} />)
  expect(container.textContent).toContain("Supported")
  expect(container.textContent).not.toContain("Unsupported combination")
  const select = container.querySelectorAll<HTMLSelectElement>("select")[1]!
  await act(async () => { select.value = "supported"; select.dispatchEvent(new Event("change", { bubbles: true })) })
  expect(container.textContent).toContain("/home?case=supported")
})

it("keeps an incomplete page explicitly unavailable and disables approval rather than claiming an empty history", async () => {
  transport.client = { "client.sequence": () => Effect.succeed({ sequence: 1 }),
    "project.mocks.read": ({ after }: { after?: string }) => Effect.succeed(after === undefined ? { items: [row], next: revisionId } : { items: [], next: revisionId }) }
  const { container } = await mount(<Mocks projectId={projectId} onSessionExpired={() => {}} />)
  expect(container.textContent).toContain("Mock history did not advance")
  expect(container.textContent).not.toContain("No mocks have been recorded")
  expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Approve mocks")!.disabled).toBe(true)
})

it("distinguishes omitted and explicitly empty component screen use within the selected revision", async () => {
  const component = { componentId: "button" as never, name: "Button", sourceId: "page" as never, reference: "Button.tsx", fingerprint: "a".repeat(64), provenance: "shared" as const }
  const components: MockRevision = { ...row, bundle: { ...row.bundle, components: [component, { ...component, componentId: "empty" as never, screens: [] }, { ...component, componentId: "used" as never, screens: ["home" as never] }] } }
  transport.client = { "client.sequence": () => Effect.succeed({ sequence: 1 }), "project.mocks.read": () => Effect.succeed({ items: [components] }) }
  const { container } = await mount(<Mocks projectId={projectId} onSessionExpired={() => {}} />)
  await click(container, "Components")
  const cells = [...container.querySelectorAll("tbody tr")].map((item) => item.children[2]?.textContent)
  expect(cells).toEqual(["Not reported", "None", "<img src=x onerror=alert(1)>\\u202e"])
  expect(container.querySelector("img")).toBeNull()
})

it("retains unknown history after a failed refresh and queues durable-event refreshes during an active read", async () => {
  let fail = false, reads = 0
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  transport.client = {
    "client.sequence": () => Effect.succeed({ sequence: 1 }),
    "project.mocks.read": () => Effect.gen(function* () {
      reads++
      if (reads === 1) yield* Effect.promise(() => wait)
      if (fail) return yield* Effect.fail({ _tag: "RpcClientError" })
      return { items: [row] }
    })
  }
  const { container, root } = await mount(<Mocks projectId={projectId} refreshKey={1} onSessionExpired={() => {}} />)
  await act(async () => { root.render(<Mocks projectId={projectId} refreshKey={2} onSessionExpired={() => {}} />) })
  await act(async () => { release() })
  expect(reads).toBe(2)
  fail = true
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  await click(container, "Refresh mocks")
  expect(container.textContent).toContain("Mock history is not loaded")
  expect(container.textContent).not.toContain("No mocks have been recorded")
})

it("shows exact registered Design identity even when its current file is unavailable, without an active editor", async () => {
  const read = vi.fn((payload: unknown) => Effect.succeed({ result: { _tag: "registered", record: { projectId, revisionId,
    author: { _tag: "owner" }, at: 123456, design: { repoId: "explicit-repo", worktreeId: "explicit-worktree", file: "assets/actual.pen", components: [] }, fileFingerprint: "a".repeat(64) },
    file: { _tag: "unavailable", reason: "artifact unavailable" }, tokens: { _tag: "unavailable", reason: "artifact unavailable" }, components: [] } }))
  transport.client = { "project.design.read": read }
  const { container } = await mount(<RepositoryDesign repoId={"explicit-repo" as never} revisionId={revisionId} onSessionExpired={() => {}} />)
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ repoId: "explicit-repo", revisionId }))
  expect(container.textContent).toContain("assets/actual.pen")
  expect(container.textContent).toContain("explicit-worktree")
  expect(container.textContent).toContain("Current artifact is unavailable or changed")
  expect(container.querySelector("iframe")).toBeNull()
  expect(container.textContent).not.toContain("design/explicit-repo.fig")
})

it("keeps a mounted project-form slot and its draft through Back, while durable progress stays monotonic", async () => {
  let step = "found"
  transport.client = {
    "project.setup": () => Effect.succeed({ setup: { step } }),
    "client.sequence": () => Effect.succeed({ sequence: 1 }),
    "project.read": () => Effect.succeed({ items: [] }),
    "project.settings": () => Effect.succeed({ settings: { workspaceFolder: "/actual/work", shell: "sh", displayName: "Explicit owner" } }),
    "project.setup.discover": () => Effect.succeed({ result: { state: "available", repositories: [], harnesses: [], truncated: false,
      readyDefaults: { harness: "claude", account: { _tag: "named", accountId: "actual-account" }, permission: "ask" }, ownerNameSuggestion: "Git suggestion" } }),
    "project.setup.advance": ({ step: next }: { step: string }) => { step = next; return Effect.succeed({}) }
  }
  // A controlled form slot verifies lifetime only. The actual W07B form import
  // and full creation journey are still held for the accepted foundation join.
  function Slot() { const [draft, setDraft] = useState(""); return <input aria-label="Controlled form draft" value={draft} onChange={(event) => setDraft(event.target.value)} /> }
  const { container } = await mount(<Setup renderProject={() => <Slot />} onCompleted={() => {}} onLogout={() => {}} onSessionExpired={() => {}} />)
  expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("Explicit owner")
  await click(container, "Continue")
  const input = container.querySelector<HTMLInputElement>('[aria-label="Controlled form draft"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Kept draft")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await click(container, "Back"); await click(container, "Continue")
  expect(container.querySelector('[aria-label="Controlled form draft"]')).toBe(input)
  expect(input.value).toBe("Kept draft"); expect(step).toBe("project")
})

it("shows unavailable discovery with retry and Change folder while distinguishing local credentials from a provider handshake", async () => {
  transport.client = {
    "project.setup": () => Effect.succeed({ setup: { step: "found" } }),
    "project.settings": () => Effect.succeed({ settings: { workspaceFolder: "/missing", shell: "sh" } }),
    "project.setup.discover": () => Effect.succeed({ result: { state: "unavailable", repositories: [], truncated: false,
      harnesses: [{ harness: "claude", installed: true, configured: true, accounts: [{ accountId: "actual-account", state: "local-credential", remoteAuthentication: "not-checked" }] }] } })
  }
  const { container } = await mount(<Setup renderProject={() => null} onCompleted={() => {}} onLogout={() => {}} onSessionExpired={() => {}} />)
  expect(container.textContent).toContain("Discovery unavailable")
  expect(container.textContent).toContain("Local credential present")
  expect(container.textContent).toContain("Remote authentication not checked")
  expect(container.textContent).not.toContain("No repositories found")
  expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Continue")!.disabled).toBe(true)
  await click(container, "Change folder")
  expect([...container.querySelectorAll("input")].some((input) => input.value === "/missing")).toBe(true)
})

it("uses accepted static guidance for four supported harnesses without treating missing installation or credentials as readiness", async () => {
  const commands: string[] = []
  let ready = false
  transport.client = {
    "project.setup": () => Effect.succeed({ setup: { step: "found" } }),
    "project.settings": () => Effect.succeed({ settings: { workspaceFolder: "/actual/work", shell: "sh" } }),
    "project.setup.discover": () => Effect.succeed({ result: { state: "available", repositories: [], truncated: false,
      harnesses: [
        { harness: "claude", installed: false, configured: true, accounts: [{ accountId: "missing", state: "missing-executable", remoteAuthentication: "not-checked" }] },
        { harness: "codex", installed: true, configured: true, accounts: [{ accountId: "local-account", state: ready ? "local-credential" : "signed-out", remoteAuthentication: "not-checked" }] },
        { harness: "gemini", installed: false, configured: false, accounts: [] },
        { harness: "cursor", installed: false, configured: false, accounts: [] },
        { harness: "__proto__", installed: false, configured: false, accounts: [] }
      ], ...(ready ? { readyDefaults: { harness: "codex", account: { _tag: "named", accountId: "local-account" }, permission: "ask" } } : {}) } }),
    "project.setup.advance": () => { commands.push("advance"); return Effect.succeed({}) }
  }
  const { container } = await mount(<Setup renderProject={() => null} onCompleted={() => {}} onLogout={() => {}} onSessionExpired={() => {}} />)
  const links = [...container.querySelectorAll<HTMLAnchorElement>("a")]
  expect(links).toHaveLength(4)
  for (const key of ["claude", "codex", "gemini", "cursor"] as const) {
    expect(container.textContent).toContain(setupHarnessGuidance[key].guidance)
    const link = links.find((item) => item.textContent?.endsWith(key))!
    expect(link.href).toBe(setupHarnessGuidance[key].documentation)
    expect(new URL(link.href).protocol).toBe("https:")
    expect(link.rel).toBe("noopener noreferrer")
    expect(link.target).toBe("_blank")
  }
  expect(container.textContent).toContain("Not installed")
  expect(container.textContent).toContain("Executable missing")
  expect(container.textContent).toContain("Signed out")
  expect(container.textContent).toContain("Remote authentication not checked")
  const next = [...container.querySelectorAll("button")].find((button) => button.textContent === "Continue")!
  expect(next.disabled).toBe(true)
  await click(container, "Continue")
  expect(commands).toEqual([])
  ready = true
  await click(container, "Check again")
  expect(next.disabled).toBe(false)
  expect(container.textContent).toContain("Local credential present")
  expect(container.textContent).toContain("Remote authentication not checked")
  expect(commands).toEqual([])
})


it("uses the accepted single creation controller and form through Setup Back and actual returned-project completion", async () => {
  const created: Array<{ requestId: string; useWorktree: boolean }> = []
  let setup: { step: string; completedAt?: number; projectId?: string } = { step: "project" }
  const completed = vi.fn()
  transport.client = {
    "client.sequence": () => Effect.succeed({ sequence: 1 }),
    "project.setup": () => Effect.succeed({ setup }),
    "project.settings": () => Effect.succeed({ settings: { workspaceFolder: "/actual/work", shell: "sh" } }),
    "project.setup.discover": () => Effect.succeed({ result: { state: "available", repositories: [], truncated: false, harnesses: [],
      readyDefaults: { harness: "claude", account: { _tag: "named", accountId: "actual" }, permission: "ask" } } }),
    "project.repositories": () => Effect.succeed({ items: [{ repoId: "repo", name: "Actual repository", path: "/actual/work" }] }),
    "project.creations": () => Effect.succeed({ items: [] }),
    "project.placement.preview": () => Effect.succeed({ result: { branch: "actual-branch", path: "/actual/worktree", checkout: "worktree", reserved: false } }),
    "project.create": (payload: { requestId: string; useWorktree: boolean }) => { created.push(payload); return Effect.succeed({ projectId: "actual-created" }) },
    "project.read": () => Effect.succeed({ items: created.length === 0 ? [] : [{ projectId: "actual-created", name: "Owned draft", leadAgentId: "actual-lead", repoId: "repo", worktreeId: "actual-worktree", machineId: "local", goal: "Actual goal" }] }),
    "project.setup.complete": ({ projectId: id }: { projectId: string }) => { setup = { step: "project", completedAt: 123459, projectId: id }; return Effect.succeed({}) }
  }
  const creation = new NewProjectSession(() => {})
  try {
    const { container } = await mount(<OwnerSetup creation={creation} onAddRepository={() => {}} onSettings={() => {}}
      onCompleted={completed} onLogout={() => {}} onSessionExpired={() => {}} />)
    await act(async () => { creation.update({ name: "Owned draft", goal: "Actual goal" }) })
    const form = container.querySelector(".new-project form")
    expect(form).not.toBeNull()
    expect(container.querySelectorAll(".new-project form")).toHaveLength(1)
    expect(container.querySelector("dialog")).toBeNull()
    await click(container, "Back")
    expect(container.querySelector(".new-project form")).toBe(form)
    expect(creation.getSnapshot().draft).toMatchObject({ name: "Owned draft", goal: "Actual goal" })
    await click(container, "Continue")
    expect(container.querySelector(".new-project form")).toBe(form)
    await act(async () => { await creation.start() })
    expect(created).toHaveLength(1)
    expect(created[0]!.useWorktree).toBe(true)
    expect(completed).toHaveBeenCalledWith("actual-created")
  } finally { await act(async () => { creation.dispose() }) }
})
