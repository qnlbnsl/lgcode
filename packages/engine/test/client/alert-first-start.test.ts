import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { Restart } from "../../src/recovery/service.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { makeRig, removeRig, seedAgent } from "../support/handlerRig.ts";
import { eventually, pause } from "../support/routingRig.ts";
import { alertLog, append, awaitCleared, awaitRaised, barrier, eventsOf, fixtureEvent, permission, pieceLists, question, quietLists, raised, withAlerts } from "../support/alertsRig.ts";

it("6.16 first start scans only open engine and piece matters in one baseline batch, then marks later sources as live", async () => {
  const rig = makeRig();
  const lists = pieceLists();
  // A roles openMatters fixture exercises a second namespace without
  // implementing the deferred standing-rule service.
  let head = 0;
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "working" });
      yield* permission(); yield* question();
      yield* question("worker", "closed");
      yield* append({ _tag: "QuestionAnswered", agentId: "worker", questionId: "closed", answeredBy: { _tag: "owner" }, text: "Answered.", deliveryId: "answer-closed" });
      yield* fixtureEvent("open-post"); yield* fixtureEvent("closed-post"); yield* fixtureEvent("closed-post", "closed");
      head = (yield* alertLog).at(-1)?.sequence ?? 0;
    }), { rig, lists: quietLists(lists) });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const baseline = yield* eventually(eventsOf("client.AlertBaseline"), (rows) => rows.length > 0);
      expect(baseline).toHaveLength(1);
      expect(baseline[0]!.event.position).toBe(head);
      const rows = yield* eventually(raised(), (rows) => rows.length >= 4);
      expect(rows.map((row) => row.event.alertKey).sort()).toEqual(["permission:request-1", "question:question-1", "post:open-post", "roles:open-stall"].sort());
      for (const row of rows) {
        expect(row.event.baseline).toBe(true);
        expect(row.requestId).toBe(baseline[0]!.requestId);
      }
      yield* question("worker", "later");
      const later = yield* awaitRaised("question:later");
      expect(later).toHaveLength(1);
      expect(later[0]!.event.baseline).not.toBe(true);
      yield* fixtureEvent("open-post", "closed");
      const post = rows.find((row) => row.event.alertKey === "post:open-post")!;
      expect(yield* awaitCleared(post.event.alertId)).toHaveLength(1);
    }), { rig, initialize: false, lists: { ...lists, openMatters: {
      ...pieceLists().openMatters, roles: () => [{ key: "roles:open-stall", kind: "roles.stall" }],
    } } });
  } finally { removeRig(rig); }
});

it("6.16 a stopped owner's asker is not scanned, but its still-open question is scanned after the asker resumes", async () => {
  const rig = makeRig();
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "working" });
      yield* question();
      yield* append({ _tag: "AgentStopped", agentId: "worker" });
    }), { rig, lists: quietLists() });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const baseline = yield* eventually(eventsOf("client.AlertBaseline"), (rows) => rows.length > 0);
      expect(baseline).toHaveLength(1);
      expect(yield* raised("question:question-1")).toEqual([]);
      yield* append({ _tag: "StateChanged", agentId: "worker", state: { _tag: "idle" } });
      const rows = yield* awaitRaised("question:question-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event.baseline).not.toBe(true);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});

it("6.4 throwing openMatters cannot stop the first scan or the later live reactor", async () => {
  const lists = pieceLists();
  const lines: string[] = [];
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const baseline = yield* eventually(eventsOf("client.AlertBaseline"), (rows) => rows.length > 0);
    expect(baseline).toHaveLength(1);
    expect(yield* raised()).toEqual([]);
    yield* fixtureEvent("later");
    expect(yield* awaitRaised("post:later")).toHaveLength(1);
    expect(lines.join("\n")).not.toContain("UNTRUSTED SCAN TEXT");
  }), { lines, lists: { ...lists, openMatters: { ...lists.openMatters, board: () => { throw new Error("UNTRUSTED SCAN TEXT"); } } } });
});

it("6.16 a failed scan write cannot leave a partial baseline, and reopening retries the whole scan", async () => {
  const rig = makeRig();
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "working" }); yield* question(); yield* permission();
      const sql = yield* SqlClient.SqlClient;
      yield* sql.unsafe(`CREATE TRIGGER fail_alert_scan BEFORE INSERT ON events
        WHEN json_extract(NEW.payload_json, '$._tag') = 'client.AlertRaised'
        BEGIN SELECT RAISE(ABORT, 'fixture scan failure'); END`);
    }), { rig, lists: quietLists() });
    const lines: string[] = [];
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* eventually(Effect.sync(() => lines.length), (count) => count > 0);
      expect(lines.length, "the failed write must be observed before inspecting the transaction").toBeGreaterThan(0);
      expect(yield* eventsOf("client.AlertBaseline")).toEqual([]);
      expect(yield* raised()).toEqual([]);
      yield* (yield* SqlClient.SqlClient).unsafe("DROP TRIGGER fail_alert_scan");
    }), { rig, initialize: false, lines });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const rows = yield* eventually(raised(), (rows) => rows.length === 2);
      expect(rows).toHaveLength(2);
      const baseline = yield* eventsOf("client.AlertBaseline");
      expect(baseline).toHaveLength(1);
      expect(rows.every((row) => row.requestId === baseline[0]!.requestId && row.event.baseline === true)).toBe(true);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});

it("6a recovery gate prevents the baseline and every alert write until recovery is ready", async () => {
  const gate = await Effect.runPromise(Deferred.make<void>());
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* pause(50);
    expect(yield* eventsOf("client.AlertBaseline")).toEqual([]);
    expect(yield* raised()).toEqual([]);
    yield* Deferred.succeed(gate, undefined);
    const baseline = yield* eventually(eventsOf("client.AlertBaseline"), (rows) => rows.length > 0);
    expect(baseline).toHaveLength(1);
    expect(yield* barrier()).toHaveLength(1);
  }), { recovery: Layer.succeed(Restart, {
    ready: Deferred.isDone(gate), whenReady: Deferred.await(gate), recover: Effect.void, returnAccount: () => Effect.void,
  }) });
});
