import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { EventLog } from "../../src/log/EventLog.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { planWith, record, reply, requiredModule, rulesFixture, useRules, type Batch, type PieceBatches } from "../support/callerRules.ts";
import { appendSetup, call, eventOf, freshRequest, seedAgent } from "../support/handlerRig.ts";
import { CommandHandler } from "../../src/commands/CommandHandler.ts";
import { snapshot } from "../support/routingRig.ts";
import { asEvent, withFixture } from "../support/fixturePiece.ts";
import { Restart } from "../../src/recovery/service.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const invalid: Record<string, Batch> = {
  "foreign piece event": { events: [{ _tag: "board.Forged", text: "Data." }], reply },
  "raw engine queue": { events: [{ _tag: "DeliveryQueued", delivery: { id: "raw", target: "target", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Raw prompt." } } }], reply },
  "engine lifecycle event": { events: [{ _tag: "AgentStopped", agentId: "target" }], reply },
  "unknown withdrawal": { events: [{ _tag: "DeliveryWithdrawn", agentId: "target", deliveryId: "missing", reason: "request closed" }], reply },
  "refused reach": { events: [], deliveries: [{ target: "target", sourceId: "post", body: "Data." }], reply },
  "queue to stopped agent": { events: [], deliveries: [{ target: "stopped", sourceId: "post", body: "Data." }], reply },
};
const isolatedRules = async () => {
  const lists = await rulesFixture();
  return { ...lists, reads: { ...lists.reads } };
};
for (const [broken, bad] of Object.entries(invalid)) for (const kind of ["planner", "read", "reactor"] as const) {
  it(`1.32 ${kind}/${broken}: catches a partial commit or the wrong refusal record`, async () => {
    const base = await isolatedRules();
    base.reach.client = () => broken !== "refused reach";
    const batch: Batch = { ...bad, events: [record("must-rollback"), ...bad.events], sideRows: { client_fixture: [{ id: "must-rollback" }] } };
    const lists = planWith(base, () => batch);
    const pieceBatches = await requiredModule<PieceBatches>("commands/pieceBatch.ts");
    if (kind === "read") {
      delete (lists.planners as Record<string, unknown>)["client.record"];
      (lists.reads as Record<string, unknown>)["client.record"] = () => Effect.succeed({ reply: { text: "must never escape" }, marks: batch.events, deliveries: batch.deliveries, sideRows: batch.sideRows });
    }
    await useRules(lists, () => Effect.gen(function* () {
      yield* seedAgent({ id: "target", state: "working" });
      yield* seedAgent({ id: "stopped", state: "stopped" });
      const requestId = freshRequest();
      const outcome = kind === "reactor"
        ? yield* pieceBatches!.writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 7, build: () => batch }, lists).pipe(Effect.result)
        : yield* call({ _tag: "owner" }, "client.record", { requestId, id: "must-rollback", text: "Data." });
      const sql = yield* SqlClient.SqlClient;
      expect(yield* sql`SELECT * FROM client_fixture`).toEqual([]);
      expect((yield* snapshot).client).toEqual({ records: [] });
      expect(yield* sql`SELECT event_type FROM events WHERE event_type = 'DeliveryQueued' AND payload_json LIKE '%post%'`).toEqual([]);
      const refusals = yield* sql<{ caller: string; payload_json: string }>`SELECT caller, payload_json FROM events WHERE event_type = 'CommandRefused'`;
      if (kind === "read") {
        expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
        expect(refusals).toEqual([]);
        expect(yield* sql`SELECT * FROM receipts WHERE request_id = ${requestId}`).toEqual([]);
      } else {
        expect(refusals).toHaveLength(1);
        if (kind === "planner") {
          expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
          expect(refusals[0]?.caller).toBe("owner");
          expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${requestId}`).toHaveLength(1);
        } else {
          expect(refusals[0]?.caller).toBe("piece:client");
          expect(JSON.parse(refusals[0]!.payload_json)).toMatchObject({ command: "client.reactor", sourceSequence: 7 });
          expect(yield* sql`SELECT * FROM receipts WHERE caller = 'piece:client'`).toEqual([]);
        }
      }
    }));
  });
}

it("FR-110 reactor waits for the real writer permit, then builds inside the transaction from the preceding commit", async () => {
  const { writePieceBatch } = await requiredModule<PieceBatches>("commands/pieceBatch.ts");
  const lists = { ...await isolatedRules(), reactors: {} };
  await useRules(lists, () => Effect.gen(function* () {
    const log = yield* EventLog;
    const sql = yield* SqlClient.SqlClient;
    const held = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const holder = yield* log.transact((append) => Effect.gen(function* () {
      yield* Deferred.succeed(held, undefined);
      yield* Deferred.await(release);
      yield* append({ _tag: "owner" }, freshRequest(), "prior", [asEvent(record("prior"))], {});
    })).pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(held);
    let attempted = false;
    let entered = false;
    let built = false;
    const observedLog = { ...log, transact: ((use: Parameters<typeof log.transact>[0]) =>
      Effect.sync(() => { attempted = true; }).pipe(Effect.andThen(log.transact((append) => {
        entered = true;
        return use(append);
      })))) as typeof log.transact };
    const reactor = yield* writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 0, build: (view) => {
      built = true;
      expect(entered, "construction must run inside the acquired transaction").toBe(true);
      expect(view.client).toEqual({ records: [{ id: "prior", text: "Fixture data.", sequence: view.sequence }] });
      return { events: [record("reactor")], reply };
    } }, lists).pipe(Effect.provideService(EventLog, observedLog), Effect.forkChild({ startImmediately: true }));
    yield* Effect.sync(() => {
      expect(attempted, "the reactor must have reached the contended transaction").toBe(true);
      expect(entered).toBe(false);
      expect(built).toBe(false);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    yield* Fiber.join(holder);
    yield* Fiber.join(reactor);
    expect(built).toBe(true);
    expect(yield* sql`SELECT caller, json_extract(payload_json, '$.id') AS id FROM events ORDER BY sequence`).toEqual([
      { caller: "owner", id: "prior" }, { caller: "piece:client", id: "reactor" },
    ]);
    expect(yield* sql`SELECT caller FROM receipts`).toEqual([{ caller: "owner" }]);
  }));
});

it("1.36 the piece batch path refuses a reactor before recovery is ready and writes nothing", async () => {
  const { writePieceBatch } = await requiredModule<PieceBatches>("commands/pieceBatch.ts");
  const lists = await isolatedRules();
  const recovery = Layer.succeed(Restart, { ready: Effect.succeed(false), whenReady: Effect.never, recover: Effect.void, returnAccount: () => Effect.void });
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    let built = false;
    const outcome = yield* writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 0, build: () => { built = true; return { events: [record()], reply }; } }, lists).pipe(Effect.timeout(1000), Effect.result);
    expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused", reason: "recovering" } });
    expect(built).toBe(false);
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`SELECT * FROM events`).toEqual([]);
    expect(yield* sql`SELECT * FROM receipts`).toEqual([]);
  }), { recovery });
});
