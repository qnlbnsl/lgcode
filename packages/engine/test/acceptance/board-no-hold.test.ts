import { randomBytes } from "node:crypto";
import { join } from "node:path";

import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { it } from "@effect/vitest";
import { settled } from "@lgtm/contracts";
import { waitForAgents } from "@lgtm/client";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as Socket from "effect/socket/Socket";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { connectWith } from "../../../client/src/core.ts";
import { serve } from "../../src/api/server.ts";
import { compareViews } from "../../src/views/compare.ts";
import { agentIdOf, call, freshRequest, headSequence, logAfter, makeRig, ownerCredential, removeRig, success, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { pause } from "../support/routingRig.ts";
import { ancestryHeaders, authorization, socketUrl } from "../support/socketClient.ts";
import { boardState, change, postAs, provideBoard, queued, seedBoard, snapshot } from "../board/wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

const ownerWait = () => Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url");
  const socketPath = join(rig.stateFolder, "no-hold.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: false });
  const client = yield* connectWith({ attempts: 1, makeSocket: () => Socket.makeWebSocket(socketUrl(socketPath), {
    headers: { ...authorization(bearer), ...ancestryHeaders() },
  }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) });
  let completed = false;
  const waiting = yield* waitForAgents(client, { members: ["worker"], mode: "all" }).pipe(
    Effect.tap(() => Effect.sync(() => { completed = true; })), Effect.forkChild,
  );
  const boundary = (waitId: string) => Effect.gen(function* () {
    yield* pause(40);
    const live = yield* snapshot;
    expect((yield* compareViews()).differences).toEqual([]);
    const published = yield* client["client.snapshot"]({ requestId: freshRequest() });
    expect(published.sequence).toBe(live.sequence);
    expect(published.agents.find((row) => row.agentId === "worker")).toHaveProperty("capacityHeld", false);
    expect(settled(live, "worker")).toBe(false);
    expect(live.waits[waitId]?.status).toBe("open");
    expect(completed).toBe(false);
  });
  return { waiting, boundary };
});

// The held case lives in board-capacity-hold.test.ts. This control uses the
// real board planners, including their choice of which wake to replace.
// Automatic delivery is parked so each committed queue boundary is observable.
for (const state of ["idle", "working"] as const) {
  it.live(`6.7 no-hold control: replacement survives reopening, and withdrawing the last wake settles an agent recorded as ${state} and both waits`, () => Effect.gen(function* () {
    const beforeClose = yield* provideBoard(rig, Effect.gen(function* () {
      yield* registerRebuildCheck();
      const credentials = yield* seedBoard();
      const firstPost = yield* postAs(credentials.lead!);
      const first = (yield* queued("worker"))[0]!;
      const secondPost = yield* postAs(credentials.lead!);
      const combined = (yield* queued("worker"))[0]!;
      expect(combined.id).not.toBe(first.id);
      expect((yield* snapshot).deliveries[first.id]?.status).toBe("withdrawn");
      // Recovery records a loaded session as working before sending its next
      // delivery. There has been no DeliverySent in this loaded turn.
      if (state === "working") yield* change({ _tag: "StateChanged", agentId: "worker", state: { _tag: "working" } });
      const wait = success(yield* call(credentials.lead!, "wait", { members: ["worker"], mode: "all", block: false }));
      const waitId = String(wait.waitId);
      const owner = yield* ownerWait();
      yield* owner.boundary(waitId);
      success(yield* call(ownerCredential, "board.close", { postId: firstPost }));
      const replacement = (yield* queued("worker"))[0]!;
      expect(replacement.id).not.toBe(combined.id);
      expect((yield* snapshot).deliveries[combined.id]?.status).toBe("withdrawn");
      yield* owner.boundary(waitId);
      return { secondPost, waitId, deliveryId: replacement.id };
    }));

    // Close and reopen the database and all views. No view or queue is copied
    // between the two instances.
    yield* provideBoard(rig, Effect.gen(function* () {
      yield* registerRebuildCheck();
      const owner = yield* ownerWait();
      expect((yield* queued("worker")).map((row) => row.id)).toEqual([beforeClose.deliveryId]);
      expect((yield* snapshot).agents.worker?.state._tag).toBe(state);
      yield* owner.boundary(beforeClose.waitId);
      const before = yield* headSequence;
      success(yield* call(ownerCredential, "board.close", { postId: beforeClose.secondPost }));
      expect(yield* queued("worker")).toEqual([]);
      const live = yield* snapshot;
      expect(live.agents.worker?.state._tag).toBe("idle");
      expect(settled(live, "worker")).toBe(true);
      expect(live.waits[beforeClose.waitId]).toMatchObject({ status: "satisfied", resolved: [{ agentId: "worker", reason: "settled" }] });
      expect(yield* Fiber.join(owner.waiting).pipe(Effect.timeout(5_000))).toEqual({ outcome: "satisfied", members: [{ agentId: "worker", reason: "settled" }] });
      expect((yield* boardState).posts[beforeClose.secondPost]?.status).toBe("closed");
      const committed = yield* logAfter(before);
      expect(committed.some((row) => row.event._tag === "DeliveryWithdrawn" && row.event.deliveryId === beforeClose.deliveryId)).toBe(true);
      expect(committed.some((row) => row.event._tag === "WaitSatisfied" && row.event.waitId === beforeClose.waitId)).toBe(true);
      expect(committed.some((row) => row.event._tag === "DeliverySent" && row.event.agentId === agentIdOf("worker"))).toBe(false);
      expect((yield* compareViews()).differences).toEqual([]);
    }));
  }).pipe(Effect.orDie), 30_000);
}
