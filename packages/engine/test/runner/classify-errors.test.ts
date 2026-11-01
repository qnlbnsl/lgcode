import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import {
  accountFor, alive, deliveryFor, echoFile, fixturePath, harnessFor, makeRunnerRig, readEcho, removeRunnerRig,
  spawnFor, withAcpRunner, writeFakeAdapter, writeReplayAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { classifyError } from "../../src/runner/classify.ts";

// Unit 6c, criterion 6.9 (task 6c.3): the classifier that tells a signed-out
// reply and an out-of-usage reply apart, per harness, and the proof that the
// real runner uses it by default. Account pauses themselves are unit 6b's;
// these tests look only at the kind the classifier gives and at the runner's
// pause outcome.

registerRebuildCheck({ noLog: true });

interface Sample { readonly harness: string; readonly kind: "signed-out" | "out-of-usage"; readonly text: string; readonly file: string }

const errorsFolder = fixturePath("errors");
const samples: ReadonlyArray<Sample> = readdirSync(errorsFolder)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((file) => ({ ...(JSON.parse(readFileSync(join(errorsFolder, file), "utf8")) as Omit<Sample, "file">), file }));

const harnesses = [...new Set(samples.map((sample) => sample.harness))].sort();
const sampleOf = (harness: string, kind: Sample["kind"]) => {
  const found = samples.find((sample) => sample.harness === harness && sample.kind === kind);
  if (found === undefined) throw new Error(`No ${kind} sample for ${harness}`);
  return found;
};

// Text a working agent can plausibly produce that is neither error. The
// classifier also reads a turn's reply text when the turn has no error (the
// runner passes `turn.error ?? turn.text`), so ordinary prose about
// authentication, usage and limits must not pause an account.
const unrelated = [
  "Tool call failed: file not found",
  "Usage: pnpm test [options]",
  "The build ran out of memory",
  "The authentication tests failed: expected 3, got 4",
  "I added a rate limiter to the middleware and a test for the limit.",
  "{\"code\":-32603,\"message\":\"Internal error\"}",
  "",
] as const;

describe("6.9 the fixtures cover what the task names", () => {
  it("every harness with a fixture has both kinds, so the per-harness cases below are not silently empty (breaks if a fixture is renamed or removed)", () => {
    expect(harnesses).toEqual(["claude", "codex", "cursor", "gemini"]);
    for (const harness of harnesses) {
      expect(samples.filter((sample) => sample.harness === harness).map((sample) => sample.kind).sort()).toEqual(["out-of-usage", "signed-out"]);
    }
  });
});

describe("6.9 the classifier tells the two errors apart, per harness", () => {
  for (const sample of samples) {
    it(`${sample.file}: the recorded ${sample.kind} reply classifies as ${sample.kind} for ${sample.harness} (breaks if the matcher for this harness is missing, or gives the other kind)`, () => {
      expect(classifyError({ harness: sample.harness, text: sample.text })).toBe(sample.kind);
    });
  }

  it("6.9 the same reply inside a longer message still classifies, because the claude out-of-usage sample is only the start of the real message (breaks if the matcher wants the whole text to be equal)", () => {
    const sample = sampleOf("claude", "out-of-usage");
    const longer = `{"code":-32001,"message":"${sample.text} 5-hour limit · resets 4pm (Europe/Berlin)"}`;
    expect(classifyError({ harness: "claude", text: longer })).toBe("out-of-usage");
  });

  it("6.9 the runner passes the reply as JSON of the error, and each signed-out sample still classifies when wrapped that way (breaks if the matcher reads only bare text and not the JSON form the runner builds)", () => {
    for (const harness of harnesses) {
      const sample = sampleOf(harness, "signed-out");
      const message = (() => {
        try { return (JSON.parse(sample.text) as { message?: string }).message ?? sample.text; } catch { return sample.text; }
      })();
      expect(classifyError({ harness, text: JSON.stringify({ code: -32000, message }) })).toBe("signed-out");
    }
  });

  for (const harness of harnesses) {
    it(`6.9 ${harness}: unrelated errors and prose are neither kind (breaks if a matcher fires on a loose word such as usage, authentication, limit or memory)`, () => {
      for (const text of unrelated) {
        expect({ text, kind: classifyError({ harness, text }) }).toEqual({ text, kind: undefined });
      }
    });
  }
});

describe("6.9 issue 38: the third harness's out-of-usage reply", () => {
  it("the cursor out-of-usage fixture classifies as out of usage (breaks if the cursor matcher is missing)", () => {
    const sample = sampleOf("cursor", "out-of-usage");
    expect(classifyError({ harness: "cursor", text: sample.text })).toBe("out-of-usage");
  });

  it("the text in the recorded cursor transcript, the reply the real adapter sends, classifies as out of usage too (breaks if only the placeholder fixture text is matched and not the recorded wording)", () => {
    const transcript = readFileSync(fixturePath("cursor.ndjson"), "utf8");
    expect(transcript).toContain("Upgrade your plan to continue");
    expect(classifyError({ harness: "cursor", text: "\n\nUpgrade your plan to continue" })).toBe("out-of-usage");
  });
});

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 30_000);

