import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { RolesSettings } from "@lgtm/contracts";
import { resolveSettings } from "../../../src/roles/stall-watch/settings.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it("ST01 supplies the documented default limits when no override is set", () => {
  expect(resolveSettings({}, undefined)).toEqual({
    crashRetries: 1, capacityRetries: 12, capacityBackoffMinutes: 5,
    stallMinutes: 10, teamIdleMinutes: 60, turnMinutes: 120, ageMinutes: 120,
  });
});

it("ST02 applies a per-role override without changing the team defaults", () => {
  const settings = resolveSettings({ limits: { teamIdleMinutes: 90 } }, { limits: { stallMinutes: 25 } });
  expect(settings.teamIdleMinutes).toBe(90);
  expect(settings.stallMinutes).toBe(25);
  expect(settings.capacityRetries).toBe(12);
});

it.each([
  [{ crashRetries: 2 }, "crashRetries"],
  [{ capacityRetries: 13 }, "capacityRetries"],
  [{ capacityBackoffMinutes: 0 }, "capacityBackoffMinutes"],
  [{ stallMinutes: 4 }, "stallMinutes"],
  [{ teamIdleMinutes: 1441 }, "teamIdleMinutes"],
  [{ turnMinutes: 29 }, "turnMinutes"],
  [{ ageMinutes: 2881 }, "ageMinutes"],
  [{ compactionTokens: 19999 }, "compactionTokens"],
  [{ flushLeadMinutes: 5 }, "flushLeadMinutes"],
] as const)("ST03 rejects the out-of-range limit %j at its field", (limits, path) => {
  expect(() => Schema.decodeUnknownSync(RolesSettings)({ limits })).toThrow(path);
});
