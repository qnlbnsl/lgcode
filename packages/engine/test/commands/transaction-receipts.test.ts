import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { EventLog } from "../../src/log/EventLog.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentIdOf, appendSetup, call, eventOf, failureOf, freshRequest, harnessSettings, headSequence, logAfter,
  makeFakeSecrets, makeRig, ownerCredential, provideRig, removeRig, seedAccount, seedHarness,
  startPayload, success, viewsWithoutSequence, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGCODE_HOME", rig.stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

const withRig = <A, E, R>(program: Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
  return yield* provideRig(rig, fakes, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAccount();
    yield* seedHarness();
    return yield* program;
  }));
});

for (const name of ["accounts", "harnesses"] as const) {
  it.effect(`5b receipts: ${name} retry returns the first list after settings change`, () => withRig(Effect.gen(function* () {
    const requestId = freshRequest();
    const first = success(yield* call(ownerCredential, name, { requestId, operation: "list" }));
    if (name === "accounts") success(yield* call(ownerCredential, name, {
      operation: "add", account: { id: "spare", harness: "first", enabled: true },
    }));
    else success(yield* call(ownerCredential, name, {
      operation: "set", harness: harnessSettings("first", { adapterArguments: ["changed"] }),
    }));
    const before = yield* headSequence;
    const retry = success(yield* call(ownerCredential, name, { requestId, operation: "list" }));
    expect(retry).toEqual(first);
    expect(yield* logAfter(before)).toEqual([]);
  })).pipe(Effect.orDie));
}

it.effect("5b receipts: temporary account refusal allows the same request after the account returns", () => withRig(Effect.gen(function* () {
  yield* appendSetup([eventOf({ _tag: "AccountOutOfUsage", accountId: "primary" })]);
  const requestId = freshRequest();
  const payload = startPayload(rig, { requestId });
  expect(failureOf(yield* call(ownerCredential, "start", payload))?.reason).toBe("no usable account");
  const sql = yield* SqlClient.SqlClient;
  expect(yield* sql`SELECT * FROM receipts WHERE request_id = ${requestId}`).toEqual([]);
  yield* appendSetup([eventOf({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" })]);
  expect(success(yield* call(ownerCredential, "start", payload)).agentId).toBeTypeOf("string");
})).pipe(Effect.orDie));

it.effect("5.1 writer transaction: a caller failure after append rolls back events, receipt, side rows and live publication", () => withRig(Effect.gen(function* () {
  const before = yield* headSequence;
  const snapshot = yield* viewsWithoutSequence;
  const log = yield* EventLog;
  const requestId = freshRequest();
  const outcome = yield* log.transact((append) => Effect.gen(function* () {
    yield* append({ _tag: "owner" }, requestId, "a".repeat(64), [eventOf({
      _tag: "AccountChanged", accountId: "rolled-back", account: { id: "rolled-back", harness: "first" },
    })], { agentTokens: [{ agentId: agentIdOf("rolled-back"), tokenHash: "b".repeat(64), revokedAt: null }] });
    return yield* Effect.fail("rollback marker");
  })).pipe(Effect.result);
  expect(outcome._tag).toBe("Failure");
  expect(yield* logAfter(before)).toEqual([]);
  expect(yield* viewsWithoutSequence).toEqual(snapshot);
  const sql = yield* SqlClient.SqlClient;
  expect(yield* sql`SELECT * FROM receipts WHERE request_id = ${requestId}`).toEqual([]);
  expect(yield* sql`SELECT * FROM agent_tokens WHERE agent_id = 'rolled-back'`).toEqual([]);
  // A caller refusal does not trip the write-failure latch.
  success(yield* call(ownerCredential, "accounts", { operation: "list" }));
})).pipe(Effect.orDie));
