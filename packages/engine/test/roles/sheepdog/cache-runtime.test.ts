import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it } from "@effect/vitest";
import { HarnessSettings, type TurnUsage } from "@shephrd/contracts";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { serve } from "../../../src/api/server.ts";
import { engineLists, type EngineLists } from "../../../src/pieces/lists.ts";
import { layer as redactor } from "../../../src/log/Redactor.ts";
import { buildServices } from "../../../src/service.ts";
import { transcriptPath } from "../../../src/roles/sheepdog/usage.ts";
import { sheepdogLoop } from "../../../src/roles/sheepdog/loop.ts";
import { fixtureClient } from "../../support/fixturePiece.ts";
import { incarnationOf, makeFakeRunner, type FakeRunner } from "../../support/fakeRunner.ts";
import { agentIdOf, appendSetup, eventOf, makeFakeSecrets, makeRig, removeRig, seedAccount, seedHarness, startPayload, type Rig } from "../../support/handlerRig.ts";
import { alertLog } from "../../support/alertsRig.ts";
import { eventually, pause, snapshot } from "../../support/routingRig.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
type Client = Effect.Success<ReturnType<typeof fixtureClient>>;
const run = <A, E, R>(body: (runner: FakeRunner, client: Client) => Effect.Effect<A, E, R>, lists: EngineLists = engineLists) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  return yield* Effect.scoped(Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAccount(); yield* seedHarness();
    const bearer = randomBytes(32).toString("base64url");
    const socketPath = join(rig.stateFolder, "cache.sock");
    yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: true, lists });
    const client = yield* fixtureClient(socketPath, bearer, lists as any);
    yield* runner.subscribed;
    return yield* body(runner, client);
  })).pipe(Effect.provide(buildServices(rig, lists).pipe(
    Layer.provide(Layer.mergeAll(runner.layer, makeFakeSecrets().layer, redactor)),
  )), Effect.provide(runner.layer));
}).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<A, E>;

const start = (runner: FakeRunner, client: Client, extra: Record<string, unknown> = {}) => Effect.gen(function* () {
  const reply = yield* client.start!({ requestId: "cache-start", ...startPayload(rig, extra) });
  const agentId = agentIdOf(reply.agentId);
  const launch = runner.callsOf("start").find((call) => call.input.agentId === agentId)!;
  return { agentId, incarnation: incarnationOf(Redacted.value(launch.input.token)) };
});
type Agent = Effect.Success<ReturnType<typeof start>>;
const turn = (runner: FakeRunner, client: Client, who: Agent, name: string, usage: TurnUsage | undefined,
  elapsed: Parameters<typeof TestClock.adjust>[0] = "0 seconds") => Effect.gen(function* () {
  const sent = yield* client.prompt!({ requestId: name, agentId: who.agentId, text: "Do the assigned work." });
  const deliveryId = String(sent.deliveryId);
  yield* eventually(snapshot, (view) => view.deliveries[deliveryId]?.status === "sent");
  yield* runner.emit({ _tag: "deliveryUpdate", ...who, deliveryId, kind: "message", replay: false, text: "Finished." });
  yield* eventually(snapshot, (view) => view.deliveries[deliveryId]?.status === "accepted");
  if (elapsed !== "0 seconds") yield* TestClock.adjust(elapsed);
  yield* runner.emit({ _tag: "turnEnded", ...who, deliveryId: deliveryId as any, ...(usage === undefined ? {} : { usage }) });
  yield* eventually(snapshot, (view) => view.agents[who.agentId]?.state._tag === "idle");
  yield* pause(40); // Let the subscription arm before advancing its clock.
});
const warm: TurnUsage = { used: 200_000, cachedWrite5mTokens: 0, cachedWrite1hTokens: 10 };
const waitCompact = (runner: FakeRunner, count = 1) => eventually(Effect.sync(() => runner.callsOf("compact").length), (value) => value === count);

