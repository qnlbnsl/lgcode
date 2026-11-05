import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { append, awaitRaised, barrier, cleared, eventsOf, question, quietLists, raised, withAlerts } from "../support/alertsRig.ts";
import { configure, delivered, ntfyServer, posts, withCarrier } from "../support/carrierRig.ts";
import { call, crashAgent, makeRig, ownerCredential, removeRig, seedAgent, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { snapshot } from "../support/routingRig.ts";
import { alertDelivery } from "../../src/client/alerts/delivery.ts";
import { alertReactor, initializeAlerts } from "../../src/client/alerts/reactor.ts";
import { clientView } from "../../src/client/alerts/view.ts";

const cases = ["stopped", "crashed"].flatMap((state) => ["delivered", "baseline"].flatMap((initial) =>
  ["live", "restart"].map((catchup) => ({ state, initial, catchup }))));

it.each(cases)("FR-013 renews a $initial question after $state and resume both commit before $catchup catch-up", async ({ state, initial, catchup }) => {
  const rig = makeRig();
  const server = await ntfyServer();
  let oldId = ""; let newId = ""; let boundary = 0;
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "idle" });
      if (initial === "delivered") yield* initializeAlerts;
      yield* question();
      if (initial === "baseline") yield* initializeAlerts;
      else yield* alertReactor.pipe(Effect.forkScoped);
      const rows = yield* awaitRaised("question:question-1");
      expect(rows).toHaveLength(1);
      oldId = rows[0]!.event.alertId;
      expect(rows[0]!.event.baseline === true).toBe(initial === "baseline");
    }), { rig, lists: quietLists() });

    const verifyRenewal = Effect.gen(function* () {
      const barrierRows = yield* barrier();
      expect(barrierRows).toHaveLength(1);
      expect(yield* delivered(barrierRows[0]!.event.alertId)).toHaveLength(1);
      const ends = yield* cleared(oldId);
      expect(ends).toHaveLength(1);
      expect(ends[0]!.event.sourceSequence).toBe(boundary);
      const rows = yield* raised("question:question-1");
      expect(rows).toHaveLength(2);
      newId = rows[1]!.event.alertId;
      expect(newId).not.toBe(oldId);
      expect(rows[1]!.event.baseline).not.toBe(true);
      expect(rows[1]!.event.sourceSequence).toBeGreaterThan(boundary);
      expect(yield* delivered(newId)).toHaveLength(1);
      const view = clientView((yield* snapshot).client);
      expect(view.alerts[oldId]?.status).toBe("cleared");
      expect(view.alerts[newId]?.status).toBe("open");
      expect(view.delivery[newId]).toMatchObject({ status: "delivered", attempt: 1 });
      const ids = posts(server).map((row) => row.headers["x-sequence-id"]);
      expect(ids.filter((id) => id === newId)).toHaveLength(1);
      expect(ids.filter((id) => id === oldId)).toHaveLength(initial === "delivered" ? 1 : 0);
    });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* configure(server.origin);
      if (initial === "delivered") expect(yield* delivered(oldId)).toHaveLength(1);
      // The real lifecycle commands run with the alert follower absent.
      if (state === "stopped") success(yield* call(ownerCredential, "stop", { agentId: "worker" }));
      else yield* crashAgent("worker");
      boundary = (yield* eventsOf(state === "stopped" ? "AgentStopped" : "AgentCrashed")).at(-1)!.sequence;
      success(yield* call(ownerCredential, "resume", { agentId: "worker" }));
      expect((yield* snapshot).agents.worker?.state._tag).toBe("idle");
      expect(yield* cleared(oldId)).toEqual([]);
      if (catchup === "live") {
        yield* alertReactor.pipe(Effect.forkScoped);
        yield* verifyRenewal;
      }
    }), { rig, initialize: false, lists: { ...quietLists(), reactors: { ...quietLists().reactors, client: alertDelivery } } });
    if (catchup === "restart") await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* verifyRenewal;
    }), { rig, initialize: false });

    const beforeRestart = posts(server).length;
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* question("worker", "restart-barrier");
      const barrierRows = yield* awaitRaised("question:restart-barrier");
      expect(barrierRows).toHaveLength(1);
      expect(yield* delivered(barrierRows[0]!.event.alertId)).toHaveLength(1);
      expect(yield* raised("question:question-1")).toHaveLength(2);
      expect(yield* cleared(oldId)).toHaveLength(1);
      expect(yield* cleared(newId)).toEqual([]);
      expect(yield* delivered(newId)).toHaveLength(1);
      expect(posts(server)).toHaveLength(beforeRestart + 1);
    }), { rig, initialize: false });
  } finally { await server.close(); removeRig(rig); }
});

it("FR-013 catch-up raises only the latest resumed question and never revives an obsolete source", async () => {
  const rig = makeRig(); let latestResume = 0;
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "idle" });
      yield* initializeAlerts;
      yield* question();
      for (let cycle = 0; cycle < 2; cycle++) {
        yield* append({ _tag: "AgentStopped", agentId: "worker" });
        latestResume = (yield* append({ _tag: "StateChanged", agentId: "worker", state: { _tag: "idle" } }))[0]!.sequence;
      }
    }), { rig, lists: quietLists() });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* alertReactor.pipe(Effect.forkScoped);
      expect(yield* barrier()).toHaveLength(1);
      const rows = yield* raised("question:question-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event.sourceSequence).toBe(latestResume);
      expect(yield* cleared(rows[0]!.event.alertId)).toEqual([]);
    }), { rig, initialize: false, lists: quietLists() });
  } finally { removeRig(rig); }
});
