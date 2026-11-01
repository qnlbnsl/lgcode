// Criterion 8.1: the fake agent follows a JSON script from an environment variable, over real
// Agent Client Protocol (ACP) on standard input and output, in the protocol version the real
// adapters negotiate (version 2).
//
// The fake agent is a program, `packages/testing/src/fakeAgent.ts`, started with
// `node <path>`. Its script is the JSON text in `FAKE_AGENT_SCRIPT`:
//
//   { "agentInfo"?: { "name": string, "version": string },
//     "configOptions"?: SessionConfigOption[],        // returned by session/new
//     "history"?: [{ "role": "user" | "agent", "text": string }],   // replayed on load
//     "turns": Step[][] }                              // the nth prompt runs turns[n]
//
// A prompt past the end of `turns` ends at once with `end_turn`. Every test drives the program
// with the copied `effect-acp` client, never a hand-written peer. Each test name says which
// production change makes it fail.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, it } from "@effect/vitest"
import * as AcpClient from "@shepherd/t3-effect-acp/client"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import * as Stream from "effect/Stream"
import { WebSocketServer } from "ws"

const fakeAgentPath = fileURLToPath(new URL("../src/fakeAgent.ts", import.meta.url))

const secretToken = "shp_a_PLANTEDTOKENVALUE0123456789abcdef"
const secretEnvValue = "planted-env-value-9f8e7d6c5b4a"

type Update = { readonly sessionUpdate: string; readonly [key: string]: unknown }
type Script = Record<string, unknown>

const modeOption = {
  configId: "mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: "default",
  options: [
    { value: "default", name: "Default" },
    { value: "plan", name: "Plan" },
    { value: "read-only", name: "Read only" }
  ]
}

const temporaryFolder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "shepherd-fake-agent-"))),
  (folder) => Effect.promise(() => rm(folder, { recursive: true, force: true }))
)

const startAgent = (script: Script | undefined, extraEnv: Record<string, string> = {}) =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const home = yield* temporaryFolder
    // An explicit, minimal environment: the test never hands its own environment to the child.
    const env: Record<string, string> = {
      PATH: "/usr/bin:/bin",
      HOME: home,
      TMPDIR: home,
      ...(script === undefined ? {} : { FAKE_AGENT_SCRIPT: JSON.stringify(script) }),
      ...extraEnv
    }
    const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [fakeAgentPath], { cwd: home, env }))
    const stderrChunks: Array<string> = []
    const stderrEnded = yield* Deferred.make<void>()
    yield* handle.stderr.pipe(
      Stream.decodeText,
      Stream.runForEach((chunk) => Effect.sync(() => void stderrChunks.push(chunk))),
      Effect.ensuring(Deferred.succeed(stderrEnded, undefined)),
      Effect.forkScoped
    )
    return { handle, home, stderr: () => stderrChunks.join(""), stderrEnded: Deferred.await(stderrEnded) }
  })

interface Context {
  readonly acp: AcpClient.AcpClient["Service"]
  readonly home: string
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  readonly updates: Array<Update>
  readonly logs: Array<string>
  readonly stderr: () => string
  readonly waitFor: (predicate: (update: Update) => boolean) => Effect.Effect<Update>
}

// Starts the agent, installs a logger that records every log line (the stand-in for the service
// logger until unit 5a's redactor exists), leaves every wire option off, and records every
// session update.
const withClient = <A, E, R>(
  script: Script | undefined,
  options: { readonly env?: Record<string, string> },
  body: (context: Context) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const started = yield* startAgent(script, options.env)
    const logs: Array<string> = []
    const logger = Logger.make(({ message, cause }) => {
      logs.push(JSON.stringify([message, String(cause)]))
    })
    const updates: Array<Update> = []
    const waiters: Array<{ predicate: (update: Update) => boolean; done: Deferred.Deferred<Update> }> = []
    return yield* Effect.gen(function*() {
      const acp = yield* AcpClient.AcpClient
      yield* acp.handleSessionUpdate((notification) =>
        Effect.gen(function*() {
          const update = notification.update as unknown as Update
          updates.push(update)
          for (const waiter of waiters) {
            if (waiter.predicate(update)) yield* Deferred.succeed(waiter.done, update)
          }
        })
      )
      const waitFor = (predicate: (update: Update) => boolean) =>
        Effect.gen(function*() {
          const existing = updates.find(predicate)
          if (existing !== undefined) return existing
          const done = yield* Deferred.make<Update>()
          waiters.push({ predicate, done })
          return yield* Deferred.await(done).pipe(Effect.timeout("10 seconds"), Effect.orDie)
        })
      return yield* body({
        acp,
        home: started.home,
        handle: started.handle,
        updates,
        logs,
        stderr: started.stderr,
        waitFor
      })
    }).pipe(
      Effect.provide(AcpClient.layerChildProcess(started.handle)),
      Effect.provide(Logger.layer([logger]))
    )
  })

