import { randomBytes, createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, symlinkSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import { connectWith } from "@lgtm/client/core"
import { makeNodeSocket } from "@lgtm/client/nodeSocket"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { beforeEach, afterEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { ancestryHeaders } from "../support/socketClient.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { call, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts"
import { approveMockRevision, artifactState, readMockHistory, screenRoute } from "../../../web/src/project/mockRead.ts"
import { advanceSetup, changeSetupSettings, completeSetup, readSetup } from "../../../web/src/project/setupRead.ts"
import { RepositoryRegistration } from "../../../web/src/project/registration.ts"
import type { withClient } from "../../../web/src/thread/client.ts"
import { ClientError, type Client } from "@lgtm/client/browser"
import { LogWriteFailed } from "../../src/log/EventLog.ts"
import type { Fakes } from "../support/handlerRig.ts"
import { freePort, http, login, post, withWeb } from "../support/webRig.ts"
import { provideRestart, recover } from "../support/restartRig.ts"
import * as GitProcess from "../../src/project/git/process.ts"

// Match creation-recovery.test.ts: the restart fixture supplies its services
// at runtime but retains an open environment in its generic test signature.
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) => it.live(name, () => body() as Effect.Effect<unknown, unknown, never>)

let rig: Rig
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  execFileSync("git", ["-C", rig.work, "init", "-b", "main"], { stdio: "ignore" })
  execFileSync("git", ["-C", rig.work, "config", "user.name", "Git suggestion"], { stdio: "ignore" })
  execFileSync("git", ["-C", rig.work, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial"], { stdio: "ignore" })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); removeRig(rig) })

const configured = () => Effect.gen(function* () {
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "sh", displayName: "Explicit owner" } }))
  success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("claude", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(owner, "accounts", { operation: "add", account: { id: "ready", harness: "claude", enabled: true } }))
  success(yield* call(owner, "accounts set-secret", { accountId: "ready", name: "ANTHROPIC_API_KEY", nonce: freshRequest(), value: Redacted.make("controlled-website-test-credential") }))
})
const open = () => Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "website-review.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  return yield* connectWith({ attempts: 1, makeSocket: () => makeNodeSocket(`ws+unix://${socket}:/`, {
    headers: { Authorization: `Bearer ${bearer}`, ...ancestryHeaders() }
  }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) })
})

it.live("validates a component workspace once per read and rechecks every design artifact and branch on the next read", () => Effect.gen(function* () {
  const { CommandHandler } = yield* Effect.promise(() => import("../../src/commands/CommandHandler.ts"))
  const { componentDisplay } = yield* Effect.promise(() => import("../../src/project/display.ts"))
  const { projectView } = yield* Effect.promise(() => import("../../src/project/view.ts"))
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* configured()
    const repoId = success(yield* call(owner, "project.repository.add", { name: "Components", path: rig.work, machineId: "local" })).repoId
    const { projectId } = success(yield* call(owner, "project.create", { name: "Components", goal: "", machineId: "local", repository: { _tag: "existing", repoId }, useWorktree: true }))
    const handler = yield* CommandHandler, view = projectView((yield* handler.input({ _tag: "owner" })).snapshot)
    const project = view.projects[projectId]!, workspace = view.workspaces[project.worktreeId]!
    const files = { "actual.pen": "Registered design", "tokens.json": JSON.stringify({ tokens: [{ name: "ink", value: "#123456" }] }),
      "card.html": "<h1>Registered card</h1>", "other.html": "<h1>Registered sibling</h1>" }
    mkdirSync(join(workspace.path, "design"))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(workspace.path, "design", name), text)
    const revision = success(yield* call(owner, "project.design.record", { projectId, design: { repoId, worktreeId: workspace.worktreeId,
      file: "design/actual.pen", tokensPath: "design/tokens.json", components: [
        { componentId: "card", name: "Card", reference: "design/card.html", fingerprint: hash(files["card.html"]) },
        { componentId: "other", name: "Other", reference: "design/other.html", fingerprint: hash(files["other.html"]) }
      ] } }))
    const input = yield* handler.input({ _tag: "owner" }), selection = { repoId, revisionId: revision.revisionId, componentId: "card" }
    const process = vi.spyOn(GitProcess, "gitProcess")
    try {
      expect((yield* componentDisplay(input, selection)).text).toBe(files["card.html"])
      // Repeated registration/state probes previously launched 60 Git
      // children for this single read. Keep its work bounded independently of
      // how many sibling artifacts the registered revision contains.
      expect(process.mock.calls.length).toBeLessThan(30)
      for (const [name, text] of Object.entries(files)) {
        writeFileSync(join(workspace.path, "design", name), "Changed evidence")
        expect((yield* componentDisplay(input, selection).pipe(Effect.result))._tag).toBe("Failure")
        writeFileSync(join(workspace.path, "design", name), text)
        expect((yield* componentDisplay(input, selection)).text).toBe(files["card.html"])
      }
      execFileSync("git", ["-C", workspace.path, "branch", "-m", "changed-branch"])
      expect((yield* componentDisplay(input, selection).pipe(Effect.result))._tag).toBe("Failure")
      execFileSync("git", ["-C", workspace.path, "branch", "-m", workspace.branch])
      unlinkSync(join(workspace.path, "design/card.html"))
      symlinkSync(join(workspace.path, "design/other.html"), join(workspace.path, "design/card.html"))
      expect((yield* componentDisplay(input, selection).pipe(Effect.result))._tag).toBe("Failure")
      unlinkSync(join(workspace.path, "design/card.html"))
      writeFileSync(join(workspace.path, "design/card.html"), files["card.html"])
      expect((yield* componentDisplay(input, selection)).text).toBe(files["card.html"])
      expect((yield* componentDisplay({ ...input, actor: { _tag: "agent", agentId: project.leadAgentId } }, selection).pipe(Effect.result))._tag).toBe("Failure")
    } finally { process.mockRestore() }
  }))
}))

