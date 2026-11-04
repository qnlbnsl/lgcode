import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { planWith, record, reply, rulesFixture } from "../support/callerRules.ts";
import { withPersistentRules } from "../support/persistentRules.ts";
import { call, seedAgent, success } from "../support/handlerRig.ts";
import { incarnationOf } from "../support/fakeRunner.ts";
import { deliveryRow, eventually, snapshot } from "../support/routingRig.ts";

for (const accepted of [false, true]) {
  it(`1.31 piece failed send accepted=${accepted}: catches a lost piece sender or an invented agent return notice`, async () => {
    const base = await rulesFixture();
    base.reach.client = () => true;
    const lists = planWith(base, () => ({ events: [record()], deliveries: [{ target: "target", body: "Data.", sourceId: "post" }], reply }));
    await withPersistentRules(lists, (_rig, runner) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const target = yield* seedAgent({ id: "target" });
      success(yield* call({ _tag: "owner" }, "client.record", { id: "record", text: "Data." }));
      const piece = Object.values((yield* snapshot).deliveries).find((d) => (d.source as { _tag: string })?._tag === "piece");
      expect(piece, "the piece batch path must materialize its delivery request").toBeDefined();
      expect((yield* eventually(deliveryRow(piece!.id), (d) => d?.status === "sent"))?.status).toBe("sent");
      const identity = { agentId: target.agentId, incarnation: incarnationOf(target.token), deliveryId: piece!.id };
      yield* runner.subscribed;
      if (accepted) {
        yield* runner.emit({ _tag: "deliveryUpdate", ...identity, kind: "message", replay: false, text: "Working." });
        expect((yield* eventually(deliveryRow(piece!.id), (d) => d?.status === "accepted"))?.status).toBe("accepted");
      }
      yield* runner.emit({ _tag: "promptReply", ...identity, outcome: { _tag: "error", error: "Delivery rejected." } });
      expect((yield* eventually(deliveryRow(piece!.id), (d) => d?.status === "returned"))?.status).toBe("returned");
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events WHERE event_type = 'DeliveryReturned'`;
      expect(rows.map((row) => JSON.parse(row.payload_json))).toContainEqual(expect.objectContaining({ sender: { _tag: "piece", namespace: "client" }, deliveryId: piece!.id }));
      expect(Object.values((yield* snapshot).deliveries)).toHaveLength(1);
    }));
  });
}
