import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { withWaitChecks, project } from "../../src/routing/waits.ts";
import { planWith, record, reply, rulesFixture, useRules } from "../support/callerRules.ts";
import { eventOf, seedAgent } from "../support/handlerRig.ts";
import { snapshot } from "../support/routingRig.ts";

for (const timing of ["open", "after batch"] as const) {
  it(`1.21 request held ${timing}: catches a blocking wait that cannot return to answer a piece request`, async () => {
    const lists = await rulesFixture();
    lists.requestHeld.client = (_view, id) => id === "waiter";
    await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "waiter" }); yield* seedAgent({ id: "member", parent: "waiter", state: "working" });
      const opened = eventOf({ _tag: "WaitOpened", agentId: "waiter", waitId: "blocking", members: ["member"], mode: "all", blocking: true });
      const state = yield* snapshot;
      const result = (withWaitChecks as unknown as (view: typeof state, events: ReadonlyArray<typeof opened>, lists: unknown) => ReadonlyArray<unknown>)(timing === "open" ? state : project(state, [opened]), timing === "open" ? [opened] : [], lists);
      expect(result).toContainEqual({ _tag: "WaitCancelled", agentId: "waiter", waitId: "blocking", reason: "request held" });
    }));
  });
}

it("1.44 a throwing request-held entry is checked and counts as no request held", async () => {
  const lists = await rulesFixture();
  let called = false;
  lists.requestHeld.client = () => { called = true; throw new Error("Untrusted request-held data."); };
  await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    yield* seedAgent({ id: "waiter" }); yield* seedAgent({ id: "member", parent: "waiter", state: "working" });
    const opened = eventOf({ _tag: "WaitOpened", agentId: "waiter", waitId: "blocking", members: ["member"], mode: "all", blocking: true });
    const state = yield* snapshot;
    const result = (withWaitChecks as unknown as (view: typeof state, events: ReadonlyArray<typeof opened>, lists: unknown) => ReadonlyArray<unknown>)(state, [opened], lists);
    expect(called, "the fallback is exercised at the actual wait boundary").toBe(true);
    expect(result).toEqual([opened]);
  }));
});
