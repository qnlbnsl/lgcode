import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import * as Server from "../../src/api/server.ts";
import { fixtureClient, withFixture } from "../support/fixturePiece.ts";
import { planWith, record, reply, requiredModule, rulesFixture, type Batch, type PieceBatches } from "../support/callerRules.ts";
import { agentCredential, appendSetup, call, eventOf, freshRequest, seedAgent, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { snapshot } from "../support/routingRig.ts";

const cases = ["foreign side row", "unknown withdrawal", "foreign withdrawal", "engine withdrawal", "sent withdrawal", "accepted withdrawal", "returned withdrawal", "withdrawn withdrawal", "wrong target", "owned withdrawal", "wait change"] as const;
for (const kind of ["planner", "read", "reactor", "wire read"] as const) for (const scenario of cases) {
  it(`FR-090 ${kind}/${scenario}: exact event, receipt, caller and side-row delta`, async () => {
    const base = await rulesFixture();
    base.holdUnsettled.client = (state, id) => id === "member" && !(state.client as { records: { id: string }[] }).records.some((row) => row.id === "release-wait");
    const allowed = scenario === "owned withdrawal" || scenario === "wait change";
    const withdrawal = { _tag: "DeliveryWithdrawn", agentId: scenario === "wrong target" ? "other" : "target", deliveryId: scenario === "unknown withdrawal" ? "unknown" : "chosen", reason: "request closed" };
    const batch: Batch = { events: [record("release-wait"), ...(scenario === "foreign side row" || scenario === "wait change" ? [] : [withdrawal])],
      sideRows: { client_fixture: [{ id: "committed" }], ...(scenario === "foreign side row" ? { board_fixture: [{ id: "foreign" }] } : {}) }, reply,
    };
    const lists = { ...planWith(base, () => batch), reads: { ...base.reads }, reactors: {},
      migrations: { ...base.migrations, board: [...(base.migrations.board ?? []), { id: 1, statements: ["CREATE TABLE board_fixture (id TEXT PRIMARY KEY)"] }] },
    };
    if (kind === "read" || kind === "wire read") {
      delete (lists.planners as Record<string, unknown>)["client.record"];
      (lists.reads as Record<string, unknown>)["client.record"] = (_input: unknown, payload: Record<string, unknown>) => Effect.succeed({
        reply: { requestId: payload.requestId, id: "read-result", sequence: 0 }, marks: batch.events, sideRows: batch.sideRows,
      });
    }
    const { writePieceBatch } = await requiredModule<PieceBatches>("commands/pieceBatch.ts");
    await withFixture(lists, (rig, bearer) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "target", state: "working" });
      yield* seedAgent({ id: "other", state: "working" });
      const waiter = yield* seedAgent({ id: "waiter", state: "working" });
      yield* seedAgent({ id: "member", parent: "waiter" });
      const wait = success(yield* call(agentCredential(waiter.token), "wait", { members: ["member"], mode: "all", block: false }));
      const source = scenario === "engine withdrawal" ? {} : { source: { _tag: "piece", namespace: scenario === "foreign withdrawal" ? "board" : "client", id: "post" } };
      yield* appendSetup([eventOf({ _tag: "DeliveryQueued", delivery: { id: "chosen", target: "target", sender: { _tag: "owner" }, ...source, content: { _tag: "prompt", text: "Data." } } })]);
      const status = scenario.split(" ")[0];
      if (["sent", "accepted", "returned"].includes(status!)) yield* appendSetup([eventOf({ _tag: "DeliverySent", agentId: "target", deliveryId: "chosen", method: "acp" })]);
      if (status === "accepted") yield* appendSetup([eventOf({ _tag: "DeliveryAccepted", agentId: "target", deliveryId: "chosen" })]);
      if (status === "returned") yield* appendSetup([eventOf({ _tag: "DeliveryReturned", agentId: "target", deliveryId: "chosen", sender: { _tag: "owner" }, reason: "not delivered" })]);
      if (status === "withdrawn") yield* appendSetup([eventOf({ ...withdrawal, agentId: "target", deliveryId: "chosen" })]);
      const sql = yield* SqlClient.SqlClient;
      const before = yield* snapshot;
      expect(before.waits[wait.waitId]?.status).toBe("open");
      const priorEvents = yield* sql`SELECT * FROM events ORDER BY sequence`;
      const priorReceipts = yield* sql`SELECT * FROM receipts ORDER BY caller, request_id`;
      const requestId = freshRequest();
      let outcome: { _tag: string };
      if (kind === "wire read") {
        const socketPath = join(rig.stateFolder, "engine.sock");
        yield* Server.serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: false, lists });
        const client = yield* fixtureClient(socketPath, bearer, lists);
        outcome = yield* client["client.record"]!({ requestId, id: "release-wait", text: "Fixture data." }).pipe(Effect.result);
      } else outcome = kind === "reactor"
        ? yield* writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 7, build: () => batch }, lists).pipe(Effect.result)
        : yield* call({ _tag: "owner" }, "client.record", { requestId, id: "release-wait", text: "Fixture data." });
      const rows = yield* sql<{ sequence: number; caller: string; request_id: string; payload_json: string }>`SELECT sequence, caller, request_id, payload_json FROM events WHERE sequence > ${before.sequence} ORDER BY sequence`;
      const events = rows.map((row) => JSON.parse(row.payload_json));
      const receipts = yield* sql<{ caller: string; request_id: string; body_hash: string; result_json: string; first_sequence: number }>`SELECT * FROM receipts WHERE request_id = ${requestId}`;
      expect(yield* sql`SELECT * FROM events WHERE sequence <= ${before.sequence} ORDER BY sequence`).toEqual(priorEvents);
      expect(yield* sql`SELECT * FROM receipts WHERE request_id != ${requestId} ORDER BY caller, request_id`).toEqual(priorReceipts);
      if (!allowed) {
        expect(outcome._tag).toBe(kind === "reactor" ? "Success" : "Failure");
        expect(events).toEqual(kind === "read" || kind === "wire read" ? [] : [{ _tag: "CommandRefused", command: kind === "reactor" ? "client.reactor" : "client.record", reason: "command refused", ...(kind === "reactor" ? { sourceSequence: 7 } : {}) }]);
        const { sequence: _before, ...priorState } = before;
        const { sequence: _after, ...afterState } = yield* snapshot;
        expect(afterState).toEqual(priorState);
      } else {
        expect(outcome._tag).toBe("Success");
        expect(events).toEqual([
          record("release-wait"), ...(scenario === "owned withdrawal" ? [withdrawal] : []),
          { _tag: "WaitMemberResolved", agentId: "waiter", waitId: wait.waitId, member: { agentId: "member", reason: "settled" } },
          { _tag: "WaitSatisfied", agentId: "waiter", waitId: wait.waitId, members: [{ agentId: "member", reason: "settled" }] },
          { _tag: "DeliveryQueued", delivery: { id: expect.any(String), target: "waiter", sender: { _tag: "owner" }, source: { _tag: "wait", id: wait.waitId }, content: { _tag: "prompt", text: expect.stringContaining(`Wait ${wait.waitId} finished.`) } } },
        ]);
        expect((yield* snapshot).waits[wait.waitId]?.status).toBe("satisfied");
        expect((yield* snapshot).client).toEqual({ records: [{ id: "release-wait", text: "Fixture data.", sequence: rows[0]!.sequence }] });
      }
      expect(rows.map((row) => row.caller)).toEqual(Array(rows.length).fill(kind === "reactor" ? "piece:client" : "owner"));
      expect(new Set(rows.map((row) => row.request_id)).size).toBe(rows.length > 0 ? 1 : 0);
      if (kind === "planner") {
        expect(rows.every((row) => row.request_id === requestId)).toBe(true);
        expect(receipts).toEqual([{ caller: "owner", request_id: requestId, body_hash: expect.stringMatching(/^[a-f0-9]{64}$/), result_json: expect.any(String), first_sequence: rows[0]!.sequence }]);
        const stored = JSON.parse(receipts[0]!.result_json);
        expect((Array.isArray(stored) ? stored : stored.envelopes).map((row: { event: unknown }) => row.event)).toEqual(events);
        if (allowed) expect(stored.reply).toEqual({ requestId, id: "release-wait", sequence: rows[0]!.sequence });
        const committedEvents = yield* sql`SELECT * FROM events ORDER BY sequence`;
        const committedReceipts = yield* sql`SELECT * FROM receipts ORDER BY caller, request_id`;
        expect((yield* call({ _tag: "owner" }, "client.record", { requestId, id: "release-wait", text: "Fixture data." }))._tag).toBe(allowed ? "Success" : "Failure");
        expect(yield* sql`SELECT * FROM events ORDER BY sequence`).toEqual(committedEvents);
        expect(yield* sql`SELECT * FROM receipts ORDER BY caller, request_id`).toEqual(committedReceipts);
      } else expect(receipts).toEqual([]);
      expect(yield* sql`SELECT * FROM client_fixture`).toEqual(allowed ? [{ id: "committed" }] : []);
      expect(yield* sql`SELECT * FROM board_fixture`).toEqual([]);
    }));
  });
}
