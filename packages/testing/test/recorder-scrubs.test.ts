// Criterion 8.2: the fixture recorder's testable core, `packages/engine/scripts/recorder.ts`
// (the command `pnpm record-fixtures` is a thin entry point over it). The tests run it against
// the fake agent, never a real adapter.
//
//   scrubText(text, { homeDirectory, workspace, environment }) -> string
//   recordFixtures(options) -> Effect<ReadonlyArray<RecordResult>>
//   formatReport(results) -> string
//
// `RecordResult` is `{ harness, status: "recorded", file, workspace }` or
// `{ harness, status: "skipped", reason }`. `RecordOptions` is
//   { harnesses: [{ id, settings?: HarnessSettings, accountVariables?: Record<string,string> }],
//     outputDirectory, temporaryRoot, homeDirectory, parentEnvironment, prompt, errorSamples? }
// where a harness without `settings` is not installed. The recorder makes a fresh folder inside
// `temporaryRoot` (mode 0700), builds the adapter's environment with `buildBaseEnvironment` from
// the explicit `parentEnvironment` plus the harness's `accountVariables`, drives one short
// session (initialize in protocol version 2, session/new, session/set_config_option on the
// option whose category is mode, session/prompt), and writes `<id>.ndjson` into
// `outputDirectory`, with `errors/<harness>-<kind>.json` per error sample. The recorder manages
// its own child-process scope and needs only the services `NodeServices.layer` provides. It leaves
// the workspace folder in place for the caller to remove with `temporaryRoot`.
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { fileURLToPath } from "node:url"

import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, it } from "@effect/vitest"
import type { HarnessSettings } from "@shepherd/contracts"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { afterEach, beforeEach } from "vitest"

import { formatReport, recordFixtures, scrubText } from "../../engine/scripts/recorder.ts"
import { parseReplay } from "../src/replay.ts"

const fakeAgentPath = fileURLToPath(new URL("../src/fakeAgent.ts", import.meta.url))

const home = "/home/planted-user"
const envSecret = "planted-env-secret-Zk3p9Qx7Lm2"
const envSecretBase64 = Buffer.from(envSecret).toString("base64")
const envSecretEncoded = "pa ss/word+1=planted"
const envSecretUrlEncoded = encodeURIComponent(envSecretEncoded)
const quoted = 'ab"cd\\ef-planted-12345'
const tokens = [
  "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
  "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  "AKIAABCDEFGHIJKLMNOP",
  "eyJhbGciOiJIUzI1NiJ9.payloadpayloadpayload.signaturesignature",
  "shp_a_PLANTEDAGENTTOKEN0123456789",
  "shp_d_PLANTEDDEVICETOKEN0123456789"
]
const parentEnvironment = {
  PATH: "/usr/bin:/bin",
  HOME: home,
  LANG: "C.UTF-8",
  PLANTED_API_TOKEN: envSecret,
  PLANTED_PASSWORD: envSecretEncoded,
  PLANTED_QUOTED: quoted,
  HERDR_SOCKET_PATH: "/tmp/herdr-planted.sock",
  ANTHROPIC_API_KEY: "sk-ant-parent-planted-0123456789abcdef"
}
const plantedEverywhere = [
  home,
  envSecret,
  envSecretBase64,
  envSecretUrlEncoded,
  "ab\\\"cd\\\\ef-planted-12345", // the JSON-escaped form of `quoted`
  "sk-ant-parent-planted-0123456789abcdef",
  "/tmp/herdr-planted.sock",
  ...tokens
]

const modeOption = {
  configId: "mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: "default",
  options: [{ value: "default", name: "Default" }, { value: "ro-mode", name: "Read only" }]
}

const settingsFor = (id: string): HarnessSettings => ({
  id,
  runMode: "acp",
  adapterPath: process.execPath,
  adapterArguments: [fakeAgentPath],
  permissionMapping: { "read-only": "ro-mode", ask: "default", edit: "default", full: "default" },
  reportedModes: [],
  defaultPermission: "ask",
  models: [],
  efforts: [],
  denyReadMechanism: { _tag: "none" }
} as unknown as HarnessSettings)

const leakyTurn = [
  { step: "text", text: `I looked in ${home}/.claude/projects and found ${tokens.join(" and ")}.` },
  { step: "text", text: `env ${envSecret} b64 ${envSecretBase64} url ${envSecretUrlEncoded} q ${quoted}` },
  { step: "tool_call", toolCallId: "t1", title: "Read", kind: "read", status: "completed", output: `${home}/x ${tokens[0]}` }
]

