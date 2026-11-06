import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it } from "@effect/vitest";
import { HarnessSettings, type TurnUsage } from "@sheprd/contracts";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
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
import type { TimerOrigin } from "../../../src/roles/sheepdog/timers.ts";
import { makeCacheRule } from "../../../src/roles/sheepdog/cacheRule.ts";
import { Views } from "../../../src/views/Views.ts";
import { EventLog } from "../../../src/log/EventLog.ts";
import { withLane } from "../../../src/routing/lanes.ts";
import { sheepdogLoop } from "../../../src/roles/sheepdog/loop.ts";
import type { RolesView } from "../../../src/roles/view.ts";
import { fixtureClient } from "../../support/fixturePiece.ts";
import { incarnationOf, makeFakeRunner, type FakeRunner } from "../../support/fakeRunner.ts";
import { agentIdOf, appendSetup, eventOf, makeFakeSecrets, makeRig, removeRig, seedAccount, seedHarness, startPayload, type Rig } from "../../support/handlerRig.ts";
import { alertLog } from "../../support/alertsRig.ts";
import { eventually, pause, snapshot } from "../../support/routingRig.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("SHEPRD_HOME", rig.stateFolder); });
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

// Configuration is committed before the disabled subscription starts. Enabling
// must reconstruct the cache without depending on another HarnessChanged.
const switchSheepdog = (client: Client, on: boolean, requestId: string) => Effect.gen(function* () {
  yield* client["roles.settings.set"]!({ requestId, settings: { sheepdog: on } });
  const view = yield* eventually(snapshot, (view) => (view.roles as RolesView).baseline?.on === on);
  expect((view.roles as RolesView).baseline?.on).toBe(on);
  yield* pause(50);
});

it.effect.each(["existing", "subsequent", "missed"] as const)(
  "enabling an initially disabled sheepdog loads the configured lifetime for an %s unsplit turn",
  (timing) => run((runner, client) => Effect.gen(function* () {
    const reply = yield* client.harnesses!({ requestId: "activation-harness", operation: "list" });
    const harness = (reply.harnesses as Array<Record<string, unknown>>).find((row) => row.id === "first")!;
    yield* client.harnesses!({ requestId: "activation-lifetime", operation: "set", harness: { ...harness, cacheLifetime: 60 } });
    yield* client["roles.settings.set"]!({ requestId: "initially-off", settings: { sheepdog: false } });
    const who = yield* start(runner, client);
    if (timing !== "subsequent") yield* turn(runner, client, who, "before-activation", { used: 200_000 });
    yield* sheepdogLoop.pipe(Effect.forkScoped);
    const disabled = yield* eventually(snapshot, (view) => (view.roles as RolesView).baseline?.on === false);
    expect((disabled.roles as RolesView).baseline?.on).toBe(false);
    yield* TestClock.adjust(timing === "missed" ? "59 minutes" : "30 minutes");
    expect(runner.callsOf("compact")).toHaveLength(0);
    const beforeEnable = (yield* snapshot).sequence;
    yield* switchSheepdog(client, true, "activate");
    if (timing === "subsequent") yield* turn(runner, client, who, "after-activation", { used: 200_000 });
    // Exercise a repeated on write and a real off/on cycle with the same turn.
    yield* switchSheepdog(client, true, "already-on");
    yield* switchSheepdog(client, false, "disable-again");
    yield* switchSheepdog(client, true, "activate-again");
    expect((yield* alertLog).some((row) => row.sequence > beforeEnable && row.event._tag === "HarnessChanged")).toBe(false);
    if (timing === "missed") {
      yield* TestClock.adjust("1 hour");
      yield* pause(50);
      expect(runner.callsOf("compact")).toHaveLength(0);
    } else {
      // The existing turn's deadline remains minute 58, not enable time + 58.
      yield* TestClock.adjust(timing === "existing" ? "27 minutes" : "57 minutes");
      expect(runner.callsOf("compact")).toHaveLength(0);
      yield* TestClock.adjust("1 minute");
      expect(yield* waitCompact(runner)).toBe(1);
      yield* runner.emit({ _tag: "turnEnded", ...who, deliveryId: runner.callsOf("compact")[0]!.input.delivery.id, usage: warm });
      yield* eventually(snapshot, (view) => view.agents[who.agentId]?.state._tag === "idle");
      yield* switchSheepdog(client, false, "off-after-action");
      yield* switchSheepdog(client, true, "on-after-action");
      yield* TestClock.adjust("1 hour");
      yield* pause(50);
      expect(runner.callsOf("compact")).toHaveLength(1);
      expect((yield* alertLog).filter((row) => row.event._tag === "roles.CompactRequested")).toHaveLength(1);
    }
  }), { ...engineLists, reactors: {} }),
);