const isIdle = (update: Update) => update.sessionUpdate === "state_update" && update.state === "idle"

const textOf = (updates: ReadonlyArray<Update>) =>
  updates
    .filter((update) => update.sessionUpdate === "agent_message_chunk")
    .map((update) => (update.content as { text?: string }).text ?? "")

const allow = { outcome: { outcome: "selected" as const, optionId: "allow-once" } }

// Initialises in protocol version 2, opens a session and sends one prompt.
const converse = (
  script: Script,
  options: {
    readonly env?: Record<string, string>
    readonly permission?: (request: unknown) => unknown
    readonly elicitation?: (request: unknown) => unknown
  } = {}
) =>
  withClient(script, { ...(options.env ? { env: options.env } : {}) }, (context) =>
    Effect.gen(function*() {
      const permissionRequests: Array<unknown> = []
      const elicitationRequests: Array<unknown> = []
      yield* context.acp.handleRequestPermission((request) =>
        Effect.sync(() => {
          permissionRequests.push(request)
          return (options.permission?.(request) ?? allow) as never
        })
      )
      yield* context.acp.handleElicitation((request) =>
        Effect.sync(() => {
          elicitationRequests.push(request)
          return (options.elicitation?.(request) ?? { action: "accept", content: {} }) as never
        })
      )
      const init = yield* context.acp.agent.initialize({
        protocolVersion: 2,
        clientInfo: { name: "fake-agent-test", version: "0.0.0" }
      })
      const session = yield* context.acp.agent.createSession({ cwd: context.home, mcpServers: [] })
      const result = yield* context.acp.agent.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "go" }]
      })
      yield* context.waitFor(isIdle)
      return { ...context, init, session, result, permissionRequests, elicitationRequests }
    }))

const assertNoSecret = (haystacks: ReadonlyArray<string>, secrets: ReadonlyArray<string>) => {
  for (const haystack of haystacks) {
    for (const secret of secrets) assert.notInclude(haystack, secret)
  }
}

// `it.layer` hands its callback a test API without `live`, and the tests need the real clock, so
// each test provides the Node services itself.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout?: number) =>
  it.live(name, () => test().pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<void, unknown, never>, timeout)

live(
  "answers protocol version 2 and names itself from the script (breaks if the fake agent answers version 1 or ignores agentInfo)",
  () =>
    withClient({ agentInfo: { name: "fake-adapter", version: "9.8.7" }, turns: [] }, {}, ({ acp }) =>
      Effect.gen(function*() {
        const init = yield* acp.agent.initialize({ protocolVersion: 2 })
        assert.equal(init.protocolVersion, 2)
        assert.deepEqual(
          { name: init.agentInfo?.name, version: init.agentInfo?.version },
          { name: "fake-adapter", version: "9.8.7" }
        )
      }))
)

live("exits non-zero and names the variable when FAKE_AGENT_SCRIPT is missing (breaks if the fake agent starts with no script and waits forever)", () =>
  Effect.gen(function*() {
    const { handle, stderr, stderrEnded } = yield* startAgent(undefined)
    const code = yield* handle.exitCode.pipe(Effect.timeout("10 seconds"), Effect.orDie)
    assert.notEqual(Number(code), 0)
    yield* stderrEnded.pipe(Effect.timeout("10 seconds"), Effect.orDie)
    assert.include(stderr(), "FAKE_AGENT_SCRIPT")
  }))