it.live("uses setup page helpers over authenticated RPC and retains durable completion after archiving its real created project", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configured()
    const client = yield* open()
    const first = yield* readSetup(client)
    expect(first.setup).toEqual({ step: "welcome" })
    expect(first.settings?.displayName).toBe("Explicit owner")
    expect(first.discovery.ownerNameSuggestion).toBe("Git suggestion")
    expect(first.discovery.harnesses.find((row) => row.harness === "claude")?.accounts).toEqual([{ accountId: "ready", state: "local-credential", remoteAuthentication: "not-checked" }])
    yield* advanceSetup(client, "found"); yield* advanceSetup(client, "project"); yield* advanceSetup(client, "welcome")
    expect((yield* readSetup(client)).setup.step).toBe("project")
    yield* changeSetupSettings(client, { shell: "zsh" })
    expect((yield* readSetup(client)).settings?.displayName).toBe("Explicit owner")
    const missing = yield* completeSetup(client, { requestId: freshRequest(), projectId: "missing" as never }).pipe(Effect.result)
    expect(missing._tag).toBe("Failure")
    const created = yield* client["project.create"]({ requestId: freshRequest(), name: "First", goal: "", machineId: "local", repository: { _tag: "new", name: "First repository" }, useWorktree: true })
    const attempt = { requestId: freshRequest(), projectId: created.projectId }
    const done = yield* completeSetup(client, attempt)
    expect(done.completedAt).toBeGreaterThan(0)
    expect(yield* completeSetup(client, attempt)).toEqual(done)
    yield* client["project.archive"]({ requestId: freshRequest(), projectId: created.projectId })
    expect((yield* readSetup(client)).setup).toEqual(done)
    expect((yield* readLog).filter((row) => row.event._tag === "project.SetupCompleted")).toHaveLength(1)
    expect(runner.callsOf("start")).toHaveLength(1)
  }))
}))

