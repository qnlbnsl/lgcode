import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { fixtureLists, loadLists } from "../support/fixturePiece.ts";
import { freshRequest } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { connected, login, rows, rpc, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

it("5.12 generic dispatch: catches a transport switch that omits a piece command or skips its real planner and writer", async () => {
  const lists = fixtureLists(await loadLists());
  await withWeb((ctx) => Effect.gen(function* () {
    const { cookie } = yield* login(ctx);
    const socket = yield* connected(ctx, cookie);
    const requestId = freshRequest();
    const exit = yield* rpc(socket, "client.record", { requestId, id: "web-record", text: "Data from a piece." });
    expect(exit).toMatchObject({ _tag: "Success", value: { requestId, id: "web-record" } });
    const events = (yield* rows).filter((row) => row.request_id === requestId);
    expect(events).toHaveLength(1);
    expect(events[0]!.caller).toBe("owner");
    expect(JSON.parse(events[0]!.payload_json)).toEqual({
      _tag: "client.FixtureRecorded", id: "web-record", text: "Data from a piece.",
    });
  }), { lists });
});

it("5.12 debug exclusion: catches exposing debug.compare-views through the web group", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx);
  const socket = yield* connected(ctx, cookie);
  const exit = yield* rpc(socket, "debug.compare-views", { requestId: freshRequest() });
  expect(exit._tag).not.toBe("Success");
})));