live("emits a text step as an agent message chunk between running and idle (breaks if text steps are dropped or the turn has no running/idle state updates)", () =>
  Effect.gen(function*() {
    const run = yield* converse({ turns: [[{ step: "text", text: "hello there" }]] })
    assert.deepEqual(textOf(run.updates), ["hello there"])
    assert.equal(run.result.stopReason, "end_turn")
    const states = run.updates
      .filter((update) => update.sessionUpdate === "state_update")
      .map((update) => update.state)
    assert.deepEqual(states, ["running", "idle"])
  }))

live("a prompt past the end of the script ends the turn at once with end_turn (breaks if an unscripted prompt hangs or errors)", () =>
  Effect.gen(function*() {
    const run = yield* converse({ turns: [] })
    assert.equal(run.result.stopReason, "end_turn")
    assert.deepEqual(textOf(run.updates), [])
  }))

live("a plan step emits a plan update with the entries as given (breaks if plan steps are dropped or entries are rewritten)", () =>
  Effect.gen(function*() {
    const entries = [
      { content: "Read the code", priority: "high", status: "completed" },
      { content: "Write the test", priority: "medium", status: "in_progress" }
    ]
    const run = yield* converse({ turns: [[{ step: "plan", entries }]] })
    const plan = run.updates.find((update) => update.sessionUpdate === "plan_update")
    assert.deepEqual((plan?.plan as { entries: unknown }).entries, entries)
  }))

live("a tool call step emits a tool call update with id, title, kind, status and output (breaks if the tool call fields are lost)", () =>
  Effect.gen(function*() {
    const run = yield* converse({
      turns: [[{
        step: "tool_call",
        toolCallId: "tool-7",
        title: "List files",
        kind: "execute",
        status: "completed",
        output: "a.txt b.txt"
      }]]
    })
    const call = run.updates.find((update) => update.sessionUpdate === "tool_call_update" && update.toolCallId === "tool-7")
    assert.isDefined(call)
    assert.equal(call?.title, "List files")
    assert.equal(call?.kind, "execute")
    assert.equal(call?.status, "completed")
    assert.include(JSON.stringify(call), "a.txt b.txt")
  }))

live("a file change step emits a diff with the operation, absolute path and git patch (breaks if file changes are not sent as diffs)", () =>
  Effect.gen(function*() {
    const patch = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n"
    const run = yield* converse({
      turns: [[{ step: "file_change", toolCallId: "edit-1", path: "/work/x.ts", operation: "modify", patch }]]
    })
    const update = run.updates.find((candidate) => candidate.sessionUpdate === "tool_call_update" && candidate.toolCallId === "edit-1")
    const diff = (update?.content as Array<Record<string, any>> | undefined)?.find((entry) => entry.type === "diff")
    assert.isDefined(diff)
    assert.equal(diff?.changes[0].operation, "modify")
    assert.equal(diff?.changes[0].path, "/work/x.ts")
    assert.deepEqual(diff?.patch, { format: "git_patch", text: patch })
  }))

