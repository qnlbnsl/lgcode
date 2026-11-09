import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, renameSync, symlinkSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { it } from "@effect/vitest"
import { ContextPath, ContextSearchResult, Event } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { dispatchQueued } from "../../src/routing/deliveries.ts"
import { projectView } from "../../src/project/view.ts"
import { canCarryPost } from "../../src/board/access.ts"
import { checkPieceBatch } from "../../src/commands/pieceBatch.ts"
import { engineLists } from "../../src/pieces/lists.ts"
import { provideBoard, snapshot, boardState, queued, deliveryText } from "../board/wakeFixtures.ts"
import { connect, ancestryHeaders, authorization, requestFrame, upgrade, upgradeStatus, type Client } from "../support/socketClient.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { appendSetup, call, success, seedAccount, seedHarness, seedAgent, freshRequest, makeRig, removeRig, readLog, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const git = (folder: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", folder, ...args], { stdio: ["ignore", "pipe", "pipe"] })
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  writeFileSync(join(rig.work, "file.txt"), "context-secret-value must never be inlined\n")
  git(rig.work, "config", "user.name", "Context Test")
  git(rig.work, "config", "user.email", "context@example.test")
  git(rig.work, "config", "commit.gpgsign", "false")
  git(rig.work, "add", "file.txt"); git(rig.work, "commit", "-m", "Initial file")
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const owner = { _tag: "owner" } as const
const run = (api: Client, name: string, payload: Record<string, unknown>) =>
  (api as unknown as Record<string, (p: unknown) => Effect.Effect<any, { readonly reason: string }>>)[name]!({ requestId: freshRequest(), ...payload })
const refuse = <A, E extends { readonly reason: string }, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.result, Effect.map((result) => {
  expect(result._tag).toBe("Failure")
  return result._tag === "Failure" ? result.failure.reason : "unexpected success"
}))
// Bypass only the generated client's local payload validator, so malformed
// file identities reach the real authenticated public decoder too.
const rawRefusal = (bearer: string, context: unknown[]) => Effect.promise(async () => {
  const opened = await upgrade(join(rig.stateFolder, "context.sock"), { ...authorization(bearer), ...ancestryHeaders() })
  if (opened.socket === undefined) throw new Error("authenticated socket did not open")
  const ws = opened.socket
  try {
    const reply = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("raw request timed out")), 5000)
      ws.on("error", (error) => { clearTimeout(timer); reject(error) })
      ws.on("message", (bytes) => {
        const frame = JSON.parse(bytes.toString())
        if (frame._tag === "Exit") { clearTimeout(timer); resolve(frame) }
      })
      ws.send(requestFrame("context-invalid", "prompt", { requestId: freshRequest(), agentId: "worker", text: "", context }))
    })
    expect(reply.exit._tag).toBe("Failure")
  } finally { ws.terminate() }
})
const setup = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  const lead = yield* seedAgent({ id: "lead", folder: rig.work })
  const worker = yield* seedAgent({ id: "worker", parent: "lead", folder: rig.work })
  const stranger = yield* seedAgent({ id: "stranger", folder: rig.outside })
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
  const worktreeId = success(yield* call(owner, "project.workspace.register", { repoId, machineId: "local", branch: "main", path: rig.work, checkout: "main" })).worktreeId
  // Accepted historical project membership, through the real typed event log.
  // All team, sprint and task entities below use public production commands.
  const projectId = `project-${freshRequest()}`
  yield* appendSetup([Schema.decodeUnknownSync(Event)({ _tag: "project.Created", projectId, repoId, worktreeId, leadAgentId: lead.agentId, machineId: "local", name: "Context", goal: "" })])
  const team = success(yield* call(owner, "project.team.create", { projectId, worktreeId, name: "Build" }))
  success(yield* call(owner, "group", { agentId: worker.agentId, add: [team.group], remove: [] }))
  const sprintId = success(yield* call(owner, "project.sprint.create", { projectId, label: "SP-1", name: "Build", goal: "", phase: "Build", owner: lead.agentId, needs: [] })).sprintId
  const taskId = success(yield* call(owner, "project.task.create", { projectId, worktreeId, teamId: team.teamId, sprintId, owner: worker.agentId, title: "<img src=x onerror=alert(1)> context-secret-value", label: "TASK-1", state: "queue" })).taskId
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "context.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  expect((yield* Effect.promise(() => upgradeStatus(socket, ancestryHeaders()))).status).toBe(401)
  const api = yield* connect(socket, bearer), member = yield* connect(socket, lead.token), outsider = yield* connect(socket, stranger.token)
  const task = { _tag: "task", projectId, taskId }
  const file = { _tag: "file", projectId, repoId, worktreeId, path: "file.txt" }
  return { api, member, outsider, bearer, lead, worker, stranger, projectId, repoId, worktreeId, team, task, file }
})

