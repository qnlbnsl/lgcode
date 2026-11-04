import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { Event as EventSchema } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { Runner } from "../../src/runner/Runner.ts";
import { requiredModule, rulesFixture, useRules, reply, record, type PieceBatches, type ReachInput } from "../support/callerRules.ts";
import { appendSetup, eventOf, seedAgent } from "../support/handlerRig.ts";
import { snapshot } from "../support/routingRig.ts";
import { type FakeRunner } from "../support/fakeRunner.ts";

for (const policy of ["refuse", "throw"] as const) {
  it(`1.23/1.25/1.44 send ${policy}: catches stale reach, a stopped queue or a withdrawn item reaching the runner`, async () => {
    const lists = await rulesFixture();
    const seen: ReachInput[] = [];
    lists.reach.client = (input) => { seen.push(input); if (policy === "throw") throw new Error("untrusted text"); return false; };
    await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const target = yield* seedAgent({ id: "target" });
      const queued = { _tag: "DeliveryQueued", delivery: { id: "piece", target: "target", sender: { _tag: "piece", namespace: "client" }, source: { _tag: "piece", namespace: "client", id: "left-channel" }, content: { _tag: "prompt", text: "Wrapped data." } } };
      expect(Schema.is(EventSchema)(queued), "E15/E16 must accept a piece sender and source").toBe(true);
      yield* appendSetup([eventOf(queued), eventOf({ _tag: "DeliveryQueued", delivery: { id: "next", target: "target", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Next safe delivery." } } })]);
      yield* (dispatchQueued as unknown as (id: typeof target.agentId, options: { lists: unknown }) => Effect.Effect<void, unknown, any>)(target.agentId, { lists });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]).toMatchObject({ target: "target", deliveryId: "piece", source: { namespace: "client", id: "left-channel" } });
      const view = yield* snapshot;
      expect(view.deliveries.piece?.status).toBe("withdrawn");
      expect(view.deliveries.next?.status).toBe("sent");
    }));
  });
}

it("1.24 reactor: catches omitting queue-time reach when there is no calling agent", async () => {
  const { writePieceBatch } = await requiredModule<PieceBatches>("commands/pieceBatch.ts");
  const lists = await rulesFixture();
  const seen: ReachInput[] = [];
  lists.reach.client = (input) => { seen.push(input); return false; };
  await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    yield* seedAgent({ id: "target", state: "working" });
    yield* writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 1, build: () => ({ events: [record()], deliveries: [{ target: "target", sourceId: "merged-wake", body: "Data." }], reply }) }, lists).pipe(Effect.result);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.caller).toBeUndefined();
    expect((yield* snapshot).client).toEqual({ records: [] });
  }));
});
