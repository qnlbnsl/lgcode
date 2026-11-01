import type { EventEnvelope } from "@shepherd/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { sha256Hex } from "../../src/identity/credential.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import * as Subscribe from "../../src/log/subscribe.ts";
import * as Views from "../../src/views/Views.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, call, failureOf, headSequence, makeFakeSecrets, makeRig, ownerCredential, provideRig, removeRig,
  seedAccount, seedAgent, seedHarness, stateOf, success, type Credential, type Fakes, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Unit 5c fix round 1, ruling 2 (B1; SECURITY.md rule 6): a `requestId` that
// the redactor would change is refused with "command refused" before the
// receipt lookup, and nothing is written: no event, no receipt, no thread
// entry. The contract accepts any nonempty string, so a caller can put a
// live token there; the engine must not store it in `events.request_id`,
// `receipts.request_id`, a stored envelope, a view or the `subscribe`
// stream. The redactor here is the real one (task 5a.3), told about the
// seeded agents' token hashes.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const tokenHashes = new Set<string>();

const withRig = <A, E, R>(body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    tokenHashes.clear();
    const redactor = makeRedactor({ secrets: () => [], tokenHashes: () => tokenHashes }).layer;
    const fakes: Fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets(), redactor };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      return yield* body(fakes);
    }));
  });

// An agent whose token the redactor knows, as the service's token registry
// knows every live token.
const seedKnown = (spec: Parameters<typeof seedAgent>[0]) => Effect.gen(function* () {
  const seeded = yield* seedAgent(spec);
  tokenHashes.add(sha256Hex(seeded.token));
  return seeded;
});

const callWith = (credential: Credential, name: string, requestId: string, payload: Record<string, unknown>) =>
  call(credential, name, { ...payload, requestId });

// Every stored place the token could reach: request ids, stored payloads and
// receipts, the live views, and what `subscribe(0)` delivers up to the head.
const stored = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const head = yield* headSequence;
  const delivered: Array<EventEnvelope> = head === 0 ? [] : [...yield* Subscribe.subscribe(0).pipe(
    Stream.takeUntil((envelope) => envelope.sequence >= head),
    Stream.runCollect,
    Effect.timeout("5 seconds"),
    Effect.orDie,
  )];
  return {
    head,
    receiptCount: (yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM receipts`)[0]!.n,
    requestIds: [
      ...(yield* sql<{ request_id: string }>`SELECT request_id FROM events`).map((row) => row.request_id),
      ...(yield* sql<{ request_id: string }>`SELECT request_id FROM receipts`).map((row) => row.request_id),
    ],
    texts: [
      ...(yield* sql<{ payload_json: string }>`SELECT payload_json FROM events`).map((row) => row.payload_json),
      ...(yield* sql<{ result_json: string }>`SELECT result_json FROM receipts`).map((row) => row.result_json),
      JSON.stringify(yield* (yield* Views.Views).snapshot),
      ...delivered.map((envelope) => JSON.stringify(envelope)),
    ],
    delivered: delivered.length,
  };
});

const expectNowhere = (where: Effect.Success<typeof stored>, secret: string) => {
  for (const id of where.requestIds) expect(id).not.toContain(secret);
  for (const text of where.texts) expect(text).not.toContain(secret);
};

// The request ids a caller could build from its own token.
for (const [form, requestIdOf] of [
  ["the token itself", (token: string) => token],
  ["the token inside a longer id", (token: string) => `retry-${token}-2`],
] as const) {
  it.live(`5c fix-1 ruling 2, ask with ${form} as requestId: catches an agent's live token stored as a request id, in a receipt, an envelope, the views or the subscribe stream`, () =>
    withRig(() => Effect.gen(function* () {
      yield* seedKnown({ id: "lead" });
      const worker = yield* seedKnown({ id: "worker", parent: "lead", state: "working" });
      const before = yield* stored;

      const outcome = yield* callWith(agentCredential(worker.token), "ask", requestIdOf(worker.token), { text: "Which branch?" });
      expect(failureOf(outcome)).toEqual({ _tag: "CommandRefused", reason: "command refused" });

      const after = yield* stored;
      // Nothing was written: no event, no receipt, no thread entry.
      expect(after.head).toBe(before.head);
      expect(after.receiptCount).toBe(before.receiptCount);
      expect(after.delivered).toBe(before.delivered);
      expectNowhere(after, worker.token);
      expect(Object.values((yield* (yield* Views.Views).snapshot).questions)).toEqual([]);
    })).pipe(Effect.orDie));
}

it.live("5c fix-1 ruling 2, a command refused anyway: catches a token request id stored with the \"command refused\" event of a stop the agent has no right to", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedKnown({ id: "lead", state: "working" });
    const worker = yield* seedKnown({ id: "worker", parent: "lead", state: "working" });
    const before = yield* stored;

    // A worker may not stop its own parent.
    const outcome = yield* callWith(agentCredential(worker.token), "stop", worker.token, { agentId: "lead" });
    expect(failureOf(outcome)).toEqual({ _tag: "CommandRefused", reason: "command refused" });

    const after = yield* stored;
    expect(after.head).toBe(before.head);
    expect(after.receiptCount).toBe(before.receiptCount);
    expectNowhere(after, worker.token);
    expect(yield* stateOf("lead")).toBe("working");
  })).pipe(Effect.orDie));

it.live("5c fix-1 ruling 2, the owner as caller: catches the check applied only to agent callers, so the owner's stop stores an agent's token as its request id", () =>
  withRig((fakes) => Effect.gen(function* () {
    const worker = yield* seedKnown({ id: "worker", state: "working" });
    const before = yield* stored;

    const outcome = yield* callWith(ownerCredential, "stop", worker.token, { agentId: "worker" });
    expect(failureOf(outcome)).toEqual({ _tag: "CommandRefused", reason: "command refused" });

    const after = yield* stored;
    expect(after.head).toBe(before.head);
    expect(after.receiptCount).toBe(before.receiptCount);
    expectNowhere(after, worker.token);
    expect(yield* stateOf("worker")).toBe("working");
    expect(fakes.runner.callsOf("stop")).toEqual([]);
  })).pipe(Effect.orDie));

it.live("5c fix-1 ruling 2 control: catches a plain request id refused, or a token in the question text that reaches a request id or stays unredacted", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedKnown({ id: "lead" });
    const worker = yield* seedKnown({ id: "worker", parent: "lead", state: "working" });

    const outcome = yield* callWith(agentCredential(worker.token), "ask", "safe-request-1", { text: `Is ${worker.token} still needed?` });
    const reply = success(outcome);
    expect(reply.requestId).toBe("safe-request-1");
    expect(typeof reply.questionId).toBe("string");

    const after = yield* stored;
    expect(after.requestIds).toContain("safe-request-1");
    expectNowhere(after, worker.token);
    expect(after.texts.some((text) => text.includes("QuestionAsked"))).toBe(true);
  })).pipe(Effect.orDie));