live("a permission step sends all four option kinds and reports the chosen option back as text (breaks if option kinds are collapsed or the answer is not delivered to the agent)", () =>
  Effect.gen(function*() {
    const options = [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
      { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
      { optionId: "reject-always", name: "Always reject", kind: "reject_always" }
    ]
    const run = yield* converse(
      { turns: [[{ step: "permission", toolCallId: "tool-9", title: "Run ls", options }]] },
      { permission: () => ({ outcome: { outcome: "selected", optionId: "allow-always" } }) }
    )
    assert.equal(run.permissionRequests.length, 1)
    const request = run.permissionRequests[0] as Record<string, any>
    assert.equal(request.title, "Run ls")
    assert.deepEqual(request.options.map((option: any) => [option.optionId, option.kind]), [
      ["allow-once", "allow_once"],
      ["allow-always", "allow_always"],
      ["reject-once", "reject_once"],
      ["reject-always", "reject_always"]
    ])
    assert.equal(request.subject.toolCall.toolCallId, "tool-9")
    assert.deepEqual(textOf(run.updates), ["permission:selected:allow-always"])
  }))

live("a cancelled permission answer reaches the agent as permission:cancelled (breaks if cancel is treated as a selection)", () =>
  Effect.gen(function*() {
    const run = yield* converse(
      {
        turns: [[{
          step: "permission",
          toolCallId: "tool-1",
          title: "Run ls",
          options: [{ optionId: "allow-once", name: "Allow", kind: "allow_once" }]
        }]]
      },
      { permission: () => ({ outcome: { outcome: "cancelled" } }) }
    )
    assert.deepEqual(textOf(run.updates), ["permission:cancelled"])
  }))

live("a question step asks through elicitation and reports the accepted content (breaks if questions are not sent as form elicitations or the answer is lost)", () =>
  Effect.gen(function*() {
    const requestedSchema = {
      type: "object",
      properties: { colour: { type: "string", title: "Colour" } },
      required: ["colour"]
    }
    const run = yield* converse(
      { turns: [[{ step: "question", message: "Which colour?", requestedSchema }]] },
      { elicitation: () => ({ action: "accept", content: { colour: "green" } }) }
    )
    const request = run.elicitationRequests[0] as Record<string, any>
    assert.equal(request.message, "Which colour?")
    assert.equal(request.mode, "form")
    assert.deepEqual(request.requestedSchema, requestedSchema)
    assert.deepEqual(textOf(run.updates), ['question:accept:{"colour":"green"}'])
  }))

live("a declined question reaches the agent as question:decline (breaks if decline is reported as accept)", () =>
  Effect.gen(function*() {
    const run = yield* converse(
      { turns: [[{ step: "question", message: "Sure?", requestedSchema: { type: "object", properties: {} } }]] },
      { elicitation: () => ({ action: "decline" }) }
    )
    assert.deepEqual(textOf(run.updates), ["question:decline"])
  }))

live("a mode change step moves the mode option through a config option update, not a mode update (breaks if the fake agent uses the removed current_mode_update; row 70)", () =>
  Effect.gen(function*() {
    const run = yield* converse({
      configOptions: [modeOption],
      turns: [[{ step: "mode_change", configId: "mode", value: "plan" }]]
    })
    assert.isUndefined(run.updates.find((update) => update.sessionUpdate === "current_mode_update"))
    const change = run.updates.find((update) => update.sessionUpdate === "config_option_update")
    const options = change?.configOptions as Array<Record<string, any>>
    const mode = options.find((option) => option.category === "mode")
    assert.equal(mode?.currentValue, "plan")
  }))

live("a config options step sends the options exactly as scripted (breaks if config option updates are filtered or rewritten)", () =>
  Effect.gen(function*() {
    const configOptions = [
      { configId: "model", name: "Model", category: "model", type: "select", currentValue: "a",
        options: [{ value: "a", name: "A" }, { value: "b", name: "B" }] },
      { configId: "verbose", name: "Verbose", type: "boolean", currentValue: true }
    ]
    const run = yield* converse({ turns: [[{ step: "config_options", configOptions }]] })
    const update = run.updates.find((candidate) => candidate.sessionUpdate === "config_option_update")
    // The copied client renames configId to id on the way in; nothing else may change.
    const expected = configOptions.map(({ configId, ...rest }) => ({ id: configId, ...rest }))
    assert.deepEqual(update?.configOptions, expected)
  }))

live("session/new returns the scripted options and set_config_option changes the current value, while set_mode is refused (breaks if the mode is set by session/set_mode; row 70)", () =>
  withClient({ configOptions: [modeOption], turns: [] }, {}, ({ acp, home }) =>
    Effect.gen(function*() {
      yield* acp.agent.initialize({ protocolVersion: 2 })
      const session = yield* acp.agent.createSession({ cwd: home, mcpServers: [] })
      const created = session.configOptions as unknown as Array<Record<string, any>>
      assert.equal(created.find((option) => option.category === "mode")?.currentValue, "default")

      const changed = yield* acp.agent.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "mode",
        value: "read-only"
      } as never)
      const after = changed.configOptions as unknown as Array<Record<string, any>>
      assert.equal(after.find((option) => option.id === "mode")?.currentValue, "read-only")

      const refused = yield* acp.agent.setSessionMode({ sessionId: session.sessionId, modeId: "plan" }).pipe(Effect.flip)
      assert.equal(refused._tag === "AcpRequestError" ? refused.code : undefined, -32601)
    }))
)

live("an end turn step ends the turn with its stop reason and skips later steps (breaks if later steps still run or the reason is replaced by end_turn)", () =>
  Effect.gen(function*() {
    const run = yield* converse({
      turns: [[
        { step: "text", text: "before" },
        { step: "end_turn", stopReason: "max_tokens" },
        { step: "text", text: "after" }
      ]]
    })
    assert.equal(run.result.stopReason, "max_tokens")
    assert.deepEqual(textOf(run.updates), ["before"])
  }))