it.live("searches actual scoped entities over authenticated RPC and preserves canonical direct context through retry, delivery and rebuild", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  const f = yield* setup(), context = [f.task, f.file]
  const search = { projectId: f.projectId, worktreeId: f.worktreeId, query: "" }
  const found = (yield* run(f.api, "project.context.search", search)).result
  expect(found.truncated).toBe(false)
  expect(found.items).toEqual(expect.arrayContaining([
    { reference: f.task, label: "TASK-1 · <img src=x onerror=alert(1)> [REDACTED]" }, { reference: f.file, label: "file.txt" }
  ]))
  const memberRead = yield* run(f.member, "project.context.search", search)
  expect(memberRead.data).toMatch(/^Data from another agent \[/)
  expect(memberRead.data).toContain(f.task.taskId)
  expect(memberRead.data).not.toContain("context-secret-value")
  expect(yield* refuse(run(f.outsider, "project.context.search", search))).toBe("project is unavailable to this caller")
  const payload = { requestId: freshRequest(), agentId: f.worker.agentId, text: "/owner-command is unchanged", context }
  const first = yield* run(f.api, "prompt", payload)
  expect(yield* run(f.api, "prompt", payload)).toEqual(first)
  rmSync(join(rig.work, "file.txt"))
  expect(yield* run(f.api, "prompt", payload)).toEqual(first)
  writeFileSync(join(rig.work, "file.txt"), "context-secret-value must never be inlined\n")
  expect(yield* refuse(run(f.api, "prompt", { ...payload, context: [f.task] }))).toBe("request id reused")
  const before = yield* snapshot
  expect(before.deliveries[first.deliveryId]?.content).toMatchObject({ _tag: "prompt", context })
  const text = deliveryText(before.deliveries[first.deliveryId]!)
  expect(text).toMatch(/^\/owner-command is unchanged\n\nData from another agent \[/)
  expect(text).toContain(JSON.stringify(context)); expect(text).not.toContain("must never be inlined")
  yield* dispatchQueued(f.worker.agentId)
  expect(runner.callsOf("prompt")[0]?.input.delivery.content).toMatchObject({ context })
  const history = yield* run(f.api, "client.thread", { agentId: f.worker.agentId, after: 0, limit: 100 })
  expect(history.items.find((row: any) => row.event._tag === "PromptSent")?.event).toMatchObject({ context })
  const memberPayload = { requestId: freshRequest(), agentId: f.worker.agentId, text: "\u200b/unsafe", context: [f.task] }
  const memberReply = yield* run(f.member, "prompt", memberPayload)
  expect(deliveryText((yield* snapshot).deliveries[memberReply.deliveryId]!)).toMatch(/^Data from another agent \[/)
  expect(deliveryText((yield* snapshot).deliveries[memberReply.deliveryId]!)).toContain("\u200b\\/unsafe")
}), ["context-secret-value"]).pipe(Effect.orDie))

