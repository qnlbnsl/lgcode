// Unit 7a's additions to the scripted fake agent. The service tests in
// `packages/engine/test/api/` read these behaviours; each test here names the change to the fake
// agent that would make it fail.
//
// - Step `exec`: runs `node <argv...>` as a child in the agent's own process group, with the
//   agent's environment minus the names in `strip`, waits for it, then sends `exec:<exit code>`.
// - Script option `outliveStdin`: the agent keeps running after its standard input ends.
// - Script option `loadGate`: session/load does not reply until the named file exists.
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, it } from "@effect/vitest"
import * as AcpClient from "@shephrd/t3-effect-acp/client"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

const fakeAgentPath = fileURLToPath(new URL("../src/fakeAgent.ts", import.meta.url))

const temporaryFolder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "shephrd-fake-agent-7a-"))),
  (folder) => Effect.promise(() => rm(folder, { recursive: true, force: true }))
)

const statOf = (pid: number) => {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8")
  return text.slice(text.lastIndexOf(")") + 2).split(" ")
}
const alive = (pid: number) => {
  try { return statOf(pid)[0] !== "Z" } catch { return false }
}

// Polls a named condition, never longer than `limit` milliseconds.
const until = (what: string, check: () => boolean, limit = 10_000) => Effect.gen(function*() {
  const deadline = Date.now() + limit
  while (!check()) {
    if (Date.now() > deadline) return yield* Effect.die(new Error(`Timed out waiting for ${what}`))
    yield* Effect.sleep(20)
  }
})

const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test().pipe(Effect.scoped, Effect.provide(NodeServices.layer)) as Effect.Effect<void, unknown, never>, 30_000)

live("exec runs node with the given arguments in the agent's process group, strips the named variables and reports the exit code (breaks if the child is detached, inherits the stripped names, or the step does not wait for it)", () =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const home = yield* temporaryFolder
    const report = join(home, "report.json")
    const caller = join(home, "caller.mjs")
    yield* Effect.promise(() => writeFile(caller, [
      "import { readFileSync, writeFileSync } from 'node:fs'",
      "const stat = (pid) => { const t = readFileSync(`/proc/${pid}/stat`, 'utf8'); return t.slice(t.lastIndexOf(')') + 2).split(' ') }",
      "writeFileSync(process.argv[2], JSON.stringify({ argv: process.argv.slice(2), ppid: process.ppid, group: Number(stat(process.pid)[2]),",
      "  socket: process.env.SHEPHRD_SOCKET ?? null, token: process.env.SHEPHRD_TOKEN ?? null, kept: process.env.KEPT_VALUE ?? null }))",
      "process.exit(7)"
    ].join("\n")))
    const env = {
      PATH: "/usr/bin:/bin", HOME: home, SHEPHRD_SOCKET: "/tmp/planted.sock", SHEPHRD_TOKEN: "planted-token", KEPT_VALUE: "kept",
      FAKE_AGENT_SCRIPT: JSON.stringify({ turns: [[{ step: "exec", argv: [caller, report, "second"], strip: ["SHEPHRD_SOCKET", "SHEPHRD_TOKEN"] }]] })
    }
    const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [fakeAgentPath], { cwd: home, env, detached: true }))
    const texts: Array<string> = []
    yield* Effect.gen(function*() {
      const acp = yield* AcpClient.AcpClient
      yield* acp.handleSessionUpdate((notification) => Effect.sync(() => {
        const update = notification.update as { sessionUpdate: string; content?: { text?: string } }
        if (update.sessionUpdate === "agent_message_chunk" && update.content?.text !== undefined) texts.push(update.content.text)
      }))
      yield* acp.agent.initialize({ protocolVersion: 2, clientInfo: { name: "exec-test", version: "0.0.0" } })
      const session = yield* acp.agent.createSession({ cwd: home, mcpServers: [] })
      yield* acp.agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] })
    }).pipe(Effect.provide(AcpClient.layerChildProcess(handle)))
    const written = JSON.parse(readFileSync(report, "utf8")) as { argv: Array<string>; ppid: number; group: number; socket: string | null; token: string | null; kept: string | null }
    assert.deepEqual(written.argv, [report, "second"])
    assert.equal(written.ppid, Number(handle.pid))
    assert.equal(written.group, Number(statOf(Number(handle.pid))[2]))
    assert.equal(written.socket, null)
    assert.equal(written.token, null)
    assert.equal(written.kept, "kept")
    assert.include(texts, "exec:7")
  }))

live("outliveStdin keeps the agent running after its standard input ends, while an agent without it exits (breaks if the option is ignored or ends the agent on end of input)", () =>
  Effect.gen(function*() {
    const home = yield* temporaryFolder
    const start = (script: Record<string, unknown>) => {
      const child = spawn(process.execPath, [fakeAgentPath], { cwd: home, env: { PATH: "/usr/bin:/bin", HOME: home, FAKE_AGENT_SCRIPT: JSON.stringify(script) }, stdio: ["pipe", "ignore", "ignore"], detached: true })
      return child
    }
    const outliving = start({ turns: [], outliveStdin: true })
    const control = start({ turns: [] })
    yield* Effect.addFinalizer(() => Effect.sync(() => {
      for (const child of [outliving, control]) { try { process.kill(-child.pid!, "SIGKILL") } catch { /* gone */ } }
    }))
    let controlExited = false
    control.once("exit", () => { controlExited = true })
    yield* until("both agents to start", () => alive(outliving.pid!) && alive(control.pid!))
    outliving.stdin!.end()
    control.stdin!.end()
    yield* until("the control agent to exit at the end of its input", () => controlExited)
    assert.isTrue(alive(outliving.pid!), "the outliveStdin agent exited when its input ended")
    let exited: { code: number | null; signal: string | null } | undefined
    outliving.once("exit", (code, signal) => { exited = { code, signal } })
    process.kill(outliving.pid!, "SIGTERM")
    yield* until("the outliveStdin agent to stop on SIGTERM", () => exited !== undefined)
  }))

live("loadGate holds the session/load reply until the gate file exists (breaks if load replies at once, or never replies after the gate appears)", () =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const home = yield* temporaryFolder
    const gate = join(home, "gate")
    const echo = join(home, "echo.json")
    const env = { PATH: "/usr/bin:/bin", HOME: home, FAKE_AGENT_ECHO: echo, FAKE_AGENT_SCRIPT: JSON.stringify({ turns: [], loadGate: gate }) }
    const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [fakeAgentPath], { cwd: home, env, detached: true }))
    yield* Effect.gen(function*() {
      const acp = yield* AcpClient.AcpClient
      yield* acp.agent.initialize({ protocolVersion: 2, clientInfo: { name: "gate-test", version: "0.0.0" } })
      const load = yield* acp.agent.loadSession({ sessionId: "fake-session-9", cwd: home, mcpServers: [] }).pipe(Effect.forkScoped)
      yield* until("the agent to receive the load request", () => {
        try { return (JSON.parse(readFileSync(echo, "utf8")) as { inbound: Array<{ method?: string }> }).inbound.some((frame) => frame.method === "session/resume" || frame.method === "session/load") } catch { return false }
      })
      // Absence inside a window, not a sleep as proof of the positive case.
      const early = yield* Fiber.join(load).pipe(Effect.timeoutOption(300))
      assert.isTrue(early._tag === "None", "session/load replied before the gate existed")
      assert.isFalse(existsSync(gate))
      yield* Effect.promise(() => writeFile(gate, ""))
      yield* Fiber.join(load).pipe(Effect.timeout(10_000))
    }).pipe(Effect.provide(AcpClient.layerChildProcess(handle)))
  }))
