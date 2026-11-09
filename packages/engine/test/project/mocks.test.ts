import { randomBytes, createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeFileSync, symlinkSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { dispatchQueued } from "../../src/routing/deliveries.ts"
import { mockReach, mockApprovalSource } from "../../src/project/mockReach.ts"
import { projectKey, projectView } from "../../src/project/view.ts"
import { rebuild } from "../../src/views/rebuild.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { connect } from "../support/socketClient.ts"
import { provideBoard, snapshot } from "../board/wakeFixtures.ts"
import { agentCredential, appendSetup, call, eventOf, failureOf, freshRequest, makeRig, ownerCredential as owner, readLog, removeRig, seedAccount, seedAgent, seedHarness, success, type Rig } from "../support/handlerRig.ts"

let rig: Rig
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  execFileSync("git", ["-C", rig.work, "init", "-b", "main"], { stdio: "ignore" })
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const bundle = () => ({
  sources: [{ sourceId: "page", worktreeId: "workspace", path: "screen.html", kind: "screens", previewOrigin: "http://127.0.0.1:4178" },
    { sourceId: "schema", worktreeId: "workspace", path: "schema.json", kind: "data" },
    { sourceId: "components", worktreeId: "workspace", path: "components.json", kind: "components" },
    { sourceId: "tokens", worktreeId: "workspace", path: "tokens.json", kind: "tokens" }],
  screens: [{ screenId: "home", sourceId: "page", name: "Home", route: "/screen", summary: "First screen", scenarioRoutes: [{ scenarioId: "empty", route: "/screen?sample=empty" }] }],
  scenarios: [{ scenarioId: "empty", name: "Empty", description: "No records" }],
  draftedFields: [{ entity: "Project", name: "name", type: "string", description: "Current name", sourceId: "schema", screens: ["home"] },
    { entity: "Project", name: "active", type: "boolean", description: "A new flag", sourceId: "schema", screens: ["home"] },
    { entity: "Project", name: "count", type: "number", description: "Change count", sourceId: "schema", screens: ["home"] }],
  components: [{ componentId: "button", name: "Button", sourceId: "components", provenance: "draft", reference: "draft-button.tsx", fingerprint: hash("export const Button = 1\n"), screens: ["home"] }]
})
const setup = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  const lead = yield* seedAgent({ id: "mock-lead" }), child = yield* seedAgent({ id: "designer", parent: "mock-lead" }), stranger = yield* seedAgent({ id: "stranger" })
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "sh" } }))
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
  // A historical project uses the accepted typed event path, without adding a
  // production record-only creation command. Live lifecycle is tested separately.
  yield* appendSetup([eventOf({ _tag: "project.WorktreeCreated", worktreeId: "workspace", repoId, machineId: "local", branch: "main", path: rig.work, checkout: "main" }),
    eventOf({ _tag: "project.Created", projectId: "project", name: "Mocks", goal: "Review actual artifacts", repoId, worktreeId: "workspace", leadAgentId: lead.agentId, machineId: "local" })])
  writeFileSync(join(rig.work, "screen.html"), "<h1>Actual screen</h1>")
  writeFileSync(join(rig.work, "schema.json"), JSON.stringify({ Project: { name: "string", count: "string" } }))
  writeFileSync(join(rig.work, "components.json"), JSON.stringify({ components: ["Button"] }))
  writeFileSync(join(rig.work, "tokens.json"), JSON.stringify({ colors: { ink: "#000000" } }))
  writeFileSync(join(rig.work, "draft-button.tsx"), "export const Button = 1\n")
  return { lead, child, stranger, repoId }
})
const record = (extra: Record<string, unknown> = {}) => call(owner, "project.mocks.record", { projectId: "project", bundle: bundle(), ...extra }).pipe(Effect.map(success))