live("each prompt runs the next turn of the script (breaks if every prompt replays the first turn)", () =>
  withClient({ turns: [[{ step: "text", text: "one" }], [{ step: "text", text: "two" }]] }, {}, (context) =>
    Effect.gen(function*() {
      yield* context.acp.agent.initialize({ protocolVersion: 2 })
      const session = yield* context.acp.agent.createSession({ cwd: context.home, mcpServers: [] })
      const send = () => context.acp.agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] })
      yield* send()
      yield* send()
      yield* context.waitFor((update) => isIdle(update) && textOf(context.updates).length === 2)
      assert.deepEqual(textOf(context.updates), ["one", "two"])
    }))
)

live("a crash step exits the process with the scripted code mid-turn and the client sees the exit (breaks if the crash step returns an error reply instead of killing the process)", () =>
  withClient({ turns: [[{ step: "text", text: "last words" }, { step: "crash", exitCode: 3 }]] }, {}, (context) =>
    Effect.gen(function*() {
      yield* context.acp.agent.initialize({ protocolVersion: 2 })
      const session = yield* context.acp.agent.createSession({ cwd: context.home, mcpServers: [] })
      const failure = yield* context.acp.agent
        .prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] })
        .pipe(Effect.flip)
      assert.equal(failure._tag, "AcpProcessExitedError")
      assert.equal(Number((failure as unknown as { code: unknown }).code), 3)
      assert.deepEqual(textOf(context.updates), ["last words"])
    }))
)

live("an out of usage step ends the turn as an error carrying the scripted message and reset time, not as -32000 (breaks if usage limits look like a sign-out, or the reset time is lost)", () =>
  Effect.gen(function*() {
    const run = yield* converse({
      turns: [[{
        step: "out_of_usage",
        message: "You have hit your usage limit. It resets at 5pm.",
        resetsAt: "2026-11-02T17:00:00Z"
      }]]
    })
    const error = (run.result as unknown as { error: Record<string, any> }).error
    assert.equal(run.result.stopReason, "error")
    assert.equal(error.message, "You have hit your usage limit. It resets at 5pm.")
    assert.equal(error.data.resetsAt, "2026-11-02T17:00:00Z")
    assert.notEqual(error.code, -32000)
  }))

live("a signed out step ends the turn as an error with the authentication-required code (breaks if signed-out is sent with any other code, so the service cannot tell it from other errors)", () =>
  Effect.gen(function*() {
    const run = yield* converse({ turns: [[{ step: "signed_out", message: "Please sign in" }]] })
    const error = (run.result as unknown as { error: Record<string, any> }).error
    assert.equal(run.result.stopReason, "error")
    assert.equal(error.code, -32000)
    assert.equal(error.message, "Please sign in")
  }))

live("a signed out step with via rpc fails the prompt request itself with code -32000 (breaks if via rpc is ignored and the error is still sent as an idle state)", () =>
  withClient({ turns: [[{ step: "signed_out", via: "rpc", message: "Please sign in" }]] }, {}, (context) =>
    Effect.gen(function*() {
      yield* context.acp.agent.initialize({ protocolVersion: 2 })
      const session = yield* context.acp.agent.createSession({ cwd: context.home, mcpServers: [] })
      const failure = yield* context.acp.agent
        .prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] })
        .pipe(Effect.flip)
      assert.equal(failure._tag, "AcpRequestError")
      assert.equal((failure as unknown as { code: number }).code, -32000)
    }))
)

live("a slow turn stays running until cancelled, then ends cancelled and skips the rest (breaks if the slow step cannot be interrupted by session/cancel, or finishes by itself)", () =>
  withClient({ turns: [[{ step: "text", text: "start" }, { step: "slow", ms: 600000 }, { step: "text", text: "never" }]] }, {}, (context) =>
    Effect.gen(function*() {
      yield* context.acp.agent.initialize({ protocolVersion: 2 })
      const session = yield* context.acp.agent.createSession({ cwd: context.home, mcpServers: [] })
      const turn = yield* context.acp.agent
        .prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] })
        .pipe(Effect.forkScoped)
      // Wait on the event, not on a clock: the first text arrives, so the slow step is next.
      yield* context.waitFor((update) => update.sessionUpdate === "agent_message_chunk")
      assert.isUndefined(context.updates.find(isIdle))
      yield* context.acp.agent.cancel({ sessionId: session.sessionId })
      const result = yield* Fiber.await(turn)
      assert.isTrue(result._tag === "Success" && result.value.stopReason === "cancelled")
      assert.deepEqual(textOf(context.updates), ["start"])
    }))
)