it.live("reviews real current artifacts without treating historical metadata as stored bytes and approves one exact current revision", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configured()
    const client = yield* open()
    const repoId = (yield* client["project.repository.add"]({ requestId: freshRequest(), name: "Product", path: rig.work, machineId: "local" })).repoId
    const { projectId } = yield* client["project.create"]({ requestId: freshRequest(), name: "Review", goal: "Review actual bytes", machineId: "local", repository: { _tag: "existing", repoId }, useWorktree: true })
    const projects = yield* client["project.read"]({ requestId: freshRequest(), projectId, collection: "projects" })
    if (!("items" in projects)) throw new Error("Owner projects must be structured")
    const project = projects.items.find((row) => "leadAgentId" in row && row.projectId === projectId)
    if (project === undefined || !("worktreeId" in project)) throw new Error("Created project is unavailable")
    const worktreeId = project.worktreeId
    const { CommandHandler } = yield* Effect.promise(() => import("../../src/commands/CommandHandler.ts"))
    const { projectView } = yield* Effect.promise(() => import("../../src/project/view.ts"))
    const handler = yield* CommandHandler
    const folder = projectView((yield* handler.input({ _tag: "owner" })).snapshot).workspaces[worktreeId]!.path
    writeFileSync(join(folder, "screen.html"), "<h1>Recorded screen</h1>")
    writeFileSync(join(folder, "tokens.json"), JSON.stringify({ tokens: [{ name: "ink", value: "#123456" }] }))
    writeFileSync(join(folder, "design.fig"), "registered-design-bytes")
    const design = yield* client["project.design.record"]({ requestId: freshRequest(), projectId, design: { repoId, worktreeId, file: "design.fig", tokensPath: "tokens.json", components: [] } })
    const bundle = { sources: [{ sourceId: "screen" as never, worktreeId, path: "screen.html", kind: "screens" as const }],
      screens: [{ screenId: "home" as never, sourceId: "screen" as never, name: "Home", route: "/home", scenarioRoutes: [{ scenarioId: "empty" as never, route: "/home?case=empty" }] }],
      scenarios: [{ scenarioId: "empty" as never, name: "Empty", description: "An exact typed scenario" }], draftedFields: [], components: [], designRevision: design.revisionId }
    const first = yield* client["project.mocks.record"]({ requestId: freshRequest(), projectId, bundle })
    const history = yield* readMockHistory(client, projectId)
    expect(history.complete).toBe(true); expect(history.items).toHaveLength(1)
    const row = history.items[0]!
    expect(screenRoute(row, "home", "empty")).toBe("/home?case=empty")
    expect(screenRoute(row, "home", "unknown")).toBeUndefined()
    writeFileSync(join(folder, "screen.html"), "<script>parent.document.body.remove()</script>")
    const changed = yield* client["project.mocks.artifact"]({ requestId: freshRequest(), projectId, revisionId: first.revisionId, sourceId: "screen" as never })
    if (!("result" in changed)) throw new Error("Owner artifact must be structured")
    expect(artifactState(row, "screen", changed.result)).toBe("stale")
    expect(changed.result._tag === "available" && changed.result.fingerprint).toBe(hash("<script>parent.document.body.remove()</script>"))
    const refused = yield* approveMockRevision(client, projectId, first.revisionId, freshRequest())
    expect(refused.state).toBe("refused")
    unlinkSync(join(folder, "screen.html"))
    const gone = yield* client["project.mocks.artifact"]({ requestId: freshRequest(), projectId, revisionId: first.revisionId, sourceId: "screen" as never })
    expect(gone).toMatchObject({ result: { _tag: "unavailable" } })
    expect((yield* readMockHistory(client, projectId)).items[0]).toEqual(row)
    writeFileSync(join(folder, "screen.html"), "<h1>New revision</h1>")
    const second = yield* client["project.mocks.record"]({ requestId: freshRequest(), projectId, expectedRevision: first.revisionId, bundle })
    expect((yield* approveMockRevision(client, projectId, first.revisionId, freshRequest())).state).toBe("stale")
    const approvalId = freshRequest()
    expect((yield* approveMockRevision(client, projectId, second.revisionId, approvalId)).state).toBe("approved")
    expect((yield* approveMockRevision(client, projectId, second.revisionId, approvalId)).state).toBe("approved")
    const log = yield* readLog
    expect(log.filter((event) => event.event._tag === "project.MockApproved")).toHaveLength(1)
    const registered = yield* client["project.design.read"]({ requestId: freshRequest(), repoId, revisionId: design.revisionId })
    expect(registered).toMatchObject({ result: { _tag: "registered", record: { design: { file: "design.fig", repoId, worktreeId } }, file: { _tag: "available" }, tokens: { _tag: "available", tokens: [{ name: "ink", value: "#123456" }] } } })
    writeFileSync(join(folder, "design.fig"), "changed")
    expect(yield* client["project.design.read"]({ requestId: freshRequest(), repoId, revisionId: design.revisionId })).toMatchObject({ result: { _tag: "registered", file: { _tag: "unavailable" }, record: { revisionId: design.revisionId } } })
  }))
}))

it.live("recovers one actual repository registration after controlled acknowledgement loss and keeps its frozen request across Cancel", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configured()
    const client = yield* open()
    const attempts: string[] = []
    let drop = true
    // The real command and readback complete first. This test-only observer
    // suppresses the first operation result, without replacing an RPC method,
    // Git, or receipts. It does not claim an actual broken network transport.
    const run: typeof withClient = (operation, signal) => {
      attempts.push(session.getSnapshot().attempt!.payload.requestId)
      return Effect.runPromise(operation(client).pipe(Effect.flatMap((value) => {
        if (drop) { drop = false; return Effect.fail(new ClientError({ message: "controlled acknowledgement loss" })) }
        return Effect.succeed(value)
      })), { signal })
    }
    const session = new RepositoryRegistration(() => { throw new Error("unexpected expiry") }, run)
    session.open({ path: rig.work }); session.update({ name: "Actual checkout" })
    yield* Effect.promise(() => session.submit())
    expect(session.getSnapshot().phase).toBe("uncertain")
    const frozen = session.getSnapshot().attempt
    session.close(); session.open({ path: rig.outside }); session.update({ name: "Must not replace request", path: rig.outside })
    expect(session.getSnapshot().attempt).toEqual(frozen)
    expect(session.getSnapshot().path).toBe(rig.work)
    yield* Effect.promise(() => session.submit())
    expect(session.getSnapshot().phase).toBe("registered")
    expect(session.getSnapshot().result).toMatchObject({ name: "Actual checkout", path: rig.work })
    expect(attempts).toHaveLength(2); expect(attempts[0]).toBe(attempts[1])
    const repositories = yield* client["project.repositories"]({ requestId: freshRequest() })
    expect(repositories.items).toEqual([session.getSnapshot().result])
    expect((yield* readLog).filter((row) => row.event._tag === "project.RepositoryAdded")).toHaveLength(1)
    session.dispose(); expect(session.getSnapshot()).toMatchObject({ name: "", path: "", open: false, phase: "editing" })
    yield* Effect.promise(() => session.submit()); expect(attempts).toHaveLength(2)
  }))
}))

