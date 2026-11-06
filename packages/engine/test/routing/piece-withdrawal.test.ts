import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Effect from "effect/Effect";
import { Event as EventSchema } from "@sheprd/contracts";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { planWith, record, reply, requiredModule, rulesFixture, useRules } from "../support/callerRules.ts";
import { appendSetup, call, eventOf, seedAgent } from "../support/handlerRig.ts";
import { snapshot } from "../support/routingRig.ts";

for (const [source, status, allowed] of [
  ["client", "queued", true], ["client", "sent", false], ["client", "accepted", false],
  ["board", "queued", false], ["engine", "queued", false],
] as const) {
  it(`1.17 withdrawal ${source}/${status}: catches a piece withdrawing an engine, foreign or nonqueued delivery`, async () => {
    await requiredModule("commands/pieceBatch.ts");
    const lists = planWith(await rulesFixture(), () => ({
      events: [record(), { _tag: "DeliveryWithdrawn", agentId: "target", deliveryId: "chosen", reason: "request closed" }],
      sideRows: { client_fixture: [{ id: "withdrawal" }] }, reply,
    }));
    await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "target", state: "working" });
      // Historical delivery data goes through the actual writer, independently
      // of the new batch validator whose authorization is under test.
      const queued = {
        _tag: "DeliveryQueued", delivery: { id: "chosen", target: "target", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Data." },
          ...(source === "engine" ? {} : { source: { _tag: "piece", namespace: source, id: "post" } }) },
      };
      expect(Schema.is(EventSchema)(queued), "E16 must accept historical piece sources").toBe(true);
      yield* appendSetup([eventOf(queued)]);
      if (status !== "queued") yield* appendSetup([eventOf({ _tag: "DeliverySent", agentId: "target", deliveryId: "chosen", method: "acp" })]);
      if (status === "accepted") yield* appendSetup([eventOf({ _tag: "DeliveryAccepted", agentId: "target", deliveryId: "chosen" })]);
      const result = yield* call({ _tag: "owner" }, "client.record", { id: "record", text: "Data." });
      const sql = yield* SqlClient.SqlClient;
      if (allowed) {
        expect(result._tag).toBe("Success");
        expect((yield* snapshot).deliveries.chosen?.status).toBe("withdrawn");
      } else {
        expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
        expect((yield* snapshot).deliveries.chosen?.status).toBe(status);
        expect((yield* snapshot).client).toEqual({ records: [] });
        expect(yield* sql`SELECT * FROM client_fixture`).toEqual([]);
      }
    }));
  });
}
