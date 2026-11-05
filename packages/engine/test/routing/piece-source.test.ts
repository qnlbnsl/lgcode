import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { targetGone } from "../../src/routing/deliveries.ts";
import { project } from "../../src/routing/waits.ts";
import { emptyViews } from "../../src/views/apply.ts";
import { rulesFixture } from "../support/callerRules.ts";
import { agentIdOf, eventOf } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

for (const cause of ["stopped", "crashed"] as const) for (const status of ["queued", "sent"] as const) for (const action of ["withdraw", "return", "throw"] as const) {
  it(`1.15/1.44 ${cause}/${status}/${action}: catches ignoring the piece source rule or making a sender notice`, async () => {
    const lists = await rulesFixture();
    let checked = 0;
    lists.sourceRules.client = () => { checked++; if (action === "throw") throw new Error("Untrusted failure data."); return action; };
    const state = project(emptyViews(), [{
      _tag: "DeliveryQueued", delivery: { id: "piece-delivery", target: "target", sender: { _tag: "piece", namespace: "client" },
        source: { _tag: "piece", namespace: "client", id: "post" }, content: { _tag: "prompt", text: "Wrapped data." } },
    } as unknown as ReturnType<typeof eventOf>, ...(status === "sent" ? [eventOf({ _tag: "DeliverySent", agentId: "target", deliveryId: "piece-delivery", method: "acp" })] : [])]);
    const events = (targetGone as unknown as (view: typeof state, id: ReturnType<typeof agentIdOf>, cause: string, lists: unknown) => ReadonlyArray<unknown>)(state, agentIdOf("target"), cause, lists);
    expect(checked, "targetGone must ask the source's namespace rule").toBe(1);
    if (action === "return") expect(events).toEqual([{ _tag: "DeliveryReturned", agentId: "target", deliveryId: "piece-delivery", sender: { _tag: "piece", namespace: "client" }, reason: "not delivered" }]);
    else expect(events).toEqual([{ _tag: "DeliveryWithdrawn", agentId: "target", deliveryId: "piece-delivery", reason: cause === "stopped" ? "agent stopped" : "agent crashed" }]);
    expect(events.filter((event) => (event as { _tag: string })._tag === "DeliveryQueued")).toEqual([]);
  });
}
