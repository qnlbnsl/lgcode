// Task 2h: execute the CLI's real argument handling, replacing only adapter
// discovery and recording. No installed harness runs or repository fixture is
// written. recorder-scenarios.test.ts exercises the actual recording core.
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Effect from "effect/Effect"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { RECORDER_PROMPT } from "../../engine/scripts/live/prompts.ts"

vi.mock("../../engine/src/runner/harnesses.ts", () => ({
  resolveHarnessDefaults: () => Effect.succeed({ harnesses: [], missing: [] })
}))
vi.mock("../../engine/scripts/recorder.ts", () => ({
  recordFixtures: vi.fn(() => Effect.succeed([{ harness: "codex", status: "recorded" }])),
  formatReport: () => "scenario CLI test completed",
  hasRecordingFailures: () => false
}))

const outputPath = join(tmpdir(), "sheprd-cli-test-shell-permission.ndjson")
let originalArgv: string[]
let originalExitCode: typeof process.exitCode
beforeEach(() => {
  vi.resetModules()
  originalArgv = process.argv
  originalExitCode = process.exitCode
  vi.stubEnv("HOME", tmpdir())
  process.argv = [process.execPath, "record-fixtures.ts", "--scenario", "shell-permission", "--permission", "edit",
    "--harness", "codex", "--output", outputPath]
})
afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const run = async () => {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  const recorder = await import("../../engine/scripts/recorder.ts")
  await import("../../engine/scripts/record-fixtures.ts")
  await vi.waitFor(() => expect(stdout).toHaveBeenCalledWith("scenario CLI test completed\n"))
  expect(stderr).not.toHaveBeenCalled()
  expect(recorder.recordFixtures).toHaveBeenCalledTimes(1)
  // Never let an assertion diff print the CLI's inherited environment.
  const { parentEnvironment: _environment, ...options } = vi.mocked(recorder.recordFixtures).mock.calls[0]![0]
  return options
}

it("R3P07 forwards only the CLI's chosen harness instead of recording all four", async () => {
  expect((await run()).harnesses.map((harness) => harness.id)).toEqual(["codex"])
})

it("R3P08 forwards the CLI permission choice instead of leaving the core at read-only", async () => {
  expect(await run()).toMatchObject({ permission: "edit" })
})

it("R3P09 forwards the CLI scenario and its shell prompt instead of the no-tools greeting", async () => {
  const options = await run()
  expect(options.prompt).not.toBe(RECORDER_PROMPT)
  expect(options.prompt).toMatch(/shell|command/i)
  expect(options).toMatchObject({ scenario: "shell-permission" })
})

it("R3P10 forwards the CLI output path instead of overwriting the greeting path", async () => {
  expect(await run()).toMatchObject({ outputPath })
})
