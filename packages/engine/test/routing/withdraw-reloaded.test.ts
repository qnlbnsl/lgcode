import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { reloadedEvents } from "../../src/recovery/reload.ts";
import { project, withWaitChecks } from "../../src/routing/waits.ts";
import { rulesFixture, useRules } from "../support/callerRules.ts";
import { appendSetup, eventOf, seedAgent } from "../support/handlerRig.ts";
import { snapshot } from "../support/routingRig.ts";

it("1.43 catches an engine withdrawal stranding a reloaded holder working and hanging a wait", async () => {
  await useRules(await rulesFixture(), () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    yield* seedAgent({ id: "waiter" });
    const target = yield* seedAgent({ id: "holder", parent: "waiter" });
    yield* appendSetup([
      eventOf({ _tag: "DeliveryQueued", delivery: { id: "question", target: "holder", sender: { _tag: "owner" }, source: { _tag: "question", id: "question-id" }, content: { _tag: "prompt", text: "Question data." } } }),
      eventOf({ _tag: "DeliverySent", agentId: "holder", deliveryId: "question", method: "acp" }),
      eventOf({ _tag: "AgentInterrupted", agentId: "holder", previous: "working" }),
    ]);
    const recovered = reloadedEvents(yield* snapshot, target.agentId, { session: { _tag: "acp", sessionId: "reloaded" }, protocolVersion: 2, reloadable: true }, false, "Continue.");
    yield* appendSetup(recovered);
    const state = yield* snapshot;
    expect(state.agents.holder?.state._tag).toBe("working");
    const opened = eventOf({ _tag: "WaitOpened", agentId: "waiter", waitId: "parent-wait", members: ["holder"], mode: "all", blocking: true });
    const withdrawal = eventOf({ _tag: "DeliveryWithdrawn", agentId: "holder", deliveryId: "question", reason: "request closed" });
    const batch = withWaitChecks(project(state, [opened]), [withdrawal]);
    expect(batch).toContainEqual({ _tag: "StateChanged", agentId: "holder", state: { _tag: "idle" } });
    expect(batch).toContainEqual({ _tag: "WaitSatisfied", agentId: "waiter", waitId: "parent-wait", members: [{ agentId: "holder", reason: "settled" }] });
    expect(batch.findIndex((e) => e._tag === "StateChanged")).toBeLessThan(batch.findIndex((e) => e._tag === "WaitSatisfied"));
  }));
});