const fakeHarness = (id: string, version: string) => ({
  id,
  settings: settingsFor(id),
  accountVariables: {
    FAKE_AGENT_SCRIPT: JSON.stringify({
      agentInfo: { name: `${id}-fake`, version },
      configOptions: [modeOption],
      turns: [leakyTurn]
    })
  }
})
const absent = (id: string) => ({ id })

let root: string
let outputDirectory: string
let temporaryRoot: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "shepherd-recorder-"))
  outputDirectory = join(root, "fixtures")
  temporaryRoot = join(root, "work")
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const record = (harnesses: ReadonlyArray<unknown>, extra: Record<string, unknown> = {}) =>
  recordFixtures({
    harnesses,
    outputDirectory,
    temporaryRoot,
    homeDirectory: home,
    parentEnvironment,
    prompt: `Reply with ok. Your folder is ${home}/work.`,
    ...extra
  } as never)

const readFixture = async (name: string) => await readFile(join(outputDirectory, name), "utf8")
const names = async (directory: string) => (await readdir(directory).catch(() => [])).sort()

const outbound = (entries: ReadonlyArray<any>) => entries.filter((entry) => entry.type === "expect_outbound")
const inboundText = (entries: ReadonlyArray<any>) =>
  entries
    .filter((entry) => entry.type === "emit_inbound")
    .map((entry) => entry.frame?.params?.update)
    .filter((update) => update?.sessionUpdate === "agent_message_chunk")
    .map((update) => update.content.text as string)

const scrubContext = { homeDirectory: home, workspace: "/tmp/work-planted-1234", environment: parentEnvironment }

it("scrubText removes token and key shapes (breaks if only environment values are scrubbed, so a key the environment never held survives)", () => {
  const text = tokens.map((token, index) => `line ${index}: ${token}`).join("\n") + "\nAuthorization: Bearer abcdefghijklmnop0123456789"
  const scrubbed = scrubText(text, scrubContext)
  for (const token of tokens) assert.notInclude(scrubbed, token)
  assert.notInclude(scrubbed, "abcdefghijklmnop0123456789")
  assert.include(scrubbed, "line 0:")
})

it("scrubText removes the home folder and swaps the workspace for <workspace> (breaks if a recorded path names the owner's account or the run's temporary folder)", () => {
  const text = `{"path":"${home}/.claude/a","cwd":"/tmp/work-planted-1234","file":"/tmp/work-planted-1234/b.txt"}`
  const scrubbed = scrubText(text, scrubContext)
  assert.notInclude(scrubbed, home)
  assert.notInclude(scrubbed, "/tmp/work-planted-1234")
  assert.include(scrubbed, "<workspace>/b.txt")
})

it("scrubText removes environment values in raw, base64, URL-encoded and JSON-escaped forms (breaks if only the raw form is matched)", () => {
  const text = [
    `raw ${envSecret}`,
    `b64 ${envSecretBase64}`,
    `url ${envSecretUrlEncoded}`,
    `plain ${envSecretEncoded}`,
    `json ${JSON.stringify({ v: quoted })}`
  ].join("\n")
  const scrubbed = scrubText(text, scrubContext)
  for (const planted of [envSecret, envSecretBase64, envSecretUrlEncoded, envSecretEncoded, "ab\\\"cd\\\\ef-planted-12345", quoted]) {
    assert.notInclude(scrubbed, planted)
  }
})

it("scrubText leaves short environment values alone (breaks if values like 1 or C are replaced everywhere and the transcript turns to noise)", () => {
  const text = `{"jsonrpc":"2.0","id":1,"result":{"language":"C","ok":true,"count":1}}`
  const scrubbed = scrubText(text, { ...scrubContext, environment: { FORCE_COLOR: "1", LANG: "C", FLAG: "true" } })
  assert.equal(scrubbed, text)
})

it("scrubText keeps every line valid JSON after scrubbing (breaks if a replacement lands on a quote or breaks an escape)", () => {
  const line = JSON.stringify({ text: `${envSecret} ${quoted} ${home}/x ${tokens[0]}` })
  const scrubbed = scrubText(line, scrubContext)
  assert.doesNotThrow(() => JSON.parse(scrubbed))
})

const fx = <A>(run: () => Promise<A>) => Effect.promise(run)
const allEntries = async (file: string) => {
  const transcript = await Effect.runPromise(parseReplay(await readFixture(file)))
  return transcript
}
const cleanHarness = (id: string, turns: ReadonlyArray<ReadonlyArray<unknown>>, options: ReadonlyArray<unknown> = [modeOption]) => ({
  id,
  settings: settingsFor(id),
  accountVariables: {
    FAKE_AGENT_SCRIPT: JSON.stringify({ agentInfo: { name: `${id}-fake`, version: "1.0.0" }, configOptions: options, turns })
  }
})

