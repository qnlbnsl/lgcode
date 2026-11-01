import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { resolveHarnessDefaults } from "../src/runner/harnesses.ts"
import { formatReport, hasRecordingFailures, recordFixtures } from "./recorder.ts"

const parentEnvironment = { ...process.env }
const outputDirectory = fileURLToPath(new URL("../../testing/fixtures", import.meta.url))

async function main() {
  const homeDirectory = parentEnvironment.HOME
  if (!homeDirectory) throw new Error("HOME must be set for owner-run recording")
  const defaults = await Effect.runPromise(resolveHarnessDefaults({
    binDirectory: fileURLToPath(new URL("../node_modules/.bin", import.meta.url)), path: parentEnvironment.PATH ?? ""
  }).pipe(Effect.provide(NodeServices.layer)))
  const accountNames: Record<string, string[]> = {
    claude: ["ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR"],
    codex: ["OPENAI_API_KEY", "CODEX_HOME"],
    gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS", "GEMINI_CLI_HOME"],
    cursor: ["CURSOR_API_KEY"]
  }
  const harnesses = ["claude", "codex", "gemini", "cursor"].map((id) => {
    const settings = defaults.harnesses.find((harness) => harness.id === id)
    return { id, ...(settings ? { settings } : {}), accountVariables: Object.fromEntries(
      (accountNames[id] ?? []).flatMap((name) => parentEnvironment[name] === undefined ? [] : [[name, parentEnvironment[name]!]])
    ) }
  })
  const errorDirectory = join(outputDirectory, "errors")
  const errorSamples = await Promise.all((await readdir(errorDirectory)).filter((name) => name.endsWith(".json")).map(async (name) =>
    JSON.parse(await readFile(join(errorDirectory, name), "utf8"))
  ))
  const temporaryRoot = await mkdtemp(join(tmpdir(), "shepherd-record-fixtures-"))
  try {
    const results = await Effect.runPromise(recordFixtures({
      harnesses, outputDirectory, temporaryRoot, homeDirectory, parentEnvironment,
      prompt: "Reply with the word ok. Do not run tools or create or change any file.", errorSamples, captureSignedOut: true
    }))
    process.stdout.write(formatReport(results) + "\n")
    if (hasRecordingFailures(results) || !results.some((result) => result.status === "recorded")) process.exitCode = 1
  } finally { await rm(temporaryRoot, { recursive: true, force: true }) }
}

main().catch(() => { process.stderr.write("Fixture recording failed; check adapter installation, authentication and read-only mode support\n"); process.exitCode = 1 })