it.effect("the production sheepdog compacts through the service at 58 minutes after a socket-started turn", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "first-turn", warm);
  yield* TestClock.adjust("57 minutes"); expect(runner.callsOf("compact")).toHaveLength(0);
  yield* TestClock.adjust("1 minute");
  expect(yield* waitCompact(runner)).toBe(1);
  const rows = yield* alertLog;
  expect(rows.find((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.content._tag === "compact")?.caller)
    .toEqual({ _tag: "service", service: "roles.sheepdog" });
  const recorded = yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === "roles.CompactRequested"));
  expect(recorded.filter((row) => row.event._tag === "roles.CompactRequested")).toHaveLength(1);
  // A completed compaction does not compact itself again.
  const delivery = runner.callsOf("compact")[0]!.input.delivery;
  yield* runner.emit({ _tag: "turnEnded", ...who, deliveryId: delivery.id, usage: warm });
  yield* TestClock.adjust("1 hour"); expect(runner.callsOf("compact")).toHaveLength(1);
})));

it.effect("two unread socket posts are flushed at the deadline instead of compacting", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "flush-turn", warm);
  for (const index of [1, 2]) yield* client["board.post"]!({ requestId: `post-${index}`, direct: { _tag: "agent", agentId: who.agentId },
    to: [{ _tag: "agent", agentId: who.agentId }], text: `Waiting message ${index}.`, reply: "none" });
  expect(runner.callsOf("compact")).toHaveLength(0);
  yield* TestClock.adjust("58 minutes");
  const rows = yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === "board.WakeBuilt"));
  const wake = rows.find((row) => row.event._tag === "board.WakeBuilt");
  expect(wake?.caller).toEqual({ _tag: "service", service: "roles.sheepdog" });
  expect(wake?.event._tag === "board.WakeBuilt" && wake.event.carried).toHaveLength(2);
  const recorded = yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === "roles.CacheFlushed"));
  expect(recorded.filter((row) => row.event._tag === "roles.CacheFlushed")).toHaveLength(1);
  expect(runner.callsOf("compact")).toHaveLength(0);
})));

it.effect.each([
  { name: "below the floor", limits: { compactionTokens: 300_000 } },
  { name: "role switch off", limits: { compactionTokens: "off" } },
] as const)("socket role overrides suppress compaction: $name", ({ limits }) => run((runner, client) => Effect.gen(function* () {
  yield* client["roles.role-file.set"]!({ requestId: "role-limits", content: JSON.stringify({ name: "Cache roles", roles: {
    keeper: { advice: "Coordinate the assigned work.", limits },
  } }) });
  const who = yield* start(runner, client, { role: "lead:keeper" });
  yield* turn(runner, client, who, "limited-turn", warm);
  yield* TestClock.adjust("58 minutes");
  yield* pause(100); expect(runner.callsOf("compact")).toHaveLength(0);
})));

it.effect("a capacity hold opened after arming suppresses compaction even with an empty queue", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "before-hold", warm);
  yield* TestClock.adjust("57 minutes");
  // The capacity producer is a runner event, not an owner command. Only this
  // otherwise unreachable empty-hold condition uses a historical event fixture.
  // Open it near the cache deadline so the capacity rule has not released it.
  yield* appendSetup([eventOf({ _tag: "DeliveryHeld", agentId: who.agentId, deliveryId: "empty-hold", reason: "capacity" })]);
  yield* TestClock.adjust("1 minute");
  expect((yield* snapshot).agents[who.agentId]?.capacityHeld).toBe(true);
  yield* pause(100); expect(runner.callsOf("compact")).toHaveLength(0);
})));

it.effect("a new turn that arrives during the status read is caught by the final guard", () => {
  let onStatus = () => Effect.void as Effect.Effect<unknown, unknown, any>;
  const actual = engineLists.reads["board.status"]!;
  const lists: EngineLists = { ...engineLists, reads: { ...engineLists.reads, "board.status": (input, payload) => {
    const reply = actual(input, payload);
    return Effect.isEffect(reply) ? reply.pipe(Effect.tap(() => onStatus())) : reply;
  } } };
  return run((runner, client) => Effect.gen(function* () {
    const who = yield* start(runner, client);
    yield* turn(runner, client, who, "guard-turn", warm);
    onStatus = () => client.prompt!({ requestId: "racing-work", agentId: who.agentId, text: "Handle the newly arrived work." });
    yield* TestClock.adjust("58 minutes");
    yield* eventually(snapshot, (view) => view.agents[who.agentId]?.state._tag === "working");
    yield* pause(50); expect(runner.callsOf("compact")).toHaveLength(0);
  }), lists);
});

