import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createServer } from "node:net"
import { act } from "react"
import { createRoot } from "react-dom/client"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { makeNodeSocket } from "@lgcode/client/nodeSocket"
import { connectWith, type Client } from "../../client/src/core.ts"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as Server from "../../engine/src/api/server.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { Views } from "../../engine/src/views/Views.ts"
import { projectView } from "../../engine/src/project/view.ts"
import { provideBoard } from "../../engine/test/board/wakeFixtures.ts"
import { ancestryHeaders, authorization, socketUrl } from "../../engine/test/support/socketClient.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { provideRestart, recover } from "../../engine/test/support/restartRig.ts"
import type { FakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { appendSetup, call, eventOf, freshRequest, harnessSettings, makeRig, ownerCredential, removeRig, seedAccount, seedAgent, success, type Rig } from "../../engine/test/support/handlerRig.ts"
import { GitPage, type GitPageProps } from "../src/git/GitPage.tsx"
import * as GitProcess from "../../engine/src/project/git/process.ts"
import { createGitSession, readResult, workspaceKey } from "../src/git/state.ts"

// Only browser socket construction is substituted. The client below performs
// authenticated real RPCs against the real handler, SQL, redactor and Git.
const browser = vi.hoisted(() => ({ client: undefined as Client | undefined }))
vi.mock("@lgcode/client/browser", () => ({ connect: () => Effect.succeed(browser.client!) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let rig: Rig
const git = (path: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", path, ...args], { encoding: "utf8" }).trim()
const save = (path: string, name: string, text: string) => writeFileSync(join(path, name), text)
const unusedPort = () => new Promise<number>((resolve, reject) => {
  const listener = createServer(); listener.once("error", reject)
  listener.listen(0, "127.0.0.1", () => {
    const port = (listener.address() as import("node:net").AddressInfo).port
    listener.close((error) => error ? reject(error) : resolve(port))
  })
})
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main"); git(rig.work, "config", "user.name", "Web Git test"); git(rig.work, "config", "user.email", "web@example.invalid"); git(rig.work, "config", "commit.gpgsign", "false")
  save(rig.work, "file.txt", "base\n"); git(rig.work, "add", "--all"); git(rig.work, "commit", "-m", "Initial")
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(() => { browser.client = undefined; vi.unstubAllEnvs(); vi.unstubAllGlobals(); removeRig(rig) })
const setup = (base = "main") => Effect.gen(function* () {
  yield* registerRebuildCheck()
  if (base !== "main") git(rig.work, "branch", "-m", base)
  yield* seedAccount("launch", "cursor")
  success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(ownerCredential, "accounts set-secret", { accountId: "launch", name: "CURSOR_API_KEY", nonce: "web-git", value: Redacted.make("synthetic-web-git-key") }))
  const api = yield* connect()
  yield* api["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.root, shell: "zsh" } })
  const { repoId } = yield* api["project.repository.add"]({ requestId: freshRequest(), name: "Real product", path: rig.work, machineId: "local" })
  yield* api["project.workspace.register"]({ requestId: freshRequest(), repoId, path: rig.work, branch: base, machineId: "local", checkout: "main" })
  const { projectId } = yield* api["project.create"]({ requestId: freshRequest(), name: "Git work", goal: "Real Git UI", machineId: "local", repository: { _tag: "existing", repoId }, useWorktree: true })
  const view = projectView(yield* (yield* Views).snapshot), project = view.projects[projectId]!, source = view.workspaces[project.worktreeId]!
  return { api, project, source, repository: view.repositories[repoId]!, workspaces: Object.values(view.workspaces) }
})
const connect = (agentToken?: string) => Effect.gen(function* () {
  const socket = join(rig.stateFolder, `${randomBytes(8).toString("hex")}.sock`), token = randomBytes(32).toString("base64url")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(token), debug: false })
  return yield* connectWith({ attempts: 1, makeSocket: () => makeNodeSocket(socketUrl(socket), { headers: { ...authorization(agentToken ?? token), ...ancestryHeaders() } }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) })
})
const wait = async (check: () => void) => {
  const until = Date.now() + 10000
  for (;;) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    try { check(); return } catch (error) { if (Date.now() >= until) throw error }
  }
}
function button(container: HTMLElement, name: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name)
  expect(found, `button ${name}`).toBeTruthy(); return found!
}
const click = async (container: HTMLElement, name: string) => {
  await wait(() => expect(button(container, name).disabled).toBe(false))
  await act(async () => { button(container, name).click() })
}
const message = async (container: HTMLElement, value: string) => { await act(async () => {
  const field = container.querySelector<HTMLTextAreaElement>("#git-message")!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true }))
}) }
async function mounted(f: Effect.Success<ReturnType<typeof setup>>, body: (container: HTMLElement, render: (extra?: Partial<GitPageProps>) => Promise<void>, session: ReturnType<typeof createGitSession>) => Promise<void>) {
  browser.client = f.api
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container), session = createGitSession()
  const props: GitPageProps = { repository: f.repository, projects: [f.project], teams: [], workspaces: f.workspaces, assignedWorkspaceId: f.source.worktreeId, inspectedWorkspaceId: f.source.worktreeId, onInspect: vi.fn(), mutationDisabled: false, connection: "Live", onSessionExpired: vi.fn(), session }
  const render = async (extra: Partial<GitPageProps> = {}) => { await act(async () => { root.render(<GitPage {...props} {...extra} />) }) }
  try { await render(); await wait(() => expect(session.get(workspaceKey(f.repository.repoId, "local", f.source.worktreeId)).ready).toBe(true)); await body(container, render, session) }
  finally { await act(async () => { root.unmount(); session.close() }); container.remove() }
}

it("minor606: refreshes a previously visited row with genuine, partial and unavailable counts and rejects its aborted generation", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), main = f.workspaces.find((row) => row.checkout === "main")!
    let mode: "actual" | "partial" | "unavailable" | "hold" = "actual", release!: () => void, heldSignal: AbortSignal | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    const changes = (payload: Parameters<Client["project.changes"]>[0]) => f.api["project.changes"](payload).pipe(Effect.flatMap((reply): Effect.Effect<typeof reply, unknown> => {
      if (payload.worktreeId !== f.source.worktreeId) return Effect.succeed(reply)
      if (mode === "partial") return Effect.succeed({ ...reply, result: { ...readResult(reply), truncated: true } })
      if (mode === "unavailable") return Effect.fail({ _tag: "CommandError" as const, requestId: payload.requestId, reason: "Git: not_repository" })
      if (mode === "hold") return Effect.tryPromise((signal) => { heldSignal = signal; return pending.then(() => reply) })
      return Effect.succeed(reply)
    }))
    const api = { ...f.api, "project.changes": changes } as Client
    try {
      yield* Effect.promise(() => mounted({ ...f, api }, async (container, render, session) => {
        const sourceKey = workspaceKey(f.repository.repoId, "local", f.source.worktreeId), mainKey = workspaceKey(f.repository.repoId, "local", main.worktreeId)
        const status = (id: string) => container.querySelector(`[data-git-worktree="${id}"] .wt-status`)!.textContent
        expect(session.get(sourceKey).data?.changes.items).toHaveLength(0)
        await render({ inspectedWorkspaceId: main.worktreeId })
        await wait(() => expect(session.get(mainKey).ready).toBe(true))
        save(f.source.path, "after-visit.txt", "actual change after inspecting another worktree\n")
        await click(container, "Refresh Git"); await wait(() => expect(status(f.source.worktreeId)).toBe("1 changes"))
        expect(session.get(sourceKey).data?.changes.items).toHaveLength(0)
        mode = "partial"
        await click(container, "Refresh Git"); await wait(() => expect(status(f.source.worktreeId)).toBe("Partial change list"))
        mode = "unavailable"
        await click(container, "Refresh Git"); await wait(() => expect(status(f.source.worktreeId)).toBe("Unavailable"))
        mode = "hold"
        await click(container, "Refresh Git"); await wait(() => expect(heldSignal).toBeDefined())
        save(f.source.path, "after-held-read.txt", "actual newer generation\n"); mode = "actual"
        await click(container, "Refresh Git"); await wait(() => expect(status(f.source.worktreeId)).toBe("2 changes"))
        expect(heldSignal!.aborted).toBe(true)
        await act(async () => release())
        expect(status(f.source.worktreeId)).toBe("2 changes")
        save(main.path, "current-worktree.txt", "current inspected working data\n")
        await click(container, "Refresh Git")
        await wait(() => expect(session.get(mainKey).data?.changes.items).toHaveLength(1))
        expect(status(main.worktreeId)).toBe("1 changes")
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})

it("stages exact tab paths, refuses stale discard, preserves offline drafts, and commits through the authenticated controller", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "tab\tfile.txt", "<script>literal</script>\n"); save(f.source.path, "file.txt", "working\n")
    yield* Effect.promise(() => mounted(f, async (container, render, session) => {
      await wait(() => expect(container.textContent).toContain("tab\\tfile.txt")); expect(container.querySelector("script")).toBeNull()
      await message(container, "Persisted draft")
      await render({ mutationDisabled: true }); expect(button(container, "Stage all").disabled).toBe(true)
      expect(container.querySelector<HTMLTextAreaElement>("#git-message")!.value).toBe("Persisted draft")
      await render(); await wait(() => expect(button(container, "Discard").disabled).toBe(false)); await click(container, "Discard")
      await wait(() => expect(container.querySelector("dialog")).toBeTruthy()); save(f.source.path, "file.txt", "later independent edit\n")
      await click(container, "Confirm discard"); await wait(() => expect(container.textContent).toContain("state changed"))
      expect(readFileSync(join(f.source.path, "file.txt"), "utf8")).toBe("later independent edit\n")
      expect(container.textContent).not.toContain("Discarded 2 changes.")
      await wait(() => expect(button(container, "Stage all").disabled).toBe(false)); await click(container, "Stage all")
      await wait(() => expect(git(f.source.path, "diff", "--cached", "--name-only")).toContain("file.txt"))
      await wait(() => expect(button(container, "Commit 2 files").disabled).toBe(false))
      await act(async () => { container.querySelector("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })) })
      await wait(() => expect(container.textContent).toContain("Committed "))
      expect(git(f.source.path, "log", "-1", "--format=%B")).toBe("Persisted draft")
      expect(git(f.source.path, "status", "--porcelain")).toBe("")
      expect(session.get(workspaceKey(f.repository.repoId, "local", f.source.worktreeId)).message).toBe("")
    }))
  })).pipe(Effect.orDie))
})