live("a print environment step shows exactly the environment the child received (breaks if the step prints the parent environment instead of its own, or hides values the tests need to see)", () =>
  Effect.gen(function*() {
    const run = yield* converse(
      { turns: [[{ step: "print_env" }]] },
      { env: { PLANTED_SERVICE_KEY: secretEnvValue, SHEPHERD_TOKEN: secretToken } }
    )
    const printed = textOf(run.updates).join("\n").split("\n")
    assert.include(printed, `PLANTED_SERVICE_KEY=${secretEnvValue}`)
    assert.include(printed, `SHEPHERD_TOKEN=${secretToken}`)
    assert.include(printed, `HOME=${run.home}`)
    // Only what the test passed: no name from the test process leaks in.
    const names = printed.map((line) => line.split("=")[0])
    assert.notInclude(names, "SHEPHERD_HOME")
    assert.notInclude(names, "VITEST")
  }))

live("a print environment step writes no environment value to any file in the child's home (breaks if the step caches the environment on disk; issue 15)", () =>
  Effect.gen(function*() {
    const run = yield* converse(
      { turns: [[{ step: "print_env" }]] },
      { env: { PLANTED_SERVICE_KEY: secretEnvValue, SHEPHERD_TOKEN: secretToken } }
    )
    const entries = yield* Effect.promise(() => readdir(run.home, { recursive: true, withFileTypes: true }))
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const content = yield* Effect.promise(() => readFile(join(entry.parentPath, entry.name), "utf8"))
      assertNoSecret([content], [secretEnvValue, secretToken])
    }
  }))

live("an ext_notification step sends one extension notification with the scripted method and params, and the turn still ends (breaks if the step is dropped, the method name is rewritten, or the params are changed; fix round 1 item 1)", () =>
  withClient(
    {
      turns: [[
        { step: "ext_notification", method: "_auth/status_update", params: { email: "someone@example.test", nested: { n: [1, 2] } } },
        { step: "text", text: "after" }
      ]]
    },
    {},
    (context) =>
      Effect.gen(function*() {
        const received: Array<{ method: string; params: unknown }> = []
        yield* context.acp.handleUnknownExtNotification((method, params) =>
          Effect.sync(() => void received.push({ method, params }))
        )
        yield* context.acp.agent.initialize({ protocolVersion: 2 })
        const session = yield* context.acp.agent.createSession({ cwd: context.home, mcpServers: [] })
        yield* context.acp.agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] })
        yield* context.waitFor(isIdle)
        assert.deepEqual(received, [
          { method: "_auth/status_update", params: { email: "someone@example.test", nested: { n: [1, 2] } } }
        ])
        assert.deepEqual(textOf(context.updates), ["after"])
      }))
)

live("a stderr_flood step writes the scripted number of bytes to stderr and the turn still ends while the client drains it (breaks if the flood is skipped, shortened, or blocks the agent so the turn never ends; fix round 1 item 5a)", () =>
  Effect.gen(function*() {
    const bytes = 1024 * 1024
    const run = yield* converse({ turns: [[{ step: "stderr_flood", bytes }, { step: "text", text: "after the flood" }]] })
    assert.deepEqual(textOf(run.updates), ["after the flood"])
    assert.equal(run.result.stopReason, "end_turn")
    // The client drains stderr in the background; wait for the last bytes to arrive.
    let seen = 0
    for (let attempt = 0; attempt < 100 && seen < bytes; attempt++) {
      seen = Buffer.byteLength(run.stderr())
      if (seen < bytes) yield* Effect.sleep("100 millis")
    }
    assert.isAtLeast(seen, bytes)
  }))

