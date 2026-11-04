import { expect, it } from "vitest";
import { engineLists } from "../../../src/pieces/lists.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it("K01 registers the sheepdog service with only its planned command rights", () => {
  expect(engineLists.services["roles.sheepdog"]).toEqual([
    "subscribe", "client.event", "prompt", "compact", "resume", "release",
    "roles.record", "board.post", "board.flush", "board.status",
  ]);
});

it("K02 gives the standing-rules service no command rights", () => {
  expect(engineLists.services["roles.standing-rules"]).toEqual([]);
});

it("K03 registers roles.record as a roles-piece planner", () => {
  expect(engineLists.planners["roles.record"]).toBeTypeOf("function");
});

it("K04 exposes a sheepdog reactor through the engine reactor table", () => {
  expect(engineLists.reactors.roles).toBeDefined();
});