for (const operation of ["add", "locate"] as const) for (const boundary of ["before append", "after commit"] as const) live(`retains ${operation} registration identity after an actual typed database CommandError ${boundary}`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let once = true, armed = false
  let client: Client, session: RepositoryRegistration, baseline = 0
  const attempts: string[] = []
  const run: typeof withClient = (action, signal) => {
    attempts.push(session.getSnapshot().attempt!.payload.requestId)
    return Effect.runPromise(action(client), { signal })
  }
  const eventTag = operation === "add" ? "project.RepositoryAdded" : "project.RepositoryLocated"
  // A named fault at the real writer boundary. SQL, Git, receipt lookup,
  // authorization and the public CommandError encoder remain production code.
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => {
    let registration = false
    return real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
      if (armed && once && events.some((event) => event._tag === eventTag)) {
        registration = true
        if (boundary === "before append") { once = false; return Effect.fail(new LogWriteFailed({ reason: "database write failed" })) }
      }
      return append(actor, id, hash, events, rows, receipt)
    })).pipe(Effect.flatMap((value) => {
      if (registration && once && boundary === "after commit") { once = false; return Effect.fail(new LogWriteFailed({ reason: "database write failed" })) }
      return Effect.succeed(value)
    }))
  } })
  const previous = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configured()
    client = yield* open()
    if (operation === "locate") yield* client["project.repository.add"]({ requestId: freshRequest(), name: "Database recovery", path: rig.work, machineId: "local" })
    const repository = (yield* client["project.repositories"]({ requestId: freshRequest() })).items[0]
    baseline = (yield* readLog).filter((row) => row.event._tag === eventTag).length
    armed = true
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 }))) // Controlled session probe only.
    session = new RepositoryRegistration(() => { throw new Error("unexpected expiry") }, run)
    session.open({ ...(repository === undefined ? {} : { repository }), path: rig.work }); session.update({ name: "Database recovery" })
    yield* Effect.promise(() => session.submit())
    expect(session.getSnapshot().phase).toBe("uncertain")
    const frozen = session.getSnapshot().attempt
    expect(frozen).toBeDefined()
    expect((yield* readLog).filter((row) => row.event._tag === eventTag)).toHaveLength(baseline + (boundary === "after commit" ? 1 : 0))
    session.close(); session.open({ path: rig.outside }); session.update({ path: rig.outside })
    expect(session.getSnapshot().attempt).toEqual(frozen)
    yield* Effect.promise(() => session.submit())
    expect(attempts[1]).toBe(attempts[0]); expect(attempts).toHaveLength(2)
    if (boundary === "before append") {
      // A real writer failure latches this runtime. The request must survive
      // another refusal until the service restarts; never reset that latch.
      expect(session.getSnapshot()).toMatchObject({ phase: "uncertain", attempt: frozen })
      expect((yield* readLog).filter((row) => row.event._tag === eventTag)).toHaveLength(baseline)
      return { session, client, frozen }
    }
    expect(session.getSnapshot()).toMatchObject({ phase: "registered", result: { name: "Database recovery", path: rig.work } })
    expect((yield* readLog).filter((row) => row.event._tag === eventTag)).toHaveLength(baseline + 1)
    expect((yield* readLog).filter((row) => row.event._tag === "project.RepositoryAdded")).toHaveLength(1)
    session.dispose()
    return { session, client, frozen }
  }))
  if (boundary === "before append") yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    client = yield* open()
    expect(client).not.toBe(previous.client)
    expect(session).toBe(previous.session)
    expect(session.getSnapshot().phase).toBe("uncertain")
    expect(session.getSnapshot().attempt).toEqual(previous.frozen)
    yield* Effect.promise(() => session.submit())
    expect(attempts).toHaveLength(3); expect(new Set(attempts).size).toBe(1)
    expect(session.getSnapshot()).toMatchObject({ phase: "registered", result: { name: "Database recovery", path: rig.work } })
    expect((yield* readLog).filter((row) => row.event._tag === eventTag)).toHaveLength(baseline + 1)
    expect((yield* readLog).filter((row) => row.event._tag === "project.RepositoryAdded")).toHaveLength(1)
    session.dispose()
  }), { secrets })
}))

