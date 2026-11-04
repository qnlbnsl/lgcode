import { expect, it } from "vitest";
import { emptyViews } from "../../src/views/apply.ts";
import { openMatters } from "../../src/roles/openMatters.ts";
import { action, start, fold, event } from "./fixtures.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it("OM01 returns an open owner stall with the same identity as the alert", () => {
  const views = fold([start(), action("StallSeen")]);
  expect(openMatters(views)).toEqual([{ key: "stall:worker", kind: "roles.stall", agentId: "worker" }]);
});

it("OM02 omits records that were never addressed to the owner", () => {
  expect(openMatters(fold([start(), action("ReplaceAdvised", { noticeRecipient: "lead" })]))).toEqual([]);
});

it("OM03 omits an engine-covered give-up alert", () => {
  expect(openMatters(fold([start(), action("GaveUp", { engineAlertOpen: true })]))).toEqual([]);
});

it("OM04 ended and stopped matters are no longer open", () => {
  expect(openMatters(fold([start(), action("StallSeen"), action("StallEnded")]))).toEqual([]);
  expect(openMatters(fold([start(), action("ReplaceAdvised"), event({ _tag: "AgentStopped", agentId: "worker" })]))).toEqual([]);
});

it("OM05 an empty engine view has no open roles matters", () => {
  expect(openMatters(emptyViews())).toEqual([]);
});