it.effect.each(["default", "account-home", "account-environment"] as const)(
  "enabling an initially disabled sheepdog reconstructs the Claude transcript deadline from %s",
  (location) => run((runner, client) => Effect.gen(function* () {
    yield* seedHarness("claude");
    const configHome = location === "default" ? join(rig.home, ".claude") : join(rig.home, "claude-account");
    yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: "activation-claude", account: {
      id: "activation-claude", harness: "claude", displayName: "Claude", enabled: true,
      ...(location === "account-home" ? { home: configHome } : {}),
      ...(location === "account-environment" ? { environment: { CLAUDE_CONFIG_DIR: configHome } } : {}),
    } })]);
    yield* client["roles.settings.set"]!({ requestId: "claude-initially-off", settings: { sheepdog: false } });
    const sessionId = "123e4567-e89b-42d3-a456-426614174000";
    runner.script("start", () => Effect.succeed({ session: { _tag: "acp", sessionId }, protocolVersion: 2, reloadable: true }));
    const who = yield* start(runner, client, { harness: "claude", account: { _tag: "named", accountId: "activation-claude" } });
    const path = transcriptPath(configHome, rig.work, sessionId)!;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ type: "assistant", timestamp: new Date(yield* Clock.currentTimeMillis).toISOString(), message: {
      content: "PRIVATE ACTIVATION TRANSCRIPT", usage: { input_tokens: 180_000, cache_read_input_tokens: 20_000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 10 } },
    } }) + "\n");
    yield* turn(runner, client, who, "claude-before-activation", undefined);
    yield* sheepdogLoop.pipe(Effect.forkScoped);
    const disabled = yield* eventually(snapshot, (view) => (view.roles as RolesView).baseline?.on === false);
    expect((disabled.roles as RolesView).baseline?.on).toBe(false);
    yield* TestClock.adjust("30 minutes");
    yield* switchSheepdog(client, true, "claude-activate");
    yield* TestClock.adjust("27 minutes");
    expect(runner.callsOf("compact")).toHaveLength(0);
    yield* TestClock.adjust("1 minute");
    expect(yield* waitCompact(runner)).toBe(1);
    expect(JSON.stringify(yield* alertLog)).not.toContain("PRIVATE ACTIVATION TRANSCRIPT");
  }), { ...engineLists, reactors: {} }),
);


const cacheContext = (view: Effect.Success<typeof snapshot>, lists = engineLists) => ({
  snapshot: view, lists, sourceSequence: view.sequence, firstStart: false, baselinePosition: 0,
});
const armedCacheTimer = (timer: TimerOrigin) => ({ ...timer, dueAt: timer.absoluteDueAt! });
const quietLists = { ...engineLists, reactors: {} };

