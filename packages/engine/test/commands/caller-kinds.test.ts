import { commandAccess } from "@lgcode/contracts";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

// Service grants belong to 1b E13. Preserve these sixteen owner/agent
// answers without preventing that later unit from granting a service access.
const access: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["start", ["owner", "agent"]], ["prompt", ["owner", "agent"]], ["answer", ["owner", "agent"]],
  ["pass-up", ["owner", "agent"]], ["ask", ["owner", "agent"]], ["wait", ["owner", "agent"]],
  ["stop", ["owner", "agent"]], ["resume", ["owner", "agent"]], ["compact", ["owner", "agent"]],
  ["group", ["owner", "agent"]], ["subscribe", ["owner", "agent"]],
  ["accounts", ["owner"]], ["accounts set-secret", ["owner"]], ["accounts mark-available", ["owner"]],
  ["harnesses", ["owner"]], ["debug.compare-views", ["owner"]],
];

it.each(access)("1.4 %s uses caller kinds while preserving its owner and agent access", (name, kinds) => {
  const entry = (commandAccess as unknown as Record<string, ReadonlyArray<string>>)[name];
  expect(Array.isArray(entry), "Access must be a collection of caller kinds").toBe(true);
  expect(entry!.filter((kind) => kind === "owner" || kind === "agent")).toEqual(kinds);
});