it.live("refuses cross-project tasks and repositories, missing entities, unrelated placements, unsafe file paths and symlink escapes", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  // Issue 567: setup now queues legitimate owner-task notices. Every refused
  // request must preserve the exact current map, including those deliveries.
  const unchanged = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.gen(function* () {
    const before = (yield* snapshot).deliveries
    const value = yield* effect
    expect((yield* snapshot).deliveries).toEqual(before)
    return value
  })
  const refuseUnchanged = <A, E extends { readonly reason: string }, R>(effect: Effect.Effect<A, E, R>) => unchanged(refuse(effect))
  const send = (context: unknown[]) => run(f.api, "prompt", { agentId: f.worker.agentId, text: "Read selected context", context })
  for (const path of ["../outside/file", "/etc/passwd", ".git/config", "src/../file.txt", "src/.GiT/config", "", "src\\file"]) {
    yield* unchanged(rawRefusal(f.bearer, [{ ...f.file, path }]))
  }
  expect(yield* refuseUnchanged(send([{ ...f.file, path: "missing.txt" }]))).toBeTypeOf("string")
  symlinkSync(rig.outside, join(rig.work, "escape")); writeFileSync(join(rig.outside, "private.txt"), "private")
  expect(yield* refuseUnchanged(send([{ ...f.file, path: "escape/private.txt" }]))).toMatch(/refused|invalid_path/)
  symlinkSync(join(rig.work, "file.txt"), join(rig.work, "linked.txt"))
  expect(yield* refuseUnchanged(send([{ ...f.file, path: "linked.txt" }]))).toMatch(/refused|invalid_path/)
  expect(yield* refuseUnchanged(send([{ ...f.task, taskId: "missing" }]))).toBeTypeOf("string")
  expect(yield* refuseUnchanged(send([{ ...f.task, taskId: "context-secret-value" }]))).not.toContain("context-secret-value")
  expect(yield* refuseUnchanged(run(f.outsider, "prompt", { agentId: f.worker.agentId, text: "", context: [f.task] }))).toBeTypeOf("string")
  git(rig.outside, "init", "-b", "main")
  const repoId = (yield* run(f.api, "project.repository.add", { name: "Other", path: rig.outside, machineId: "local" })).repoId
  const worktreeId = (yield* run(f.api, "project.workspace.register", { repoId, machineId: "local", path: rig.outside, branch: "main", checkout: "main" })).worktreeId
  expect(yield* refuseUnchanged(send([{ ...f.file, repoId, worktreeId, path: "private.txt" }]))).toBeTypeOf("string")
  // Prompt failures retain the public server's existing safe reason filter.
  expect(yield* refuseUnchanged(send([{ ...f.file, repoId }]))).toBe("command refused")
  expect(yield* refuseUnchanged(run(f.api, "project.context.search", { projectId: f.projectId, worktreeId, query: "" }))).toBe("project is unavailable to this caller")
  const unrelated = join(rig.root, "unrelated"); git(rig.work, "worktree", "add", "-b", "unrelated", unrelated)
  const unrelatedId = (yield* run(f.api, "project.workspace.register", { repoId: f.repoId, path: unrelated, branch: "unrelated", machineId: "local", checkout: "worktree" })).worktreeId
  expect(yield* refuseUnchanged(send([{ ...f.file, worktreeId: unrelatedId }]))).toBeTypeOf("string")
  // Real tasks in another project of this repository and in another repository
  // must both be refused, even though the owner can read them separately.
  const foreign = yield* seedAgent({ id: "foreign", folder: rig.outside })
  for (const placement of [
    { repoId: f.repoId, worktreeId: unrelatedId, leadAgentId: f.stranger.agentId },
    { repoId, worktreeId, leadAgentId: foreign.agentId }
  ]) {
    const projectId = `project-${freshRequest()}`
    yield* appendSetup([Schema.decodeUnknownSync(Event)({ _tag: "project.Created", projectId, ...placement, machineId: "local", name: "Foreign", goal: "" })])
    const team = yield* run(f.api, "project.team.create", { projectId, worktreeId: placement.worktreeId, name: "Foreign" })
    const sprint = yield* run(f.api, "project.sprint.create", { projectId, label: "SP-1", name: "Foreign", goal: "", phase: "Build", owner: placement.leadAgentId, needs: [] })
    const task = yield* run(f.api, "project.task.create", { projectId, worktreeId: placement.worktreeId, teamId: team.teamId, sprintId: sprint.sprintId, owner: placement.leadAgentId, title: "Actual foreign task", state: "queue" })
    const reference = { _tag: "task", projectId, taskId: task.taskId }
    expect((yield* run(f.api, "project.context.search", { projectId, worktreeId: placement.worktreeId, scope: "tasks", query: "Actual foreign task" })).result.items[0]?.reference).toEqual(reference)
    expect(yield* refuseUnchanged(send([reference]))).toBe("command refused")
    expect(yield* refuseUnchanged(run(f.member, "prompt", { agentId: f.worker.agentId, text: "", context: [reference] }))).toBe("command refused")
  }
  // The exact delivery-map equality was checked after every refusal above.
  expect(JSON.stringify(yield* readLog)).not.toContain("context-secret-value")
}), ["context-secret-value"]).pipe(Effect.orDie))