for (const operation of ["add", "locate"] as const) it.live(`unlocks ${operation} only after a conclusive Git admission refusal and submits a corrected checkout with a new request`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configured()
    const client = yield* open(), attempts: string[] = []
    if (operation === "locate") yield* client["project.repository.add"]({ requestId: freshRequest(), name: "Corrected checkout", path: rig.work, machineId: "local" })
    const repository = (yield* client["project.repositories"]({ requestId: freshRequest() })).items[0]
    const baseline = (yield* readLog).filter((row) => row.event._tag === "project.RepositoryLocated").length
    const run: typeof withClient = (action, signal) => {
      attempts.push(session.getSnapshot().attempt!.payload.requestId)
      return Effect.runPromise(action(client), { signal })
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 }))) // Controlled session probe only.
    const session = new RepositoryRegistration(() => { throw new Error("unexpected expiry") }, run)
    session.open({ ...(repository === undefined ? {} : { repository }), path: rig.outside }); session.update({ name: "Corrected checkout" })
    yield* Effect.promise(() => session.submit())
    expect(session.getSnapshot()).toMatchObject({ phase: "refused", attempt: undefined })
    expect((yield* readLog).filter((row) => row.event._tag === "project.RepositoryLocated")).toHaveLength(baseline)
    expect((yield* readLog).filter((row) => row.event._tag === "CommandRefused").at(-1)?.event).toMatchObject({ reason: "Git: invalid_path" })
    session.update({ path: rig.work }); yield* Effect.promise(() => session.submit())
    expect(attempts).toHaveLength(2); expect(attempts[1]).not.toBe(attempts[0])
    expect(session.getSnapshot()).toMatchObject({ phase: "registered", result: { path: rig.work } })
    expect((yield* readLog).filter((row) => row.event._tag === "project.RepositoryLocated")).toHaveLength(baseline + 1)
    session.dispose()
  }))
}))

it("clears registration private state when a real typed admission refusal is followed by actual web logout", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx)
  const client = yield* connectWith({ attempts: 1, makeSocket: () => makeNodeSocket(`ws://${ctx.host}/api`, {
    headers: { Host: ctx.host, Origin: ctx.origin, Cookie: cookie }
  }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) })
  let expired = 0, calls = 0
  // Adapt the browser's relative session URL to the real test HTTP listener.
  // This forwards a real cookie and response, rather than supplying a canned 401.
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe("/api/session"); expect(options.method).toBe("POST")
    const reply = await post(ctx, "/api/session", undefined, { Cookie: cookie })
    return new Response(null, { status: reply.status })
  }))
  const run: typeof withClient = (operation, signal) => {
    calls++
    return Effect.runPromise(operation(client).pipe(Effect.tap(() => Effect.promise(async () => {
      // Deterministic boundary after the actual typed CommandError was read.
      expect((await post(ctx, "/api/logout", undefined, { Cookie: cookie })).status).toBe(204)
    }))), { signal })
  }
  const session = new RepositoryRegistration(() => { expired++ }, run)
  session.open({ path: ctx.rig.outside }); session.update({ name: "Private owner draft" })
  yield* Effect.promise(() => session.submit())
  expect(expired).toBe(1)
  expect(session.getSnapshot()).toMatchObject({ name: "", path: "", open: false, phase: "editing" })
  expect(session.getSnapshot().attempt).toBeUndefined()
  session.open({ path: ctx.rig.work }); yield* Effect.promise(() => session.submit())
  expect(calls).toBe(1)
})))