for (const base of ["main", "master"]) it(`prepares and explicitly approves ${base} with missing evidence and real Git effects`, async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(base); save(f.source.path, "feature.txt", "actual reviewed bytes\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Feature <script>literal</script>")
    const expected = git(f.source.path, "rev-parse", "HEAD")
    yield* Effect.promise(() => mounted(f, async (container) => {
      await wait(() => expect(button(container, `Review merge to ${base}`).disabled).toBe(false)); await click(container, `Review merge to ${base}`)
      await wait(() => expect(button(container, "Approve without evidence").disabled).toBe(false))
      expect(git(rig.work, "rev-parse", "HEAD")).not.toBe(expected)
      expect(container.querySelector("dialog")!.textContent).toContain("No reported evidence")
      expect(container.querySelector("dialog")!.textContent).toContain("actual reviewed bytes")
      expect(container.querySelector("script")).toBeNull()
      await click(container, "Approve without evidence")
      await wait(() => expect(container.textContent).toContain(`Merged into ${base}`))
      expect(git(rig.work, "rev-parse", "HEAD")).toBe(expected); expect(readFileSync(join(rig.work, "feature.txt"), "utf8")).toBe("actual reviewed bytes\n")
      expect(git(rig.work, "status", "--porcelain")).toBe("")
    }))
  })).pipe(Effect.orDie))
})

it("renders a successful RPC with refused outcome honestly when reviewed heads become stale", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "feature.txt", "feature\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Feature")
    yield* Effect.promise(() => mounted(f, async (container) => {
      await click(container, "Review merge to main"); await wait(() => expect(button(container, "Approve without evidence").disabled).toBe(false))
      const base = git(rig.work, "rev-parse", "HEAD")
      save(f.source.path, "later.txt", "new head\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Later")
      await click(container, "Approve without evidence"); await wait(() => expect(container.textContent).toContain("Merge refused."))
      expect(git(rig.work, "rev-parse", "HEAD")).toBe(base)
      expect(container.textContent).not.toContain("Merged into main")
    }))
  })).pipe(Effect.orDie))
})

it("keeps conflicts inline, previews server choices, cancels without writing, and resolves canonical bytes", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup()
    save(f.source.path, "file.txt", "ours\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Ours")
    save(rig.work, "file.txt", "theirs\n"); git(rig.work, "add", "--all"); git(rig.work, "commit", "-m", "Theirs")
    try { git(f.source.path, "merge", "--no-edit", "main") } catch { /* The genuine merge must conflict. */ }
    const conflicted = readFileSync(join(f.source.path, "file.txt"), "utf8")
    expect(git(f.source.path, "ls-files", "--unmerged")).not.toBe("")
    yield* Effect.promise(() => mounted(f, async (container) => {
      await wait(() => expect(container.querySelectorAll(".conflict-hunk")).toHaveLength(1))
      expect(container.querySelector(".conflict-side.base")!.textContent).toContain("base")
      expect(button(container, "Mark resolved").disabled).toBe(true)
      await click(container, "Keep both"); await wait(() => expect(container.querySelector(".conflict-preview")!.textContent).toContain("ours\ntheirs"))
      expect(readFileSync(join(f.source.path, "file.txt"), "utf8")).toBe(conflicted)
      await click(container, "Cancel choices"); await wait(() => { expect(container.querySelectorAll(".conflict-hunk")).toHaveLength(1); expect(container.querySelectorAll(".is-chosen")).toHaveLength(0); expect(button(container, "Use ours").disabled).toBe(false) })
      expect(readFileSync(join(f.source.path, "file.txt"), "utf8")).toBe(conflicted)
      await click(container, "Use ours"); await wait(() => expect(button(container, "Mark resolved").disabled).toBe(false)); await click(container, "Mark resolved")
      await wait(() => expect(container.textContent).toContain("Conflict resolved."))
      expect(readFileSync(join(f.source.path, "file.txt"), "utf8")).toBe("ours\n")
      expect(git(f.source.path, "ls-files", "--unmerged")).toBe("")
      await message(container, "Finalize merge with unchanged ours")
      await wait(() => expect(button(container, "Commit").disabled).toBe(false))
      await act(async () => { container.querySelector("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })) })
      await wait(() => expect(container.textContent).toContain("Committed "))
      expect(git(f.source.path, "log", "-1", "--format=%P").split(" ")).toHaveLength(2)
    }))
  })).pipe(Effect.orDie))
})