it.live("keeps board post, peek, wake and agent delivery context without consuming owner or member marks", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  const f = yield* setup(), context = [f.task, f.file]
  const payload = { requestId: freshRequest(), channelId: f.team.channelId, text: "Use these references", to: [{ _tag: "agent", agentId: f.worker.agentId }], reply: "all", context }
  const first = yield* run(f.member, "board.post", payload)
  expect(yield* run(f.member, "board.post", payload)).toEqual(first)
  expect(yield* refuse(run(f.member, "board.post", { ...payload, context: [f.file] }))).toBe("request id reused")
  const marks = (yield* boardState).readState
  const peek = yield* run(f.api, "board.peek", { channelId: f.team.channelId })
  expect(peek.items[0]).toMatchObject({ postId: first.postId, context })
  expect((yield* boardState).readState).toEqual(marks)
  const [wake] = yield* queued(f.worker.agentId)
  expect(wake?.content).toMatchObject({ context })
  expect(deliveryText(wake!)).toContain(JSON.stringify(context))
  expect(deliveryText(wake!)).not.toContain("must never be inlined")
  const state = yield* snapshot
  const original = Object.values((yield* boardState).wakes).find((row) => row.deliveryId === wake!.id)!
  const { deliveryId: _deliveryId, ...wakeEvent } = original
  const rebuilt = Schema.decodeUnknownSync(Event)({ ...wakeEvent, wakeId: freshRequest() })
  if (rebuilt._tag !== "board.WakeBuilt") throw new Error("expected a wake")
  const request = { target: f.worker.agentId, sourceId: rebuilt.wakeId, body: "Existing admitted post", context: wake!.content._tag === "prompt" ? wake!.content.context! : [] }
  const control = yield* checkPieceBatch("board", state, { events: [rebuilt], deliveries: [request] }, undefined, engineLists)
  expect(control.some((event) => event._tag === "DeliveryQueued")).toBe(true)
  const forged = yield* checkPieceBatch("board", state, { events: [rebuilt], deliveries: [{ ...request, context: [] }] }, undefined, engineLists).pipe(Effect.result)
  expect(forged._tag).toBe("Failure")
  yield* dispatchQueued(f.worker.agentId)
  expect(runner.callsOf("prompt")[0]?.input.delivery.content).toMatchObject({ context })
  const worker = yield* connect(join(rig.stateFolder, "context.sock"), f.worker.token)
  expect((yield* run(worker, "board.read", { post: first.postId })).data).toContain(f.task.taskId)
  const direct = yield* run(f.api, "board.post", { direct: { _tag: "agent", agentId: f.worker.agentId }, text: "Direct context", to: [], reply: "none", context })
  expect((yield* boardState).posts[direct.postId]?.context).toEqual(context)
  // A later plain-channel member cannot acquire another project's context.
  const channelId = (yield* run(f.api, "board.open", { name: "ContextRoom" })).channelId
  yield* run(f.api, "board.members", { channelId, add: [f.worker.agentId], remove: [] })
  const postId = (yield* run(f.api, "board.post", { channelId, text: "Scoped", to: [], reply: "none", context })).postId
  yield* run(f.api, "board.members", { channelId, add: [f.stranger.agentId], remove: [] })
  expect((yield* run(f.outsider, "board.read", { channelId })).data).not.toContain(postId)
  expect(canCarryPost(yield* snapshot, f.stranger.agentId, postId)).toBe(false)
  expect(yield* refuse(run(f.api, "board.post", { channelId, text: "Refuse mixed recipients", to: [], reply: "none", context }))).toBeTypeOf("string")
}), ["context-secret-value"]).pipe(Effect.orDie))

