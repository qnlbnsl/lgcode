import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import type { EngineLists } from "../../src/pieces/lists.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { project } from "../../src/routing/waits.ts";
import { Views } from "../../src/views/Views.ts";
import { compareViews } from "../../src/views/compare.ts";
import { fixtureLists, loadLists, withFixture } from "../support/fixturePiece.ts";
import { eventOf, freshRequest } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

for (const fault of ["absent", "null", "entry getter", "observer getter", "observer body", "healthy"] as const) {
  it(`FR-026 ${fault}: projection, publication and rebuild contain observer resolution and invocation`, async () => {
    const base = fixtureLists(await loadLists());
    const views = { ...base.views };
    if (fault === "absent") delete (views as Record<string, unknown>).client;
    else if (fault === "null") (views as Record<string, unknown>).client = null;
    else if (fault === "entry getter") Object.defineProperty(views, "client", { get() { throw new TypeError("Private lookup text."); } });
    else views.client = {
      empty: () => ({ records: [] }), reduce: (_view, event, sequence) => ({ records: [{ tag: event._tag, sequence }] }),
    };
    if (fault === "observer getter") Object.defineProperty(views.client!, "observe", { get() { throw new TypeError("Private accessor text."); } });
    if (fault === "observer body") Object.assign(views.client!, { observe() { throw new RangeError("Private observer text."); } });
    if (fault === "healthy") Object.assign(views.client!, { observe: (state: { sequence: number }) => ({ observed: state.sequence }) });
    const lists = { ...base, views, reactors: {} };
    await withFixture(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const log = yield* EventLog;
      const live = yield* Views;
      const before = yield* live.snapshot;
      const event = eventOf({ _tag: "AccountChanged", accountId: "healthy", account: { id: "healthy", harness: "first" } });
      const projected = project(before, [event], lists as unknown as EngineLists);
      const batch = yield* log.append({ _tag: "owner" }, freshRequest(), "a".repeat(64), [event], {});
      const current = yield* live.snapshot;
      expect(current.accounts.healthy).toMatchObject({ id: "healthy", status: "available" });
      expect(current.sequence).toBe(batch[0]!.sequence);
      expect(current.client).toEqual(fault === "healthy" ? { observed: current.sequence }
        : fault === "observer getter" || fault === "observer body" ? { records: [{ tag: "AccountChanged", sequence: current.sequence }] } : before.client);
      expect(current.board).toEqual(projected.board);
      expect(current.roles).toEqual(projected.roles);
      expect(current.client).toEqual(projected.client);
      expect((yield* compareViews()).differences).toEqual([]);
    }));
  });
}
