import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { expect } from "vitest";

import { serviceLog } from "../../src/api/serviceLog.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { redactingLoggerLayer } from "../../src/identity/logger.ts";
import { installedHarnessDefaults, localHarnessDefaults } from "../../src/runner/harnesses.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

// Fix round 2, F-2: the first-start warning that names the harness adapters it
// could not find reaches the service's log as a fixed line, while any other
// text still becomes "service diagnostic". The test goes through the real
// redacting logger and the real sink, writing to a list of finished lines.
const secret = "sk-ant-api03-PLANTEDSERVICELOGSECRET0123456789";
const sinkLines = (program: Effect.Effect<unknown>) => Effect.gen(function* () {
  const lines: Array<string> = [];
  const redactor = makeRedactor({ secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set<string>() });
  yield* program.pipe(Effect.provide(redactingLoggerLayer(redactor, serviceLog(false, (line) => { lines.push(line); }))));
  return lines.map((line) => JSON.parse(line) as { level: string; message: string });
});

it.live("F-2 missing adapters: catches the sink replacing the first-start warning with `service diagnostic`, so an owner whose Gemini or Cursor adapter is missing is told nothing (the ids come from the real defaults with an empty search path)", () =>
  Effect.gen(function* () {
    const { missing } = yield* localHarnessDefaults("").pipe(Effect.provide(NodeServices.layer));
    const ids = missing.map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining(["gemini", "cursor"]));
    const lines = yield* sinkLines(installedHarnessDefaults(""));
    expect(lines.map((line) => line.message)).toEqual([`harness adapters not found: ${ids.join(", ")}`]);
    expect(lines[0]!.level).toBe("WARN");
  }), 60_000);

it.live("F-2 missing adapters: catches a message that only starts like the warning (other ids, extra text, a planted secret) being written as it is, which would reopen the sink to arbitrary text", () =>
  Effect.gen(function* () {
    const lines = yield* sinkLines(Effect.all([
      Effect.logWarning("harness adapters not found: gemini, planted-id"),
      Effect.logWarning(`harness adapters not found: gemini ${secret}`),
      Effect.logWarning("harness adapters not found: gemini, cursor and more"),
      Effect.logWarning("harness adapters not found: "),
      Effect.logWarning("harness adapters not found: cursor, gemini, claude, codex, claude"),
    ]));
    expect(lines.map((line) => line.message)).toEqual(Array(5).fill("service diagnostic"));
    expect(JSON.stringify(lines).includes(secret)).toBe(false);
  }), 60_000);
