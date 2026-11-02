import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  accountFor, alive, deliveryFor, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig,
  spawnFor, withAcpRunner, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Unit 6c fix round 2, ruling F-4 (issue 128). The runner's out-of-usage pause carries `resetAt`,
// epoch milliseconds, taken from `error.data.resetsAt` of the error reply to `session/prompt`:
//   - a string that `Date.parse` turns into a finite number, or a finite non-negative integer
//     (epoch milliseconds), gives `resetAt`;
//   - anything else (missing, empty, not a date, an object, a fraction, a negative number, a
//     time more than 366 days from now) gives no `resetAt` key, and never an error or a crash;
//   - a signed-out pause never carries `resetAt`.
//
// The tests go through the real runner with its default classifier and the fake agent's
// `out_of_usage` and `signed_out` steps. The script is JSON the fake agent does not validate,
// so a number or an object in `resetsAt` needs no change to the fake agent.

registerRebuildCheck({ noLog: true });

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 30_000);

type Outcome = { readonly _tag: string; readonly reason?: string; readonly resetAt?: unknown };

const turnReply = (context: { readonly runner: any; readonly events: ReadonlyArray<any>; readonly waitFor: any }, spawn: { readonly agentId: any; readonly incarnation: string }): Effect.Effect<unknown, unknown, never> =>
  Effect.gen(function* () {
    const delivery = deliveryFor(spawn.agentId, "go");
    const before = context.events.length;
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    return yield* context.waitFor((event: any) => event._tag === "promptReply" && event.deliveryId === delivery.id, before);
  }) as Effect.Effect<unknown, unknown, never>;

// One turn on a fresh adapter whose only step is `step`; returns the prompt reply's outcome.
const outcomeOf = (context: Parameters<Parameters<typeof withAcpRunner>[2]>[0], name: string, step: Record<string, unknown>, harness = "claude") =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor(harness, writeFakeAdapter(rig, `adapter-${name}`)), accountFor(harness, { turns: [[step]] }, echo, {}, `account-${name}`));
    yield* context.runner.start(spawn.input);
    const reply = (yield* turnReply(context, spawn)) as { readonly outcome: Outcome };
    // A bad value must not crash the adapter's process or end the agent.
    expect(context.events.filter((event) => event._tag === "exited" && event.agentId === spawn.agentId)).toEqual([]);
    expect(alive((yield* readEcho(echo)).pid)).toBe(true);
    return reply.outcome;
  });

const usage = (resetsAt: unknown) => ({ step: "out_of_usage", message: "You've hit your usage limit.", resetsAt });
const day = 24 * 60 * 60 * 1000;

live("6.10 F-4 an ISO reset time in the error reply becomes resetAt, the same instant as Date.parse gives, for a UTC time, a time with an offset and a time with milliseconds (breaks if the runner drops the reset time or reads it wrongly)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const now = Date.now();
    const utc = new Date(now + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const offset = `${new Date(now + 2 * 3_600_000 + 2 * 3_600_000).toISOString().slice(0, 19)}+02:00`;
    const milliseconds = new Date(now + 5_400_000 + 123).toISOString();
    for (const [name, text] of [["utc", utc], ["offset", offset], ["milliseconds", milliseconds]] as const) {
      const outcome = yield* outcomeOf(context, `iso-${name}`, usage(text));
      expect({ name, tag: outcome._tag, reason: outcome.reason, resetAt: outcome.resetAt }).toEqual({ name, tag: "pause", reason: "out-of-usage", resetAt: Date.parse(text) });
    }
  })));

live("6.10 F-4 a time inside the 366 day bound, 300 days ahead, still becomes resetAt (breaks if the bound is made much shorter than the ruling says)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const text = new Date(Date.now() + 300 * day).toISOString();
    const outcome = yield* outcomeOf(context, "far-but-inside", usage(text));
    expect(outcome).toMatchObject({ _tag: "pause", reason: "out-of-usage", resetAt: Date.parse(text) });
  })));

live("6.10 F-4 a finite non-negative integer in the error reply is taken as epoch milliseconds (breaks if only strings are read)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const at = Date.now() + 3_600_000;
    const outcome = yield* outcomeOf(context, "integer", usage(at));
    expect(outcome).toMatchObject({ _tag: "pause", reason: "out-of-usage", resetAt: at });
  })));

live("6.10 F-4 a missing, empty, unparsable, object, fractional, negative, boolean or null reset time, and a time 400 days ahead, give an out-of-usage pause with no resetAt key, and no crash (breaks if a bad value throws, is guessed, or is passed through)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["missing", { step: "out_of_usage", message: "You've hit your usage limit." }],
      ["soon", usage("soon")],
      ["empty", usage("")],
      ["400-days", usage(new Date(Date.now() + 400 * day).toISOString())],
      ["400-days-number", usage(Date.now() + 400 * day)],
      ["object", usage({ at: "2026-11-02T00:00:00Z" })],
      ["fraction", usage(1.5)],
      ["negative", usage(-5)],
      ["boolean", usage(true)],
      ["null", usage(null)],
    ];
    for (const [name, step] of cases) {
      const outcome = yield* outcomeOf(context, `bad-${name}`, step);
      expect({ name, tag: outcome._tag, reason: outcome.reason, hasResetAt: "resetAt" in outcome }).toEqual({ name, tag: "pause", reason: "out-of-usage", hasResetAt: false });
    }
  })));

live("6.10 F-4 a signed-out error reply gives a signed-out pause with no resetAt (breaks if resetAt is attached to every pause)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    for (const via of ["idle", "rpc"] as const) {
      const outcome = yield* outcomeOf(context, `signed-out-${via}`, { step: "signed_out", message: "Authentication required", via });
      expect({ via, tag: outcome._tag, reason: outcome.reason, hasResetAt: "resetAt" in outcome }).toEqual({ via, tag: "pause", reason: "signed-out", hasResetAt: false });
    }
  })));