// `it.layer` hands its callback a test API without `live`, and the tests need the real clock, so
// each test provides the Node services itself.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout?: number) =>
  it.live(name, () => test().pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<void, unknown, never>, timeout)

live("writes claude.ndjson and codex.ndjson and reports gemini and cursor as skipped when they are not installed (breaks if absent harnesses are guessed, fail the run, or leave stray files)", () =>
  Effect.gen(function*() {
    const results = yield* record([
      fakeHarness("claude", "0.99.1"),
      fakeHarness("codex", "2.5.0"),
      absent("gemini"),
      absent("cursor")
    ])
    assert.deepEqual(
      results.map((result: any) => [result.harness, result.status]),
      [["claude", "recorded"], ["codex", "recorded"], ["gemini", "skipped"], ["cursor", "skipped"]]
    )
    assert.deepEqual(yield* fx(() => names(outputDirectory)), ["claude.ndjson", "codex.ndjson"])
    const report = formatReport(results)
    assert.match(report, /^gemini: skipped/m)
    assert.match(report, /^cursor: skipped/m)
    assert.match(report, /^claude: recorded/m)
  }))

live("writes gemini.ndjson and cursor.ndjson when they are installed (breaks if the recorder only ever handles claude and codex)", () =>
  Effect.gen(function*() {
    yield* record([
      fakeHarness("claude", "0.99.1"),
      fakeHarness("codex", "2.5.0"),
      fakeHarness("gemini", "0.31.0"),
      fakeHarness("cursor", "2026.10.1")
    ])
    assert.deepEqual(
      yield* fx(() => names(outputDirectory)),
      ["claude.ndjson", "codex.ndjson", "cursor.ndjson", "gemini.ndjson"]
    )
  }))

live("each file decodes with the replay parser, and its header records the adapter version and the negotiated protocol version (breaks if the header is missing, hard-codes a version, or the file is not valid replay NDJSON)", () =>
  Effect.gen(function*() {
    yield* record([fakeHarness("claude", "0.99.1"), fakeHarness("codex", "2.5.0")])
    for (const [id, version] of [["claude", "0.99.1"], ["codex", "2.5.0"]] as const) {
      const transcript = yield* fx(() => allEntries(`${id}.ndjson`))
      assert.equal(transcript.provider, id)
      assert.equal(transcript.version, version)
      assert.equal((transcript as any).protocol, "acp")
      assert.equal((transcript.metadata as any).protocolVersion, 2)
      assert.isTrue(transcript.scenario.length > 0)
      const last = transcript.entries[transcript.entries.length - 1] as any
      assert.equal(last.type, "runtime_exit")
      assert.equal(last.status, "success")
    }
  }))

live("sends initialize, session/new, the read-only mode option and only then the prompt (breaks if the session is prompted before it is read-only, or the mode is set with session/set_mode; row 70)", () =>
  Effect.gen(function*() {
    yield* record([fakeHarness("claude", "0.99.1")])
    const transcript = yield* fx(() => allEntries("claude.ndjson"))
    const methods = outbound(transcript.entries).map((entry: any) => entry.frame.method as string)
    assert.deepEqual(methods, ["initialize", "session/new", "session/set_config_option", "session/prompt"])
    const setMode = outbound(transcript.entries)[2] as any
    assert.include(JSON.stringify(setMode.frame.params), "ro-mode")
    assert.equal(setMode.frame.params.configId, "mode")
  }))

live("runs in a fresh private folder under the temporary root and records its path as <workspace> (breaks if the recorder runs in the repository or the home folder, reuses a folder, or writes the real path into the file)", () =>
  Effect.gen(function*() {
    const first = (yield* record([fakeHarness("claude", "0.99.1"), fakeHarness("codex", "2.5.0")])) as any[]
    const second = (yield* record([fakeHarness("claude", "0.99.1")])) as any[]
    const workspaces: string[] = [first[0].workspace, first[1].workspace, second[0].workspace]
    assert.equal(new Set(workspaces).size, 3)
    for (const workspace of workspaces) {
      assert.isTrue(workspace.startsWith(temporaryRoot + sep))
      const info = yield* fx(() => stat(workspace))
      assert.equal(info.mode & 0o777, 0o700)
      assert.deepEqual(yield* fx(() => readdir(workspace)), []) // read-only mode leaves the folder empty
    }
    const transcript = yield* fx(() => allEntries("claude.ndjson"))
    const created = outbound(transcript.entries).find((entry: any) => entry.frame.method === "session/new") as any
    assert.equal(created.frame.params.cwd, "<workspace>")
    for (const workspace of workspaces) assert.notInclude(yield* fx(() => readFixture("claude.ndjson")), workspace)
  }))

