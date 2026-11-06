import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { permissionLevels } from "@sheprd/contracts"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { resolveHarnessDefaults } from "../src/runner/harnesses.ts"
import { RECORDER_PROMPT } from "./live/prompts.ts"
import { formatReport, hasRecordingFailures, recordFixtures } from "./recorder.ts"

const parentEnvironment = { ...process.env }
const outputDirectory = fileURLToPath(new URL("../../testing/fixtures", import.meta.url))

// Example: pnpm record-fixtures --scenario shell-permission --permission edit
// --harness codex --output /tmp/codex-shell-permission.ndjson
const SHELL_PERMISSION_PROMPT = "Run the shell command printf ok once in your working folder. If permission is required, request it explicitly. Report a refusal honestly and do not retry or change settings."

async function main() {
  const { values } = parseArgs({ options: {
    scenario: { type: "string", default: "read-only-greeting" },
    permission: { type: "string", default: "read-only" },
    harness: { type: "string" }, output: { type: "string" }, prompt: { type: "string" }
  } })
  const permission = permissionLevels.find((level) => level === values.permission)
  if (!permission) throw new Error("Invalid permission level")
  if (!["read-only-greeting", "shell-permission"].includes(values.scenario)) throw new Error("Unknown recording scenario")
  if (values.harness !== undefined && !["claude", "codex", "gemini", "cursor"].includes(values.harness)) throw new Error("Unknown harness")
  if (values.output !== undefined && values.harness === undefined) throw new Error("An output filename requires --harness")
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
  const harnesses = ["claude", "codex", "gemini", "cursor"].filter((id) => values.harness === undefined || id === values.harness).map((id) => {
    const settings = defaults.harnesses.find((harness) => harness.id === id)
    return { id, ...(settings ? { settings } : {}), accountVariables: Object.fromEntries(
      (accountNames[id] ?? []).flatMap((name) => parentEnvironment[name] === undefined ? [] : [[name, parentEnvironment[name]!]])
    ) }
  })
  const errorDirectory = join(outputDirectory, "errors")
  const errorSamples = values.scenario !== "read-only-greeting" ? [] : await Promise.all((await readdir(errorDirectory)).filter((name) => name.endsWith(".json")).map(async (name) =>
    JSON.parse(await readFile(join(errorDirectory, name), "utf8"))
  ))
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sheprd-record-fixtures-"))
  try {
    const results = await Effect.runPromise(recordFixtures({
      harnesses, outputDirectory: values.scenario === "read-only-greeting" ? outputDirectory : join(outputDirectory, values.scenario),
      temporaryRoot, homeDirectory, parentEnvironment, scenario: values.scenario, permission,
      ...(values.harness !== undefined ? { harness: values.harness } : {}),
      ...(values.output !== undefined ? { outputPath: values.output } : {}),
      prompt: values.prompt ?? (values.scenario === "read-only-greeting" ? RECORDER_PROMPT : SHELL_PERMISSION_PROMPT),
      errorSamples: values.scenario === "read-only-greeting" ? errorSamples : [],
      captureSignedOut: values.scenario === "read-only-greeting"
    }))
    process.stdout.write(formatReport(results) + "\n")
    if (hasRecordingFailures(results) || !results.some((result) => result.status === "recorded")) process.exitCode = 1
  } finally { await rm(temporaryRoot, { recursive: true, force: true }) }
}

main().catch(() => { process.stderr.write("Fixture recording failed; check adapter installation, authentication, recording options and permission mode support\n"); process.exitCode = 1 })
