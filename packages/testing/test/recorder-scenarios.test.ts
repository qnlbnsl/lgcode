// Unit 3p, task 2h. The optional selection fields below are the builder's seam.
// Existing callers keep their prompt and greeting defaults. These tests never
// run an installed harness or create a fixture in the repository.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { HarnessSettings } from "@shephrd/contracts"
import * as Effect from "effect/Effect"
import { afterEach, beforeEach, expect, it } from "vitest"
import { RECORDER_PROMPT } from "../../engine/scripts/live/prompts.ts"
import { recordFixtures } from "../../engine/scripts/recorder.ts"

const home = "/home/recorder-scenario-test"
// Synthetic canaries, never real credentials.
const canary = "scenario-synthetic-canary-48271"
const shellPrompt = "Run one shell command and request permission; report a refusal honestly."
const mapping = { "read-only": "ro-mode", ask: "ask-mode", edit: "workspace-write", full: "full-mode" } as const
const harness = (id: string) => ({
  id,
  settings: {
    id, runMode: "acp", adapterPath: process.execPath, adapterArguments: [join(root, "work", "adapter.cjs")],
    permissionMapping: mapping, reportedModes: [], defaultPermission: "ask",
    models: [], efforts: [], denyReadMechanism: { _tag: "none" }
  } as unknown as HarnessSettings,
  accountVariables: { SCENARIO_TEST_CANARY: canary }
})

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "shephrd-recorder-scenarios-"))
  await mkdir(join(root, "work"))
  // A transport double is sufficient here: the existing Effect fake agent
  // exits during initialize in this checkout, including in its existing tests.
  await writeFile(join(root, "work", "adapter.cjs"), `
const fs = require("node:fs");
const send = (frame) => fs.writeSync(1, JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\\n");
let promptId;
let mode = "ro-mode";
const option = () => ({ id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode,
  options: ["ro-mode", "ask-mode", "workspace-write", "full-mode"].map(value => ({ value, name: value })) });
const handle = (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") send({ id: frame.id, result: { protocolVersion: 1, agentInfo: { name: "scenario-double", version: "1.0.0" }, agentCapabilities: {} } });
  else if (frame.method === "session/new") send({ id: frame.id, result: { sessionId: "scenario-session", configOptions: [option()] } });
  else if (frame.method === "session/set_config_option") {
    mode = frame.params.value;
    send({ id: frame.id, result: { configOptions: [option()] } });
  } else if (frame.method === "session/prompt") {
    promptId = frame.id;
    send({ method: "session/update", params: { sessionId: "scenario-session", update: { sessionUpdate: "tool_call", toolCallId: "shell-1", title: "Shell", kind: "execute", status: "pending", rawInput: { command: "printf ok", cwd: process.cwd() }, content: [{ type: "content", content: { type: "text", text: process.env.HOME + "/project " + process.env.SCENARIO_TEST_CANARY } }] } } });
    send({ id: "permission-1", method: "session/request_permission", params: { sessionId: "scenario-session", toolCall: { toolCallId: "shell-1", title: "Shell " + process.env.SCENARIO_TEST_CANARY }, options: [{ optionId: "yes", name: "Allow once", kind: "allow_once" }] } });
  } else if (frame.id === "permission-1" && frame.result) {
    send({ id: promptId, result: { stopReason: "end_turn" } });
  }
};
let line = "";
const byte = Buffer.alloc(1);
while (fs.readSync(0, byte, 0, 1, null) > 0) {
  if (byte[0] === 10) { handle(line); line = ""; }
  else line += byte.toString();
}
`)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const record = async (selection: {
  scenario?: string; permission?: keyof typeof mapping; outputPath?: string; harness?: string; prompt?: string
} = {}, harnesses = [harness("codex")]) => {
  // A variable permits forward-compatible optional fields without an unsafe
  // cast or a missing production import in this pre-implementation test suite.
  const options = {
    harnesses, outputDirectory: root, temporaryRoot: join(root, "work"), homeDirectory: home,
    parentEnvironment: { PATH: "/usr/bin:/bin", HOME: home, SCENARIO_TEST_CANARY: canary },
    prompt: RECORDER_PROMPT, ...selection
  }
  return Effect.runPromise(recordFixtures(options))
}
type Entry = { type: string; scenario?: string; provider?: string; frame?: {
  method?: string; params?: { value?: string; prompt?: Array<{ text: string }> }; result?: unknown
} }
const entries = async (name = "codex.ndjson"): Promise<Entry[]> =>
  (await readFile(join(root, name), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Entry)

it("R3P01 preserves the greeting scenario, prompt, read-only mode and fixture path when no choices are supplied", async () => {
  expect(await record()).toEqual([expect.objectContaining({ harness: "codex", status: "recorded" })])
  const transcript = await entries()
  expect(transcript[0]).toMatchObject({ type: "transcript_start", scenario: "read-only-greeting", provider: "codex" })
  expect(transcript.find((entry) => entry.frame?.method === "session/set_config_option")?.frame?.params?.value).toBe("ro-mode")
  expect(transcript.find((entry) => entry.frame?.method === "session/prompt")?.frame?.params?.prompt).toEqual([{ type: "text", text: RECORDER_PROMPT }])
})

it("R3P02 records the selected scenario instead of mislabelling shell frames as a greeting", async () => {
  await record({ scenario: "shell-permission", prompt: shellPrompt })
  const transcript = await entries()
  expect(transcript.find((entry) => entry.frame?.method === "session/prompt")?.frame?.params?.prompt).toEqual([{ type: "text", text: shellPrompt }])
  expect(transcript[0]?.scenario).toBe("shell-permission")
})

it.each([
  ["ask", "ask-mode"], ["edit", "workspace-write"], ["full", "full-mode"]
] as const)("R3P03 selects %s through the harness mapping instead of silently recording read-only", async (permission, value) => {
  expect(await record({ permission })).toMatchObject([{ status: "recorded" }])
  expect((await entries()).find((entry) => entry.frame?.method === "session/set_config_option")?.frame?.params?.value).toBe(value)
})

it("R3P04 writes the chosen output file and leaves an existing greeting fixture unchanged", async () => {
  await writeFile(join(root, "codex.ndjson"), "existing greeting fixture\n")
  await record({ scenario: "shell-permission", outputPath: join(root, "codex-shell-permission.ndjson"), prompt: shellPrompt })
  expect((await readdir(root)).sort()).toEqual(["codex-shell-permission.ndjson", "codex.ndjson", "work"])
  expect(await readFile(join(root, "codex.ndjson"), "utf8")).toBe("existing greeting fixture\n")
  expect((await entries("codex-shell-permission.ndjson"))[0]?.scenario).toBe("shell-permission")
})

it("R3P05 records only the selected harness instead of starting every installed harness", async () => {
  const results = await record({ harness: "codex" }, [harness("claude"), harness("codex")])
  expect(results.map((result) => result.harness)).toEqual(["codex"])
  expect((await readdir(root)).sort()).toEqual(["codex.ndjson", "work"])
})

it("R3P06 scrubs a selected scenario's prompt, tool and permission frames while retaining the permission exchange", async () => {
  await record({ scenario: "shell-permission", prompt: `${shellPrompt} ${home} ${canary}` })
  const text = await readFile(join(root, "codex.ndjson"), "utf8")
  expect(text).not.toContain(home)
  expect(text).not.toContain(canary)
  const transcript = await entries()
  expect(transcript.some((entry) => entry.frame?.method === "session/request_permission")).toBe(true)
  expect(transcript.some((entry) => entry.type === "expect_outbound" &&
    JSON.stringify(entry.frame?.result) === '{"outcome":{"outcome":"cancelled"}}')).toBe(true)
  expect(text).toContain('"kind":"execute"')
  expect(text).toContain("<redacted>")
  expect(transcript[0]?.scenario).toBe("shell-permission")
})
