import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  accountFor, alive, deliveryFor, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig,
  spawnFor, withAcpRunner, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Unit 6c fix round 1, ruling A3. The runner hands the classifier `turn.error ?? turn.text`,
// so the text of a turn that succeeded is classified as well. Text a working agent writes
// that merely quotes an authentication or usage phrase must not pause its account, with one
// exception: the cursor adapter reports an exhausted plan as ordinary reply text, so its
// phrase "Upgrade your plan to continue" in a successful turn still pauses out of usage.
// An error reply that carries the signed-out phrase still pauses signed out.
//
// These tests run the real runner with its default classifier, as the runner tests in
// classify-errors.test.ts do, because the choice between the error and the text is the runner's.

registerRebuildCheck({ noLog: true });

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
// Each case starts a fresh fake adapter per harness or value; allow for serial startups under suite load.
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 120_000);

const turnReply = (context: { readonly runner: any; readonly events: ReadonlyArray<any>; readonly waitFor: any }, spawn: { readonly agentId: any; readonly incarnation: string }, text: string): Effect.Effect<unknown, unknown, never> =>
  Effect.gen(function* () {
    const delivery = deliveryFor(spawn.agentId, text);
    const before = context.events.length;
    yield* context.runner.prompt({ sentSequence: 1, agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    return yield* context.waitFor((event: any) => event._tag === "promptReply" && event.deliveryId === delivery.id, before);
  }) as Effect.Effect<unknown, unknown, never>;

const harnesses = ["claude", "codex", "cursor", "gemini"] as const;
// The usage phrases the classifier matches for the three adapters whose usage errors are errors.
const usagePhrase = {
  claude: "You've hit your usage limit for today.",
  codex: "rateLimitExceeded",
  gemini: "Rate limit exceeded. Try again later.",
} as const;

// One turn on a fresh process: the fake agent writes `text`, then ends the turn normally.
const successfulTurn = (context: Parameters<Parameters<typeof withAcpRunner>[2]>[0], harness: string, text: string, name: string) =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const script = { turns: [[{ step: "text", text }, { step: "end_turn", stopReason: "end_turn" }]] };
    const spawn = yield* spawnFor(rig, harnessFor(harness, writeFakeAdapter(rig, `adapter-${name}`)), accountFor(harness, script, echo, {}, `account-${name}`));
    yield* context.runner.start(spawn.input);
    const reply = (yield* turnReply(context, spawn, "go")) as { readonly outcome: { readonly _tag: string; readonly reason?: string } };
    expect(context.events.filter((event) => event._tag === "exited" && event.agentId === spawn.agentId)).toEqual([]);
    expect(alive((yield* readEcho(echo)).pid)).toBe(true);
    return reply.outcome;
  });

live("6.9 A3 a successful turn whose text says 'authentication required' is a success for every harness, not a signed-out pause (breaks if the runner classifies the text of a turn that had no error)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    for (const harness of harnesses) {
      for (const text of ["authentication required", "I read the log. Authentication required. Please run the login step, then retry."]) {
        const outcome = yield* successfulTurn(context, harness, text, `${harness}-auth-${text.length}`);
        expect({ harness, text, outcome }).toEqual({ harness, text, outcome: { _tag: "success" } });
      }
    }
  })));

live("6.9 A3 a successful turn whose text holds the claude, codex or gemini usage phrase is a success, not an out-of-usage pause (breaks if the runner classifies the text of a turn that had no error)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    for (const harness of ["claude", "codex", "gemini"] as const) {
      const text = usagePhrase[harness];
      const outcome = yield* successfulTurn(context, harness, `The docs say: ${text}`, `${harness}-usage`);
      expect({ harness, text, outcome }).toEqual({ harness, text, outcome: { _tag: "success" } });
    }
  })));

live("6.9 A3 the cursor phrase 'Upgrade your plan to continue' in a successful turn still pauses out of usage (breaks if the runner stops classifying turn text altogether, because the cursor adapter reports its quota only as reply text)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const outcome = yield* successfulTurn(context, "cursor", "\n\nUpgrade your plan to continue", "cursor-upgrade");
    expect(outcome).toMatchObject({ _tag: "pause", reason: "out-of-usage" });
  })));

live("6.9 A3 the same signed-out phrase in an error reply still pauses signed out for every harness, whether the adapter ends the turn with an error or fails the request (breaks if moving the check off the text drops the error path)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    for (const harness of harnesses) {
      for (const via of ["idle", "rpc"] as const) {
        const echo = echoFile(rig);
        const script = { turns: [[{ step: "signed_out", message: "Authentication required", via }]] };
        const name = `${harness}-${via}`;
        const spawn = yield* spawnFor(rig, harnessFor(harness, writeFakeAdapter(rig, `adapter-${name}`)), accountFor(harness, script, echo, {}, `account-${name}`));
        yield* context.runner.start(spawn.input);
        const reply = (yield* turnReply(context, spawn, "go")) as { readonly outcome: { readonly _tag: string; readonly reason?: string } };
        expect({ harness, via, outcome: reply.outcome._tag, reason: reply.outcome.reason }).toEqual({ harness, via, outcome: "pause", reason: "signed-out" });
        expect(context.events.filter((event) => event._tag === "exited" && event.agentId === spawn.agentId)).toEqual([]);
      }
    }
  })));
