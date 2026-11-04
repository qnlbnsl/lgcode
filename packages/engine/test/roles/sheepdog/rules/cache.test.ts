import { it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { cacheExpiry, cacheAction } from "../../../../src/roles/sheepdog/rules/cache.ts";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it.effect("CM01 uses the one-hour write expiry and requests compaction two minutes early", () => Effect.gen(function* () {
  const started = yield* Clock.currentTimeMillis;
  const expiry = cacheExpiry({ requestStartedAt: started, written5m: 0, written1h: 10 });
  expect(expiry).toBe(started + 3_600_000);
  yield* TestClock.adjust("58 minutes");
  expect(cacheAction({ expiry, now: yield* Clock.currentTimeMillis, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 0, compaction: "on" })).toBe("compact");
}));

it("CM02 flushes unread posts at the cache lead time instead of compacting", () => {
  const expiry = 1_900_003_600_000;
  expect(cacheAction({ expiry, now: 1_900_003_480_000, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 2, compaction: "on" })).toBe("flush");
});

it.each([
  ["queued delivery", { queued: true }], ["sent delivery", { sent: true }], ["capacity hold", { capacityHold: true }],
  ["open request", { openRequest: true }], ["open question", { openQuestion: true }], ["blocking wait", { blockingWait: true }],
  ["active compaction", { compacting: true }], ["previous turn compacted", { lastTurnWasCompact: true }],
] as const)("CM03-CM07 suppresses a cache action for an agent with a %s", (_name, state) => {
  expect(cacheAction({ expiry: 1_900_003_600_000, now: 1_900_003_480_000, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 0, compaction: "on", ...state })).toBeUndefined();
});

it("CM06 allows non-blocking waits and an agent's own open post", () => {
  expect(cacheAction({ expiry: 1_900_003_600_000, now: 1_900_003_480_000, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 0, compaction: "on", blockingWait: false, ownOpenPost: true })).toBe("compact");
});

it.each([
  ["below the context floor", { contextTokens: 149_999, floor: 150_000, compaction: "on" as const }],
  ["compaction switched off", { contextTokens: 200_000, floor: 150_000, compaction: "off" as const }],
  ["unknown expiry", { contextTokens: 200_000, floor: 150_000, compaction: "on" as const, expiry: undefined }],
] as const)("CM08-CM10 does not compact when %s", (_name, state) => {
  expect(cacheAction({ expiry: 1_900_003_600_000, now: 1_900_003_480_000, unreadPosts: 0,
    ...state })).toBeUndefined();
});

it("CM11 drops a five-minute cache whose deadline passed during a four-minute turn", () => {
  const expiry = cacheExpiry({ turnStartedAt: 1_900_000_000_000, turnEndedAt: 1_900_000_240_000,
    written5m: 1, written1h: 0 });
  expect(expiry).toBe(1_900_000_300_000);
  expect(cacheAction({ expiry, now: 1_900_000_240_000, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 0, compaction: "on" })).toBeUndefined();
});

it("CM12-CM15 chooses the shortest written lifetime, preserves a read-only cache lifetime, and refuses unknown expiry", () => {
  expect(cacheExpiry({ requestStartedAt: 1_900_000_000_000, written5m: 1, written1h: 1 })).toBe(1_900_000_300_000);
  expect(cacheExpiry({ requestStartedAt: 1_900_000_000_000, written5m: 0, written1h: 0,
    priorWriteExpiry: 1_900_003_600_000 })).toBe(1_900_003_600_000);
  expect(cacheExpiry({ requestStartedAt: 1_900_000_000_000, written5m: 0, written1h: 0 })).toBeUndefined();
  expect(cacheExpiry({ requestStartedAt: 1_900_000_000_000, written5m: 0, written1h: 0,
    cacheLifetimeMinutes: undefined })).toBeUndefined();
});

it("CM16-CM17 trusts context usage before the transcript and ignores whole-turn token tallies", () => {
  expect(cacheExpiry({ requestStartedAt: 1_900_000_000_000, turnStartedAt: 1_900_000_000_000,
    used: 200_000, written5m: 0, written1h: 1,
    terminalUsage: { inputTokens: 2_000_000, cachedReadTokens: 2_000_000, cachedWriteTokens: 2_000_000 } }))
    .toBe(1_900_003_600_000);
  expect(cacheExpiry({ requestStartedAt: 1_900_000_000_000, written5m: 0, written1h: 0,
    transcript: { inputTokens: 180_000, cachedReadTokens: 20_000, cachedWrite5mTokens: 0, cachedWrite1hTokens: 0 } }))
    .toBeUndefined();
  expect(cacheExpiry({ requestStartedAt: 1_900_000_000_000, written5m: 0, written1h: 0,
    terminalUsage: { inputTokens: 2_000_000, cachedReadTokens: 2_000_000, cachedWriteTokens: 2_000_000 } }))
    .toBeUndefined();
});

it("CM18-CM20 schedules current idle leads and orchestrators, replaces stale turns, and rechecks guards before sending", () => {
  const expiry = 1_900_003_600_000;
  expect(cacheAction({ expiry, now: 1_900_003_480_000, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 0, compaction: "on", role: "lead", workersWorking: true })).toBe("compact");
  expect(cacheAction({ expiry, now: 1_900_003_480_000, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 0, compaction: "on", role: "orchestrator", teamsWorking: true })).toBe("compact");
  expect(cacheAction({ expiry, now: 1_900_003_480_000, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 0, compaction: "on", capacityHold: true })).toBeUndefined();
  expect(cacheAction({ expiry, now: 1_900_003_480_000, contextTokens: 200_000, floor: 150_000,
    unreadPosts: 0, compaction: "on", newerTurn: true })).toBeUndefined();
});