const turnReply = (context: { readonly runner: any; readonly events: ReadonlyArray<any>; readonly waitFor: any }, spawn: { readonly agentId: any; readonly incarnation: string }, text: string) =>
  Effect.gen(function* () {
    const delivery = deliveryFor(spawn.agentId, text);
    const before = context.events.length;
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    return yield* context.waitFor((event: any) => event._tag === "promptReply" && event.deliveryId === delivery.id, before);
  });

live("6.9 the real runner, with no classifier passed in, turns each recorded out-of-usage reply into a pause and each recorded signed-out reply into a signed-out pause, not an error or a crash (breaks if the runner's default classifier is missing or is not the one in runner/classify.ts)", () =>
  // No `classifyError` option is given: the default must be the real one.
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    for (const sample of samples) {
      const echo = echoFile(rig);
      const name = sample.file.replace(/\.json$/, "");
      const script = sample.kind === "out-of-usage"
        ? { turns: [[{ step: "out_of_usage", message: sample.text, resetsAt: "2026-11-02T00:00:00Z" }]] }
        // The fake agent's signed-out step carries a message; the runner
        // wraps it as {"code":-32000,"message":...} like the real adapters.
        : { turns: [[{ step: "signed_out", message: (() => { try { return (JSON.parse(sample.text) as { message?: string }).message ?? sample.text; } catch { return sample.text; } })() }]] };
      const spawn = yield* spawnFor(rig, harnessFor(sample.harness, writeFakeAdapter(rig, `adapter-${name}`)), accountFor(sample.harness, script, echo, {}, `account-${name}`));
      yield* context.runner.start(spawn.input);
      const reply = yield* turnReply(context, spawn, "go");
      expect({ sample: sample.file, outcome: (reply as any).outcome._tag, reason: (reply as any).outcome.reason }).toEqual({ sample: sample.file, outcome: "pause", reason: sample.kind });
      expect(context.events.filter((event) => event._tag === "exited" && event.agentId === spawn.agentId)).toEqual([]);
      expect(alive((yield* readEcho(echo)).pid)).toBe(true);
    }
  })));

live("6.9 issue 38: the recorded cursor transcript, replayed through the real runner, ends in an out-of-usage pause and the adapter keeps running, not a crash (breaks if the runner reports the turn as success, or the pause is dropped, or the child is stopped)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const adapter = writeReplayAdapter(rig, "cursor.ndjson", rig.work);
    const spawn = yield* spawnFor(rig, harnessFor("cursor", adapter), accountFor("cursor", {}, echo));
    yield* context.runner.start(spawn.input);
    const reply = yield* turnReply(context, spawn, "go");
    expect((reply as any).outcome).toMatchObject({ _tag: "pause", reason: "out-of-usage" });
    expect(context.events.filter((event) => event._tag === "exited")).toEqual([]);
  })));

live("6.9 a normal turn whose reply talks about authentication and limits stays a success, not a pause (breaks if the runner's default classifier matches loose words in the reply text)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const script = { turns: [[{ step: "text", text: "The authentication tests failed: expected 3, got 4. I added a rate limiter." }, { step: "end_turn", stopReason: "end_turn" }]] };
    const spawn = yield* spawnFor(rig, harnessFor("gemini", writeFakeAdapter(rig)), accountFor("gemini", script, echo));
    yield* context.runner.start(spawn.input);
    const reply = yield* turnReply(context, spawn, "go");
    expect((reply as any).outcome).toEqual({ _tag: "success" });
  })));

live("6.9 an unrelated adapter error stays an error, neither kind, and still is not a crash (breaks if every error is classified as a pause, or an unclassified error is treated as an exit)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const script = { turns: [[{ step: "rpc_error", message: "Tool call failed: file not found" }]] };
    const spawn = yield* spawnFor(rig, harnessFor("codex", writeFakeAdapter(rig)), accountFor("codex", script, echo));
    yield* context.runner.start(spawn.input);
    const reply = yield* turnReply(context, spawn, "go");
    expect((reply as any).outcome._tag).toBe("error");
    expect(context.events.filter((event) => event._tag === "exited")).toEqual([]);
  })));
