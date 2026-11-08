import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { settled, type AgentId } from "@lgcode/contracts";
import { waitForAgents } from "@lgcode/client";
import { connectWith } from "../../../client/src/core.ts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as Socket from "effect/socket/Socket";
import { expect, it } from "vitest";
import { serve } from "../../src/api/server.ts";
import { writePieceBatch } from "../../src/commands/pieceBatch.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { compareViews } from "../../src/views/compare.ts";
import { hold, eventsNamed, runCapacity } from "../support/capacityRig.ts";
import { promptsTo, spawn, waitFor, waitRow } from "../support/deliveryRig.ts";
import { makeFakeRunner, type FakeRunner } from "../support/fakeRunner.ts";
import { agentRow, eventOf, freshRequest, headSequence, logAfter, success, type Rig } from "../support/handlerRig.ts";
import { deliveryRow, eventually, pause, snapshot } from "../support/routingRig.ts";
import { provideRestart, recover } from "../support/restartRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ancestryHeaders, authorization, socketUrl } from "../support/socketClient.ts";

// Board unit 5 is not present at this base. Drive the board's actual piece
// delivery/withdrawal boundary, keeping validation, transactions, dispatch,
// restart, the socket, and both wait implementations real. Only membership
// policy is supplied. The later board unit owns how it chooses these batches.
const lists = { ...engineLists, reach: { ...engineLists.reach, board: () => true } };
const queueWake = (target: AgentId, sourceId: string, withdraw?: string) => Effect.gen(function* () {
  const before = yield* headSequence;
  yield* writePieceBatch({ namespace: "board", kind: "reactor", sourceSequence: before, build: () => ({
    events: [
      ...(withdraw === undefined ? [] : [eventOf({ _tag: "DeliveryWithdrawn", agentId: target, deliveryId: withdraw, reason: "wake replaced" })]),
      eventOf({ _tag: "board.WakeBuilt", wakeId: sourceId, targetAgentId: target, carried: [], mustReply: [], completions: [], completionReplyText: [], reminders: [], noAnswers: [] }),
    ],
    deliveries: [{ target, sourceId, body: "Board wake data." }],
  }) }, lists);
  const rows = yield* logAfter(before);
  const queued = rows.flatMap(({ event }) => event._tag === "DeliveryQueued" && event.delivery.source?._tag === "piece" && event.delivery.source.id === sourceId ? [event.delivery.id] : []);
  expect(queued).toHaveLength(1);
  return queued[0]!;
});

const ownerWait = (rig: Rig, target: AgentId) => Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url");
  const socketPath = join(rig.stateFolder, "hold.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: false, lists });
  const client = yield* connectWith({ attempts: 1, makeSocket: () => Socket.makeWebSocket(socketUrl(socketPath), {
    headers: { ...authorization(bearer), ...ancestryHeaders() },
  }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) });
  let completed = false;
  const waiting = yield* waitForAgents(client, { members: [target], mode: "all" }).pipe(
    Effect.tap(() => Effect.sync(() => { completed = true; })), Effect.forkChild,
  );
  const boundary = (waitId: string) => Effect.gen(function* () {
    yield* pause(40);
    const live = yield* snapshot;
    expect((yield* compareViews()).differences).toEqual([]);
    const reply = yield* client["client.snapshot"]({ requestId: freshRequest() });
    expect(reply.sequence).toBe(live.sequence);
    expect(reply.agents.find((row) => row.agentId === target)).toHaveProperty("capacityHeld", true);
    expect(settled(live, target)).toBe(false);
    expect((yield* waitRow(waitId))?.status).toBe("open");
    expect(completed).toBe(false);
  });
  return { client, waiting, boundary };
});

it("BH01 criterion 6.7 catches replacement or last-wake withdrawal bypassing a hold across restart, or the engine and owner waits disagreeing at a committed boundary", async () => {
  await runCapacity((rig, runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const parent = yield* spawn(rig, runner);
    const target = yield* spawn(rig, runner, parent);
    const original = yield* queueWake(target.agentId, "first-wake");
    expect((yield* eventually(deliveryRow(original), (row) => row?.status === "sent"))?.status).toBe("sent");
    yield* hold(runner, target, original);
    const engineWait = success(yield* waitFor(parent, [target], "all", false));
    const waitId = String(engineWait.waitId);
    const owner = yield* ownerWait(rig, target.agentId);
    yield* owner.boundary(waitId);
    const replacement = yield* queueWake(target.agentId, "replacement-before-restart", original);
    yield* owner.boundary(waitId);
    expect((yield* deliveryRow(original))?.status).toBe("withdrawn");
    expect((yield* deliveryRow(replacement))?.status).toBe("queued");
    expect(promptsTo(runner, target)).toHaveLength(1);
    return { target, waitId, replacement };
  }), () => true, { lists, afterClose: (rig, old) => Effect.gen(function* () {
    const runner: FakeRunner = yield* makeFakeRunner();
    yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* recover;
      expect((yield* agentRow(old.target.agentId))?.state._tag).toBe("idle");
      const owner = yield* ownerWait(rig, old.target.agentId);
      yield* owner.boundary(old.waitId);
      const last = yield* queueWake(old.target.agentId, "replacement-after-restart", old.replacement);
      yield* owner.boundary(old.waitId);
      const before = yield* headSequence;
      yield* writePieceBatch({ namespace: "board", kind: "reactor", sourceSequence: before, build: () => ({ events: [eventOf({
        _tag: "DeliveryWithdrawn", agentId: old.target.agentId, deliveryId: last, reason: "last wake withdrawn",
      })] }) }, lists);
      yield* owner.boundary(old.waitId);
      expect((yield* snapshot).agents[old.target.agentId]?.state._tag).toBe("idle");
      expect(promptsTo(runner, old.target)).toHaveLength(0);
      const releasedAt = yield* headSequence;
      const release = (owner.client as unknown as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>).release;
      expect(release, "release must be callable over the same authenticated client API").toBeTypeOf("function");
      yield* release!({ requestId: freshRequest(), agentId: old.target.agentId });
      expect(yield* Fiber.join(owner.waiting).pipe(Effect.timeout(4_000))).toEqual({ outcome: "satisfied", members: [{ agentId: old.target.agentId, reason: "settled" }] });
      expect((yield* waitRow(old.waitId))?.status).toBe("satisfied");
      const rows = yield* logAfter(releasedAt);
      expect(eventsNamed(rows, "DeliveryReleased")).toHaveLength(1);
      expect(eventsNamed(rows, "DeliverySent").filter((event) => event.agentId === old.target.agentId)).toEqual([]);
      expect((yield* compareViews()).differences).toEqual([]);
    }), { lists, capacityHoldCondition: () => true });
  }) });
}, 30_000);
