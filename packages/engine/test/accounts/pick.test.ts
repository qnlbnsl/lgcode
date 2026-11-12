import { it } from "@effect/vitest";
import type { Event } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { pickAccount } from "../../src/accounts/pick.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentIdOf, appendSetup, call, eventOf, failureOf, headSequence, logAfter, makeFakeSecrets,
  makeRig, ownerCredential, provideRig, removeRig, seedHarness, startPayload, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { snapshot, tagged } from "../support/routingRig.ts";

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", `${rig.home}/.codex`);
});
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

const withAccounts = <A, E, R>(body: (runner: Effect.Success<ReturnType<typeof makeFakeRunner>>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const runner = yield* makeFakeRunner();
    return yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedHarness();
      yield* runner.subscribed;
      return yield* body(runner);
    }));
  }).pipe(Effect.orDie);

const add = (id: string, extra: Record<string, unknown> = {}) => Effect.gen(function* () {
  success(yield* call(ownerCredential, "accounts", {
    operation: "add", account: { id, harness: "first", enabled: true, ...extra },
  }));
});

// Logged historical lifecycles, rather than hand-filled view rows. A starting
// session and an interrupted process cannot be manufactured with a successful
// synchronous fake start. The picker and start command read the real reducer.
const historicalAgent = (id: string, account: string, state: string) => Effect.gen(function* () {
  const agentId = agentIdOf(id);
  const events: Array<Event> = [eventOf({
    _tag: "AgentStarted", agentId, name: id, role: "worker", groups: [], parent: { _tag: "owner" },
    harness: "first", account, permission: "ask", folder: rig.work, runMode: "acp",
  })];
  if (state !== "starting") events.push(eventOf({
    _tag: "SessionOpened", agentId, session: { _tag: "acp", sessionId: `session-${id}` }, protocolVersion: 2, reloadable: true,
  }));
  if (state === "working") events.push(
    eventOf({ _tag: "DeliveryQueued", delivery: { id: `turn-${id}`, target: agentId, sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Existing turn." } } }),
    eventOf({ _tag: "DeliverySent", agentId, deliveryId: `turn-${id}`, method: "acp" }),
    eventOf({ _tag: "DeliveryAccepted", agentId, deliveryId: `turn-${id}` }),
  );
  if (state === "paused") events.push(eventOf({ _tag: "StateChanged", agentId, state: { _tag: "paused", reason: "limit", midTurn: false } }));
  if (state === "interrupted") events.push(eventOf({ _tag: "AgentInterrupted", agentId, previous: "idle" }));
  if (state === "stopped") events.push(eventOf({ _tag: "AgentStopped", agentId }));
  if (state === "crashed") events.push(eventOf({ _tag: "AgentCrashed", agentId, exitCode: 1, signal: null, stderr: "" }));
  yield* appendSetup(events);
});

const startAny = () => call(ownerCredential, "start", startPayload(rig, { account: { _tag: "any" } }));

for (const state of ["starting", "working", "idle", "paused"] as const) {
  it.effect(`6.5 P1/${state}: catches ignoring ${state} agents when picking the least-loaded account`, () => withAccounts((runner) => Effect.gen(function* () {
    yield* add("a-loaded");
    yield* add("z-free");
    yield* historicalAgent(`existing-${state}`, "a-loaded", state);
    expect(pickAccount(yield* snapshot, "first", { _tag: "any" })?.id).toBe("z-free");
    const before = runner.callsOf("start").length;
    const reply = success(yield* startAny());
    expect(runner.callsOf("start").slice(before).map((entry) => entry.input.account.id)).toEqual(["z-free"]);
    expect((yield* snapshot).agents[reply.agentId]?.account).toBe("z-free");
  })));
}

it.effect("6.5 P2: catches insertion-order tie-breaking and counting stopped, crashed or interrupted agents", () => withAccounts((runner) => Effect.gen(function* () {
  yield* add("z-first");
  yield* add("a-second");
  for (const state of ["stopped", "crashed", "interrupted"]) yield* historicalAgent(`old-${state}`, "a-second", state);
  expect(pickAccount(yield* snapshot, "first", { _tag: "any" })?.id).toBe("a-second");
  const before = runner.callsOf("start").length;
  success(yield* startAny());
  expect(runner.callsOf("start").slice(before).map((entry) => entry.input.account.id)).toEqual(["a-second"]);
})));

it.effect("6.5 P3: catches selecting an unusable or wrong-harness account and ignoring the new reservation", () => withAccounts((runner) => Effect.gen(function* () {
  yield* add("a-disabled", { enabled: false });
  yield* add("b-other", { harness: "other" });
  yield* add("c-signed-out");
  yield* add("d-empty");
  yield* appendSetup([
    eventOf({ _tag: "AccountNeedsSignIn", accountId: "c-signed-out", reason: "account needs sign-in" }),
    eventOf({ _tag: "AccountOutOfUsage", accountId: "d-empty", resetAt: 1 }),
  ]);
  yield* add("y-ready");
  yield* add("z-ready");
  const before = runner.callsOf("start").length;
  success(yield* startAny());
  success(yield* startAny());
  expect(runner.callsOf("start").slice(before).map((entry) => entry.input.account.id)).toEqual(["y-ready", "z-ready"]);
})));

for (const status of ["none", "needs-sign-in", "out-of-usage", "disabled", "other-harness"] as const) {
  for (const selection of ["any", "named"] as const) {
    it.effect(`6.5 P4/${status}/${selection}: catches spawning without a usable account or leaking a variable in the refusal`, () => withAccounts((runner) => Effect.gen(function* () {
      if (status !== "none") {
        yield* add("unusable", {
          harness: status === "other-harness" ? "other" : "first", enabled: status !== "disabled",
          environment: { API_KEY: "secret:planted" },
        });
        if (status === "needs-sign-in") yield* appendSetup([eventOf({ _tag: "AccountNeedsSignIn", accountId: "unusable", reason: "account needs sign-in" })]);
        if (status === "out-of-usage") yield* appendSetup([eventOf({ _tag: "AccountOutOfUsage", accountId: "unusable", resetAt: 1 })]);
      }
      const callsBefore = runner.calls.length;
      const before = yield* headSequence;
      expect(pickAccount(yield* snapshot, "first", selection === "any" ? { _tag: "any" } : { _tag: "named", accountId: "unusable" })).toBeUndefined();
      const result = yield* call(ownerCredential, "start", startPayload(rig, {
        account: selection === "any" ? { _tag: "any" } : { _tag: "named", accountId: "unusable" },
      }));
      expect(failureOf(result)).toEqual({ _tag: "CommandRefused", reason: "no usable account" });
      expect(runner.calls.slice(callsBefore)).toEqual([]);
      const written = yield* logAfter(before);
      expect(tagged(written, "AgentStarted")).toEqual([]);
      expect(tagged(written, "CommandRefused").map((event) => event.reason)).toEqual(["no usable account"]);
    })));
  }
}