it("publishes coherent source changes before held history and rejects the stale ancillary generation", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup()
    save(f.source.path, "one.txt", "one\n"); save(f.source.path, "two.txt", "two\n"); git(f.source.path, "add", "--all")
    let release!: () => void, heldSignal: AbortSignal | undefined, calls = 0
    const held = new Promise<void>((resolve) => { release = resolve })
    const original = f.api["project.history"]
    const delayedHistory = (payload: Parameters<Client["project.history"]>[0]) => original(payload).pipe(Effect.flatMap((reply) => {
      if (++calls !== 1) return Effect.succeed(reply)
      return Effect.tryPromise((signal) => { heldSignal = signal; return held.then(() => reply) })
    }))
    const api: Client = { ...f.api, "project.history": delayedHistory as Client["project.history"] }
    try {
      yield* Effect.promise(() => mounted({ ...f, api }, async (container, _render, session) => {
        const key = workspaceKey(f.repository.repoId, "local", f.source.worktreeId)
        await click(container, "History")
        await wait(() => expect(heldSignal).toBeDefined())
        expect(button(container, "Commit 2 files").disabled).toBe(true)
        expect(session.get(key).ready).toBe(true); expect(session.get(key).detailsReady).toBe(false)
        expect(button(container, "Review merge to main").disabled).toBe(true)
        await message(container, "A coherent source can commit while history is held")
        expect(button(container, "Commit 2 files").disabled).toBe(false)
        git(f.source.path, "reset", "HEAD", "--", "two.txt")
        git(f.source.path, "commit", "-m", "New current history")
        save(f.source.path, "three.txt", "three\n"); git(f.source.path, "add", "--", "three.txt")
        await click(container, "Refresh Git")
        await wait(() => expect(button(container, "Commit 1 file").disabled).toBe(false))
        await wait(() => expect(session.get(key).data?.history?.items[0]?.title).toBe("New current history"))
        expect(button(container, "Review merge to main").disabled).toBe(true)
        expect(heldSignal?.aborted).toBe(true)
        const current = session.get(key).data
        await act(async () => { release(); await Promise.resolve() })
        expect(session.get(key).data).toBe(current)
        expect(session.get(key).data?.changes.items.filter((row) => row.staged)).toHaveLength(1)
        expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("2")
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})

it("waits for a new selected comparison after readiness changes and reuses an all-files read across selection", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "file.txt", "old comparison row\n"); save(f.source.path, "next.txt", "other file\n")
    let hold = false, release!: () => void, heldSignal: AbortSignal | undefined, aggregateCalls = 0
    const held = new Promise<void>((resolve) => { release = resolve })
    const delayedDiff = (payload: Parameters<Client["project.diff"]>[0]) => {
      if (payload.path === undefined) aggregateCalls++
      return f.api["project.diff"](payload).pipe(Effect.flatMap((reply) => hold
        ? Effect.tryPromise((signal) => { heldSignal = signal; return held.then(() => reply) }) : Effect.succeed(reply)))
    }
    const api: Client = { ...f.api, "project.diff": delayedDiff as Client["project.diff"] }
    try {
      yield* Effect.promise(() => mounted({ ...f, api }, async (container) => {
        await wait(() => expect(container.querySelector(".diff-content")!.textContent).toContain("old comparison row"))
        save(f.source.path, "file.txt", "new comparison row\n"); hold = true
        await click(container, "History")
        await wait(() => expect(heldSignal).toBeDefined())
        expect(container.querySelector(".diff-content")!.textContent).toContain("Loading comparison")
        expect(container.querySelector(".diff-content")!.textContent).not.toContain("old comparison row")
        hold = false; await act(async () => release())
        await wait(() => expect(container.querySelector(".diff-content")!.textContent).toContain("new comparison row"))
        await click(container, "All files"); await wait(() => expect(container.querySelectorAll(".diff-file")).toHaveLength(2))
        expect(aggregateCalls).toBe(1)
        await act(async () => container.querySelector<HTMLButtonElement>('[data-source-file="next.txt"]')!.click())
        expect(aggregateCalls).toBe(1); expect(container.querySelectorAll(".diff-file")).toHaveLength(2)
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})

it("refreshes a lost committed reply to terminal uncertainty without replay or clearing the next draft", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "file.txt", "actual changed bytes\n")
    const sql = yield* SqlClient.SqlClient
    yield* Effect.promise(() => mounted(f, async (container, _render, session) => {
      const requests: Array<Parameters<Client["project.commit"]>[0]> = [], original = f.api["project.commit"]
      let refuseReads = false
      browser.client = { ...f.api, "project.commit": (payload) => original(payload).pipe(Effect.flatMap(() => {
        requests.push(payload); refuseReads = true
        return Effect.fail({ _tag: "CommandError" as const, requestId: payload.requestId, reason: "database read failed" })
      })), "project.git.state": (payload) => refuseReads ? Effect.fail({ _tag: "CommandError", requestId: payload.requestId, reason: "database read failed" }) : f.api["project.git.state"](payload) } as Client
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
      await click(container, "Stage all"); await message(container, "Commit once")
      await click(container, "Commit 1 file")
      await wait(() => expect(session.attempt?.status).toBe("uncertain"))
      const originalAttempt = session.attempt
      await wait(() => expect(container.textContent).toContain("The Git read failed"))
      expect(session.attempt).toBe(originalAttempt)
      expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("2")
      const receipts = await Effect.runPromise(sql`SELECT request_id FROM receipts WHERE request_id = ${requests[0]!.requestId}`)
      expect(receipts).toHaveLength(1)
      await message(container, "Keep this next draft")
      refuseReads = false; await click(container, "Refresh Git")
      await wait(() => expect(session.attempt?.status).toBe("terminal"))
      expect(container.textContent).toContain("does not establish")
      expect(container.textContent).not.toContain("Committed ")
      expect(requests).toHaveLength(1)
      expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("2")
      expect(container.querySelector<HTMLTextAreaElement>("#git-message")!.value).toBe("Keep this next draft")
      expect(button(container, "Push").disabled).toBe(false)
    }))
  })).pipe(Effect.orDie))
})

for (const boundary of ["before Git", "after Git before receipt"] as const) it(`retains a typed SQL failure ${boundary}, respects the writer latch and refreshes only after normal restart`, async () => {
  const session = createGitSession(); session.setMutationDisabled(false)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  let runner!: FakeRunner, fixture!: Effect.Success<ReturnType<typeof setup>>
  let payload!: Parameters<Client["project.commit"]>[0]
  const acknowledged = vi.fn(() => "Committed"), calls: unknown[] = []
  try {
    await Effect.runPromise(provideBoard(rig, (running) => Effect.gen(function* () {
      runner = running; fixture = yield* setup(); browser.client = fixture.api
      save(fixture.source.path, "file.txt", "effect must be accounted for\n"); git(fixture.source.path, "add", "--all")
      const sql = yield* SqlClient.SqlClient
      payload = { requestId: freshRequest(), worktreeId: fixture.source.worktreeId, message: "Commit only once" }
      if (boundary === "before Git") yield* sql`PRAGMA query_only = ON`
      else yield* sql`CREATE TRIGGER fail_git_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'private SQL details'); END`
      yield* Effect.promise(() => session.execute("source", "Commit", (client) => { calls.push(payload); return client["project.commit"](payload) }, acknowledged, vi.fn()))
      expect(session.attempt?.status).toBe("uncertain"); expect(acknowledged).not.toHaveBeenCalled()
      expect(session.get("source").error).toContain("database"); expect(session.get("source").error).not.toContain("private SQL details")
      expect(git(fixture.source.path, "rev-list", "--count", "HEAD")).toBe(boundary === "before Git" ? "1" : "2")
      expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${payload.requestId}`).toEqual([])
      if (boundary === "before Git") yield* sql`PRAGMA query_only = OFF`
      else yield* sql`DROP TRIGGER fail_git_receipt`
      // An actual new writer request proves the service latch stays failed.
      const latched = yield* fixture.api["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.root, shell: "zsh" } }).pipe(Effect.result)
      expect(latched._tag).toBe("Failure")
      if (boundary === "after Git before receipt") {
        const failedRefresh = yield* fixture.api["project.git.state"]({ requestId: freshRequest(), worktreeId: fixture.source.worktreeId }).pipe(Effect.result)
        expect(failedRefresh._tag).toBe("Failure")
      }
      expect(session.attempt?.status).toBe("uncertain"); expect(calls).toEqual([payload])
    })).pipe(Effect.orDie))
    await Effect.runPromise(provideRestart(rig, runner.layer, Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* recover
      browser.client = yield* connect()
      const originalAttempt = session.attempt!
      const before = readResult(yield* browser.client["project.git.state"]({ requestId: freshRequest(), worktreeId: fixture.source.worktreeId }))
      readResult(yield* browser.client["project.changes"]({ requestId: freshRequest(), worktreeId: fixture.source.worktreeId }))
      const after = readResult(yield* browser.client["project.git.state"]({ requestId: freshRequest(), worktreeId: fixture.source.worktreeId }))
      expect(after.head).toBe(before.head); expect(after.branch).toBe(before.branch); expect(after.mergeHead).toBe(before.mergeHead)
      session.refreshed("source", originalAttempt)
      expect(session.attempt?.status).toBe("terminal"); expect(calls).toEqual([payload]); expect(acknowledged).not.toHaveBeenCalled()
      expect(session.get("source").notice).toBe(""); expect(session.get("source").error).toContain("does not establish")
      expect(git(fixture.source.path, "rev-list", "--count", "HEAD")).toBe(boundary === "before Git" ? "1" : "2")
      if (boundary === "after Git before receipt") {
        const old = yield* browser.client["project.commit"](payload).pipe(Effect.result)
        expect(old).toMatchObject({ _tag: "Failure", failure: { reason: "Git outcome is uncertain; refresh Git state" } })
      }
      save(fixture.source.path, "next.txt", "explicit new owner choice\n"); git(fixture.source.path, "add", "--all")
      const fresh = { requestId: freshRequest(), worktreeId: fixture.source.worktreeId, message: "A fresh explicit choice" }
      yield* Effect.promise(() => session.execute("source", "Commit", (client) => client["project.commit"](fresh), () => "Fresh commit", vi.fn()))
      expect(fresh.requestId).not.toBe(payload.requestId); expect(session.get("source").notice).toBe("Fresh commit")
      expect(git(fixture.source.path, "rev-list", "--count", "HEAD")).toBe(boundary === "before Git" ? "2" : "3")
    })).pipe(Effect.orDie) as Effect.Effect<void>)
  } finally { session.close() }
})

it("keeps actual Git uncertainty distinct, settles by authenticated refresh and never replays a possible commit", async () => {
  const actual = GitProcess.gitProcess
  const process = vi.spyOn(GitProcess, "gitProcess").mockImplementation(async (...args) => {
    const reply = await actual(...args)
    return args[1][0] === "commit" && reply.code === 0 ? { ...reply, code: 1 } : reply
  })
  try {
    await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
      const f = yield* setup(), sql = yield* SqlClient.SqlClient
      browser.client = f.api; vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
      save(f.source.path, "file.txt", "real effect with lost process outcome\n"); git(f.source.path, "add", "--all")
      const session = createGitSession(); session.setMutationDisabled(false)
      const payload = { requestId: freshRequest(), worktreeId: f.source.worktreeId, message: "Uncertain actual commit" }, ack = vi.fn(() => "Wrong")
      try {
        yield* Effect.promise(() => session.execute("source", "Commit", (client) => client["project.commit"](payload), ack, vi.fn()))
        expect(session.attempt).toMatchObject({ status: "uncertain", failure: "git-uncertain" })
        expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("2")
        const original = session.attempt!
        const state = readResult(yield* f.api["project.git.state"]({ requestId: freshRequest(), worktreeId: f.source.worktreeId }))
        const changes = readResult(yield* f.api["project.changes"]({ requestId: freshRequest(), worktreeId: f.source.worktreeId }))
        const final = readResult(yield* f.api["project.git.state"]({ requestId: freshRequest(), worktreeId: f.source.worktreeId }))
        expect(state).toEqual(final); expect(changes.items).toEqual([])
        session.refreshed("source", original)
        expect(session.attempt?.status).toBe("terminal"); expect(ack).not.toHaveBeenCalled()
        const old = yield* f.api["project.commit"](payload).pipe(Effect.result)
        expect(old).toMatchObject({ _tag: "Failure", failure: { reason: "Git outcome is uncertain; refresh Git state" } })
        expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${payload.requestId}`).toHaveLength(1)
        expect(process.mock.calls.filter((args) => args[1][0] === "commit")).toHaveLength(1)
      } finally { session.close() }
    })).pipe(Effect.orDie))
  } finally { process.mockRestore() }
})

