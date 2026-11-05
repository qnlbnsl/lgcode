import { randomBytes } from "node:crypto";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";

import * as Server from "../../src/api/server.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { Views } from "../../src/views/Views.ts";
import { compareViews } from "../../src/views/compare.ts";
import { fixtureClient, fixtureLists, loadLists, withFixture } from "../support/fixturePiece.ts";
import { call, ownerCredential } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it("1.2/1.26 a real socket fixture command commits once, replays its batch reply, redacts and rebuilds its piece view", async () => {
  const lists = fixtureLists(await loadLists());
  // Generated only for this run; no stored credential fixture or logged value.
  const sensitive = randomBytes(24).toString("hex");
  const redactor = makeRedactor({ secrets: () => [Redacted.make(sensitive)], tokenHashes: () => new Set() });
  await withFixture(lists, (rig, bearer) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const options = { socketPath: join(rig.stateFolder, "engine.sock"), ownerCredential: Redacted.make(bearer), debug: true, lists };
    yield* Server.serve(options);
    const client = yield* fixtureClient(options.socketPath, bearer, lists);
    const payload = { requestId: "fixture-once", id: "record-a", text: `before ${sensitive} after` };
    const first = yield* client["client.record"]!(payload);
    const resent = yield* client["client.record"]!(payload);
    expect(first).toEqual({ requestId: "fixture-once", id: "record-a", sequence: expect.any(Number) });
    expect(resent).toEqual(first);
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* sql<{ sequence: number; event_type: string; payload_json: string }>`SELECT sequence, event_type, payload_json FROM events WHERE event_type != 'roles.SheepdogBaseline' ORDER BY sequence`;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.sequence).toBe(first.sequence);
    expect(stored[0]!.event_type).toBe("client.FixtureRecorded");
    expect(JSON.parse(stored[0]!.payload_json)).toEqual({ _tag: "client.FixtureRecorded", id: "record-a", text: "before [REDACTED] after" });
    const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = 'fixture-once'`;
    expect(receipts).toHaveLength(1);
    expect(JSON.parse(receipts[0]!.result_json).reply).toEqual(first);
    expect(receipts[0]!.result_json.includes(sensitive)).toBe(false);
    expect(yield* sql`SELECT id FROM client_fixture`).toEqual([{ id: "record-a" }]);
    const view = yield* (yield* Views).snapshot;
    expect((view as unknown as { client: unknown }).client).toEqual({ records: [{ id: "record-a", text: "before [REDACTED] after", sequence: first.sequence }] });
    expect((yield* compareViews()).differences).toEqual([]);
    expect(yield* client["debug.compare-views"]!({ requestId: "fixture-compare" })).toMatchObject({ equal: true, differences: [] });
  }), { redactor: redactor.layer });
});

it("1.2 debug comparison detects corruption in a piece field, rather than comparing only engine fields", async () => {
  const lists = fixtureLists(await loadLists());
  await withFixture(lists, (rig, bearer) => Effect.gen(function* () {
    yield* registerRebuildCheck({ expectDifference: true });
    const views = yield* Views;
    const live = yield* views.snapshot;
    (live as unknown as { client: unknown }).client = { records: [{ id: "not-in-log" }] };
    const options = { socketPath: join(rig.stateFolder, "engine.sock"), ownerCredential: Redacted.make(bearer), debug: true, lists };
    yield* Server.serve(options);
    const client = yield* fixtureClient(options.socketPath, bearer, lists);
    const reply = yield* client["debug.compare-views"]!({ requestId: "fixture-corrupt" });
    expect(reply).toMatchObject({ equal: false });
    expect((reply as { differences: string[] }).differences.some((path) => path.startsWith("client."))).toBe(true);
  }));
});

it("1a E7 fixture migrations run on the real service build", async () => {
  const lists = fixtureLists(await loadLists());
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`SELECT name FROM sqlite_master WHERE name = 'client_fixture'`).toEqual([{ name: "client_fixture" }]);
    yield* sql`INSERT INTO client_fixture (id) VALUES ('kept')`;
  }));
});

it("1a E7 a failed piece side-row insert rolls back its events and receipt in the same transaction", async () => {
  const lists = fixtureLists(await loadLists());
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TRIGGER reject_fixture BEFORE INSERT ON client_fixture BEGIN SELECT RAISE(ABORT, 'fixture side row refused'); END`;
    const outcome = yield* call(ownerCredential, "client.record", { requestId: "failed-side-row", id: "a", text: "Text." });
    expect(outcome._tag).toBe("Failure");
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM client_fixture`).toEqual([{ n: 0 }]);
  }));
});