it.live("treats context-only completion replies as protected reply data after channel membership changes", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  const channelId = (yield* run(f.api, "board.open", { name: "CompletionContext" })).channelId
  yield* run(f.api, "board.members", { channelId, add: [f.lead.agentId, f.worker.agentId], remove: [] })
  const question = yield* run(f.member, "board.post", { channelId, text: "Which task?", to: [{ _tag: "agent", agentId: f.worker.agentId }], reply: "all" })
  const worker = yield* connect(join(rig.stateFolder, "context.sock"), f.worker.token)
  yield* run(worker, "board.post", { channelId, text: "", context: [f.task], to: [], reply: "none", replyTo: question.postId })
  const [completion] = yield* queued(f.lead.agentId)
  expect(completion?.content).toMatchObject({ context: [f.task] })
  const built = Object.values((yield* boardState).wakes).find((wake) => wake.deliveryId === completion?.id)!
  expect(built.completionReplyText).toContain(question.postId)
  yield* run(f.api, "board.members", { channelId, add: [], remove: [f.lead.agentId] })
  const [metadata] = yield* queued(f.lead.agentId)
  expect(metadata).toBeDefined()
  expect(metadata!.content).not.toHaveProperty("context")
  expect(deliveryText(metadata!)).not.toContain(f.task.taskId)
}), ["context-secret-value"]).pipe(Effect.orDie))

it.live("distinguishes truncated, empty and failed searches and refuses stale placement or secret-bearing identities", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  for (let i = 0; i < 205; i++) writeFileSync(join(rig.work, `entry-${String(i).padStart(3, "0")}.txt`), "actual file")
  writeFileSync(join(rig.work, "context-secret-value.txt"), "never inline")
  const query = { projectId: f.projectId, worktreeId: f.worktreeId, scope: "files", query: "entry-", limit: 2 }
  const found = (yield* run(f.api, "project.context.search", query)).result
  expect(found.items).toHaveLength(2); expect(found.truncated).toBe(true)
  expect((yield* run(f.api, "project.context.search", { ...query, query: "no-such-file" })).result).toEqual({ items: [], truncated: false })
  expect((yield* run(f.api, "project.context.search", { ...query, query: "context-secret-value" })).result.items).toEqual([])
  expect(yield* refuse(run(f.api, "prompt", { agentId: f.worker.agentId, text: "", context: [{ ...f.file, path: "context-secret-value.txt" }] }))).not.toContain("context-secret-value")
  const saved = join(rig.work, ".git-saved"); renameSync(join(rig.work, ".git"), saved)
  expect(yield* refuse(run(f.api, "project.context.search", query))).toMatch(/^Git: /)
  renameSync(saved, join(rig.work, ".git"))
  rmSync(join(rig.work, "file.txt"))
  expect(yield* refuse(run(f.api, "prompt", { agentId: f.worker.agentId, text: "", context: [f.file] }))).toBeTypeOf("string")
  const remote = projectView(yield* snapshot).workspaces[f.worktreeId]!
  yield* appendSetup([Schema.decodeUnknownSync(Event)({ _tag: "project.WorktreeCreated", ...remote, machineId: "remote" })])
  expect(yield* refuse(run(f.api, "project.context.search", query))).toContain("local machine")
}), ["context-secret-value"]).pipe(Effect.orDie))