it("releases a durable fixed conflict refusal after real Git effects and preserves its receipt reason", async () => {
  const process = vi.spyOn(GitProcess, "gitProcess")
  try {
    await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
      const f = yield* setup(), team = join(rig.root, "fixed-conflict-team")
      git(f.source.path, "worktree", "add", "-b", "fixed-conflict-team", team)
      const registered = yield* f.api["project.workspace.register"]({ requestId: freshRequest(), repoId: f.repository.repoId, path: team, branch: "fixed-conflict-team", machineId: "local", checkout: "worktree", parentId: f.source.worktreeId })
      yield* f.api["project.team.create"]({ requestId: freshRequest(), projectId: f.project.projectId, name: "Conflicting team", worktreeId: registered.worktreeId })
      save(f.source.path, "file.txt", "destination version\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Destination")
      save(team, "file.txt", "team version\n"); git(team, "add", "--all"); git(team, "commit", "-m", "Team")
      const payload = { requestId: freshRequest(), worktreeId: registered.worktreeId, destinationId: f.source.worktreeId, expectedHead: git(team, "rev-parse", "HEAD") }
      browser.client = f.api; vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
      const session = createGitSession(); session.setMutationDisabled(false)
      const ack = vi.fn(() => "Wrong success")
      try {
        yield* Effect.promise(() => session.execute("team", "Merge", (client) => client["project.integrate"](payload), ack, vi.fn()))
        expect(session.attempt).toBeUndefined(); expect(ack).not.toHaveBeenCalled()
        expect(session.get("team").error).toContain("Git has conflicts"); expect(session.get("team").error).not.toContain("uncertain")
        expect(git(f.source.path, "rev-parse", "MERGE_HEAD")).toBe(payload.expectedHead)
        const sql = yield* SqlClient.SqlClient
        expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${payload.requestId}`).toHaveLength(1)
        expect(yield* f.api["project.integrate"](payload).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "Git: conflicts" } })
        expect(process.mock.calls.filter((args) => args[1].includes("merge"))).toHaveLength(1)
      } finally { session.close() }
    })).pipe(Effect.orDie))
  } finally { process.mockRestore() }
})

it("drops a late real committed reply after controller disposal without acknowledgment or protected state", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "file.txt", "real late effect\n"); git(f.source.path, "add", "--all")
    let release!: () => void, reached!: () => void
    const held = new Promise<void>((resolve) => { release = resolve }), completed = new Promise<void>((resolve) => { reached = resolve })
    const delayedCommit = (payload: Parameters<Client["project.commit"]>[0]) => f.api["project.commit"](payload).pipe(Effect.flatMap((reply) => Effect.tryPromise(() => { reached(); return held.then(() => reply) })))
    browser.client = { ...f.api, "project.commit": delayedCommit as Client["project.commit"] }
    const session = createGitSession(); session.setMutationDisabled(false); session.update("source", { message: "private draft" })
    const ack = vi.fn(() => "Wrong")
    const pending = session.execute("source", "Commit", (client) => client["project.commit"]({ requestId: freshRequest(), worktreeId: f.source.worktreeId, message: "Real late commit" }), ack, vi.fn())
    yield* Effect.promise(() => completed)
    expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("2")
    session.close(); release(); yield* Effect.promise(() => pending)
    expect(ack).not.toHaveBeenCalled(); expect(session.attempt).toBeUndefined(); expect(session.get("source").message).toBe("")
  })).pipe(Effect.orDie))
})

it("retains the exact attempt through failed, unauthorized, incomplete, incoherent and cancelled authoritative reads", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), member = yield* seedAgent({ id: "read-control", parent: f.project.leadAgentId, folder: f.source.path }), agent = yield* connect(member.token)
    save(f.source.path, "file.txt", "one real commit\n"); git(f.source.path, "add", "--all")
    let phase: "ordinary" | "failed" | "unauthorized" | "truncated" | "mismatch" | "held" = "ordinary", reads = 0
    let release!: () => void, heldSignal: AbortSignal | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    const lostCommit = (payload: Parameters<Client["project.commit"]>[0]) => f.api["project.commit"](payload).pipe(Effect.flatMap(() => {
      phase = "failed"; return Effect.fail({ _tag: "CommandError" as const, requestId: payload.requestId, reason: "database read failed" })
    }))
    const boundedChanges = (payload: Parameters<Client["project.changes"]>[0]) => f.api["project.changes"](payload).pipe(Effect.map((reply) => phase === "truncated" && "result" in reply ? { ...reply, result: { ...reply.result, truncated: true } } : reply))
    const api = { ...f.api, "project.changes": boundedChanges as Client["project.changes"], "project.commit": lostCommit as Client["project.commit"], "project.git.state": (payload) => {
      if (phase === "failed") return Effect.fail({ _tag: "CommandError", requestId: payload.requestId, reason: "database read failed" })
      if (phase === "unauthorized") return agent["project.git.state"](payload)
      if (phase === "mismatch" && ++reads === 2) {
        save(f.source.path, "outside.txt", "head changed during reads\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "External change")
      }
      return f.api["project.git.state"](payload).pipe(Effect.flatMap((reply) => phase === "held"
        ? Effect.tryPromise((signal) => { heldSignal = signal; return held.then(() => reply) }) : Effect.succeed(reply)))
    } } as Client
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
    try {
      yield* Effect.promise(() => mounted({ ...f, api }, async (container, _render, session) => {
        await message(container, "Real original body"); await click(container, "Commit 1 file")
        await wait(() => expect(container.textContent).toContain("The Git read failed"))
        const attempt = session.attempt!, key = workspaceKey(f.repository.repoId, "local", f.source.worktreeId)
        expect(attempt.status).toBe("uncertain")
        phase = "unauthorized"; await click(container, "Refresh Git")
        await wait(() => expect(session.get(key).refreshing).toBe(false)); expect(session.attempt).toBe(attempt)
        phase = "truncated"; await click(container, "Refresh Git")
        await wait(() => expect(session.get(key).data?.changes.truncated).toBe(true)); expect(session.attempt).toBe(attempt)
        phase = "mismatch"; await click(container, "Refresh Git")
        await wait(() => expect(session.get(key).refreshing).toBe(false)); expect(reads).toBe(2)
        expect(session.get(key).ready).toBe(false); expect(session.attempt).toBe(attempt)
        phase = "held"; await click(container, "Refresh Git")
        await wait(() => expect(heldSignal).toBeDefined()); expect(session.attempt).toBe(attempt)
        phase = "ordinary"; await _render({ mutationDisabled: true, connection: "Reconnecting" })
        expect(heldSignal?.aborted).toBe(true)
        await _render({ connection: "Live" })
        await wait(() => expect(session.attempt?.status).toBe("terminal"))
        expect(heldSignal?.aborted).toBe(true); expect(session.get(key).notice).toBe("")
        const current = session.get(key).data
        await act(async () => { release(); await Promise.resolve() })
        expect(session.get(key).data).toBe(current)
        expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("3")
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})

it("permits only a fresh owner approval to report reviewed-head containment after a lost merge receipt", async () => {
  const process = vi.spyOn(GitProcess, "gitProcess")
  const session = createGitSession(); session.setMutationDisabled(false)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  let runner!: FakeRunner, f!: Effect.Success<ReturnType<typeof setup>>
  let payload!: Parameters<Client["project.review.approve"]>[0]
  const acknowledgment = vi.fn(() => "Wrong original acknowledgment")
  try {
    await Effect.runPromise(provideBoard(rig, (running) => Effect.gen(function* () {
      runner = running; f = yield* setup(); browser.client = f.api
      save(f.source.path, "reviewed.txt", "reviewed real bytes\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Reviewed feature")
      const prepared = readResult(yield* f.api["project.review.prepare"]({ requestId: freshRequest(), projectId: f.project.projectId, worktreeId: f.source.worktreeId, destinationId: f.workspaces.find((row) => row.checkout === "main")!.worktreeId })).review
      payload = { requestId: freshRequest(), projectId: f.project.projectId, worktreeId: f.source.worktreeId, reviewId: prepared.reviewId,
        expectedHead: prepared.head, expectedBaseHead: prepared.baseHead, confirmed: true, decision: "approve_without_evidence" }
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TRIGGER fail_git_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'lost merge receipt'); END`
      yield* Effect.promise(() => session.execute("source", "Approve reviewed heads", (client) => client["project.review.approve"](payload), acknowledgment, vi.fn()))
      expect(session.attempt?.status).toBe("uncertain"); expect(acknowledgment).not.toHaveBeenCalled()
      expect(git(rig.work, "merge-base", "--is-ancestor", prepared.head, "HEAD")).toBe("")
      expect(readFileSync(join(rig.work, "reviewed.txt"), "utf8")).toBe("reviewed real bytes\n")
      yield* sql`DROP TRIGGER fail_git_receipt`
    })).pipe(Effect.orDie))
    await Effect.runPromise(provideRestart(rig, runner.layer, Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* recover
      const api = yield* connect(), member = yield* seedAgent({ id: "fresh-review-member", parent: f.project.leadAgentId, folder: f.source.path }), agent = yield* connect(member.token); browser.client = api
      const attempt = session.attempt!
      const state = readResult(yield* api["project.git.state"]({ requestId: freshRequest(), worktreeId: f.source.worktreeId }))
      readResult(yield* api["project.changes"]({ requestId: freshRequest(), worktreeId: f.source.worktreeId }))
      expect(readResult(yield* api["project.git.state"]({ requestId: freshRequest(), worktreeId: f.source.worktreeId }))).toEqual(state)
      session.refreshed("source", attempt)
      const old = yield* api["project.review.approve"](payload).pipe(Effect.result)
      expect(old).toMatchObject({ _tag: "Failure", failure: { reason: "Git outcome is uncertain; refresh Git state" } })
      expect(session.get("source").notice).toBe(""); expect(acknowledgment).not.toHaveBeenCalled()
      const denied = yield* agent["project.review.approve"]({ ...payload, requestId: freshRequest() }).pipe(Effect.result)
      expect(denied._tag).toBe("Failure")
      const fresh = { ...payload, requestId: freshRequest() }
      yield* Effect.promise(() => session.execute("source", "Fresh explicit approval", (client) => client["project.review.approve"](fresh), (reply) => {
        expect(reply.result.outcome).toBe("merged"); return "Fresh owner approval confirms reviewed heads are contained"
      }, vi.fn()))
      expect(session.attempt).toBeUndefined(); expect(session.get("source").notice).toContain("Fresh owner approval")
      expect(process.mock.calls.filter((args) => args[1].includes("merge"))).toHaveLength(1)
    })).pipe(Effect.orDie) as Effect.Effect<void>)
  } finally { session.close(); process.mockRestore() }
})