it.effect("FR-024 posts after status captured zero are flushed from the acceptance snapshot", () => {
  let onStatus = () => Effect.void as Effect.Effect<unknown, unknown, any>;
  const actual = engineLists.reads["board.status"]!;
  const lists = { ...quietLists, reads: { ...engineLists.reads, "board.status": (input, payload) => {
    const reply = actual(input, payload);
    return Effect.isEffect(reply) ? reply.pipe(Effect.tap(() => onStatus())) : reply;
  } } } satisfies EngineLists;
  return run((runner, client) => Effect.gen(function* () {
    const who = yield* start(runner, client);
    yield* turn(runner, client, who, "unread-race", warm);
    const rule = makeCacheRule();
    const context = cacheContext(yield* snapshot, lists);
    yield* rule.onStart!(context);
    const timer = rule.timers!(context)[0]!;
    onStatus = () => Effect.gen(function* () {
      for (const n of [1, 2]) yield* client["board.post"]!({ requestId: `racing-post-${n}`, direct: { _tag: "agent", agentId: who.agentId },
        to: [{ _tag: "agent", agentId: who.agentId }], text: `New notice ${n}`, reply: "none" });
    });
    yield* TestClock.adjust("58 minutes");
    yield* rule.onTimer!(context, armedCacheTimer(timer));
    const rows = yield* alertLog;
    const wake = rows.find((row) => row.event._tag === "board.WakeBuilt");
    expect(wake?.event._tag === "board.WakeBuilt" && wake.event.carried).toHaveLength(2);
    expect(runner.callsOf("compact")).toHaveLength(0);
  }), lists);
});

it.effect.each(["queue", "hold", "turn", "session"] as const)(
  "FR-021 rejects %s changes after the final read but before writer acceptance", (change) => run((runner, client) => Effect.gen(function* () {
    const who = yield* start(runner, client);
    yield* turn(runner, client, who, "acceptance-race", warm);
    const rule = makeCacheRule();
    const context = cacheContext(yield* snapshot, quietLists);
    yield* rule.onStart!(context);
    const timer = rule.timers!(context)[0]!;
    const views = yield* Views;
    let injected = false;
    // Only the rule receives this read wrapper. The command's captured Views
    // still reads the actual state inside the writer transaction.
    const racingViews = { ...views, snapshot: views.snapshot.pipe(Effect.tap(() => Effect.gen(function* () {
      if (injected) return;
      injected = true;
      if (change === "queue") yield* client.prompt!({ requestId: "queued-after-read", agentId: who.agentId, text: "New work" });
      else if (change === "hold") yield* appendSetup([eventOf({ _tag: "DeliveryHeld", agentId: who.agentId, deliveryId: "empty-hold", reason: "capacity" })]);
      else if (change === "turn") yield* turn(runner, client, who, "new-after-read", warm);
      else {
        yield* client.stop!({ requestId: "stop-after-read", agentId: who.agentId });
        runner.script("start", () => Effect.succeed({ session: { _tag: "acp", sessionId: "fresh-session" }, protocolVersion: 2, reloadable: true }));
        yield* client.resume!({ requestId: "fresh-after-read", agentId: who.agentId, fresh: true });
      }
    }))) };
    yield* TestClock.adjust("58 minutes");
    const fire = rule.onTimer!(context, armedCacheTimer(timer)).pipe(Effect.provideService(Views, racingViews));
    if (change === "queue") yield* withLane(yield* EventLog, who.agentId)(fire);
    else yield* fire;
    expect(injected).toBe(true);
    expect((yield* alertLog).filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.content._tag === "compact")).toHaveLength(0);
  }), quietLists),
);

it.effect.each([false, true])("FR-031 fresh sessions cannot reuse old usage on late lifetime settings (restart: %s)", (restart) => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "old-session-usage", { used: 200_000 });
  yield* client.stop!({ requestId: "old-session-stop", agentId: who.agentId });
  runner.script("start", () => Effect.succeed({ session: { _tag: "acp", sessionId: "distinct-session" }, protocolVersion: 2, reloadable: true }));
  yield* client.resume!({ requestId: "new-session-resume", agentId: who.agentId, fresh: true });
  const reply = yield* client.harnesses!({ requestId: "late-harness", operation: "list" });
  const harness = (reply.harnesses as Array<Record<string, unknown>>).find((row) => row.id === "first")!;
  const rule = makeCacheRule();
  yield* rule.onStart!(cacheContext(yield* snapshot, quietLists));
  yield* client.harnesses!({ requestId: "late-lifetime", operation: "set", harness: { ...harness, cacheLifetime: 60 } });
  const context = cacheContext(yield* snapshot, quietLists);
  if (restart) yield* rule.onStart!(context);
  else yield* rule.onEvent!(context, (yield* alertLog).findLast((row) => row.event._tag === "HarnessChanged")!);
  expect(rule.timers!(context)).toHaveLength(0);
  yield* TestClock.adjust("58 minutes");
  expect(runner.callsOf("compact")).toHaveLength(0);
}), quietLists));

