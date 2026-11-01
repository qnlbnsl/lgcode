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
// A 40-character lowercase hex value, like a commit id or a session key held in the environment.
const hex40 = "9f2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e1b3d5f70"
const accountEmail = "owner.person@example.test"
const accountOrganization = "Planted Organization Ltd"
const accountUuid = "3f2b8c1e-5d4a-4e7b-9c1d-0a1b2c3d4e5f"
const parentEnvironment = {
  PATH: "/usr/bin:/bin",
  HOME: home,
  LANG: "C.UTF-8",
  PLANTED_HEX: hex40,
  PLANTED_API_TOKEN: envSecret,
  PLANTED_PASSWORD: envSecretEncoded,
  PLANTED_QUOTED: quoted,
  HERDR_SOCKET_PATH: "/tmp/herdr-planted.sock",
  ANTHROPIC_API_KEY: "sk-ant-parent-planted-0123456789abcdef"
}
const plantedEverywhere = [
  home,
  `${home}/`,
  `file://${home}`,
  hex40,
  hex40.toUpperCase(),
  accountEmail,
  accountUuid,
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
  { step: "text", text: `hex ${hex40} and ${hex40.toUpperCase()}; home ${home}/ and file://${home}/project; account ${accountEmail} ${accountUuid}` },
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

it("scrubText replaces an email address with <email> and leaves the words around it (breaks if account e-mail addresses reach a committed fixture; fix round 1 item 1b)", () => {
  assert.equal(scrubText("contact someone@example.test now", scrubContext), "contact <email> now")
  const scrubbed = scrubText(`{"text":"a.b+tag@sub.example.test and ${accountEmail}"}`, scrubContext)
  assert.equal(scrubbed, '{"text":"<email> and <email>"}')
})

it("scrubText replaces a UUID with <id> (breaks if an account or organization UUID survives; fix round 1 item 1b)", () => {
  const scrubbed = scrubText(`account ${accountUuid} and ${accountUuid.toUpperCase()}`, scrubContext)
  assert.notInclude(scrubbed.toLowerCase(), accountUuid)
  assert.equal(scrubbed, "account <id> and <id>")
})

const shapeSamples: ReadonlyArray<readonly [string, string]> = [
  ["github_pat_", "github_pat_11AAAAAAA0abcdefghijkl_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456"],
  ["AIza", "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"],
  ["xoxb-", "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"],
  ["xoxa-", "xoxa-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"],
  ["xoxp-", "xoxp-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"],
  ["xoxr-", "xoxr-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"],
  ["key_", "key_ABCDEFGHIJKLMNOPQRSTUVWX0123"],
  ["32-character lowercase hex", "0123456789abcdef0123456789abcdef"],
  ["32-character uppercase hex", "0123456789ABCDEF0123456789ABCDEF"],
  ["64-character mixed-case hex", "0123456789abcdefABCDEF0123456789abcdefABCDEF0123456789abcdefABCD"]
]
for (const [shape, sample] of shapeSamples) {
  it(`scrubText removes a ${shape} secret and keeps the words around it (breaks if the ${shape} shape is not in the list; fix round 1 item 2)`, () => {
    const scrubbed = scrubText(`before ${sample} after`, scrubContext)
    assert.notInclude(scrubbed, sample)
    assert.match(scrubbed, /^before .+ after$/)
    // the replacement keeps a line that is JSON valid
    assert.doesNotThrow(() => JSON.parse(scrubText(JSON.stringify({ text: `before ${sample} after` }), scrubContext)))
  })
}

it("scrubText leaves a short key_ name and a 31-character hex value alone (breaks if the key_ and hex shapes ignore their length floors and turn ordinary names into noise; fix round 1 item 2)", () => {
  const text = "key_name key_short_id 0123456789abcdef0123456789abcde"
  assert.equal(scrubText(text, scrubContext), text)
})

const pemBody = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7plantedplantedplanted\nAbCdEfGhIjKlMnOpQrStUvWxYz0123456789plantedplantedplantedplantedplanted"
it("scrubText removes a whole PEM block, with real newlines and with JSON-escaped ones (breaks if only the BEGIN line is removed, or the block is matched on one line only; fix round 1 item 2)", () => {
  const block = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----`
  const plain = scrubText(`key follows:\n${block}\nend of message`, scrubContext)
  assert.notInclude(plain, "MIIEvQIBADANBg")
  assert.notInclude(plain, "AbCdEfGhIjKl")
  assert.notInclude(plain, "END PRIVATE KEY")
  assert.include(plain, "end of message")
  const line = JSON.stringify({ text: `key follows:\n${block}\nend of message` })
  const escaped = scrubText(line, scrubContext)
  assert.notInclude(escaped, "MIIEvQIBADANBg")
  assert.notInclude(escaped, "AbCdEfGhIjKl")
  assert.notInclude(escaped, "END PRIVATE KEY")
  assert.include(escaped, "end of message")
  assert.doesNotThrow(() => JSON.parse(escaped))
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

const poll = <A>(read: () => A | undefined, attempts = 40) =>
  Effect.gen(function*() {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const value = read()
      if (value !== undefined) return value
      yield* Effect.sleep("100 millis")
    }
    return undefined
  })
const gone = (pid: number) => {
  try {
    process.kill(pid, 0)
    return undefined
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? true : undefined
  }
}

const authNotification = {
  step: "ext_notification",
  method: "_auth/status_update",
  params: { email: accountEmail, organization: accountOrganization, accountUuid, plan: "max" }
}

live("drops every inbound extension frame before it is kept, so account identity never reaches the fixture, and counts the drops in the report (breaks if _-methods are kept and only scrubbed, the count is missing, or the report names content; fix round 1 item 1a)", () =>
  Effect.gen(function*() {
    const results = yield* record([cleanHarness("claude", [[authNotification, { step: "text", text: "hello after the notification" }]])])
    const fixture = yield* fx(() => readFixture("claude.ndjson"))
    for (const planted of [accountEmail, accountOrganization, accountUuid, "_auth/status_update", "_auth/"]) {
      assert.notInclude(fixture, planted)
    }
    for (const line of fixture.split("\n")) assert.notInclude(line, "status_update")
    assert.include(fixture, "hello after the notification") // frames after the dropped one are kept
    const transcript = yield* fx(() => allEntries("claude.ndjson"))
    assert.deepEqual(inboundText(transcript.entries), ["hello after the notification"])
    const report = formatReport(results)
    assert.match(report, /droppedExtensionFrames: 1\b/)
    for (const planted of [accountEmail, accountOrganization, accountUuid, "_auth", "status_update"]) {
      assert.notInclude(report, planted)
      assert.notInclude(JSON.stringify(results), planted)
    }
  }))

live("drops extension frames whatever their name after the underscore, and counts each one (breaks if only the _auth/ method is dropped, or the count is not per frame; fix round 1 item 1a)", () =>
  Effect.gen(function*() {
    const results = yield* record([cleanHarness("codex", [[
      authNotification,
      { step: "ext_notification", method: "_telemetry/heartbeat", params: { note: "benign-extension-content" } },
      { step: "text", text: "visible" }
    ]])])
    const fixture = yield* fx(() => readFixture("codex.ndjson"))
    assert.notInclude(fixture, "_telemetry")
    assert.notInclude(fixture, "benign-extension-content")
    assert.notInclude(fixture, "_auth")
    assert.match(formatReport(results), /droppedExtensionFrames: 2\b/)
  }))

live("account email, UUID and home forms in agent text do not survive in a written fixture (breaks if scrubText misses the e-mail or UUID shape, or the home path with a trailing slash or as a file:// URL; fix round 1 items 1b and 3)", () =>
  Effect.gen(function*() {
    yield* record([fakeHarness("claude", "0.99.1")])
    const fixture = yield* fx(() => readFixture("claude.ndjson"))
    for (const planted of [accountEmail, accountUuid, `${home}/`, `file://${home}`, home]) assert.notInclude(fixture, planted)
    assert.include(fixture, "hex ")
    assert.include(fixture, "<email>")
  }))

