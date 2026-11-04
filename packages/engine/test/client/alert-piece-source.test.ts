import type { AlertSourceRequest } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { awaitCleared, awaitRaised, barrier, cleared, fixtureEvent, pieceLists, raised, withAlerts } from "../support/alertsRig.ts";

// This compile-time fixture is covered by pnpm check. Removing the source
// type's title exclusion makes the expected error unused and fails tsc.
const forbiddenTitle: AlertSourceRequest = {
  kind: "board.post", key: "post:fixture",
  // @ts-expect-error A source may never choose a notification's title.
  title: "Agent-controlled title",
};
void forbiddenTitle;

it("6.4 a piece raises its own kind with the fixed title and ends it by key", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const source = yield* fixtureEvent("post-1");
    const rows = yield* awaitRaised("post:post-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toMatchObject({ kind: "board.post", title: "A post needs your reply", sourceSequence: source[0]!.sequence,
      subject: { _tag: "piece", namespace: "board", id: "post-1" } });
    const end = yield* fixtureEvent("post-1", "closed");
    const clears = yield* awaitCleared(rows[0]!.event.alertId);
    expect(clears).toHaveLength(1);
    expect(clears[0]!.event.sourceSequence).toBe(end[0]!.sequence);
  }), { lists: pieceLists() });
});

it("6.4 a throwing source raises nothing for that event and the next piece event still raises", async () => {
  const lists = pieceLists();
  const source = lists.alertSources!.board!;
  const lines: string[] = [];
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* fixtureEvent("throw"); yield* fixtureEvent("works");
    expect(yield* awaitRaised("post:works")).toHaveLength(1);
    expect(yield* raised("post:throw")).toEqual([]);
    expect(lines.join("\n")).not.toContain("UNTRUSTED THROW TEXT");
  }), { lines, lists: { ...lists, alertSources: { ...lists.alertSources, board: (envelope) => {
    if ((envelope.event as unknown as { id: string }).id === "throw") throw new Error("UNTRUSTED THROW TEXT");
    return source(envelope);
  } } } });
});

it("6.4 a piece end for a different key cannot clear another alert", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* fixtureEvent("open");
    const rows = yield* awaitRaised("post:open");
    expect(rows).toHaveLength(1);
    yield* fixtureEvent("unrelated", "closed");
    expect(yield* barrier()).toHaveLength(1);
    expect(yield* cleared(rows[0]!.event.alertId)).toEqual([]);
  }), { lists: pieceLists() });
});
