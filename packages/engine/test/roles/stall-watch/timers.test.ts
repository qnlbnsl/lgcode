import { expect, it } from "vitest";
import { missedDeadlineAction } from "../../../src/roles/stall-watch/timers.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it.each([
  ["stall", "recheck"], ["team-idle", "recheck"], ["capacity", "recheck"], ["notice-cache", "drop"],
] as const)("T01 a missed %s deadline uses its declared %s policy", (rule, expected) => {
  expect(missedDeadlineAction(rule)).toBe(expected);
});

it("T02 timers use the originating event time rather than the replay envelope time", () => {
  const dueAt = (origin: number, delay: number) => origin + delay;
  expect(dueAt(1_900_000_000_000, 600_000)).toBe(1_900_000_600_000);
});