it.effect("a newer turn cancels the old deadline and re-arms from the newer request", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "old-turn", warm);
  yield* TestClock.adjust("30 minutes");
  yield* turn(runner, client, who, "new-turn", warm);
  yield* TestClock.adjust("28 minutes"); expect(runner.callsOf("compact")).toHaveLength(0);
  yield* TestClock.adjust("30 minutes"); expect(yield* waitCompact(runner)).toBe(1);
})));

it.effect("a read-only request renews the latest write lifetime in the same session", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "write-turn", warm);
  yield* TestClock.adjust("30 minutes");
  yield* turn(runner, client, who, "read-turn", { used: 200_000, cachedWrite5mTokens: 0, cachedWrite1hTokens: 0 });
  yield* TestClock.adjust("57 minutes"); expect(runner.callsOf("compact")).toHaveLength(0);
  yield* TestClock.adjust("1 minute"); expect(yield* waitCompact(runner)).toBe(1);
})));

it.effect("compaction continues with the board off", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "board-off", warm);
  yield* TestClock.adjust("58 minutes"); expect(yield* waitCompact(runner)).toBe(1);
}), { ...engineLists, boardEnabled: false }));

it.effect("a four-minute turn misses the five-minute cache lead and is dropped", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "slow-turn", { used: 200_000, cachedWrite5mTokens: 1 }, "4 minutes");
  yield* TestClock.adjust("1 hour"); expect(runner.callsOf("compact")).toHaveLength(0);
})));

it.effect("the socket harness setting has no default, is bounded, and enables timing only with context usage", () => run((runner, client) => Effect.gen(function* () {
  const reply = yield* client.harnesses!({ requestId: "get-harnesses", operation: "list" });
  const harness = (reply.harnesses as Array<Record<string, unknown>>).find((row) => row.id === "first")!;
  expect(harness.cacheLifetime).toBeUndefined();
  expect(Schema.is(HarnessSettings)({ ...harness, cacheLifetime: 1 })).toBe(false);
  yield* client.harnesses!({ requestId: "set-lifetime", operation: "set", harness: { ...harness, cacheLifetime: 60 } });
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "tallies-only", { inputTokens: 2_000_000, cachedReadTokens: 2_000_000 });
  yield* TestClock.adjust("58 minutes"); expect(runner.callsOf("compact")).toHaveLength(0);
  yield* turn(runner, client, who, "reported-context", { used: 200_000 });
  yield* TestClock.adjust("58 minutes"); expect(yield* waitCompact(runner)).toBe(1);
})));

it.effect.each([false, true])("a restarted cache rule preserves the original expiry and drops missed deadlines (missed: %s)", (missed) => run((runner, client) => Effect.gen(function* () {
  const first = yield* sheepdogLoop.pipe(Effect.forkScoped);
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "before-restart", warm);
  yield* TestClock.adjust("30 minutes");
  yield* Fiber.interrupt(first);
  if (missed) yield* TestClock.adjust("29 minutes");
  yield* sheepdogLoop.pipe(Effect.forkScoped);
  yield* pause(50);
  yield* TestClock.adjust("28 minutes");
  if (missed) {
    yield* pause(50); expect(runner.callsOf("compact")).toHaveLength(0);
  } else expect(yield* waitCompact(runner)).toBe(1);
}), { ...engineLists, reactors: {} }));

it.effect("Claude transcript fallback uses only last-request usage and never records transcript text", () => run((runner, client) => Effect.gen(function* () {
  yield* seedHarness("claude"); yield* seedAccount("claude-account", "claude");
  const sessionId = "123e4567-e89b-42d3-a456-426614174000";
  runner.script("start", () => Effect.succeed({ session: { _tag: "acp", sessionId }, protocolVersion: 2, reloadable: true }));
  const who = yield* start(runner, client, { harness: "claude", account: { _tag: "named", accountId: "claude-account" } });
  const path = transcriptPath(join(rig.home, ".claude"), rig.work, sessionId)!;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ type: "assistant", timestamp: new Date(yield* Clock.currentTimeMillis).toISOString(), message: {
    content: "PRIVATE TRANSCRIPT BODY", usage: { input_tokens: 180_000, cache_read_input_tokens: 20_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 10 } },
  } }) + "\n");
  yield* turn(runner, client, who, "transcript-turn", { inputTokens: 9_000_000 });
  yield* TestClock.adjust("58 minutes"); expect(yield* waitCompact(runner)).toBe(1);
  expect(JSON.stringify(yield* alertLog)).not.toContain("PRIVATE TRANSCRIPT BODY");
})));