it.effect("FR-060 unknown lifetime does not schedule or act with valid unsplit context", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "unknown-lifetime", { used: 200_000 });
  const rule = makeCacheRule();
  const context = cacheContext(yield* snapshot);
  yield* rule.onStart!(context);
  expect(rule.timers!(context)).toHaveLength(0);
  yield* TestClock.adjust("2 hours");
  yield* pause(80);
  expect(runner.callsOf("compact")).toHaveLength(0);
  expect((yield* alertLog).filter((row) => row.event._tag === "roles.CompactRequested" || row.event._tag === "roles.CacheFlushed")).toHaveLength(0);
})));

it.effect.each(["expired", "queue", "turn", "session", "settings"] as const)(
  "FR-021 delayed automatic compact is withdrawn after %s invalidation", (change) => run((runner, client) => Effect.gen(function* () {
    const who = yield* start(runner, client);
    yield* turn(runner, client, who, "delayed-cache", warm);
    const rule = makeCacheRule();
    const context = cacheContext(yield* snapshot, quietLists);
    yield* rule.onStart!(context);
    const timer = rule.timers!(context)[0]!;
    const log = yield* EventLog;
    let automatic = "";
    // The ordinary engine send lane models a delayed reservation, without
    // replacing dispatch or its writer transaction.
    yield* withLane(log, who.agentId)(Effect.gen(function* () {
      yield* TestClock.adjust("58 minutes");
      yield* rule.onTimer!(context, armedCacheTimer(timer));
      automatic = Object.values((yield* snapshot).deliveries).find((row) => row.content._tag === "compact")!.id;
      if (change === "expired") yield* TestClock.adjust("2 minutes");
      else if (change === "queue") yield* client.prompt!({ requestId: "priority-work", agentId: who.agentId, text: "Ordinary work" });
      else if (change === "turn") yield* appendSetup([eventOf({ _tag: "TurnEnded", agentId: who.agentId, compact: false, usage: warm })]);
      else if (change === "session") yield* appendSetup([eventOf({ _tag: "SessionOpened", agentId: who.agentId,
        session: { _tag: "acp", sessionId: "new-during-delay" }, protocolVersion: 2, reloadable: true })]);
      else yield* client["roles.settings.set"]!({ requestId: "disable-during-delay", settings: { sheepdog: false } });
      expect(runner.callsOf("compact")).toHaveLength(0);
    }));
    const view = yield* eventually(snapshot, (view) => view.deliveries[automatic]?.status !== "queued");
    expect(view.deliveries[automatic]?.status).toBe("withdrawn");
    expect(runner.callsOf("compact")).toHaveLength(0);
    if (change === "queue") {
      yield* eventually(snapshot, (view) => Object.values(view.deliveries).some((row) => row.content._tag === "prompt" && row.status === "sent"));
      expect(runner.callsOf("prompt").at(-1)?.input.delivery.content).toMatchObject({ _tag: "prompt", text: expect.stringContaining("Ordinary work") });
    }
  }), quietLists),
);

