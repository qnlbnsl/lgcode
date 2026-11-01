// Unit 6a's additions to the scripted fake agent and the replay player. The runner tests in
// `packages/engine/test/runner/` read these behaviours; each test here names the change to the
// fake agent or the player that would make it fail.
//
// - `FAKE_AGENT_ECHO=<file>`: the agent writes its pid, arguments, working folder, environment
//   and every raw inbound frame there, after every frame it receives.
// - Step `stderr_part` (unit 6c tests): stderr text with no line end added.
// - Steps `stderr`, `rpc_error`, `raw_frame` and `client_request`, whose text expands
//   `${env:NAME}`, `${env-u:NAME}` (the value as JSON \u escapes) and `${session}`.
// - The permission step's optional `locations`.
// - `replay.ts <fixture> --workspace <folder> --match method`.
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, it } from "@effect/vitest"
import * as AcpClient from "@shepherd/t3-effect-acp/client"
import * as Effect from "effect/Effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import * as Stream from "effect/Stream"

const fakeAgentPath = fileURLToPath(new URL("../src/fakeAgent.ts", import.meta.url))
const playerPath = fileURLToPath(new URL("../src/replay.ts", import.meta.url))
const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}.ndjson`, import.meta.url))
const planted = "sk-ant-api03-PLANTEDRUNNERSTEP0123456789"

type Update = { readonly sessionUpdate: string; readonly [key: string]: unknown }

const temporaryFolder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "shepherd-fake-agent-6a-"))),
  (folder) => Effect.promise(() => rm(folder, { recursive: true, force: true }))
)

// One session and one prompt against the fake agent, with the echo file and a planted variable.
const run = (turns: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>, permission?: (request: unknown) => unknown) =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const home = yield* temporaryFolder
    const echoFile = join(home, "echo.json")
    const env = { PATH: "/usr/bin:/bin", HOME: home, PLANTED_VALUE: planted, FAKE_AGENT_ECHO: echoFile, FAKE_AGENT_SCRIPT: JSON.stringify({ turns }) }
    const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [fakeAgentPath, "--first", "second"], { cwd: home, env }))
    const stderr: Array<string> = []
    yield* handle.stderr.pipe(Stream.decodeText, Stream.runForEach((chunk) => Effect.sync(() => void stderr.push(chunk))), Effect.forkScoped)
    const updates: Array<Update> = []
    const permissions: Array<unknown> = []
    const outcome = yield* Effect.gen(function*() {
      const acp = yield* AcpClient.AcpClient
      yield* acp.handleSessionUpdate((notification) => Effect.sync(() => void updates.push(notification.update as unknown as Update)))
      yield* acp.handleRequestPermission((request) => Effect.sync(() => {
        permissions.push(request)
        return (permission?.(request) ?? { outcome: { outcome: "selected", optionId: "allow" } }) as never
      }))
      yield* acp.agent.initialize({ protocolVersion: 2, clientInfo: { name: "steps-test", version: "0.0.0" } })
      const session = yield* acp.agent.createSession({ cwd: home, mcpServers: [] })
      const reply = yield* acp.agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] }).pipe(Effect.result)
      return { session, reply }
    }).pipe(Effect.provide(AcpClient.layerChildProcess(handle)))
    const texts = () => updates.filter((update) => update.sessionUpdate === "agent_message_chunk").map((update) => (update.content as { text: string }).text)
    const echo = JSON.parse(yield* Effect.promise(() => readFile(echoFile, "utf8"))) as {
      pid: number; argv: Array<string>; cwd: string; env: Record<string, string>; inbound: Array<{ method?: string; params?: unknown }>
    }
    return { ...outcome, home, echo, updates, texts, permissions, stderr: () => stderr.join(""), stderrChunks: () => [...stderr] }
  })

const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test().pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<void, unknown, never>, 30_000)

live("the echo file holds the pid, arguments, folder, environment and raw inbound frames (breaks if the echo is not written, or records frames after the version adapter rewrote them)", () =>
  Effect.gen(function*() {
    const { echo, home } = yield* run([[]])
    assert.isAbove(echo.pid, 1)
    assert.deepEqual(echo.argv.slice(1), [fakeAgentPath, "--first", "second"])
    assert.equal(echo.cwd, home)
    assert.equal(echo.env.PLANTED_VALUE, planted)
    assert.deepEqual(echo.inbound.map((frame) => frame.method), ["initialize", "session/new", "session/prompt"])
    assert.deepEqual((echo.inbound[0]!.params as Record<string, unknown>).clientInfo, { name: "steps-test", version: "0.0.0" })
    assert.deepEqual((echo.inbound[1]!.params as Record<string, unknown>).mcpServers, [])
  }))

live("a stderr step writes the expanded text to stderr (breaks if ${env:NAME} is not expanded or the line goes to stdout)", () =>
  Effect.gen(function*() {
    const result = yield* run([[{ step: "stderr", text: "boom ${env:PLANTED_VALUE} end" }]])
    assert.include(result.stderr(), `boom ${planted} end`)
    assert.equal(result.reply._tag, "Success")
  }))

live("stderr_part steps write their text with no line end added, so a slow step between two of them splits one line across two chunks (breaks if a newline is appended to each part, the parts are joined into one write, or ${env:NAME} is not expanded)", () =>
  Effect.gen(function*() {
    const result = yield* run([[
      { step: "stderr_part", text: "boom first-half-" },
      { step: "slow", ms: 150 },
      { step: "stderr_part", text: "${env:PLANTED_VALUE} second-half\n" }
    ]])
    const chunks = result.stderrChunks()
    assert.isAtLeast(chunks.length, 2)
    assert.isFalse(chunks[0]!.includes("\n"))
    assert.equal(chunks.join(""), `boom first-half-${planted} second-half\n`)
    assert.equal(result.reply._tag, "Success")
  }))

live("an rpc_error step fails the prompt request with the expanded message (breaks if the error is sent as an idle state or the message is not expanded)", () =>
  Effect.gen(function*() {
    const result = yield* run([[{ step: "rpc_error", message: "failed with ${env:PLANTED_VALUE}" }]])
    assert.equal(result.reply._tag, "Failure")
    assert.include(JSON.stringify(result.reply), planted)
  }))

live("a raw_frame step writes the frame verbatim, with \\u-escaped values that decode to the variable (breaks if raw frames are re-encoded or ${env-u:NAME} is written raw)", () =>
  Effect.gen(function*() {
    const frame = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${session}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"quoted \\"${env-u:PLANTED_VALUE}\\" end"}}}}'
    const result = yield* run([[{ step: "raw_frame", frame }]])
    assert.include(result.texts(), `quoted "${planted}" end`)
  }))

live("a client_request step reports the client's refusal code as text (breaks if the request is not sent or a refusal is reported as ok)", () =>
  Effect.gen(function*() {
    const result = yield* run([[
      { step: "client_request", method: "fs/read_text_file", params: { sessionId: "s", path: "/etc/hostname" } },
      { step: "client_request", method: "terminal/create", params: { sessionId: "s", command: "true" } }
    ]])
    const reports = result.texts().filter((text) => text.startsWith("client_request:"))
    assert.equal(reports.length, 2)
    for (const report of reports) assert.match(report, /^client_request:(fs\/read_text_file|terminal\/create):error:/)
  }))

live("a permission step passes its locations in the tool call (breaks if locations are dropped from the request)", () =>
  Effect.gen(function*() {
    const result = yield* run([[{
      step: "permission", toolCallId: "tc-1", title: "Write settings", locations: [{ path: "/work/.claude/settings.local.json" }],
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }]
    }]])
    const toolCall = (result.permissions[0] as { toolCall?: { locations?: unknown } }).toolCall
    assert.deepEqual(toolCall?.locations, [{ path: "/work/.claude/settings.local.json" }])
    assert.include(result.texts(), "permission:selected:allow")
  }))

live("replay --match method answers a client's own frames with the recorded replies under the client's ids (breaks if the player compares whole frames or keeps the recorded ids)", () =>
  Effect.gen(function*() {
    const folder = yield* temporaryFolder
    const child = spawn(process.execPath, [playerPath, fixture("codex"), "--workspace", folder, "--match", "method"], {
      cwd: folder, env: { PATH: "/usr/bin:/bin", HOME: folder }, stdio: ["pipe", "pipe", "pipe"]
    })
    const lines: Array<Record<string, unknown>> = []
    let buffer = ""
    child.stdout.on("data", (chunk) => {
      buffer += chunk
      const parts = buffer.split("\n")
      buffer = parts.pop() ?? ""
      for (const part of parts) if (part.trim()) lines.push(JSON.parse(part))
    })
    const until = (count: number) => Effect.promise(async () => {
      for (let attempt = 0; attempt < 200 && lines.length < count; attempt++) await new Promise((resolve) => setTimeout(resolve, 25))
    })
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 41, method: "initialize", params: { protocolVersion: 2, clientInfo: { name: "shepherd", version: "1" } } }) + "\n")
    yield* until(1)
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 42, method: "session/set_model", params: {} }) + "\n")
    yield* until(2)
    child.stdin.end()
    yield* Effect.promise(() => new Promise((resolve) => child.on("close", resolve)))
    assert.equal(lines[0]!.id, 41)
    assert.equal((lines[0]!.result as { protocolVersion: number }).protocolVersion, 2)
    assert.deepEqual(lines[1], { jsonrpc: "2.0", id: 42, error: { code: -32601, message: "Method not found" } })
  }))

live("strictConfigOptions refuses an unknown option or an unlisted value and keeps the current value (breaks if the fake agent accepts any value, so a runner's rejected-value path is never exercised)", () =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const home = yield* temporaryFolder
    const mode = { configId: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }, { value: "plan", name: "Plan" }] }
    const env = { PATH: "/usr/bin:/bin", HOME: home, FAKE_AGENT_SCRIPT: JSON.stringify({ configOptions: [mode], strictConfigOptions: true, turns: [] }) }
    const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [fakeAgentPath], { cwd: home, env }))
    yield* Effect.gen(function*() {
      const acp = yield* AcpClient.AcpClient
      yield* acp.agent.initialize({ protocolVersion: 2, clientInfo: { name: "steps-test", version: "0.0.0" } })
      const session = yield* acp.agent.createSession({ cwd: home, mcpServers: [] })
      const set = (configId: string, value: string) => acp.agent.setSessionConfigOption({ sessionId: session.sessionId, configId, value } as never).pipe(Effect.result)
      assert.equal((yield* set("mode", "yolo"))._tag, "Failure")
      assert.equal((yield* set("model", "x"))._tag, "Failure")
      const accepted = yield* set("mode", "plan")
      assert.equal(accepted._tag, "Success")
    }).pipe(Effect.provide(AcpClient.layerChildProcess(handle)))
  }))
