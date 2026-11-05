import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { CommandHandler } from "../../src/commands/CommandHandler.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { compareViews } from "../../src/views/compare.ts";
import { planWith, record, reply, requiredModule, rulesFixture, type Batch, type PieceBatches } from "../support/callerRules.ts";
import { asEvent, withFixture } from "../support/fixturePiece.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventOf, freshRequest } from "../support/handlerRig.ts";

for (const kind of ["planner", "read", "reactor"] as const) for (const shape of ["omitted", "undefined", "empty", "populated"] as const) {
  it(`FR-033 ${kind}/${shape}: optional side rows commit without latching later writes`, async () => {
    const batch: Batch = { events: [record()], reply,
      ...(shape === "omitted" ? {} : { sideRows: { client_fixture: shape === "undefined" ? undefined : shape === "empty" ? [] : [{ id: "row" }] } }),
    };
    const base = await rulesFixture();
    const lists = { ...planWith(base, () => batch), reads: { ...base.reads }, reactors: {} };
    if (kind === "read") {
      delete (lists.planners as Record<string, unknown>)["client.record"];
      (lists.reads as Record<string, unknown>)["client.record"] = () => Effect.succeed({ reply: { ok: true }, marks: batch.events, sideRows: batch.sideRows });
    }
    const { writePieceBatch } = await requiredModule<PieceBatches>("commands/pieceBatch.ts");
    await withFixture(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const handler = yield* CommandHandler;
      const log = yield* EventLog;
      const sql = yield* SqlClient.SqlClient;
      const requestId = freshRequest();
      const write = kind === "reactor"
        ? writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 0, build: () => batch }, lists)
        : handler.execute({ _tag: "owner" }, "client.record", { requestId, id: "record", text: "Fixture data." });
      const outcome = yield* write.pipe(Effect.result);
      expect(outcome._tag).toBe("Success");
      expect(yield* sql`SELECT id FROM client_fixture`).toEqual(shape === "populated" ? [{ id: "row" }] : []);
      const receipts = yield* sql`SELECT caller, request_id FROM receipts`;
      expect(receipts).toEqual(kind === "planner" ? [{ caller: "owner", request_id: requestId }] : []);
      const stored = yield* sql`SELECT * FROM events ORDER BY sequence`;
      if (kind === "planner") {
        expect(yield* write).toEqual(outcome._tag === "Success" ? outcome.success : undefined);
        expect(yield* sql`SELECT * FROM events ORDER BY sequence`).toEqual(stored);
      }
      yield* log.append({ _tag: "owner" }, freshRequest(), "b".repeat(64), [eventOf({ _tag: "AccountChanged", accountId: "follow-up", account: { id: "follow-up", harness: "first" } })], {});
      expect((yield* compareViews()).differences).toEqual([]);
    }));
  });
}

it("FR-033 a genuinely malformed side row still rolls back the entire batch and latches the writer", async () => {
  const lists = { ...await rulesFixture(), reactors: {} };
  await withFixture(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    const log = yield* EventLog;
    const sql = yield* SqlClient.SqlClient;
    const malformed = { client_fixture: [null] } as unknown as Parameters<typeof log.append>[4];
    const failure = yield* log.append({ _tag: "owner" }, freshRequest(), "malformed", [asEvent(record())], malformed).pipe(Effect.result);
    expect(failure).toMatchObject({ _tag: "Failure", failure: { _tag: "LogWriteFailed", reason: "invalid piece side row" } });
    expect(yield* log.append({ _tag: "owner" }, freshRequest(), "healthy", [], {}).pipe(Effect.result)).toEqual(failure);
    expect(yield* sql`SELECT * FROM events`).toEqual([]);
    expect(yield* sql`SELECT * FROM receipts`).toEqual([]);
    expect(yield* sql`SELECT * FROM client_fixture`).toEqual([]);
  }));
});
