import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { planWith, record, reply, rulesFixture, useRules } from "../support/callerRules.ts";
import { agentCredential, call, seedAgent, success } from "../support/handlerRig.ts";
import { snapshot } from "../support/routingRig.ts";

for (const throwing of [false, true]) {
  it(`1.16/1.44 hold throwing=${throwing}: catches a held member counted as settled, or a throw ending its wait`, async () => {
    const base = await rulesFixture();
    let holds = true;
    base.holdUnsettled.client = (_input, id, view) => {
      if (id !== "member") return false;
      expect(view).toBeDefined();
      if (throwing && holds) throw new Error("Untrusted table data.");
      return holds;
    };
    const lists = planWith(base, () => ({ events: [record()], reply }));
    await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const waiter = yield* seedAgent({ id: "waiter" });
      yield* seedAgent({ id: "member", parent: "waiter" });
      const wait = success(yield* call(agentCredential(waiter.token), "wait", { members: ["member"], mode: "all", block: false }));
      expect((yield* snapshot).waits[wait.waitId]?.status).toBe("open");
      holds = false;
      success(yield* call({ _tag: "owner" }, "client.record", { id: "record", text: "Data." }));
      expect((yield* snapshot).waits[wait.waitId]?.status).toBe("satisfied");
    }));
  });
}