it.effect("FR-021 delayed automatic flush expires while an owner flush remains deliverable", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "delayed-flush", warm);
  yield* client["board.post"]!({ requestId: "pending-notice", direct: { _tag: "agent", agentId: who.agentId },
    to: [{ _tag: "agent", agentId: who.agentId }], text: "The durable notice.", reply: "none" });
  const rule = makeCacheRule();
  const context = cacheContext(yield* snapshot, quietLists);
  yield* rule.onStart!(context);
  let automatic = "";
  yield* withLane(yield* EventLog, who.agentId)(Effect.gen(function* () {
    yield* TestClock.adjust("58 minutes");
    yield* rule.onTimer!(context, armedCacheTimer(rule.timers!(context)[0]!));
    automatic = Object.values((yield* snapshot).deliveries).find((row) => row.cache?.action === "flush")!.id;
    yield* TestClock.adjust("2 minutes");
  }));
  const withdrawn = yield* eventually(snapshot, (view) => view.deliveries[automatic]?.status === "withdrawn");
  expect(withdrawn.deliveries[automatic]?.status).toBe("withdrawn");
  yield* client["board.flush"]!({ requestId: "owner-flush-after-expiry", agentId: who.agentId });
  const sent = yield* eventually(snapshot, (view) => Object.values(view.deliveries).some((row) => row.id !== automatic && row.source?._tag === "piece" && row.source.namespace === "board" && row.status === "sent"));
  expect(Object.values(sent.deliveries).some((row) => row.id !== automatic && row.status === "sent" && row.cache === undefined)).toBe(true);
  expect(runner.callsOf("prompt").at(-1)?.input.delivery.content).toMatchObject({ _tag: "prompt", text: expect.stringContaining("The durable notice.") });
}), quietLists));

it.effect("FR-021 owner compaction keeps its queue semantics beyond a cache deadline", () => run((runner, client) => Effect.gen(function* () {
  const who = yield* start(runner, client);
  yield* turn(runner, client, who, "before-manual-compact", warm);
  yield* withLane(yield* EventLog, who.agentId)(Effect.gen(function* () {
    yield* client.compact!({ requestId: "manual-compact", agentId: who.agentId });
    yield* TestClock.adjust("2 hours");
  }));
  expect(yield* waitCompact(runner)).toBe(1);
  expect(runner.callsOf("compact")[0]?.input.delivery.cache).toBeUndefined();
}), quietLists));

it.effect.each(["missing", "partial", "future", "read-only", "normalized-used"] as const)(
  "FR-022 composed fallback needs a current request and preserves independent context authority: %s", (current) => run((runner, client) => Effect.gen(function* () {
    yield* seedHarness("claude"); yield* seedAccount("claude-account", "claude");
    const sessionId = "123e4567-e89b-42d3-a456-426614174000";
    runner.script("start", () => Effect.succeed({ session: { _tag: "acp", sessionId }, protocolVersion: 2, reloadable: true }));
    const who = yield* start(runner, client, { harness: "claude", account: { _tag: "named", accountId: "claude-account" } });
    const path = transcriptPath(join(rig.home, ".claude"), rig.work, sessionId)!;
    mkdirSync(dirname(path), { recursive: true });
    const row = (timestamp: number, usage: unknown) => JSON.stringify({ type: "assistant", timestamp: new Date(timestamp).toISOString(), message: { usage } });
    const old = row(yield* Clock.currentTimeMillis, { input_tokens: 200_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 10 } });
    yield* TestClock.adjust("1 minute");
    const now = yield* Clock.currentTimeMillis;
    const latest = current === "missing" ? "" : row(current === "future" ? now + 60_000 : now,
      current === "partial" ? { cache_creation_input_tokens: 0 } : { input_tokens: 200_000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } });
    writeFileSync(path, `${old}\n${latest}\n`);
    yield* turn(runner, client, who, "fallback-current", current === "normalized-used" ? { used: 1_000 } : undefined);
    const rule = makeCacheRule();
    const context = cacheContext(yield* snapshot, quietLists);
    yield* rule.onStart!(context);
    expect(rule.timers!(context)).toHaveLength(current === "read-only" || current === "normalized-used" ? 1 : 0);
    yield* TestClock.adjust("58 minutes");
    const timer = rule.timers!(context)[0];
    if (timer !== undefined) yield* rule.onTimer!(context, armedCacheTimer(timer));
    if (current === "read-only") expect(yield* waitCompact(runner)).toBe(1);
    else expect(runner.callsOf("compact")).toHaveLength(0);
  }), quietLists),
);