it.live("admits exact recorded preview bytes and a dedicated registered design folder through the actual engine", () => Effect.gen(function* () {
  const { CommandHandler } = yield* Effect.promise(() => import("../../src/commands/CommandHandler.ts"))
  const { mockDisplay, designDisplay } = yield* Effect.promise(() => import("../../src/project/display.ts"))
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* configured()
    const client = yield* open()
    const repoId = (yield* client["project.repository.add"]({ requestId: freshRequest(), name: "Display", path: rig.work, machineId: "local" })).repoId
    const { projectId } = yield* client["project.create"]({ requestId: freshRequest(), name: "Display", goal: "", machineId: "local", repository: { _tag: "existing", repoId }, useWorktree: true })
    const handler = yield* CommandHandler
    let input = yield* handler.input({ _tag: "owner" })
    const { projectView } = yield* Effect.promise(() => import("../../src/project/view.ts"))
    const project = projectView(input.snapshot).projects[projectId]!
    const folder = projectView(input.snapshot).workspaces[project.worktreeId]!.path
    mkdirSync(join(folder, "screens")); mkdirSync(join(folder, "design"))
    writeFileSync(join(folder, "screens/home.html"), '<link rel="stylesheet" href="theme.css"><h1>Actual display</h1>')
    writeFileSync(join(folder, "screens/theme.css"), 'h1 { color: #123456 }')
    writeFileSync(join(folder, "design/actual.fig"), "actual design evidence")
    const design = yield* client["project.design.record"]({ requestId: freshRequest(), projectId,
      design: { repoId, worktreeId: project.worktreeId, file: "design/actual.fig", components: [] } })
    const revision = yield* client["project.mocks.record"]({ requestId: freshRequest(), projectId,
      bundle: { sources: [{ sourceId: "page" as never, worktreeId: project.worktreeId, path: "screens/home.html", kind: "screens" }],
        screens: [{ screenId: "home" as never, sourceId: "page" as never, name: "Home", route: "/home", scenarioRoutes: [{ scenarioId: "empty" as never, route: "/home?state=empty" }] }],
        scenarios: [{ scenarioId: "empty" as never, name: "Empty", description: "Actual supported state" }], draftedFields: [], components: [] } })
    input = yield* handler.input({ _tag: "owner" })
    const selection = { projectId, revisionId: revision.revisionId, screenId: "home", scenarioId: "empty" }
    const preview = yield* mockDisplay(input, selection)
    expect(preview.route).toBe("/home?state=empty")
    expect(preview.text).toContain('<link rel="stylesheet" href="theme.css">')
    expect(preview.folder).toBe(join(folder, "screens"))
    const { displayConfiguration } = yield* Effect.promise(() => import("../../src/client/web/display/policy.ts"))
    const { makeDisplaySessions } = yield* Effect.promise(() => import("../../src/client/web/display/sessions.ts"))
    const { makeMockRenderer } = yield* Effect.promise(() => import("../../src/client/web/display/renderer.ts"))
    const configuration = displayConfiguration("https://lgtm.example", "https://design.example", 4123)
    const sessions = makeDisplaySessions(configuration, () => {}) // Named test-only frame-secret observer.
    const frame = sessions.issue({ kind: "mock", selection })
    const frameUrl = frame.mockUrl(preview.route)
    const renderer = makeMockRenderer({ configuration, sessions, input: () => Effect.runPromise(handler.input({ _tag: "owner" })) })
    const rendered = yield* Effect.promise(() => renderer({ url: frameUrl, method: "GET", headers: { host: "design.example" } }))
    expect(rendered.status).toBe(200)
    expect(preview.text).toBe(readFileSync(join(folder, "screens/home.html"), "utf8"))
    expect(Buffer.from(rendered.body).toString() === `<link rel="stylesheet" href="${new URL(frame.base).pathname}theme.css"><h1>Actual display</h1>`).toBe(true)
    const redirected = yield* Effect.promise(() => renderer({ url: "/theme.css", method: "GET", headers: { host: "design.example", referer: frameUrl } }))
    expect(redirected.status).toBe(307)
    const styled = yield* Effect.promise(() => renderer({ url: redirected.headers.location!, method: "GET", headers: { host: "design.example" } }))
    expect(styled.status).toBe(200)
    expect(Buffer.from(styled.body).toString()).toBe('h1 { color: #123456 }')
    sessions.revoke(frame.id)
    expect((yield* Effect.promise(() => renderer({ url: frameUrl, method: "GET", headers: { host: "design.example" } }))).status).toBe(401)

    const editor = yield* designDisplay(input, { repoId, revisionId: design.revisionId })
    expect(editor).toMatchObject({ projectId, repoId, folder: join(folder, "design"), file: "actual.fig", fingerprint: hash("actual design evidence") })
    expect((yield* mockDisplay(input, { ...selection, scenarioId: "unsupported" }).pipe(Effect.result))._tag).toBe("Failure")
    expect((yield* mockDisplay({ ...input, actor: { _tag: "agent", agentId: project.leadAgentId } }, selection).pipe(Effect.result))._tag).toBe("Failure")
    writeFileSync(join(folder, "screens/home.html"), "changed current mock")
    expect((yield* mockDisplay(input, selection).pipe(Effect.result))._tag).toBe("Failure")
    writeFileSync(join(folder, "design/actual.fig"), "changed current design")
    expect((yield* designDisplay(input, { repoId }).pipe(Effect.result))._tag).toBe("Failure")
    writeFileSync(join(folder, "root.fig"), "root evidence")
    yield* client["project.design.record"]({ requestId: freshRequest(), projectId, expectedRevision: design.revisionId,
      design: { repoId, worktreeId: project.worktreeId, file: "root.fig", components: [] } })
    expect((yield* designDisplay(yield* handler.input({ _tag: "owner" }), { repoId }).pipe(Effect.result))._tag).toBe("Failure")
  }))
}))

