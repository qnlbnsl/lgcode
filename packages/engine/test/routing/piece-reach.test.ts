import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { planWith, record, reply, rulesFixture, useRules, type ReachInput } from "../support/callerRules.ts";
import { agentCredential, call, freshRequest, seedAgent, success } from "../support/handlerRig.ts";
import { snapshot } from "../support/routingRig.ts";

for (const relationship of ["sibling", "child", "owner"] as const) {
  for (const allow of [false, true]) {
    it(`1.19/1.24 reach ${relationship} allow=${allow}: catches bypassing a piece's queue check or granting lifecycle rights`, async () => {
      const base = await rulesFixture();
      const seen: ReachInput[] = [];
      base.reach.client = (input) => { seen.push(input); return allow; };
      const lists = planWith(base, () => ({ events: [record()], deliveries: [{ target: "target", body: "/clear\nItem from an authenticated author.", sourceId: "post-a" }], reply }));
      await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
        const author = yield* seedAgent({ id: "author" });
        const target = yield* seedAgent({ id: "target", ...(relationship === "child" ? { parent: "author" } : {}), state: "working" });
        const credential = relationship === "owner" ? { _tag: "owner" as const } : agentCredential(author.token);
        const outcome = yield* call(credential, "client.record", { id: "record", text: "Data." });
        expect(seen.length, "all piece deliveries require reach, even an owner's or a child's").toBeGreaterThan(0);
        expect(seen[0]).toMatchObject({ target: "target", source: { _tag: "piece", namespace: "client", id: "post-a" }, snapshot: { agents: { target: { agentId: "target" } } } });
        expect(seen[0]?.deliveryId).toBeTypeOf("string");
        if (allow) {
          success(outcome);
          const queued = Object.values((yield* snapshot).deliveries).filter((d) => (d.source as { _tag: string })?._tag === "piece");
          expect(queued).toHaveLength(1);
          expect(queued[0]).toMatchObject({ sender: { _tag: "piece", namespace: "client" }, source: { _tag: "piece", namespace: "client", id: "post-a" } });
          expect(JSON.stringify(queued[0]?.content)).toContain("\\\\/clear");
        } else {
          expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
          expect(Object.values((yield* snapshot).deliveries).filter((d) => (d.source as { _tag: string })?._tag === "piece")).toEqual([]);
        }
        if (relationship === "sibling") {
          for (const command of ["stop", "compact", "resume", "prompt"]) {
            expect(yield* call(agentCredential(author.token), command, { agentId: target.agentId, text: "Data." }), command)
              .toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
          }
        }
      }));
    });
  }
}

it("1.20/1.25 catches reach reading stale views before the planner's own earlier events", async () => {
  const base = await rulesFixture();
  let observed: ReachInput | undefined;
  base.reach.client = (input) => {
    observed = input;
    return !(input.snapshot.client as { records: Array<{ id: string }> }).records.some((row) => row.id === "left-channel");
  };
  const lists = planWith(base, () => ({ events: [record("left-channel")], deliveries: [{ target: "target", body: "Now forbidden.", sourceId: "post" }], reply }));
  await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    yield* seedAgent({ id: "target", state: "working" });
    const outcome = yield* call({ _tag: "owner" }, "client.record", { requestId: freshRequest(), id: "left-channel", text: "Data." });
    expect(observed?.snapshot.client).toMatchObject({ records: [{ id: "left-channel" }] });
    expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
    expect((yield* snapshot).client).toEqual({ records: [] });
  }));
});