live("a 40-character hex value from the parent environment does not survive in a written fixture, in either case (breaks if long environment values are matched only when they look like words; fix round 1 item 3)", () =>
  Effect.gen(function*() {
    yield* record([fakeHarness("claude", "0.99.1")])
    const fixture = yield* fx(() => readFixture("claude.ndjson"))
    assert.notInclude(fixture.toLowerCase(), hex40)
  }))

live("a recording whose agent floods 1 MiB to stderr still finishes, and no flood byte reaches a fixture, the report or the results (breaks if stderr is not drained so the adapter blocks, or the recorder keeps stderr; fix round 1 item 5a)", () =>
  Effect.gen(function*() {
    const results = yield* record([cleanHarness("claude", [[
      { step: "stderr_flood", bytes: 1024 * 1024 },
      { step: "text", text: "survived the flood" }
    ]])])
    const fixture = yield* fx(() => readFixture("claude.ndjson"))
    assert.include(fixture, "survived the flood")
    const report = formatReport(results)
    const everything = [fixture, report, JSON.stringify(results)]
    // The flood is 1 MiB; whatever it is made of, a megabyte of it would make these large.
    assert.isBelow(Buffer.byteLength(fixture), 64 * 1024)
    assert.isBelow(Buffer.byteLength(report), 8 * 1024)
    assert.isBelow(Buffer.byteLength(JSON.stringify(results)), 8 * 1024)
    for (const text of everything) assert.notMatch(text, /(.)\1{199}/s)
  }), 60_000)