// The independent issue 563 probe established a 65,529-byte item array with
// 91 valid real files. Keep its strict result-only oracle, and also check the
// nearest representable overflowing and fitting results for both callers.
for (const actor of ["owner", "member"] as const) {
  for (const itemBytes of [65529, 65509, 65507]) {
    it.live(`bounds the complete encoded context result for ${actor} at ${itemBytes} item bytes`, () => provideBoard(rig, Effect.gen(function* () {
      const f = yield* setup()
      const item = (path: string) => ({ reference: { ...f.file, _tag: "file" as const, path }, label: path })
      const expected: Array<ReturnType<typeof item>> = []
      const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
      const suffix = (length: number) => {
        const parts: string[] = []
        while (length > 255) { parts.push("x".repeat(200)); length -= 201 }
        return [...parts, "x".repeat(length)].join("/")
      }
      for (let i = 0; i < 91; i++) {
        const prefix = `budget-${String(i).padStart(2, "0")}/`
        // UTF-8 and JSON escaping both count toward encoded bytes. Each real
        // component still fits the filesystem's 255-byte component limit.
        const leaf = i === 0 ? "é".repeat(60) + '"'.repeat(60) : "x".repeat(240)
        const path = prefix + (i < 90 ? leaf : suffix((itemBytes - bytes([...expected, item(prefix)])) / 2))
        expect(Schema.is(ContextPath)(path)).toBe(true)
        expect(path.split("/").every((part) => Buffer.byteLength(part) <= 255)).toBe(true)
        mkdirSync(dirname(join(rig.work, path)), { recursive: true })
        writeFileSync(join(rig.work, path), "context-secret-value must never be inlined\n")
        expected.push(item(path))
      }
      expect(bytes(expected)).toBe(itemBytes)
      const api = actor === "owner" ? f.api : f.member
      const read = (query: string, limit?: number) => Effect.gen(function* () {
        const requestId = freshRequest()
        const reply = yield* run(api, "project.context.search", { requestId, projectId: f.projectId, worktreeId: f.worktreeId, scope: "files", query, ...(limit === undefined ? {} : { limit }) })
        expect(reply.requestId).toBe(requestId)
        let result = reply.result
        if (actor === "member") {
          expect(reply.data).toMatch(/^Data from another agent \[/)
          expect(reply.data).toMatch(/\nEnd data \[[^\]]+\]$/)
          expect(reply).not.toHaveProperty("result")
          const enclosed = JSON.parse(reply.data.slice(reply.data.indexOf("\n") + 1, reply.data.lastIndexOf("\n")))
          expect(enclosed.requestId).toBe(requestId)
          result = enclosed.result
        }
        const decoded = Schema.decodeUnknownSync(ContextSearchResult)(result)
        expect(bytes(Schema.encodeSync(ContextSearchResult)(decoded))).toBeLessThanOrEqual(65536)
        expect(JSON.stringify(reply)).not.toContain("must never be inlined")
        expect(JSON.stringify(reply)).not.toContain("context-secret-value")
        return decoded
      })
      const found = yield* read("budget-")
      const fits = itemBytes === 65507
      expect(found.items).toEqual(fits ? expected : expected.slice(0, -1))
      expect(found.truncated).toBe(!fits)
      if (!fits) expect(bytes({ items: [...found.items, expected.at(-1)!], truncated: false })).toBeGreaterThan(65536)
      expect(yield* read("budget-", 2)).toEqual({ items: expected.slice(0, 2), truncated: true })
      expect(yield* read("budget-00/")).toEqual({ items: expected.slice(0, 1), truncated: false })
      expect(yield* read("budget-no-match")).toEqual({ items: [], truncated: false })
      expect(yield* refuse(run(f.outsider, "project.context.search", { projectId: f.projectId, worktreeId: f.worktreeId, scope: "files", query: "budget-" }))).toBe("project is unavailable to this caller")
    }), ["context-secret-value"]).pipe(Effect.orDie))
  }
}