it("keeps an inspected team distinct from execution and refuses a dirty project destination before integrating actual commits", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), path = join(rig.root, "team")
    git(f.source.path, "worktree", "add", "-b", "team", path)
    const registered = yield* f.api["project.workspace.register"]({ requestId: freshRequest(), repoId: f.repository.repoId, path, branch: "team", machineId: "local", checkout: "worktree", parentId: f.source.worktreeId })
    yield* f.api["project.team.create"]({ requestId: freshRequest(), projectId: f.project.projectId, name: "Build team", worktreeId: registered.worktreeId })
    const view = projectView(yield* (yield* Views).snapshot), source = view.workspaces[registered.worktreeId]!
    save(path, "team.txt", "team effect\n"); git(path, "add", "--all"); git(path, "commit", "-m", "Team work")
    save(f.source.path, "dirty.txt", "preserve project edit\n")
    yield* Effect.promise(() => mounted({ ...f, workspaces: Object.values(view.workspaces) }, async (container, render) => {
      const inspect = vi.fn()
      await render({ teams: Object.values(view.teams), inspectedWorkspaceId: source.worktreeId, onInspect: inspect })
      await wait(() => expect(container.querySelector(".integration-state")!.textContent).toContain("destination has uncommitted"))
      expect(button(container, "Merge into project").disabled).toBe(true)
      await click(container, "Inspect destination"); expect(inspect).toHaveBeenCalledWith(f.source.worktreeId)
      expect(container.querySelector(".git-inspecting")!.textContent).toContain("Assigned:")
      expect(readFileSync(join(f.source.path, "dirty.txt"), "utf8")).toBe("preserve project edit\n")
      const initial = git(f.source.path, "rev-parse", "HEAD")
      const { unlinkSync } = await import("node:fs"); unlinkSync(join(f.source.path, "dirty.txt"))
      await click(container, "Refresh Git"); await wait(() => expect(button(container, "Merge into project").disabled).toBe(false))
      await click(container, "Merge into project"); await wait(() => expect(container.textContent).toContain("Merged into"))
      expect(git(f.source.path, "rev-parse", "HEAD")).not.toBe(initial)
      expect(readFileSync(join(f.source.path, "team.txt"), "utf8")).toBe("team effect\n")
      expect(inspect).toHaveBeenCalledTimes(1)
    }))
  })).pipe(Effect.orDie))
})