live("when the recording ends no process the adapter started is left running (breaks if the recorder kills only the adapter and not its process group; fix round 1 item 5b)", () =>
  Effect.gen(function*() {
    yield* record([cleanHarness("claude", [[{ step: "spawn_grandchild" }]])])
    const transcript = yield* fx(() => allEntries("claude.ndjson"))
    const pids = [...inboundText(transcript.entries).join(" ").matchAll(/\b\d{2,}\b/g)].map((match) => Number(match[0]))
    assert.equal(pids.length, 1)
    const pid = pids[0]!
    try {
      // Signal 0 only tests that the process exists; it throws ESRCH when it does not.
      const ended = yield* poll(() => gone(pid), 50)
      assert.isTrue(ended === true, `grandchild ${pid} is still running after the recording ended`)
    } finally {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // already gone
      }
    }
  }), 60_000)

live("a recording against an adapter that answers protocol version 1 writes a fixture whose header says version 1 and names the adapter version from agentInfo, and confirms read-only mode before the prompt (breaks if the recorder assumes version 2, or reads the version from the version 2 info field; fix round 1 item 6)", () =>
  Effect.gen(function*() {
    const version1 = {
      id: "claude",
      settings: settingsFor("claude"),
      accountVariables: {
        FAKE_AGENT_SCRIPT: JSON.stringify({
          protocolVersion: 1,
          agentInfo: { name: "claude-fake", version: "0.99.1" },
          configOptions: [modeOption],
          turns: [[{ step: "text", text: "hello from version 1" }]]
        })
      }
    }
    yield* record([version1])
    const transcript = yield* fx(() => allEntries("claude.ndjson"))
    assert.equal(transcript.provider, "claude")
    assert.equal(transcript.version, "0.99.1")
    assert.equal((transcript.metadata as any).protocolVersion, 1)
    const methods = outbound(transcript.entries).map((entry: any) => entry.frame.method as string)
    assert.deepEqual(methods, ["initialize", "session/new", "session/set_config_option", "session/prompt"])
    assert.include(JSON.stringify((outbound(transcript.entries)[2] as any).frame.params), "ro-mode")
    assert.deepEqual(inboundText(transcript.entries), ["hello from version 1"])
  }))

const unverifiedSample = {
  harness: "claude",
  kind: "signed-out",
  text: "Please run /login",
  source: "agent source, not run",
  verified: false
}

live("with captureSignedOut on and an adapter that never signs out, the run succeeds, the report names the harness under signedOutNotObserved, and the unverified sample file is unchanged (breaks if the probe throws on a missing auth error, writes a sample anyway, or replaces the unverified one; fix round 1 item 7)", () =>
  Effect.gen(function*() {
    const without = yield* record([cleanHarness("claude", [[{ step: "text", text: "no sign-out here" }]])], {
      errorSamples: [unverifiedSample]
    })
    const baseline = yield* fx(() => readFile(join(outputDirectory, "errors", "claude-signed-out.json"), "utf8"))
    assert.notMatch(formatReport(without), /signedOutNotObserved[^\n]*claude/)
    const probed = yield* record([cleanHarness("claude", [[{ step: "text", text: "no sign-out here" }]])], {
      outputDirectory: join(root, "fixtures-probed"),
      temporaryRoot: join(root, "work-probed"),
      errorSamples: [unverifiedSample],
      captureSignedOut: true
    })
    assert.deepEqual((probed as any[]).map((result) => [result.harness, result.status]), [["claude", "recorded"]])
    const sampleFile = join(root, "fixtures-probed", "errors", "claude-signed-out.json")
    assert.equal(yield* fx(() => readFile(sampleFile, "utf8")), baseline)
    assert.deepEqual(JSON.parse(baseline), unverifiedSample)
    assert.deepEqual(yield* fx(() => names(join(root, "fixtures-probed", "errors"))), ["claude-signed-out.json"])
    const report = formatReport(probed)
    assert.match(report, /signedOutNotObserved/)
    // the harness is named on the same line as the heading, or on the line after it
    assert.match(report, /signedOutNotObserved[^\n]*\bclaude\b|^claude: [^\n]*signedOutNotObserved|signedOutNotObserved[^\n]*\n[^\n]*\bclaude\b/m)
  }), 60_000)
