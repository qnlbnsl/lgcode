import { it } from "@effect/vitest";
import { DeliveryId, type Event } from "@sheprd/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { engineLists } from "../../src/pieces/lists.ts";
import { promptReply, targetGone } from "../../src/routing/deliveries.ts";
import { buildServices } from "../../src/service.ts";
import { layer as redactorLayer } from "../../src/log/Redactor.ts";
import { Restart } from "../../src/recovery/service.ts";
import { Runner } from "../../src/runner/Runner.ts";
import { agentIdOf, appendSetup, eventOf, makeFakeSecrets, makeRig, removeRig, seedAccount, seedAgent, seedHarness, type Credential, type Rig } from "../support/handlerRig.ts";
import type { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { currentIncarnation, makeFakeRunner, seedFakeProcess, type FakeRunner } from "../support/fakeRunner.ts";
import { eventually, pause } from "../support/routingRig.ts";
import { boardOwnerClient } from "../support/boardWait.ts";
import { appendDelivery, boardState, change, provideBoard, queued, seedBoard, snapshot } from "./wakeFixtures.ts";

export { it, eventually, pause };
export const reactorRig = (register: () => ReturnType<typeof registerRebuildCheck>) => {
  let rig: Rig;
  let credentials: Record<string, Credential> = {};
  beforeEach(() => { rig = makeRig(); credentials = {}; vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPRD_HOME", rig.stateFolder); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRig(rig); });
  return {
    ownerClient: () => boardOwnerClient(rig),
    run: <A, E, R>(body: (c: Record<string, Credential>, runner: FakeRunner) => Effect.Effect<A, E, R>, states: Parameters<typeof seedBoard>[0] = {}) =>
      provideBoard(rig, (runner) => Effect.gen(function* () {
        yield* register();
        credentials = yield* seedBoard(states);
        return yield* body(credentials, runner);
      })).pipe(Effect.orDie),
    reopen: <A, E, R>(body: Effect.Effect<A, E, R> | ((runner: FakeRunner) => Effect.Effect<A, E, R>)) => provideBoard(rig, (runner) => Effect.gen(function* () {
      yield* register();
      return yield* typeof body === "function" ? body(runner) : body;
    })).pipe(Effect.orDie),
    withoutBoard: <A, E, R>(body: Effect.Effect<A, E, R>) => provideBoard(rig, Effect.gen(function* () {
      yield* register();
      yield* seedAccount(); yield* seedHarness();
      yield* seedAgent({ id: "lead", state: "idle" });
      yield* seedAgent({ id: "worker", parent: "lead", state: "idle" });
      return yield* body;
    })).pipe(Effect.orDie),
    // Service lifecycle checks use the public service builder, including its
    // recovery gate and defect/write-failure policy. Other tests park automatic
    // engine followers and control only the board follower explicitly.
    service: <A, E, R>(body: Effect.Effect<A, E, R>, options: {
      readonly reactor?: Effect.Effect<void, unknown, any>;
      readonly recovery?: Layer.Layer<Restart>;
      readonly logger?: Layer.Layer<never>;
      readonly sheepdog?: boolean;
    } = {}) => Effect.gen(function* () {
      const runner = yield* makeFakeRunner();
      // Reopening the database changes the fake transport object. Register the
      // historical processes before the real dispatcher can send to them.
      const transport = yield* Runner.pipe(Effect.provide(runner.layer));
      for (const [id, credential] of Object.entries(credentials)) {
        if (credential._tag === "agent") seedFakeProcess(transport, agentIdOf(id), Redacted.value(credential.token), true);
      }
      const registered = registeredReactor();
      const lists = { ...engineLists, reactors: { board: options.reactor ?? registered,
        ...(options.sheepdog ? { roles: engineLists.reactors.roles } : {}) } };
      const base = buildServices(rig, lists).pipe(Layer.provideMerge(runner.layer),
        Layer.provideMerge(makeFakeSecrets().layer), Layer.provideMerge(redactorLayer));
      const services = options.recovery === undefined ? base : base.pipe(Layer.provideMerge(options.recovery));
      const program = Effect.scoped(Effect.gen(function* () { yield* register(); return yield* body; })).pipe(Effect.provide(services));
      return yield* (options.logger === undefined ? program : program.pipe(Effect.provide(options.logger)));
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped, Effect.orDie),
  };
};

// This is the public registration seam required by B8. Do not replace the
// missing reactor with a test implementation: these tests must exercise its
// real startup scan, committed-event subscription and checked writer.
export const registeredReactor = () => {
  const reactor = engineLists.reactors.board;
  expect(reactor, "B8: register the board lifecycle reactor in engineLists.reactors.board").toBeDefined();
  return reactor!;
};
export const startReactor = Effect.suspend(() => registeredReactor().pipe(Effect.forkScoped));
export const stopReactor = (fiber: Fiber.Fiber<void, unknown>) => Fiber.interrupt(fiber);
export const catchUp = Effect.gen(function* () {
  const fiber = yield* startReactor;
  yield* pause(100);
  yield* stopReactor(fiber);
});

export const lifecycle = (id: string, kind: "stop" | "crash" | "reload-failed") => Effect.gen(function* () {
  const event = eventOf(kind === "stop" ? { _tag: "AgentStopped", agentId: id }
    : kind === "crash" ? { _tag: "AgentCrashed", agentId: id, exitCode: 1, signal: null, stderr: "Fixture exit." }
    : { _tag: "AgentReloadFailed", agentId: id, reason: "Fixture reload failed." });
  yield* appendSetup([event, ...targetGone(yield* snapshot, agentIdOf(id), kind === "stop" ? "stopped" : "crashed")]);
});
export const resumeHistory = (id: string) => change(
  { _tag: "StateChanged", agentId: id, state: { _tag: "starting" } },
  { _tag: "SessionOpened", agentId: id, session: { _tag: "acp", sessionId: `resumed-${id}` }, protocolVersion: 2, reloadable: true },
);
export const acceptWake = (id: string, target = "worker") => Effect.gen(function* () {
  yield* appendDelivery("DeliverySent", id, target);
  yield* appendDelivery("DeliveryAccepted", id, target);
});
export const end = (id = "worker", compact = false) => change(
  { _tag: "TurnEnded", agentId: id, compact },
  ...(compact ? [] : [{ _tag: "StateChanged", agentId: id, state: { _tag: "idle" } }]),
);
// The actual engine failed-send/failed-turn planner, with its real sender,
// acceptance correlation and idle transition. No hand-made return counters.
export const failWake = (id: string, target = "worker", capacity = false) => Effect.gen(function* () {
  const events = yield* promptReply(yield* snapshot, {
    _tag: "promptReply", agentId: agentIdOf(target), incarnation: yield* currentIncarnation(target), deliveryId: Schema.decodeUnknownSync(DeliveryId)(id),
    outcome: capacity ? { _tag: "capacity", error: "Fixture capacity error." } : { _tag: "error", error: "Fixture send error." },
  }, Effect.succeed);
  expect(events.some((event) => event._tag === "DeliveryReturned"), "Fixture must exercise the engine's failed path").toBe(true);
  yield* appendSetup(events);
});
export const pendingWake = (target = "worker") => Effect.gen(function* () {
  const rows = yield* eventually(queued(target), (pending) => pending.length === 1);
  expect(rows, `Expected one pending board wake for ${target}`).toHaveLength(1);
  return rows[0]!;
});
export const disposition = (id: string, target: string, want: string) => Effect.gen(function* () {
  const state = yield* eventually(boardState, (view) => view.posts[id]?.dispositions[target] === want);
  expect(state.posts[id]?.dispositions[target]).toBe(want);
  return state;
});
export const waitOpened = (members = ["worker"], blocking = false): Event => eventOf({
  _tag: "WaitOpened", agentId: "lead", waitId: "board-wait", members, mode: "all", blocking,
});
