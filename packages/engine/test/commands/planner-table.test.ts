import { CommandsRpcGroup } from "@lgcode/contracts";
import { expect, it } from "vitest";
import { loadLists } from "../support/fixturePiece.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it("1.3 every declared command has exactly one planner or read, with no orphan handler", async () => {
  const lists = await loadLists();
  const planners = Object.keys(lists.planners);
  const reads = Object.keys(lists.reads);
  expect(planners.filter((name) => reads.includes(name))).toEqual([]);
  expect([...planners, ...reads].sort()).toEqual([...CommandsRpcGroup.requests.keys()].sort());
  expect(reads.filter((name) => !name.includes(".") || name === "debug.compare-views").sort()).toEqual(["debug.compare-views", "subscribe"]);
  expect(planners.filter((name) => !name.includes("."))).toHaveLength(17);
});

it("1a E2 default composition includes access for every command and no undeclared command", async () => {
  const lists = await loadLists();
  expect(Object.keys(lists.access).sort()).toEqual([...lists.commands.requests.keys()].sort());
  for (const [name, kinds] of Object.entries(lists.access)) {
    expect(kinds.length, name).toBeGreaterThan(0);
    expect(new Set(kinds).size, name).toBe(kinds.length);
    expect(kinds.every((kind) => ["owner", "agent", "service"].includes(kind)), name).toBe(true);
  }
});