it("fetches, pushes and fast-forward pulls through the mounted controller against a real temporary bare remote", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), remote = join(rig.root, "remote.git"), clone = join(rig.root, "other-clone")
    git(rig.root, "init", "--bare", "--initial-branch=main", remote); git(f.source.path, "remote", "add", "origin", remote)
    yield* Effect.promise(() => mounted(f, async (container) => {
      await click(container, "Push"); await wait(() => expect(container.textContent).toContain("push completed."))
      expect(git(remote, "rev-parse", `refs/heads/${f.source.branch}`)).toBe(git(f.source.path, "rev-parse", "HEAD"))
      git(rig.root, "clone", "--branch", f.source.branch, remote, clone)
      git(clone, "config", "user.name", "Other fixture"); git(clone, "config", "user.email", "other@example.invalid"); git(clone, "config", "commit.gpgsign", "false")
      save(clone, "remote.txt", "arrived through actual Git fetch and pull\n"); git(clone, "add", "--all"); git(clone, "commit", "-m", "Remote work"); git(clone, "push", "origin", f.source.branch)
      await wait(() => expect(button(container, "Fetch").disabled).toBe(false)); await click(container, "Fetch")
      await wait(() => expect(container.querySelector("#git-sync-state")!.textContent).toContain("1 incoming"))
      await wait(() => expect(button(container, "Pull").disabled).toBe(false)); await click(container, "Pull")
      await wait(() => expect(container.textContent).toContain("pull completed."))
      expect(readFileSync(join(f.source.path, "remote.txt"), "utf8")).toBe("arrived through actual Git fetch and pull\n")
      await wait(() => expect(container.querySelector("#git-sync-state")!.textContent).toContain("0 incoming"))
    }))
  })).pipe(Effect.orDie))
})

it("restores workspace drafts, folders, modes and historical selections while older commits remain read-only", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), historical = git(f.source.path, "rev-parse", "HEAD")
    save(f.source.path, "first.txt", "first\n"); save(f.source.path, "second.txt", "second\n")
    yield* Effect.promise(() => mounted(f, async (container, render, session) => {
      await wait(() => expect(container.querySelectorAll(".source-file")).toHaveLength(2))
      await act(async () => { container.querySelector<HTMLButtonElement>('[data-source-file="second.txt"]')!.click() })
      await message(container, "Source draft"); await click(container, "All files"); await click(container, "Split")
      await act(async () => { container.querySelector<HTMLButtonElement>(".folder-row")!.click() })
      const main = f.workspaces.find((row) => row.checkout === "main")!
      await render({ inspectedWorkspaceId: main.worktreeId }); await wait(() => expect(container.querySelector(".git-pane-head h2")!.textContent).toBe("Main checkout"))
      await message(container, "Different draft")
      await render(); await wait(() => expect(container.querySelector<HTMLTextAreaElement>("#git-message")!.value).toBe("Source draft"))
      expect(button(container, "Split").getAttribute("aria-pressed")).toBe("true"); expect(button(container, "All files").getAttribute("aria-pressed")).toBe("true")
      expect(container.querySelector(".folder-row")!.getAttribute("aria-expanded")).toBe("false")
      expect(session.get(workspaceKey(f.repository.repoId, "local", f.source.worktreeId)).selection?.path).toBe("second.txt")
      await click(container, "History")
      await wait(() => expect(container.querySelector(`[data-source-commit="${historical}"]`)).toBeTruthy())
      await act(async () => { container.querySelector<HTMLButtonElement>(`[data-source-commit="${historical}"]`)!.click() })
      await wait(() => expect(container.querySelector(".git-pane-body")!.textContent).toContain("Read-only"))
      expect(container.querySelector<HTMLTextAreaElement>("#git-message")!.disabled).toBe(true); expect(button(container, "Push").disabled).toBe(true)
      await wait(() => expect(container.querySelector('[data-source-file="file.txt"]')).toBeTruthy())
      await click(container, "Back to changes"); expect(container.querySelector("#diff-path")!.textContent).toBe("All files")
      expect(session.get(workspaceKey(f.repository.repoId, "local", f.source.worktreeId)).selection?.path).toBe("second.txt")
      await click(container, "This file"); await wait(() => expect(container.querySelector("#diff-path")!.textContent).toBe("second.txt"))
      expect(git(f.source.path, "status", "--porcelain")).toContain("?? second.txt")
    }))
  })).pipe(Effect.orDie))
})

for (const status of ["failed", "passed"] as const) it(`shows actual current and stale ${status} evidence and preserves the owner choice while denying agent approval`, async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "feature.txt", "feature\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Feature")
    const head = git(f.source.path, "rev-parse", "HEAD"), member = yield* seedAgent({ id: "reporter", parent: f.project.leadAgentId, folder: f.source.path })
    const [thread] = yield* appendSetup([eventOf({ _tag: "ThreadItem", agentId: member.agentId, itemId: "evidence", content: { _tag: "text", text: "Actual report source" }, replay: false })])
    const agent = yield* connect(member.token)
    for (const kind of ["tests", "review"] as const) yield* f.api["project.review.report"]({ requestId: freshRequest(), projectId: f.project.projectId, worktreeId: f.source.worktreeId, head, kind, status, summary: `${status} report /tool <script>plain data</script>`, threadAgentId: member.agentId, threadSequence: thread!.sequence })
    yield* Effect.promise(() => mounted(f, async (container, _render, session) => {
      await click(container, "Review merge to main")
      await wait(() => expect(container.querySelector("dialog .merge-evidence")!.textContent).toContain(status === "passed" ? "Passed" : "Failed"))
      expect(container.querySelector("dialog script")).toBeNull()
      const link = container.querySelector<HTMLAnchorElement>("dialog .merge-evidence a")!
      expect(link.getAttribute("href")).toBe(`/#/thread/${member.agentId}`); expect(container.querySelector("dialog .merge-evidence")!.textContent).toContain(`Thread item ${thread!.sequence}`)
      const radios = container.querySelectorAll<HTMLInputElement>('input[name="git-review-decision"]')
      expect(radios[status === "passed" ? 0 : 1]!.checked).toBe(true)
      // The real agent credential cannot authorize the owner's recorded heads.
      const prepared = session.get(workspaceKey(f.repository.repoId, "local", f.source.worktreeId)).prepared!.review
      const denied = await Effect.runPromise(agent["project.review.approve"]({ requestId: freshRequest(), projectId: f.project.projectId, worktreeId: f.source.worktreeId,
        reviewId: prepared.reviewId, expectedHead: head, expectedBaseHead: prepared.baseHead, confirmed: true, decision: "approve_without_evidence" }).pipe(Effect.result))
      expect(denied._tag).toBe("Failure"); expect(git(rig.work, "rev-parse", "HEAD")).not.toBe(head)
      save(f.source.path, "later", "make reports stale\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "After reports")
      await click(container, "Refresh Git")
      await click(container, "Prepare a new review"); await wait(() => expect(container.querySelector("dialog .merge-evidence")!.textContent).toContain("Stale report"))
      if (status === "passed") {
        await wait(() => expect(container.querySelector<HTMLInputElement>('input[name="git-review-decision"]')!.matches(":disabled")).toBe(false))
        await act(async () => { container.querySelector<HTMLInputElement>('input[name="git-review-decision"]')!.click() })
        expect(container.querySelector<HTMLInputElement>('input[name="git-review-decision"]')!.checked).toBe(true)
      }
      const label = status === "passed" ? "Approve merge to main" : "Approve without evidence"
      await wait(() => expect(button(container, label).disabled).toBe(false)); await click(container, label)
      await wait(() => expect(container.textContent).toContain("Merged into main"))
      expect(readFileSync(join(rig.work, "later"), "utf8")).toBe("make reports stale\n")
    }))
    const decided = yield* f.api["project.review.status"]({ requestId: freshRequest(), projectId: f.project.projectId, worktreeId: f.source.worktreeId })
    expect("result" in decided && decided.result.review?.decision).toBe(status === "passed" ? "approve" : "approve_without_evidence")
  })).pipe(Effect.orDie))
})