live("no planted token, key, home path or environment value survives in any file, the report or the results (breaks if the recorder writes agent output unscrubbed, scrubs only one file, or leaves a secret in the report)", () =>
  Effect.gen(function*() {
    const results = yield* record([
      fakeHarness("claude", "0.99.1"),
      fakeHarness("codex", "2.5.0"),
      fakeHarness("gemini", "0.31.0"),
      fakeHarness("cursor", "2026.10.1")
    ], {
      errorSamples: [
        { harness: "claude", kind: "out-of-usage", text: `limit reached for ${home} ${tokens[0]} ${envSecret}`, source: "claude-agent-acp 0.99.1, src/limits.ts" }
      ]
    })
    const written: string[] = []
    for (const file of ["claude", "codex", "gemini", "cursor"]) written.push(yield* fx(() => readFixture(`${file}.ndjson`)))
    written.push(yield* fx(() => readFile(join(outputDirectory, "errors", "claude-out-of-usage.json"), "utf8")))
    written.push(formatReport(results), JSON.stringify(results))
    for (const text of written) {
      for (const planted of plantedEverywhere) assert.notInclude(text, planted)
    }
    // the scrub keeps the transcript useful: the harmless text is still there
    assert.include(written[0]!, "I looked in")
  }))

live("the adapter receives only allow-listed environment names plus the account's variables (breaks if the recorder passes the whole parent environment, HERDR_* or an unset provider key to the adapter; rows 33 and 57)", () =>
  Effect.gen(function*() {
    yield* record([cleanHarness("claude", [[{ step: "print_env" }]])])
    const transcript = yield* fx(() => allEntries("claude.ndjson"))
    const printed = inboundText(transcript.entries).join("\n")
    const shown = [...printed.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((match) => match[1]!)
    assert.include(shown, "PATH")
    assert.include(shown, "FAKE_AGENT_SCRIPT")
    const allowed = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_.*|TERM|TMPDIR|TZ|FAKE_AGENT_SCRIPT)$/
    for (const name of shown) assert.match(name, allowed)
    for (const name of ["PLANTED_API_TOKEN", "PLANTED_PASSWORD", "HERDR_SOCKET_PATH", "ANTHROPIC_API_KEY"]) {
      assert.notInclude(shown, name)
    }
  }))

live("a session that cannot be set to read-only is never prompted and leaves no fixture (breaks if the recorder falls back to the adapter's default permission mode when the mode option is missing)", () =>
  Effect.gen(function*() {
    const exit = yield* record([cleanHarness("claude", [[{ step: "text", text: "hello" }]], [])]).pipe(Effect.exit)
    assert.isTrue(Exit.isFailure(exit))
    assert.deepEqual(yield* fx(() => names(outputDirectory)), [])
  }))

live("an error sample is written under errors/ with its source, scrubbed text and verified flag (breaks if the sample loses its source, keeps a secret, or marks an unverified Cursor message as verified; row 42)", () =>
  Effect.gen(function*() {
    yield* record([fakeHarness("claude", "0.99.1")], {
      errorSamples: [
        { harness: "claude", kind: "signed-out", text: "Please run /login", source: "recorded from claude-agent-acp 0.99.1 with an empty home", verified: true },
        { harness: "cursor", kind: "out-of-usage", text: `You are out of usage ${tokens[1]}`, source: "agent source, not run", verified: false }
      ]
    })
    assert.deepEqual(yield* fx(() => names(join(outputDirectory, "errors"))), ["claude-signed-out.json", "cursor-out-of-usage.json"])
    const signedOut = JSON.parse(yield* fx(() => readFile(join(outputDirectory, "errors", "claude-signed-out.json"), "utf8")))
    assert.deepEqual(signedOut, {
      harness: "claude",
      kind: "signed-out",
      text: "Please run /login",
      source: "recorded from claude-agent-acp 0.99.1 with an empty home",
      verified: true
    })
    const cursor = JSON.parse(yield* fx(() => readFile(join(outputDirectory, "errors", "cursor-out-of-usage.json"), "utf8")))
    assert.equal(cursor.verified, false)
    assert.equal(cursor.source, "agent source, not run")
    assert.notInclude(cursor.text, tokens[1]!)
    assert.include(cursor.text, "You are out of usage")
  }))

live("an error sample with no source is refused and nothing is written for it (breaks if a sample can be saved without saying where its text came from)", () =>
  Effect.gen(function*() {
    const exit = yield* record([fakeHarness("claude", "0.99.1")], {
      errorSamples: [{ harness: "claude", kind: "signed-out", text: "Please run /login", source: "" }]
    }).pipe(Effect.exit)
    assert.isTrue(Exit.isFailure(exit))
    assert.notInclude(yield* fx(() => names(outputDirectory)), "errors")
  }))
