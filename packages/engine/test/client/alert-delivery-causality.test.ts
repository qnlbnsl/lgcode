import type { Event } from "@lgtm/contracts";
import { appendSetup } from "../support/handlerRig.ts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { awaitCleared, awaitRaised, pieceLists, withAlerts } from "../support/alertsRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it("an explicit piece end closes an alert when both source events committed before its raise", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    // One commit makes the end visible before the follower can write a raise.
    yield* appendSetup([
      { _tag: "board.AlertFixture", id: "catchup", phase: "open", text: "Fixture data." },
      { _tag: "board.AlertFixture", id: "catchup", phase: "closed", text: "Fixture data." },
    ] as unknown as Event[]);
    const rows = yield* awaitRaised("post:catchup");
    expect(rows).toHaveLength(1);
    expect(yield* awaitCleared(rows[0]!.event.alertId)).toHaveLength(1);
  }), { lists: pieceLists() });
});