it("probes a real cookie listener's 401 after a real typed refusal and closes protected controller state", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), port = yield* Effect.promise(unusedPort)
    yield* serve({ password: Redacted.make("synthetic-expired-session-password"), staticRoot: rig.stateFolder, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
    const origin = `http://127.0.0.1:${port}`, fetchActual = globalThis.fetch
    const observed: number[] = []
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      const response = await fetchActual(new URL(path, origin), { ...init, headers: { ...init?.headers, Origin: origin } })
      observed.push(response.status); return response
    })
    browser.client = f.api
    const session = createGitSession(); session.setMutationDisabled(false); session.update("source", { message: "private expired draft" })
    const expired = vi.fn(() => session.close()), acknowledged = vi.fn(() => "Committed")
    yield* Effect.promise(() => session.execute("source", "Commit", (client) => client["project.commit"]({ requestId: freshRequest(), worktreeId: f.source.worktreeId, message: "" }), acknowledged, expired))
    expect(observed).toEqual([401]); expect(expired).toHaveBeenCalledOnce(); expect(acknowledged).not.toHaveBeenCalled()
    expect(session.attempt).toBeUndefined(); expect(session.get("source").message).toBe("")
    expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("1")
  })).pipe(Effect.orDie))
})

it("stages an indexed tab rename by its raw identity and keeps unsupported newline names honest and unchanged", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), renamed = "renamed\tfile.txt", unsupported = "newline\nname.txt"
    renameSync(join(f.source.path, "file.txt"), join(f.source.path, renamed)); git(f.source.path, "add", "--all")
    yield* Effect.promise(() => mounted(f, async (container) => {
      await wait(() => expect(container.querySelector(".git-rename")!.textContent).toContain("file.txt"))
      const requests: string[] = [], original = f.api["project.stage"]
      browser.client = { ...f.api, "project.stage": (payload) => { requests.push(payload.path); return original(payload) } }
      save(f.source.path, renamed, "base\n\n"); await click(container, "Refresh Git")
      await click(container, `Stage ${"renamed\\tfile.txt"}`)
      await wait(() => expect(execFileSync("/usr/bin/git", ["-C", f.source.path, "show", `:${renamed}`], { encoding: "utf8" })).toBe("base\n\n"))
      expect(readFileSync(join(f.source.path, renamed), "utf8")).toBe("base\n\n")
      expect(requests).toEqual([renamed])
      await click(container, `Unstage ${"renamed\\tfile.txt"}`)
      await wait(() => expect(git(f.source.path, "diff", "--cached", "--name-only")).toBe(""))
      save(f.source.path, unsupported, "must remain literal\n"); await click(container, "Refresh Git")
      await wait(() => expect(container.textContent).toContain("newline\\nname.txt"))
      await click(container, "Stage newline\\nname.txt")
      await wait(() => expect(container.textContent).toContain("Git refused this path"))
      expect(requests.at(-1)).toBe(unsupported); expect(readFileSync(join(f.source.path, unsupported), "utf8")).toBe("must remain literal\n")
      expect(git(f.source.path, "ls-files", "-z")).not.toContain(unsupported)
    }))
  })).pipe(Effect.orDie))
})

it("refreshes external Git changes on focus and requires a fresh review for a newly observed head", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "feature", "feature\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Feature")
    yield* Effect.promise(() => mounted(f, async (container) => {
      await click(container, "Review merge to main"); await wait(() => expect(button(container, "Approve without evidence").disabled).toBe(false))
      const oldIdentity = container.querySelector(".git-heads dd:last-child")!.textContent
      save(f.source.path, "outside-edit", "observed after focus\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "External head")
      await act(async () => { window.dispatchEvent(new Event("focus")) })
      await wait(() => expect(container.querySelector("dialog")!.textContent).toContain("head changed. Prepare a new review"))
      expect(button(container, "Approve without evidence").disabled).toBe(true)
      expect(container.querySelector(".git-heads dd:last-child")!.textContent).toBe(oldIdentity)
      await click(container, "Prepare a new review"); await wait(() => expect(button(container, "Approve without evidence").disabled).toBe(false))
      expect(container.querySelector(".git-heads dd:last-child")!.textContent).not.toBe(oldIdentity)
      expect(container.querySelector(".git-heads dd")!.textContent).toBe(git(f.source.path, "rev-parse", "HEAD"))
      await click(container, "Approve without evidence"); await wait(() => expect(container.textContent).toContain("Merged into main"))
    }))
  })).pipe(Effect.orDie))
})

