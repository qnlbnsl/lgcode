import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessSettings } from "@shephrd/contracts";
import * as Effect from "effect/Effect";

import { formatReport, hasRecordingFailures, recordFixtures, runRecording } from "../recorder.ts";
import { RECORDER_PROMPT } from "./prompts.ts";

// Unit 8c: the last step of `pnpm live-check`. It re-records the fixtures of
// Claude Code and Codex with the recorder that `pnpm record-fixtures` uses, and
// fails when the recorder reports a failure for either. Gemini and Cursor are
// not part of the check: the owner has no account for them in this run.

type RecordOptions = Parameters<typeof recordFixtures>[0];
export type RecordResults = Effect.Success<ReturnType<typeof recordFixtures>>;

export const RECORDED_HARNESSES = ["claude", "codex"] as const;

// The names of the variables that hold a harness's account, when the owner has set them.
const ACCOUNT_NAMES: Record<string, ReadonlyArray<string>> = {
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR"],
  codex: ["OPENAI_API_KEY", "CODEX_HOME"],
};

export interface RecordingDeps {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly settings: ReadonlyArray<HarnessSettings>;
  // The fixtures folder (`packages/testing/fixtures`).
  readonly outputDirectory: string;
  // The second argument is the run's cancellation: the recorder kills its
  // adapters' process groups when it aborts, and the promise settles only after.
  readonly record: (options: RecordOptions, signal?: AbortSignal) => Promise<RecordResults>;
  readonly signal?: AbortSignal;
}

export const realRecord = async (options: RecordOptions, signal: AbortSignal = new AbortController().signal): Promise<RecordResults> => {
  try { return await runRecording(options, signal); }
  // Never retain a raw transport, filesystem or child-process error, as `recordFixtures` does.
  catch { throw new Error("Fixture recording failed"); }
};

export interface RecordingOutcome {
  readonly passed: boolean;
  readonly report: string;
  readonly reason: string;
}

// Decides from the recorder's results alone, so a test can feed it any.
export const judge = (results: RecordResults): RecordingOutcome => {
  const report = formatReport(results);
  const missing = RECORDED_HARNESSES.filter((id) => results.find((result) => result.harness === id)?.status !== "recorded");
  if (missing.length > 0) return { passed: false, report, reason: `${missing.join(" and ")} did not record` };
  if (hasRecordingFailures(results)) return { passed: false, report, reason: "the recorder reported a failure" };
  return { passed: true, report, reason: "claude and codex recorded" };
};

export const recordLive = async (deps: RecordingDeps): Promise<RecordingOutcome> => {
  const homeDirectory = deps.environment.HOME;
  if (homeDirectory === undefined || homeDirectory === "") return { passed: false, report: "", reason: "HOME is not set" };
  const parentEnvironment = { ...deps.environment };
  const harnesses = RECORDED_HARNESSES.map((id) => {
    const settings = deps.settings.find((harness) => harness.id === id);
    const accountVariables = Object.fromEntries((ACCOUNT_NAMES[id] ?? []).flatMap((name) =>
      parentEnvironment[name] === undefined ? [] : [[name, parentEnvironment[name]!] as const]));
    return { id, ...(settings === undefined ? {} : { settings }), accountVariables };
  });
  const errorDirectory = join(deps.outputDirectory, "errors");
  const errorSamples = await Promise.all((await readdir(errorDirectory)).filter((name) => name.endsWith(".json")).map(async (name) =>
    JSON.parse(await readFile(join(errorDirectory, name), "utf8"))));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "shephrd-live-record-"));
  try {
    const results = await deps.record({
      harnesses, outputDirectory: deps.outputDirectory, temporaryRoot, homeDirectory, parentEnvironment,
      prompt: RECORDER_PROMPT, errorSamples, captureSignedOut: true,
    } as RecordOptions, deps.signal);
    return judge(results);
  } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
};
