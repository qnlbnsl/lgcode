import * as Contracts from "@lgcode/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { rolesEvents } from "../../../contracts/test/roles/fixtures.ts";
import { visibleTo } from "../../src/api/visibility.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { emptyViews } from "../../src/views/apply.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it.each(rolesEvents)("G03 visibility: an agent never receives $_tag even with its own agentId", (event) => {
  expect(() => Schema.decodeUnknownSync(Contracts.Event)(event), "1b must add this roles event to the shared Event union").not.toThrow();
  const decoded = Schema.decodeUnknownSync(Contracts.Event)(event);
  const envelope = Schema.decodeUnknownSync(Contracts.EventEnvelope)({
    sequence: 1, eventId: "event-role-visibility", occurredAt: 1_900_000_000_000,
    requestId: "request-role-visibility", caller: { _tag: "owner" }, agentId: "agent-self", event: decoded,
  });
  expect(visibleTo({ _tag: "agent", agentId: "agent-self" as Contracts.AgentId }, envelope, emptyViews())).toBe(false);
  expect(visibleTo({ _tag: "owner" }, envelope, emptyViews())).toBe(true);
});

it.each([
  ["roles.orient", "read"], ["roles.handoff", "read"],
  ["roles.role-file.set", "planner"], ["roles.role-file.get", "read"],
  ["roles.settings.get", "read"], ["roles.settings.set", "planner"],
  ["roles.snooze", "planner"], ["roles.actions.list", "read"], ["roles.record", "planner"],
] as const)("G06 %s is wired in exactly its specified %s table", (command, kind) => {
  const planners = engineLists.planners as Record<string, unknown>;
  const reads = engineLists.reads as Record<string, unknown>;
  expect(planners[command] !== undefined).toBe(kind === "planner");
  expect(reads[command] !== undefined).toBe(kind === "read");
});