it("full12 UI: publishes received sync counts while coherent reads and uncertainty remain held", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), remote = join(rig.root, "received-remote.git"), other = join(rig.root, "received-other")
    git(rig.root, "init", "--bare", "--initial-branch=main", remote)
    git(f.source.path, "remote", "add", "origin", remote); git(f.source.path, "push", "-u", "origin", f.source.branch)
    git(rig.root, "clone", "--branch", f.source.branch, remote, other)
    git(other, "config", "user.name", "Received-state writer"); git(other, "config", "user.email", "received@example.invalid"); git(other, "config", "commit.gpgsign", "false")
    save(other, "incoming.txt", "actual incoming bytes\n"); git(other, "add", "--all"); git(other, "commit", "-m", "Incoming"); git(other, "push", "origin", f.source.branch)
    let hold = false, release!: () => void, heldSignal: AbortSignal | undefined, fetchCalls = 0
    const pending = new Promise<void>((resolve) => { release = resolve })
    const delayedChanges = (payload: Parameters<Client["project.changes"]>[0]) => f.api["project.changes"](payload).pipe(Effect.flatMap((reply) =>
      hold && payload.worktreeId === f.source.worktreeId ? Effect.tryPromise((signal) => { heldSignal = signal; return pending.then(() => reply) }) : Effect.succeed(reply)))
    const lostFetch = (payload: Parameters<Client["project.fetch"]>[0]) => f.api["project.fetch"](payload).pipe(Effect.flatMap(() => {
      fetchCalls++; hold = true
      return Effect.fail({ _tag: "CommandError" as const, requestId: payload.requestId, reason: "database read failed" })
    }))
    const api = { ...f.api, "project.changes": delayedChanges, "project.fetch": lostFetch } as Client
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
    try {
      yield* Effect.promise(() => mounted({ ...f, api }, async (container, _render, session) => {
        const key = workspaceKey(f.repository.repoId, "local", f.source.worktreeId), coherent = session.get(key).data
        expect(coherent?.state.behind).toBe(0)
        await click(container, "Fetch"); await wait(() => expect(heldSignal).toBeDefined())
        const attempt = session.attempt
        expect(attempt?.status).toBe("uncertain")
        expect(container.querySelector("#git-sync-state")!.textContent).toContain("1 incoming")
        expect(container.querySelector("#git-sync-received")!.textContent).toContain("Received Git state")
        expect(session.get(key).data).toBe(coherent)
        expect(session.get(key).ready).toBe(false); expect(session.get(key).detailsReady).toBe(false)
        expect(session.attempt).toBe(attempt)
        for (const name of ["Fetch", "Pull", "Push"]) expect(button(container, name).disabled).toBe(true)
        expect(container.querySelector("#git-notice")).toBeNull(); expect(fetchCalls).toBe(1)
        hold = false; await act(async () => release())
        await wait(() => expect(session.attempt?.status).toBe("terminal"))
        expect(session.get(key).ready).toBe(true); expect(session.get(key).data?.state.behind).toBe(1)
        expect(container.textContent).toContain("does not establish")
        expect(fetchCalls).toBe(1); expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("1")
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})

it("full12 UI: shared completeness preserves the current read and explicit reconnect recovers failed reads", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "one.txt", "real current change\n")
    let hold = false, fail = false, release!: () => void, heldSignal: AbortSignal | undefined, changesCalls = 0, stateCalls = 0
    const pending = new Promise<void>((resolve) => { release = resolve })
    const sourceState = (payload: Parameters<Client["project.git.state"]>[0]) => {
      if (payload.worktreeId === f.source.worktreeId) stateCalls++
      return fail ? Effect.fail({ _tag: "CommandError" as const, requestId: payload.requestId, reason: "database read failed" }) : f.api["project.git.state"](payload)
    }
    const changes = (payload: Parameters<Client["project.changes"]>[0]) => f.api["project.changes"](payload).pipe(Effect.flatMap((reply) => {
      if (!hold || payload.worktreeId !== f.source.worktreeId) return Effect.succeed(reply)
      changesCalls++
      return Effect.tryPromise((signal) => { heldSignal = signal; return pending.then(() => reply) })
    }))
    const api = { ...f.api, "project.git.state": sourceState, "project.changes": changes } as Client
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
    try {
      yield* Effect.promise(() => mounted({ ...f, api }, async (container, render, session) => {
        const key = workspaceKey(f.repository.repoId, "local", f.source.worktreeId)
        await message(container, "Keep this current draft")
        hold = true; await click(container, "Refresh Git"); await wait(() => expect(heldSignal).toBeDefined())
        const firstSignal = heldSignal
        await render({ mutationDisabled: true })
        expect(firstSignal?.aborted).toBe(false); expect(changesCalls).toBe(1)
        expect(button(container, "Stage all").disabled).toBe(true)
        await render()
        expect(firstSignal?.aborted).toBe(false); expect(changesCalls).toBe(1)
        hold = false; await act(async () => release())
        await wait(() => expect(session.get(key).ready).toBe(true))
        expect(session.get(key).message).toBe("Keep this current draft")
        fail = true; await click(container, "Refresh Git")
        await wait(() => expect(container.textContent).toContain("The Git read failed"))
        const failedCalls = stateCalls
        await render({ ...{ connection: "Offline" as const }, mutationDisabled: true })
        expect(stateCalls).toBe(failedCalls)
        fail = false; await render({ ...{ connection: "Live" as const }, mutationDisabled: false })
        await wait(() => expect(session.get(key).ready).toBe(true))
        expect(stateCalls).toBe(failedCalls + 2)
        expect(button(container, "Stage all").disabled).toBe(false)
        expect(session.get(key).message).toBe("Keep this current draft")
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})

it("full12 UI: matching review acknowledgment retains coherent data and still refuses a later stale approval", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "feature.txt", "reviewed bytes\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Feature")
    let release!: () => void, heldSignal: AbortSignal | undefined, sourceReads = 0, approvals = 0
    const pending = new Promise<void>((resolve) => { release = resolve })
    const prepare = (payload: Parameters<Client["project.review.prepare"]>[0]) => f.api["project.review.prepare"](payload).pipe(Effect.flatMap((reply) =>
      Effect.tryPromise((signal) => { heldSignal = signal; return pending.then(() => reply) })))
    const state = (payload: Parameters<Client["project.git.state"]>[0]) => { if (payload.worktreeId === f.source.worktreeId) sourceReads++; return f.api["project.git.state"](payload) }
    const approve = (payload: Parameters<Client["project.review.approve"]>[0]) => { approvals++; return f.api["project.review.approve"](payload) }
    const api = { ...f.api, "project.review.prepare": prepare, "project.git.state": state, "project.review.approve": approve } as Client
    try {
      yield* Effect.promise(() => mounted({ ...f, api }, async (container, render, session) => {
        const key = workspaceKey(f.repository.repoId, "local", f.source.worktreeId)
        await click(container, "Review merge to main"); await wait(() => expect(heldSignal).toBeDefined())
        const coherent = session.get(key).data, revision = session.get(key).revision, reads = sourceReads
        await act(async () => release()); await wait(() => expect(session.attempt).toBeUndefined())
        expect(session.get(key).ready).toBe(true); expect(session.get(key).detailsReady).toBe(true)
        expect(session.get(key).data).toBe(coherent); expect(session.get(key).revision).toBe(revision); expect(sourceReads).toBe(reads)
        expect(button(container, "Approve without evidence").disabled).toBe(false)
        await render({ mutationDisabled: true }); expect(button(container, "Approve without evidence").disabled).toBe(true)
        await render(); expect(button(container, "Approve without evidence").disabled).toBe(false)
        const base = git(rig.work, "rev-parse", "HEAD")
        save(f.source.path, "later.txt", "head changed after preparation\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Later")
        await click(container, "Approve without evidence"); await wait(() => expect(container.textContent).toContain("Merge refused."))
        expect(approvals).toBe(1); expect(git(rig.work, "rev-parse", "HEAD")).toBe(base)
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})

for (const mismatch of ["source head", "destination binding", "incomplete comparison"] as const) it(`full12 UI: rejects a prepared review with ${mismatch}`, async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "feature.txt", "real feature\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Feature")
    const prepare = (payload: Parameters<Client["project.review.prepare"]>[0]) => f.api["project.review.prepare"](payload).pipe(Effect.map((reply) => ({ ...reply, result: {
      ...reply.result,
      review: { ...reply.result.review, ...(mismatch === "source head" ? { head: "0".repeat(40) } : mismatch === "destination binding" ? { destinationId: f.source.worktreeId } : {}) },
      comparison: { ...reply.result.comparison, ...(mismatch === "incomplete comparison" ? { files: { ...reply.result.comparison.files, truncated: true } } : {}) }
    } })))
    const api = { ...f.api, "project.review.prepare": prepare } as Client
    yield* Effect.promise(() => mounted({ ...f, api }, async (container, _render, session) => {
      const key = workspaceKey(f.repository.repoId, "local", f.source.worktreeId), base = git(rig.work, "rev-parse", "HEAD")
      await click(container, "Review merge to main"); await wait(() => expect(session.attempt).toBeUndefined())
      expect(session.get(key).prepared).toBeUndefined()
      expect(container.textContent).toContain("Review response no longer matches")
      expect(button(container, "Approve without evidence").disabled).toBe(true)
      expect(git(rig.work, "rev-parse", "HEAD")).toBe(base)
    }))
  })).pipe(Effect.orDie))
})

it("full12 UI: rejects a late prepared review after a new coherent generation with identical heads", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "feature.txt", "real feature\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Feature")
    let release!: () => void, heldSignal: AbortSignal | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    const prepare = (payload: Parameters<Client["project.review.prepare"]>[0]) => f.api["project.review.prepare"](payload).pipe(Effect.flatMap((reply) =>
      Effect.tryPromise((signal) => { heldSignal = signal; return pending.then(() => reply) })))
    try {
      yield* Effect.promise(() => mounted({ ...f, api: { ...f.api, "project.review.prepare": prepare } as Client }, async (container, _render, session) => {
        const key = workspaceKey(f.repository.repoId, "local", f.source.worktreeId)
        await click(container, "Review merge to main"); await wait(() => expect(heldSignal).toBeDefined())
        const coherent = session.get(key).data
        await click(container, "Refresh Git"); await wait(() => expect(session.get(key).detailsReady).toBe(true))
        expect(session.get(key).data).not.toBe(coherent); expect(session.get(key).data?.state.head).toBe(coherent?.state.head)
        await act(async () => release()); await wait(() => expect(session.attempt).toBeUndefined())
        expect(session.get(key).prepared).toBeUndefined()
        expect(container.textContent).toContain("Review response no longer matches")
        expect(button(container, "Approve without evidence").disabled).toBe(true)
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})

it("full12 UI: a lost preparation reply retains uncertainty and invalidates readiness", async () => {
  await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(); save(f.source.path, "feature.txt", "real feature\n"); git(f.source.path, "add", "--all"); git(f.source.path, "commit", "-m", "Feature")
    let refuseReads = false, release!: () => void, heldSignal: AbortSignal | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    const prepare = (payload: Parameters<Client["project.review.prepare"]>[0]) => f.api["project.review.prepare"](payload).pipe(Effect.flatMap(() => {
      refuseReads = true; return Effect.fail({ _tag: "CommandError" as const, requestId: payload.requestId, reason: "database read failed" })
    }))
    const state = (payload: Parameters<Client["project.git.state"]>[0]) => f.api["project.git.state"](payload).pipe(Effect.flatMap((reply) => refuseReads
      ? Effect.tryPromise((signal) => { heldSignal = signal; return pending.then(() => reply) }) : Effect.succeed(reply)))
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
    try {
      yield* Effect.promise(() => mounted({ ...f, api: { ...f.api, "project.review.prepare": prepare, "project.git.state": state } as Client }, async (container, _render, session) => {
        const key = workspaceKey(f.repository.repoId, "local", f.source.worktreeId)
        await click(container, "Review merge to main"); await wait(() => expect(heldSignal).toBeDefined())
        expect(session.attempt?.status).toBe("uncertain")
        expect(session.get(key).ready).toBe(false); expect(session.get(key).detailsReady).toBe(false)
        expect(session.get(key).prepared).toBeUndefined(); expect(container.querySelector("#git-notice")).toBeNull()
        expect(button(container, "Approve without evidence").disabled).toBe(true)
      }))
    } finally { release() }
  })).pipe(Effect.orDie))
})