it.live("uses authenticated own-project tools, freezes the reviewed revision, and actually dispatches one planning handoff to the recorded lead", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  const f = yield* setup(), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "mocks.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer), designer = yield* connect(socket, f.child.token), stranger = yield* connect(socket, f.stranger.token)
  const request = { requestId: freshRequest(), projectId: "project" as never, bundle: bundle() as never }
  const first = yield* designer["project.mocks.record"](request)
  expect(yield* designer["project.mocks.record"](request)).toEqual(first)
  expect((yield* stranger["project.mocks.record"]({ ...request, requestId: freshRequest() }).pipe(Effect.result))._tag).toBe("Failure")
  expect((yield* designer["project.mocks.approve"]({ requestId: freshRequest(), projectId: "project" as never, revisionId: first.revisionId }).pipe(Effect.result))._tag).toBe("Failure")
  expect((yield* designer["project.setup"]({ requestId: freshRequest() }).pipe(Effect.result))._tag).toBe("Failure")
  const reply = yield* api["project.mocks.read"]({ requestId: freshRequest(), projectId: "project" as never })
  expect("items" in reply).toBe(true)
  if (!("items" in reply)) throw new Error("Owner read must be structured")
  const revision = reply.items[0]!
  expect(revision.author).toEqual({ _tag: "agent", agentId: f.child.agentId }); expect(revision.at).toBeGreaterThan(0)
  expect(revision.bundle.components[0]?.screens).toEqual(["home"])
  expect(revision.bundle.scenarios[0]?.scenarioId).toBe("empty")
  expect(revision.bundle.screens[0]?.scenarioRoutes).toEqual([{ scenarioId: "empty", route: "/screen?sample=empty" }])
  expect(revision.comparisons.map((row) => row.status)).toEqual(["matches", "new", "differs"])
  const artifact = yield* api["project.mocks.artifact"]({ requestId: freshRequest(), projectId: "project" as never, revisionId: first.revisionId, sourceId: "page" as never })
  expect(artifact).toMatchObject({ result: { _tag: "available", text: "<h1>Actual screen</h1>" } })
  expect(projectView(yield* snapshot).projects.project?.stage).toBe("design")
  expect(failureOf(yield* call(owner, "project.stage.set", { projectId: "project", stage: "plan" }))).toBeDefined()
  const approval = { requestId: freshRequest(), projectId: "project" as never, revisionId: first.revisionId }
  yield* api["project.mocks.approve"](approval); yield* api["project.mocks.approve"](approval)
  expect((yield* api["project.mocks.approve"]({ ...approval, requestId: freshRequest() }).pipe(Effect.result))._tag).toBe("Failure")
  const state = yield* snapshot, view = projectView(state)
  const approved = Object.values(view.mockApprovals)[0]!
  expect(approved.revisionId).toBe(first.revisionId)
  expect(approved.worklist).toMatchObject({ screens: ["home"], drafts: ["button"], schemaChanges: [
    { sourceId: "schema", field: "Project.active", change: "add" }, { sourceId: "schema", field: "Project.count", change: "change" }] })
  expect(view.projects.project?.stage).toBe("plan")
  expect(Object.values(view.teams)).toEqual([]); expect(Object.values(view.sprints)).toEqual([]); expect(Object.values(view.tasks)).toEqual([])
  const delivery = Object.values(state.deliveries).find((row) => row.source?._tag === "piece" && row.source.namespace === "project")!
  expect(delivery.target).toBe(f.lead.agentId); expect(delivery.source).toEqual({ _tag: "piece", namespace: "project", id: mockApprovalSource("project", approval.requestId, first.revisionId) })
  expect(mockReach({ snapshot: state, source: delivery.source as never, target: f.lead.agentId, deliveryId: delivery.id })).toBe(true)
  expect(mockReach({ snapshot: state, source: delivery.source as never, target: f.child.agentId, deliveryId: delivery.id })).toBe(false)
  expect(mockReach({ snapshot: state, source: { _tag: "piece", namespace: "project", id: JSON.stringify(["owner-task", "project", approval.requestId]) }, target: f.lead.agentId, deliveryId: delivery.id })).toBe(false)
  yield* dispatchQueued(f.lead.agentId)
  const sent = runner.callsOf("prompt")
  expect(sent).toHaveLength(1); expect(sent[0]!.input.delivery.id).toBe(delivery.id)
  expect(sent[0]!.input.delivery.target).toBe(f.lead.agentId)
  expect(JSON.stringify(sent[0]!.input.delivery.content)).toContain(first.revisionId)
  expect((yield* readLog).filter((row) => row.event._tag === "DeliverySent" && row.event.deliveryId === delivery.id)).toHaveLength(1)
  yield* dispatchQueued(f.lead.agentId); expect(runner.callsOf("prompt")).toHaveLength(1)
})))

it.live("accepts an empty supported scenario list without inventing routes", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup()
  // Owner decision, 2026-11-09, website-1/brief.md, KISS item 2:
  // “only the scenario routes each screen supplies”. This supersedes the
  // former total-matrix rejection of an empty list with declared scenarios.
  const b = bundle(); b.screens[0]!.scenarioRoutes = []
  const first = yield* record({ bundle: b })
  const read = success(yield* call(owner, "project.mocks.read", { projectId: "project" }))
  expect(read.items[0].revisionId).toBe(first.revisionId)
  expect(read.items[0].bundle).toEqual(b)
  success(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: first.revisionId }))
  expect(projectView(yield* snapshot).mockRevisions[projectKey("project", first.revisionId)]?.bundle).toEqual(b)
})))