for (const addressing of ["root-relative", "relative"] as const) it.live(`serves recorded ${addressing} stylesheet, module and image addresses over actual display HTTP without Referer or cookies`, () => Effect.gen(function* () {
  const { CommandHandler } = yield* Effect.promise(() => import("../../src/commands/CommandHandler.ts"))
  const { serveDisplay } = yield* Effect.promise(() => import("../../src/client/web/display/service.ts"))
  const { displayConfiguration } = yield* Effect.promise(() => import("../../src/client/web/display/policy.ts"))
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* configured()
    const client = yield* open()
    const repoId = (yield* client["project.repository.add"]({ requestId: freshRequest(), name: "Resource addresses", path: rig.work, machineId: "local" })).repoId
    const { projectId } = yield* client["project.create"]({ requestId: freshRequest(), name: "Resource addresses", goal: "", machineId: "local", repository: { _tag: "existing", repoId }, useWorktree: true })
    const handler = yield* CommandHandler
    const { projectView } = yield* Effect.promise(() => import("../../src/project/view.ts"))
    const project = projectView((yield* handler.input({ _tag: "owner" })).snapshot).projects[projectId]!
    const folder = projectView((yield* handler.input({ _tag: "owner" })).snapshot).workspaces[project.worktreeId]!.path
    // The original browser fixture remains exactly root-relative. The second
    // control adds ordinary relative addresses and a nested selected route.
    const document = addressing === "root-relative"
      ? '<!doctype html><title>Recorded actual mock</title><link rel="stylesheet" href="/style.css"><h1>Registered mock pixels</h1><img alt="Recorded companion" src="/mark.svg"><script type="module" src="/companion.js"></script>'
      : '<!doctype html><link rel="stylesheet" href="assets/style.css?a=1&amp;b=2"><h1>Registered mock pixels</h1><img src="./草稿 design.svg"><script type="module" src="companion.js"></script>'
    const css = 'body{background:rgb(246,248,245);color:rgb(37,59,46)}h1{border:8px solid rgb(255,132,0)}img{width:80px;height:80px}'
    const image = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#285e43"/><circle cx="40" cy="40" r="22" fill="#ff8400"/></svg>'
    const module = 'document.body.dataset.moduleLoaded="yes"'
    const paths = addressing === "root-relative" ? ["style.css", "mark.svg", "companion.js"] : ["pages/assets/style.css", "pages/草稿 design.svg", "pages/companion.js"]
    const files = [["screen.html", document], [paths[0]!, css], [paths[1]!, image], [paths[2]!, module]] as const
    for (const [path, text] of files) {
      const target = join(folder, "screens", path)
      mkdirSync(join(target, ".."), { recursive: true }); writeFileSync(target, text)
    }
    writeFileSync(join(folder, "outside.css"), "outside registered folder")
    symlinkSync(join(folder, "outside.css"), join(folder, "screens/linked.css"))
    writeFileSync(join(folder, "screens/.env.css"), "private name")
    const route = addressing === "root-relative" ? "/home?state=empty" : "/pages/home?state=empty"
    const revision = yield* client["project.mocks.record"]({ requestId: freshRequest(), projectId,
      bundle: { sources: [{ sourceId: "page" as never, worktreeId: project.worktreeId, path: "screens/screen.html", kind: "screens" }],
        screens: [{ screenId: "home" as never, sourceId: "page" as never, name: "Home", route, scenarioRoutes: [] }],
        scenarios: [], draftedFields: [], components: [] } })
    const originalLog = hash(JSON.stringify(yield* readLog))
    yield* Effect.promise(async () => {
      const port = await freePort(), origin = "https://design.example"
      const endpoint = { host: "design.example", origin: "null", settings: { enabled: true, port, heartbeatSeconds: 5, proxyMode: true } }
      let now = Date.now()
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
      let cleanupFailures = 0
      // The usual rig's fake harness/secrets and pass-through redactor remain
      // disclosed. These are real engine reads and the production listener;
      // this is HTTP proof, not browser execution or HTTPS proxy proof.
      let service: Awaited<ReturnType<typeof serveDisplay>> | undefined
      try {
        service = await serveDisplay({ configuration: displayConfiguration("https://lgtm.example", origin, port),
          image: "sha256:" + "0".repeat(64), dockerSocket: "/not-used-by-mocks.sock",
          input: () => Effect.runPromise(handler.input({ _tag: "owner" })), registerSecret: () => {},
          onCleanupFailure: () => { cleanupFailures++ } })
        const selection = { _tag: "mock" as const, projectId, revisionId: revision.revisionId, screenId: "home" }
        const frame = await service.open(selection)
        const url = new URL(frame.url)
        const response = await http(endpoint, url.pathname + url.search)
        expect(response.status).toBe(200)
        expect(response.headers["content-security-policy"]).toContain("sandbox allow-scripts;")
        expect(response.headers["content-security-policy"]).not.toContain("allow-same-origin")
        expect(response.headers["referrer-policy"]).toBe("same-origin")
        expect(response.headers["set-cookie"]).toBeUndefined()
        expect(response.body !== document).toBe(true)
        const addresses = [...response.body.matchAll(/(?:href|src)="([^"]+)"/gu)].map((match) => match[1]!.replaceAll("&amp;", "&"))
        expect(addresses.length).toBe(3)
        for (const [index, address] of addresses.entries()) {
          const parsed = new URL(address, origin)
          expect(parsed.origin === origin).toBe(true)
          expect(parsed.pathname.startsWith("/session/")).toBe(true)
          expect(decodeURIComponent(parsed.pathname.split("/").slice(3).join("/")) === paths[index]).toBe(true)
          if (addressing === "relative" && index === 0) expect(parsed.search).toBe("?a=1&b=2")
          const resource = await http(endpoint, parsed.pathname + parsed.search)
          expect(resource.status).toBe(200)
          expect(resource.body).toBe(files[index + 1]![1])
          expect(resource.headers["access-control-allow-origin"]).toBe("*")
          expect(resource.headers["set-cookie"]).toBeUndefined()
        }
        const scoped = addresses[0]!.split("/").slice(0, 3).join("/")
        for (const path of ["../outside.css", "%2e%2e/outside.css", "nested%2foutside.css", "%252e%252e/outside.css", "linked.css", ".env.css"]) {
          expect((await http(endpoint, scoped + "/" + path)).status).toBe(404)
        }
        expect((await http(endpoint, addresses[0]!, { headers: { Cookie: "lgtm_session=refused" } })).status).toBe(403)
        expect((await http(endpoint, addresses[0]!, { headers: { Authorization: "Bearer refused" } })).status).toBe(403)
        expect((await http(endpoint, addresses[0]!, { headers: { Host: "lgtm.example" } })).status).toBe(403)
        expect((await http(endpoint, addresses[0]!, { method: "HEAD" })).body).toBe("")
        const other = await service.open(selection)
        await service.closeSession(frame.id)
        expect((await http(endpoint, addresses[0]!)).status).toBe(401)
        const otherUrl = new URL(other.url)
        expect((await http(endpoint, otherUrl.pathname + otherUrl.search)).status).toBe(200)
        now += 10 * 60_000
        expect((await http(endpoint, otherUrl.pathname + otherUrl.search)).status).toBe(503)
        // The unscoped document query cannot dispatch an expired mock and
        // reaches the unchanged no-editor fallback. Its scoped assets refuse.
        const otherScope = "/session/" + otherUrl.searchParams.get("__lgtm_display_session")
        expect((await http(endpoint, otherScope + "/" + paths[0]!)).status).toBe(401)
      } finally { try { await service?.close() } finally { clock.mockRestore() } }
      expect(cleanupFailures).toBe(0)
    })
    for (const [path, text] of files) expect(readFileSync(join(folder, "screens", path), "utf8")).toBe(text)
    expect(hash(JSON.stringify(yield* readLog))).toBe(originalLog)
  }))
}))

