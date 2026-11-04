import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { call, makeRig, ownerCredential, removeRig, seedAgent, success } from "../support/handlerRig.ts";
import { awaitRaised, eventsOf, question, withAlerts } from "../support/alertsRig.ts";

const defaults = [
  { kind: "approval", push: true }, { kind: "question", push: true },
  { kind: "failure", push: true }, { kind: "account", push: true }, { kind: "other", push: true },
  { kind: "client.web-down", push: true }, { kind: "board.post", push: true },
  { kind: "roles.stall", push: true }, { kind: "roles.replace", push: true },
  { kind: "roles.runaway", push: false }, { kind: "roles.rule-first-use", push: true },
];

it("6.6 the settings read exposes every default and an unset carrier through the real handler", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const reply = success(yield* call(ownerCredential, "client.alerts.settings", {}));
    expect(reply.kinds).toEqual(expect.arrayContaining(defaults));
    expect(reply.carrier).toEqual({ _tag: "none" });
    expect(reply.tokenSet).toBe(false);
  }));
});

it.each(defaults)("6.6 the owner can change the $kind push default and read the committed setting", async ({ kind, push: defaultPush }) => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const push = !defaultPush;
    const requestId = `setting-${kind}`;
    success(yield* call(ownerCredential, "client.alerts.settings.set", { requestId, kind, push }));
    const reply = success(yield* call(ownerCredential, "client.alerts.settings", {}));
    expect(reply.kinds).toContainEqual({ kind, push });
    const changes = yield* eventsOf("client.AlertSettingsChanged");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ caller: { _tag: "owner" }, requestId, event: { kind, push } });
  }));
});

it("6a installed list pages open and cleared alerts without losing the second page", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working" });
    yield* question("worker", "first"); yield* question("worker", "second");
    const first = yield* awaitRaised("question:first");
    const second = yield* awaitRaised("question:second");
    expect(first).toHaveLength(1); expect(second).toHaveLength(1);
    const page = success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 1, status: "open" }));
    expect(page.items).toHaveLength(1);
    expect(page.next).toEqual(expect.any(Number));
    const tail = success(yield* call(ownerCredential, "client.alerts.list", { after: page.next, limit: 1, status: "open" }));
    expect(tail.items).toHaveLength(1);
    expect([page.items[0].alertId, tail.items[0].alertId].sort()).toEqual([first[0]!.event.alertId, second[0]!.event.alertId].sort());
    success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: first[0]!.event.alertId }));
    expect(success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 500, status: "cleared" })).items)
      .toEqual([expect.objectContaining({ alertId: first[0]!.event.alertId, status: "cleared" })]);
  }));
});

it("6.6 an owner's push-setting change survives rebuilding the service from the log", async () => {
  const rig = makeRig();
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "client.alerts.settings.set", { kind: "approval", push: false }));
    }), { rig });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "client.alerts.settings", {}));
      expect(reply.kinds).toContainEqual({ kind: "approval", push: false });
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});