live("a spawn_grandchild step starts a sleeping child of the agent and puts its pid in the agent's text (breaks if no process is started, the pid is not reported, or the grandchild exits at once; fix round 1 item 5b)", () =>
  Effect.gen(function*() {
    const run = yield* converse({ turns: [[{ step: "spawn_grandchild" }]] })
    const text = textOf(run.updates).join(" ")
    const pids = [...text.matchAll(/\b\d{2,}\b/g)].map((match) => Number(match[0]))
    assert.equal(pids.length, 1)
    const pid = pids[0]!
    try {
      // Signal 0 only tests that the process exists; it throws ESRCH when it does not.
      assert.doesNotThrow(() => process.kill(pid, 0))
      yield* Effect.sleep("300 millis")
      assert.doesNotThrow(() => process.kill(pid, 0))
    } finally {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // already gone
      }
    }
  }))

live("replay history on load sends the scripted history, in order, as user and agent message chunks (breaks if load answers without replaying, or replays out of order or with the wrong roles)", () =>
  withClient(
    {
      history: [
        { role: "user", text: "first question" },
        { role: "agent", text: "first answer" },
        { role: "user", text: "second question" }
      ],
      turns: []
    },
    {},
    (context) =>
      Effect.gen(function*() {
        yield* context.acp.agent.initialize({ protocolVersion: 2 })
        yield* context.acp.agent.loadSession({ sessionId: "stored-session", cwd: context.home, mcpServers: [] })
        yield* context.waitFor((update) =>
          update.sessionUpdate === "user_message_chunk" && JSON.stringify(update).includes("second question")
        )
        const replayed = context.updates
          .filter((update) => update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "agent_message_chunk")
          .map((update) => [update.sessionUpdate, (update.content as { text: string }).text])
        assert.deepEqual(replayed, [
          ["user_message_chunk", "first question"],
          ["agent_message_chunk", "first answer"],
          ["user_message_chunk", "second question"]
        ])
      })
  )
)

live("a Shepherd command step connects to SHEPHERD_SOCKET with the token in an Authorization bearer header, and never prints the token (breaks if the step skips the token, sends it another way, or echoes it into the thread; rows 54 and 71)", () =>
  Effect.gen(function*() {
    const socketFolder = yield* temporaryFolder
    const socketPath = join(socketFolder, "s")
    const upgrades: Array<{ authorization: string | undefined }> = []
    const server = createServer()
    const sockets = new WebSocketServer({ server })
    sockets.on("connection", (socket, request) => {
      upgrades.push({ authorization: request.headers.authorization })
      socket.close()
    })
    yield* Effect.acquireRelease(
      Effect.promise(() => new Promise<void>((resolve) => server.listen(socketPath, resolve))),
      () => Effect.promise(() => new Promise<void>((resolve) => { sockets.close(); server.close(() => resolve()) }))
    )

    const run = yield* converse(
      { turns: [[{ step: "shepherd_command", command: "post", input: { to: "someone", text: "hi" } }]] },
      { env: { SHEPHERD_SOCKET: socketPath, SHEPHERD_TOKEN: secretToken } }
    )
    assert.deepEqual(upgrades, [{ authorization: `Bearer ${secretToken}` }])
    // The service end here answers nothing, so the step reports a failure, but it reports.
    const outcome = textOf(run.updates).filter((line) => line.startsWith("shepherd_command:"))
    assert.equal(outcome.length, 1)
    assert.match(outcome[0]!, /^shepherd_command:(ok|failed)\b/)
    assertNoSecret([...textOf(run.updates), JSON.stringify(run.updates), ...run.logs, run.stderr()], [secretToken])
  }))

live("with wire options off and the logger installed, a full session logs nothing and prints no secret to the log or to stderr (breaks if the fake agent or the copied client logs messages, causes or environment values; issue 13)", () =>
  Effect.gen(function*() {
    const run = yield* converse(
      {
        turns: [[
          { step: "text", text: `a secret ${secretEnvValue} in plain text` },
          { step: "print_env" },
          { step: "tool_call", toolCallId: "t", title: "Run", kind: "execute", status: "completed", output: secretToken }
        ]]
      },
      { env: { PLANTED_SERVICE_KEY: secretEnvValue, SHEPHERD_TOKEN: secretToken } }
    )
    assert.deepEqual(run.logs, [])
    assertNoSecret([run.stderr()], [secretEnvValue, secretToken])
  }))