for (const boundary of ["before append", "after commit"] as const) live(`retains exact mock approval through a real typed database CommandError ${boundary}`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let armed = false, once = true
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => {
    let approving = false
    return real.transact((append) => use((actor, requestId, bodyHash, events, rows, receipt) => {
      if (armed && once && events.some((event) => event._tag === "project.MockApproved")) {
        approving = true
        if (boundary === "before append") { once = false; return Effect.fail(new LogWriteFailed({ reason: "database write failed" })) }
      }
      return append(actor, requestId, bodyHash, events, rows, receipt)
    })).pipe(Effect.flatMap((result) => {
      if (approving && once && boundary === "after commit") { once = false; return Effect.fail(new LogWriteFailed({ reason: "database write failed" })) }
      return Effect.succeed(result)
    }))
  } })
  const previous = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configured()
    const client = yield* open()
    const repoId = (yield* client["project.repository.add"]({ requestId: freshRequest(), name: "Approval recovery", path: rig.work, machineId: "local" })).repoId
    const { projectId } = yield* client["project.create"]({ requestId: freshRequest(), name: "Approval recovery", goal: "", machineId: "local", repository: { _tag: "existing", repoId } })
    const { CommandHandler } = yield* Effect.promise(() => import("../../src/commands/CommandHandler.ts"))
    const { projectView } = yield* Effect.promise(() => import("../../src/project/view.ts"))
    const view = projectView((yield* (yield* CommandHandler).input({ _tag: "owner" })).snapshot)
    const project = view.projects[projectId]!, folder = view.workspaces[project.worktreeId]!.path
    writeFileSync(join(folder, "screen.html"), "<h1>Approval recovery</h1>")
    const { revisionId } = yield* client["project.mocks.record"]({ requestId: freshRequest(), projectId, bundle: {
      sources: [{ sourceId: "screen" as never, worktreeId: project.worktreeId, path: "screen.html", kind: "screens" }],
      screens: [{ screenId: "home" as never, sourceId: "screen" as never, name: "Home", route: "/", scenarioRoutes: [] }], scenarios: [], components: [], draftedFields: [] } })
    const approvalId = freshRequest()
    armed = true
    const first = yield* approveMockRevision(client, projectId, revisionId, approvalId)
    expect(first.state).toBe(boundary === "before append" ? "uncertain" : "approved")
    expect(first.history.complete).toBe(true)
    if (boundary === "before append") {
      expect(first.history.complete && first.history.approval).toBeUndefined()
      expect((yield* approveMockRevision(client, projectId, revisionId, approvalId)).state).toBe("uncertain")
    }
    expect((yield* readLog).filter((row) => row.event._tag === "project.MockApproved")).toHaveLength(boundary === "before append" ? 0 : 1)
    return { projectId, revisionId, approvalId }
  }))
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    const client = yield* open()
    expect((yield* approveMockRevision(client, previous.projectId, previous.revisionId, previous.approvalId)).state).toBe("approved")
    const approvals = (yield* readLog).filter((row) => row.event._tag === "project.MockApproved")
    expect(approvals).toHaveLength(1)
    expect(approvals[0]!.requestId).toBe(previous.approvalId)
  }), { secrets })
}))