it.live("rejects unknown or duplicate scenario identities and invalid routes with only the existing refusal audit", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup()
  const sql = yield* SqlClient.SqlClient
  for (const change of [
    (b: ReturnType<typeof bundle>) => { b.screens[0]!.scenarioRoutes[0]!.scenarioId = "Empty" },
    (b: ReturnType<typeof bundle>) => { b.screens[0]!.scenarioRoutes[0]!.route = "/screen?sample={scenario}" },
    (b: ReturnType<typeof bundle>) => { b.screens[0]!.route = "/screen/{sample}" },
    (b: ReturnType<typeof bundle>) => { b.screens[0]!.scenarioRoutes[0]!.route = "//outside.example/screen" },
    (b: ReturnType<typeof bundle>) => { b.scenarios.push({ ...b.scenarios[0]! }) },
    (b: ReturnType<typeof bundle>) => { b.screens[0]!.scenarioRoutes.push({ ...b.screens[0]!.scenarioRoutes[0]! }) },
    ...["relative", "https://outside.example/screen", "/../screen", "/screen%2fother", "/screen\\other", "/screen#fragment"].flatMap((route) => [
      (b: ReturnType<typeof bundle>) => { b.screens[0]!.scenarioRoutes[0]!.route = route },
      (b: ReturnType<typeof bundle>) => { b.screens[0]!.route = route }
    ])
  ]) {
    const b = bundle(); change(b)
    const before = yield* readLog, state = yield* snapshot, view = projectView(state), requestId = freshRequest()
    const payload = { requestId, projectId: "project", bundle: b }
    const refused = yield* call(owner, "project.mocks.record", payload)
    expect(failureOf(refused)).toBeDefined()
    expect(Object.keys(projectView(yield* snapshot).mockRevisions)).toEqual([])
    expect(projectView(yield* snapshot)).toEqual(view)
    expect((yield* readLog).slice(before.length).map((row) => row.event)).toEqual([
      { _tag: "CommandRefused", command: "project.mocks.record", reason: expect.any(String) }
    ])
    expect((yield* snapshot).deliveries).toEqual(state.deliveries)
    const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`
    expect(receipts).toHaveLength(1)
    // Owner clarification, 2026-11-09: preserve shared refusal auditing;
    // no product mutation or successful receipt may follow a refused route.
    const audited = yield* readLog
    const metadata = yield* sql<{ event_id: string; occurred_at: number }>`SELECT event_id, occurred_at FROM events WHERE request_id = ${requestId} ORDER BY sequence`
    expect(JSON.parse(receipts[0]!.result_json)).toEqual(audited.slice(before.length).map((row, index) => ({ ...row,
      eventId: metadata[index]!.event_id, occurredAt: metadata[index]!.occurred_at })))
    expect(yield* call(owner, "project.mocks.record", payload)).toEqual(refused)
    expect(yield* readLog).toEqual(audited)
  }
  const b = bundle(); b.scenarios.push({ scenarioId: "full", name: "A display label", description: "A full state" })
  b.screens[0]!.scenarioRoutes.push({ scenarioId: "full", route: "/screen?sample=concrete-recorded-value" })
  const first = yield* record({ bundle: b })
  expect(success(yield* call(owner, "project.mocks.read", { projectId: "project" })).items[0].revisionId).toBe(first.revisionId)
})))

it.live("preserves supplied scenario subsets through socket reads, exact approval, handoff and rebuild", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  const f = yield* setup(), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "supported-routes.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer), designer = yield* connect(socket, f.child.token), lead = yield* connect(socket, f.lead.token)
  const b = bundle()
  b.scenarios.push({ scenarioId: "busy", name: "Busy label", description: "Many records" },
    { scenarioId: "error", name: "Error label", description: "A failed state" })
  b.screens.push({ ...b.screens[0]!, screenId: "details", name: "Details", route: "/details", scenarioRoutes: [] })
  // A complete old matrix stays a valid, byte-stable historical revision.
  for (const screen of b.screens) screen.scenarioRoutes = b.scenarios.map((scenario) => ({ scenarioId: scenario.scenarioId, route: `${screen.route}?case=${scenario.scenarioId}` }))
  const previous = yield* designer["project.mocks.record"]({ requestId: freshRequest(), projectId: "project" as never, bundle: b as never })
  const original = JSON.stringify(projectView(yield* snapshot).mockRevisions[projectKey("project", previous.revisionId)])
  b.screens[0]!.scenarioRoutes = [{ scenarioId: "error", route: "/screen?case=failure" }, { scenarioId: "empty", route: "/screen?case=zero" }]
  b.screens[1]!.scenarioRoutes = [{ scenarioId: "busy", route: "/details?case=many" }]
  const request = { requestId: freshRequest(), projectId: "project" as never, expectedRevision: previous.revisionId, bundle: b as never }
  const first = yield* designer["project.mocks.record"](request)
  expect(yield* designer["project.mocks.record"](request)).toEqual(first)
  const read = yield* api["project.mocks.read"]({ requestId: freshRequest(), projectId: "project" as never })
  if (!("items" in read)) throw new Error("Owner read must be structured")
  expect(read.items.find((row) => row.revisionId === first.revisionId)?.bundle).toEqual(b)
  expect((yield* designer["project.mocks.approve"]({ requestId: freshRequest(), projectId: "project" as never, revisionId: first.revisionId }).pipe(Effect.result))._tag).toBe("Failure")
  expect((yield* api["project.mocks.approve"]({ requestId: freshRequest(), projectId: "project" as never, revisionId: previous.revisionId }).pipe(Effect.result))._tag).toBe("Failure")
  const approval = { requestId: freshRequest(), projectId: "project" as never, revisionId: first.revisionId }
  yield* api["project.mocks.approve"](approval); yield* api["project.mocks.approve"](approval)
  yield* dispatchQueued(f.lead.agentId)
  expect(runner.callsOf("prompt")).toHaveLength(1)
  expect(JSON.stringify(runner.callsOf("prompt")[0]!.input.delivery.content)).toContain(first.revisionId)
  const handoffRead = yield* lead["project.mocks.read"]({ requestId: freshRequest(), projectId: "project" as never })
  if (!("data" in handoffRead)) throw new Error("Lead read must use the agent envelope")
  const handed = JSON.parse(handoffRead.data.split("\n")[1]!)
  expect(handed.items.find((row: { revisionId: string }) => row.revisionId === first.revisionId).bundle).toEqual(b)
  expect(handed.approval).toMatchObject({ revisionId: first.revisionId, worklist: { screens: ["home", "details"] } })
  const log = yield* readLog, state = yield* snapshot, rebuilt = yield* rebuild(state.sequence)
  const view = projectView(state), replay = projectView(rebuilt)
  expect(replay).toEqual(view)
  expect(replay.mockRevisions[projectKey("project", first.revisionId)]?.bundle).toEqual(b)
  expect(JSON.stringify(replay.mockRevisions[projectKey("project", previous.revisionId)])).toBe(original)
  expect(log.filter((row) => row.event._tag === "project.MockApproved")).toHaveLength(1)
  expect(log.filter((row) => row.event._tag === "DeliverySent")).toHaveLength(1)
})))

const designFiles = (repoId: string) => {
  writeFileSync(join(rig.work, "recorded-layout.pen"), Buffer.from([0, 255, 1, 2]))
  writeFileSync(join(rig.work, "design-tokens.json"), JSON.stringify({ tokens: [{ name: "ink", value: "#1a1a1a" }] }))
  writeFileSync(join(rig.work, "shared-button.tsx"), "export const Shared = 1\n")
  return { repoId, worktreeId: "workspace", file: "recorded-layout.pen", tokensPath: "design-tokens.json",
    components: [{ componentId: "shared-button", name: "Shared Button", reference: "shared-button.tsx", fingerprint: hash("export const Shared = 1\n"), variants: "Default" }] }
}
it.live("refuses raw and unconfined token-document paths at authenticated public admission and still reads a real valid document", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), design = designFiles(f.repoId)
  const before = yield* readLog, view = projectView(yield* snapshot)
  // call passes unknown input directly to the real authenticated handler.
  // No typed client can filter or reject these values before server admission.
  for (const tokensPath of ["abc", "hunter2", "sk-ant-api03-AAAAAAAAAAAAAAAA", "secret", "secret:", "SECRET:x y",
    "../outside.json", "/tmp/tokens.json", "design//tokens.json", "design\\tokens.json", ".codex/auth.json", "tokens.txt"]) {
    expect(failureOf(yield* call(agentCredential(f.child.token), "project.design.record", { projectId: "project", design: { ...design, tokensPath } })))
      .toEqual({ _tag: "CommandRefused", reason: "command refused" })
    expect(yield* readLog).toEqual(before)
    expect(projectView(yield* snapshot)).toEqual(view)
  }
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "valid-tokens.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const designer = yield* connect(socket, f.child.token), api = yield* connect(socket, bearer)
  const recorded = yield* designer["project.design.record"]({ requestId: freshRequest(), projectId: "project" as never, design: design as never })
  expect(yield* api["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId, revisionId: recorded.revisionId }))
    .toMatchObject({ result: { _tag: "registered", record: { design: { tokensPath: "design-tokens.json" } },
      tokens: { _tag: "available", tokens: [{ name: "ink", value: "#1a1a1a" }] } } })
})))

it.live("cross-caller Design revision collision refuses without replacing the immutable original", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "design-collision.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer), designer = yield* connect(socket, f.child.token)
  const request = { requestId: freshRequest(), projectId: "project" as never, design: designFiles(f.repoId) as never }
  const first = yield* designer["project.design.record"](request)
  const sameCallerRetry = yield* designer["project.design.record"](request)
  expect(sameCallerRetry).toEqual(first)
  const original = yield* api["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId, revisionId: first.revisionId })
  writeFileSync(join(rig.work, "replacement-layout.pen"), "Actual replacement Design")
  const changed = { ...request, expectedRevision: first.revisionId, design: { ...designFiles(f.repoId), file: "replacement-layout.pen" } as never }
  const approvals = projectView(yield* snapshot).mockApprovals
  const before = (yield* readLog).length
  const collision = yield* api["project.design.record"](changed).pipe(Effect.result)
  const after = yield* api["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId, revisionId: first.revisionId })
  const added = (yield* readLog).slice(before).map((row) => row.event)
  const fresh = yield* api["project.design.record"]({ ...changed, requestId: freshRequest() })
  expect(fresh.revisionId).not.toBe(first.revisionId)
  expect(collision._tag).toBe("Failure")
  if (!("result" in original) || !("result" in after)) throw new Error("Owner read must be structured")
  expect(after.result).toEqual(original.result)
  expect(added).toEqual([{ _tag: "CommandRefused", command: "project.design.record", reason: "design revision identity is already recorded" }])
  expect(projectView(yield* snapshot).mockApprovals).toEqual(approvals)
  expect(yield* designer["project.design.record"](request)).toEqual(first)
  const lead = yield* connect(socket, f.lead.token)
  expect((yield* lead["project.design.record"]({ ...changed, expectedRevision: fresh.revisionId }).pipe(Effect.result))._tag).toBe("Failure")
  const historical = yield* api["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId, revisionId: first.revisionId })
  if (!("result" in historical)) throw new Error("Owner read must be structured")
  expect(historical.result).toEqual(original.result)
})))

it.live("cross-caller mock revision collision refuses without replacing the immutable original", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "mock-collision.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer), designer = yield* connect(socket, f.child.token)
  const request = { requestId: freshRequest(), projectId: "project" as never, bundle: bundle() as never }
  const first = yield* designer["project.mocks.record"](request)
  const sameCallerRetry = yield* designer["project.mocks.record"](request)
  expect(sameCallerRetry).toEqual(first)
  const original = yield* api["project.mocks.read"]({ requestId: freshRequest(), projectId: "project" as never })
  writeFileSync(join(rig.work, "replacement-screen.html"), "<h1>Actual replacement mock</h1>")
  const replacement = bundle(); replacement.sources[0]!.path = "replacement-screen.html"; replacement.screens[0]!.summary = "Changed real artifact metadata"
  const changed = { ...request, expectedRevision: first.revisionId, bundle: replacement as never }
  const approvals = projectView(yield* snapshot).mockApprovals
  const before = (yield* readLog).length
  const collision = yield* api["project.mocks.record"](changed).pipe(Effect.result)
  const after = yield* api["project.mocks.read"]({ requestId: freshRequest(), projectId: "project" as never })
  const added = (yield* readLog).slice(before).map((row) => row.event)
  const fresh = yield* api["project.mocks.record"]({ ...changed, requestId: freshRequest() })
  expect(fresh.revisionId).not.toBe(first.revisionId)
  expect(collision._tag).toBe("Failure")
  if (!("items" in original) || !("items" in after)) throw new Error("Owner read must be structured")
  expect(after.items).toEqual(original.items)
  expect(added).toEqual([{ _tag: "CommandRefused", command: "project.mocks.record", reason: "mock revision identity is already recorded" }])
  expect(projectView(yield* snapshot).mockApprovals).toEqual(approvals)
  expect(yield* designer["project.mocks.record"](request)).toEqual(first)
  const lead = yield* connect(socket, f.lead.token)
  expect((yield* lead["project.mocks.record"]({ ...changed, expectedRevision: fresh.revisionId }).pipe(Effect.result))._tag).toBe("Failure")
  const historical = yield* api["project.mocks.read"]({ requestId: freshRequest(), projectId: "project" as never })
  if (!("items" in historical)) throw new Error("Owner read must be structured")
  expect(historical.items.find((row) => row.revisionId === first.revisionId)).toEqual(original.items[0])
})))

it.live("preserves an approved mock and its exact Design registration against cross-caller revision replacement", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "approved-collision.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer), designer = yield* connect(socket, f.child.token)
  const design = designFiles(f.repoId), designRequest = { requestId: freshRequest(), projectId: "project" as never, design: design as never }
  const registration = yield* designer["project.design.record"](designRequest)
  const mockRequest = { requestId: freshRequest(), projectId: "project" as never, bundle: { ...bundle(), designRevision: registration.revisionId } as never }
  const revision = yield* designer["project.mocks.record"](mockRequest)
  yield* api["project.mocks.approve"]({ requestId: freshRequest(), projectId: "project" as never, revisionId: revision.revisionId })
  const before = yield* snapshot, logLength = (yield* readLog).length
  expect(Object.values(projectView(before).mockApprovals)).toHaveLength(1)
  writeFileSync(join(rig.work, "replacement-layout.pen"), "A real replacement Design")
  writeFileSync(join(rig.work, "replacement-screen.html"), "<h1>A real replacement screen</h1>")
  const replacement = bundle(); replacement.sources[0]!.path = "replacement-screen.html"
  expect((yield* api["project.design.record"]({ ...designRequest, expectedRevision: registration.revisionId,
    design: { ...design, file: "replacement-layout.pen" } as never }).pipe(Effect.result))._tag).toBe("Failure")
  expect((yield* api["project.mocks.record"]({ ...mockRequest, expectedRevision: revision.revisionId,
    bundle: { ...replacement, designRevision: registration.revisionId } as never }).pipe(Effect.result))._tag).toBe("Failure")
  const after = yield* snapshot
  expect(projectView(after)).toEqual(projectView(before))
  expect(after.deliveries).toEqual(before.deliveries)
  expect((yield* readLog).slice(logLength).map((row) => row.event)).toEqual([
    { _tag: "CommandRefused", command: "project.design.record", reason: "design revision identity is already recorded" },
    { _tag: "CommandRefused", command: "project.mocks.record", reason: "mock revision identity is already recorded" }
  ])
  expect(yield* designer["project.design.record"](designRequest)).toEqual(registration)
  expect(yield* designer["project.mocks.record"](mockRequest)).toEqual(revision)
})))

it.live("registers immutable repository Design through the authenticated API and preserves real provenance, bytes and revision-bound mock editing", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  const f = yield* setup(), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "design.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer), designer = yield* connect(socket, f.child.token), stranger = yield* connect(socket, f.stranger.token)
  expect(yield* api["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId })).toMatchObject({ result: { _tag: "unavailable", reason: "repository design is not registered" } })
  const design = designFiles(f.repoId), request = { requestId: freshRequest(), projectId: "project" as never, design: design as never }
  const first = yield* designer["project.design.record"](request)
  expect(yield* designer["project.design.record"](request)).toEqual(first)
  expect((yield* stranger["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId, projectId: "project" as never }).pipe(Effect.result))._tag).toBe("Failure")
  expect((yield* designer["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId }).pipe(Effect.result))._tag).toBe("Failure")
  const read = yield* api["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId, revisionId: first.revisionId })
  expect(read).toMatchObject({ result: { _tag: "registered", record: { revisionId: first.revisionId, author: { _tag: "agent", agentId: f.child.agentId }, design },
    file: { _tag: "available", fingerprint: createHash("sha256").update(Buffer.from([0, 255, 1, 2])).digest("hex") },
    tokens: { _tag: "available", tokens: [{ name: "ink", value: "#1a1a1a" }] }, components: [{ provenance: "shared", availability: { _tag: "available", fingerprint: design.components[0]!.fingerprint } }] } })
  if (!("result" in read) || read.result._tag !== "registered") throw new Error("Expected registered Design")
  expect(read.result.record.at).toBeGreaterThan(0)
  const agentRead = yield* designer["project.design.read"]({ requestId: freshRequest(), projectId: "project" as never, repoId: f.repoId, revisionId: first.revisionId })
  expect("data" in agentRead && agentRead.data).toContain("recorded-layout.pen")
  expect(Buffer.byteLength(JSON.stringify(agentRead))).toBeLessThanOrEqual(256 * 1024)
  const mock = yield* record({ bundle: { ...bundle(), designRevision: first.revisionId } })
  expect(success(yield* call(owner, "project.mocks.read", { projectId: "project" })).items[0].bundle.designRevision).toBe(first.revisionId)
  success(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: mock.revisionId }))
  writeFileSync(join(rig.work, "second-layout.fig"), "A different actual file")
  const next = yield* api["project.design.record"]({ ...request, requestId: freshRequest(), expectedRevision: first.revisionId, design: { ...design, file: "second-layout.fig" } as never })
  expect(next.revisionId).not.toBe(first.revisionId)
  expect(yield* api["project.design.read"]({ requestId: freshRequest(), repoId: f.repoId, revisionId: first.revisionId })).toMatchObject({ result: { record: { design: { file: "recorded-layout.pen" } } } })
  expect((yield* api["project.design.record"]({ ...request, requestId: freshRequest() }).pipe(Effect.result))._tag).toBe("Failure")
  expect(runner.callsOf("start")).toHaveLength(0); expect(runner.callsOf("prompt")).toHaveLength(0)
})))

it.live("reports changed and missing Design artifacts unavailable and refuses stale Design approval without guessing another file", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), design = designFiles(f.repoId)
  const first = success(yield* call(owner, "project.design.record", { projectId: "project", design }))
  expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", bundle: { ...bundle(), designRevision: "unknown" } }))?.reason).toContain("not registered")
  const mock = yield* record({ bundle: { ...bundle(), designRevision: first.revisionId } })
  writeFileSync(join(rig.work, "recorded-layout.pen"), "Changed")
  unlinkSync(join(rig.work, "design-tokens.json")); writeFileSync(join(rig.work, "shared-button.tsx"), "Changed component")
  const read = success(yield* call(owner, "project.design.read", { repoId: f.repoId, revisionId: first.revisionId })).result
  expect(read).toMatchObject({ _tag: "registered", record: { design: { file: "recorded-layout.pen" } }, file: { _tag: "unavailable" }, tokens: { _tag: "unavailable" }, components: [{ availability: { _tag: "unavailable" } }] })
  expect(failureOf(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: mock.revisionId }))?.reason).toContain("design artifacts changed")
  unlinkSync(join(rig.work, "recorded-layout.pen"))
  expect(success(yield* call(owner, "project.design.read", { repoId: f.repoId })).result.file._tag).toBe("unavailable")
  expect(failureOf(yield* call(owner, "project.design.record", { projectId: "project", expectedRevision: first.revisionId, design }))).toBeDefined()
})))

it.live("refuses redirected, oversized, unregistered and mismatched-common-directory Design evidence", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), design = designFiles(f.repoId)
  for (const file of ["../outside.pen", ".git/config", "missing.pen"]) expect(failureOf(yield* call(owner, "project.design.record", { projectId: "project", design: { ...design, file } }))).toBeDefined()
  writeFileSync(join(rig.work, "huge.pen"), "x".repeat(1024 * 1024 + 1))
  expect(failureOf(yield* call(owner, "project.design.record", { projectId: "project", design: { ...design, file: "huge.pen" } }))).toBeDefined()
  symlinkSync(join(rig.work, "recorded-layout.pen"), join(rig.work, "linked.pen"))
  expect(failureOf(yield* call(owner, "project.design.record", { projectId: "project", design: { ...design, file: "linked.pen" } }))).toBeDefined()
  expect(failureOf(yield* call(owner, "project.design.record", { projectId: "project", design: { ...design, worktreeId: "unregistered" } }))).toBeDefined()
  expect(Object.keys(projectView(yield* snapshot).designs)).toEqual([])
  const first = success(yield* call(owner, "project.design.record", { projectId: "project", design }))
  execFileSync("git", ["-C", rig.outside, "init", "-b", "main"], { stdio: "ignore" })
  yield* appendSetup([eventOf({ _tag: "project.WorktreeCreated", worktreeId: "workspace", repoId: f.repoId, machineId: "local", branch: "main", path: rig.outside, checkout: "main" })])
  expect(failureOf(yield* call(owner, "project.design.record", { projectId: "project", expectedRevision: first.revisionId, design }))?.reason).toContain("different repository")
  expect(success(yield* call(owner, "project.design.read", { repoId: f.repoId })).result).toMatchObject({ record: { revisionId: first.revisionId }, file: { _tag: "unavailable" } })
})))

it.live("rejects a real registered Design revision from another repository", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  execFileSync("git", ["-C", rig.outside, "init", "-b", "main"], { stdio: "ignore" })
  const otherRepo = success(yield* call(owner, "project.repository.add", { name: "Other", path: rig.outside, machineId: "local" })).repoId
  const otherWorkspace = success(yield* call(owner, "project.workspace.register", { repoId: otherRepo, machineId: "local", branch: "main", path: rig.outside, checkout: "main" })).worktreeId
  yield* appendSetup([eventOf({ _tag: "project.Created", projectId: "other-project", name: "Other", goal: "", repoId: otherRepo, worktreeId: otherWorkspace, machineId: "local", leadAgentId: f.stranger.agentId })])
  writeFileSync(join(rig.outside, "other.pen"), "A real other Design")
  const design = success(yield* call(owner, "project.design.record", { projectId: "other-project", design: { repoId: otherRepo, worktreeId: otherWorkspace, file: "other.pen", components: [] } }))
  expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", bundle: { ...bundle(), designRevision: design.revisionId } }))?.reason).toContain("not registered in this repository")
  expect(failureOf(yield* call(agentCredential(f.child.token), "project.design.read", { projectId: "project", repoId: otherRepo }))).toBeDefined()
})))

it.live("refuses stale reviews, changed artifacts and flag-only promotion; preserves immutable history and withdraws obsolete queued handoffs", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  const f = yield* setup(), first = yield* record()
  writeFileSync(join(rig.work, "screen.html"), "<h1>Changed screen</h1>")
  expect(failureOf(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: first.revisionId }))?.reason).toContain("artifact changed")
  const changed = bundle(); changed.screens[0]!.summary = "Revised"
  const second = yield* record({ expectedRevision: first.revisionId, bundle: changed })
  expect(failureOf(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: first.revisionId }))).toBeDefined()
  const fakePromotion = bundle(); fakePromotion.components[0]!.provenance = "shared"
  expect(failureOf(yield* call(agentCredential(f.child.token), "project.mocks.record", { projectId: "project", expectedRevision: second.revisionId, bundle: fakePromotion }))?.reason).toContain("reference change")
  writeFileSync(join(rig.work, "shared-button.tsx"), "export const Button = 2\n")
  const promoted = bundle(); promoted.components[0] = { ...promoted.components[0]!, reference: "shared-button.tsx", fingerprint: hash("export const Button = 2\n"), provenance: "shared" }
  const third = yield* record({ expectedRevision: second.revisionId, bundle: promoted })
  expect(projectView(yield* snapshot).mockRevisions[projectKey("project", first.revisionId)]?.bundle.screens[0]?.summary).toBe("First screen")
  success(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: third.revisionId }))
  const before = yield* snapshot, queued = Object.values(before.deliveries).find((row) => row.source?._tag === "piece" && row.source.namespace === "project")!
  expect(Object.values(projectView(before).mockApprovals)[0]?.worklist.drafts).toEqual([])
  const fourth = yield* record({ expectedRevision: third.revisionId, bundle: promoted })
  expect(mockReach({ snapshot: yield* snapshot, source: queued.source as never, target: f.lead.agentId, deliveryId: queued.id })).toBe(false)
  yield* dispatchQueued(f.lead.agentId)
  expect(runner.callsOf("prompt")).toHaveLength(0)
  expect((yield* snapshot).deliveries[queued.id]?.status).toBe("withdrawn")
  const page = success(yield* call(owner, "project.mocks.read", { projectId: "project", limit: 1 }))
  expect(page.items.map((row: any) => row.revisionId)).toEqual([first.revisionId]); expect(page.next).toBe(first.revisionId)
  const rest = success(yield* call(owner, "project.mocks.read", { projectId: "project", after: page.next }))
  expect(rest.items.map((row: any) => row.revisionId)).toEqual([second.revisionId, third.revisionId, fourth.revisionId])
  expect(failureOf(yield* call(owner, "project.mocks.read", { projectId: "project", after: "unknown" }))).toBeDefined()
})))

for (const path of ["../outside.json", ".git/config", ".env", "folder/.env.local", "%2e%2e/private.json", "folder\\file.json", "/etc/passwd", "auth.json"]) {
  it.live(`refuses unsafe mock path ${path}`, () => provideBoard(rig, Effect.gen(function* () {
    yield* setup(); const b = bundle(); b.sources[0]!.path = path
    expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", bundle: b }))).toBeDefined()
    expect(Object.keys(projectView(yield* snapshot).mockRevisions)).toEqual([])
  })))
}
for (const origin of ["javascript:alert(1)", "data:text/html,hi", "file:///tmp", "http://example.com", "https://owner:secret@example.com", "https://example.com/api"]) {
  it.live(`refuses unsafe preview origin ${origin}`, () => provideBoard(rig, Effect.gen(function* () {
    yield* setup(); const b = bundle(); b.sources[0]!.previewOrigin = origin
    expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", bundle: b }))).toBeDefined()
  })))
}
it.live("returns explicit unavailable artifacts and comparisons; refuses symlinks, oversized files and missing component evidence", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup(); unlinkSync(join(rig.work, "screen.html")); writeFileSync(join(rig.work, "schema.json"), "not-json")
  const first = yield* record()
  const read = success(yield* call(owner, "project.mocks.read", { projectId: "project" }))
  expect(read.items[0].comparisons.map((row: any) => row.status)).toEqual(["unavailable", "unavailable", "unavailable"])
  expect(success(yield* call(owner, "project.mocks.artifact", { projectId: "project", revisionId: first.revisionId, sourceId: "page" }))).toMatchObject({ result: { _tag: "unavailable", reason: "artifact unavailable" } })
  expect(failureOf(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: first.revisionId }))).toBeDefined()
  symlinkSync(join(rig.outside, "outside.html"), join(rig.work, "screen.html"))
  expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: first.revisionId, bundle: bundle() }))).toBeDefined()
  unlinkSync(join(rig.work, "screen.html")); writeFileSync(join(rig.work, "screen.html"), "x".repeat(9000))
  const second = yield* record({ expectedRevision: first.revisionId })
  expect(success(yield* call(owner, "project.mocks.artifact", { projectId: "project", revisionId: second.revisionId, sourceId: "page" }))).toMatchObject({ result: { _tag: "unavailable" } })
  unlinkSync(join(rig.work, "draft-button.tsx"))
  expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: second.revisionId, bundle: bundle() }))).toBeDefined()
})))

it.live("starts without Design when screens are absent and derives distinct stage labels from real team areas", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  expect(projectView(yield* snapshot).projects.project?.stage).toBe("plan")
  expect(failureOf(yield* call(owner, "project.stage.set", { projectId: "project", stage: "design" }))).toBeDefined()
  const first = success(yield* call(owner, "project.team.create", { projectId: "project", name: "Ignored stage label", stage: "build", area: "API", worktreeId: "workspace" }))
  const git = (...args: string[]) => execFileSync("git", ["-C", rig.work, ...args], { stdio: "ignore" })
  git("-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial")
  const path = join(rig.root, "team-web"); git("worktree", "add", "-b", "web", path)
  const secondWorkspace = success(yield* call(owner, "project.workspace.register", { repoId: f.repoId, machineId: "local", branch: "web", path, checkout: "worktree", parentId: "workspace" })).worktreeId
  const second = success(yield* call(owner, "project.team.create", { projectId: "project", name: "Other", stage: "build", area: "Web", worktreeId: secondWorkspace }))
  const teams = projectView(yield* snapshot).teams
  expect(teams[projectKey("project", first.teamId)]?.name).toBe("Build · API")
  expect(teams[projectKey("project", second.teamId)]?.name).toBe("Build · Web")
})))

it.live("admits readable escaped records, pages within the agent envelope budget, and refuses an unreadable approval before writing it", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), b = bundle()
  b.draftedFields = Array.from({ length: 6 }, (_, i) => ({ ...b.draftedFields[0]!, name: `field-${i}`, description: '"\\'.repeat(800) }))
  const tooLarge = { ...b, draftedFields: b.draftedFields.map((field) => ({ ...field, description: '"\\'.repeat(1500) })) }
  expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", bundle: tooLarge }))?.reason).toContain("read budget")
  expect(Object.keys(projectView(yield* snapshot).mockRevisions)).toEqual([])
  const first = yield* record({ bundle: b })
  const second = yield* record({ expectedRevision: first.revisionId, bundle: b })
  const third = yield* record({ expectedRevision: second.revisionId, bundle: b })
  const huge = { requestId: "x".repeat(100000), projectId: "project", revisionId: third.revisionId }
  const before = (yield* readLog).length
  expect(failureOf(yield* call(owner, "project.mocks.approve", huge))?.reason).toContain("read budget")
  expect((yield* readLog).slice(before).map((row) => row.event)).toEqual([
    { _tag: "CommandRefused", command: "project.mocks.approve", reason: "mock approval exceeds the read budget" }
  ])
  success(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: third.revisionId }))
  const page = success(yield* call(agentCredential(f.child.token), "project.mocks.read", { projectId: "project" }))
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(256 * 1024)
  expect(page.data).toContain(first.revisionId)
  expect(page.data).toContain('"next"')
  const rest = success(yield* call(agentCredential(f.child.token), "project.mocks.read", { projectId: "project", after: second.revisionId }))
  expect(rest.data).toContain(third.revisionId)
  expect(rest.data).not.toContain('"next"')
})))

it.live("preserves long qualified field names and redacts schema comparison prose before recording it", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup()
  const secret = "private-schema-type"
  success(yield* call(owner, "accounts set-secret", { accountId: "primary", name: "TOKEN", nonce: freshRequest(), value: Redacted.make(secret) }))
  const b = bundle(), entity = "E".repeat(128), name = "N".repeat(128)
  b.draftedFields = [{ ...b.draftedFields[0]!, entity, name }, { ...b.draftedFields[1]!, name: "secretType" }]
  writeFileSync(join(rig.work, "schema.json"), JSON.stringify({ Project: { secretType: secret } }))
  const first = yield* record({ bundle: b })
  const read = success(yield* call(owner, "project.mocks.read", { projectId: "project" }))
  expect(read.items[0].comparisons[1].known).not.toContain(secret)
  success(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: first.revisionId }))
  expect(Object.values(projectView(yield* snapshot).mockApprovals)[0]?.worklist.schemaChanges[0]?.field).toBe(`${entity}.${name}`)
  expect(JSON.stringify(yield* readLog)).not.toContain(secret)
}), ["private-schema-type"]))

it.live("reads actual stylesheet tokens as data and validates component screen references", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup(); const b = bundle()
  b.sources[3]!.path = "tokens.css"
  writeFileSync(join(rig.work, "tokens.css"), ":root { --ink: #000000; }")
  const first = yield* record({ bundle: b })
  expect(success(yield* call(owner, "project.mocks.artifact", { projectId: "project", revisionId: first.revisionId, sourceId: "tokens" }))).toMatchObject({ result: { _tag: "available", text: ":root { --ink: #000000; }" } })
  b.components[0]!.screens = ["unknown"]
  expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: first.revisionId, bundle: b }))?.reason).toContain("component reference")
})))

it.live("refuses secret-bearing raw paths and routes instead of reading a different redacted reference", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup()
  writeFileSync(join(rig.work, "[REDACTED].html"), "<h1>A different file</h1>")
  for (const change of [
    (b: ReturnType<typeof bundle>) => { b.sources[0]!.path = "private-path.html" },
    (b: ReturnType<typeof bundle>) => { b.components[0]!.reference = "private-path.tsx" },
    (b: ReturnType<typeof bundle>) => { b.screens[0]!.route = "/private-path" }
  ]) {
    const b = bundle(); change(b)
    expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", bundle: b }))).toBeDefined()
    expect(Object.keys(projectView(yield* snapshot).mockRevisions)).toEqual([])
  }
}), ["private-path"]))

it.live("keeps the same field name in different entities distinct through approval", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup(); const b = bundle()
  b.draftedFields = [{ ...b.draftedFields[0]!, entity: "EntityA" }, { ...b.draftedFields[0]!, entity: "EntityB" }]
  writeFileSync(join(rig.work, "schema.json"), JSON.stringify({ EntityA: { name: "string" }, EntityB: { name: "string" } }))
  const first = yield* record({ bundle: b })
  success(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: first.revisionId }))
  expect(Object.values(projectView(yield* snapshot).mockApprovals)[0]?.worklist.draftedFields.map((field) => [field.entity, field.name])).toEqual([["EntityA", "name"], ["EntityB", "name"]])
})))

it.live("refuses the removed declared schema input at public admission without recording or approving it", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup(); const b = { ...bundle(), draftedFields: [], schemaChanges: [{ sourceId: "schema", field: "Project.name", change: "remove", description: "Remove the obsolete name" }] }
  const before = yield* readLog
  expect(failureOf(yield* call(owner, "project.mocks.record", { projectId: "project", bundle: b }))).toEqual({ _tag: "CommandRefused", reason: "command refused" })
  expect(yield* readLog).toEqual(before)
  expect(Object.keys(projectView(yield* snapshot).mockRevisions)).toEqual([])
  expect(Object.values(projectView(yield* snapshot).mockApprovals)).toEqual([])
  const { schemaChanges: _removed, ...supported } = b
  const first = yield* record({ bundle: supported })
  success(yield* call(owner, "project.mocks.approve", { projectId: "project", revisionId: first.revisionId }))
  expect(Object.values(projectView(yield* snapshot).mockApprovals)[0]?.worklist.schemaChanges).toEqual([])
})))

for (const actor of ["owner", "member"] as const) for (const page of ["empty", "exhausted"] as const) {
  it.live(`bounds ${actor} ${page} mock replies including quote-heavy request identity`, () => provideBoard(rig, Effect.gen(function* () {
    const f = yield* setup(), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "read-budget.sock")
    yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
    const api = yield* connect(socket, bearer), member = yield* connect(socket, f.child.token)
    const client = actor === "owner" ? api : member
    const after = page === "exhausted" ? (yield* api["project.mocks.record"]({ requestId: freshRequest(), projectId: "project" as never, bundle: bundle() as never })).revisionId : undefined
    const beforeLog = yield* readLog, beforeView = projectView(yield* snapshot)
    const payload = { projectId: "project" as never, ...(after === undefined ? {} : { after }) }
    const control = yield* client["project.mocks.read"]({ ...payload, requestId: freshRequest() })
    expect(Buffer.byteLength(JSON.stringify(control))).toBeLessThanOrEqual(256 * 1024)
    if (actor === "owner") expect(control).toMatchObject({ items: [] })
    else { expect("data" in control).toBe(true); if ("data" in control) expect(control.data).toContain('"items":[]') }
    const requestId = '"'.repeat(140_000)
    const outcome = yield* client["project.mocks.read"]({ ...payload, requestId: requestId as never }).pipe(Effect.result)
    const bytes = outcome._tag === "Success" ? Buffer.byteLength(JSON.stringify(outcome.success)) : undefined
    const internal = yield* call(actor === "owner" ? owner : agentCredential(f.child.token), "project.mocks.read", { ...payload, requestId })
    expect(failureOf(internal)).toEqual({ _tag: "CommandRefused", reason: "mock reply exceeds the read budget" })
    const afterLog = yield* readLog, afterView = projectView(yield* snapshot)
    expect(afterLog).toEqual(beforeLog)
    expect(afterView).toEqual(beforeView)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") expect(outcome.failure).toEqual({ _tag: "CommandError", requestId, reason: "command refused" })
    // Retain the original public reply budget assertion as well as strict refusal.
    if (outcome._tag === "Success") expect(bytes).toBeLessThanOrEqual(256 * 1024)
  })))
}
