import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { RolesSettings } from "@sheprd/contracts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it("W01 the owner can turn both roles services off in the settings shape", () => {
  const settings = Schema.decodeUnknownSync(RolesSettings)({ sheepdog: false, standingRules: false });
  expect(settings).toEqual({ sheepdog: false, standingRules: false });
});

it("W02 the sheepdog-off switch does not stop the roles view from folding new actions", async () => {
  const { pieceViews } = await import("../../../src/pieces/viewTables.ts");
  const off = { _tag: "roles.SheepdogBaseline", position: 1, on: false };
  const action = { _tag: "roles.StallSeen", agentId: "worker", noticeRecipient: "owner", triggerSequence: 2, sourceSequence: 2, occurrence: 1, notice: "board-off" };
  let view = pieceViews.roles.reduce(pieceViews.roles.empty(), off, 1);
  view = pieceViews.roles.reduce(view, action, 2) as any;
  expect((view as any).actions).toHaveLength(1);
});
