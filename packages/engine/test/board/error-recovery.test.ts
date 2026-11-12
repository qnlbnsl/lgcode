import { waitForAgents, type Client } from "@lgtm/client";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { expect } from "vitest";
import { compareViews } from "../../src/views/compare.ts";
import { currentIncarnation, type FakeRunner } from "../support/fakeRunner.ts";
import { agentIdOf, call, headSequence, logAfter, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendWith } from "../support/routingRig.ts";
import { agent, boardState, eventsOf, postAs, snapshot, wakeFor } from "./wakeFixtures.ts";
import { acceptWake, catchUp, eventually, it, pause, pendingWake, reactorRig } from "./reactorFixtures.ts";

const { run, reopen, ownerClient } = reactorRig(() => registerRebuildCheck());
const failThroughRunner = (runner: FakeRunner, deliveryId: string) => Effect.gen(function* () {
  yield* runner.subscribed;
  const before = yield* headSequence;
  yield* runner.emit({ _tag: "promptReply", agentId: agentIdOf("worker"), incarnation: yield* currentIncarnation("worker"),
    deliveryId, outcome: { _tag: "error", error: "Ordinary accepted-turn failure." } });
  const rows = yield* eventually(logAfter(before), (rows) => rows.some((row) => row.event._tag === "DeliveryReturned" && row.event.deliveryId === deliveryId));
  const batch = appendWith(rows, (row) => row.event._tag === "DeliveryReturned" && row.event.deliveryId === deliveryId);
  expect(batch.map((row) => row.event._tag)).toContain("StateChanged");
  expect(batch.find((row) => row.event._tag === "StateChanged")?.event).toMatchObject({ agentId: "worker", state: { _tag: "idle" } });
  expect(batch.every((row) => row.requestId === batch[0]!.requestId)).toBe(true);
  return batch;
});

const boundary = (postId: string, waitId: string, phase: "original-error" | "reminder" | "reminder-error" | "no-answer") => Effect.gen(function* () {
  const live = yield* snapshot;
  const comparison = yield* compareViews();
  expect(comparison).toMatchObject({ sequence: live.sequence, differences: [] });
  const status = success(yield* call(ownerCredential, "board.status", { agentId: "worker" }));
  expect(status.sequence).toBe(live.sequence);
  expect(status.holdsUnsettled).toBe(phase !== "no-answer");
  expect(live.waits[waitId]?.status).toBe(phase === "no-answer" ? "satisfied" : "open");
  expect((live.board as any).posts[postId].dispositions.worker).toBe(phase === "no-answer" ? "no-answer" : undefined);
  return live;
});

for (const acknowledged of [false, true]) for (const mode of ["any", "all"] as const) {
  it.live(`accepted errors traverse the real runner handler and restart after each batch; ack=${acknowledged}, wait=${mode}`, () => Effect.gen(function* () {
    const initial = yield* run((c, runner) => Effect.gen(function* () {
      const postId = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
      const original = yield* pendingWake();
      yield* acceptWake(original.id);
      if (acknowledged) success(yield* call(c.worker!, "board.acknowledge", { postId }));
      const waitId = String(success(yield* call(c.lead!, "wait", { members: ["worker"], mode, block: false })).waitId);
      const client = yield* ownerClient();
      let complete = false;
      yield* waitForAgents(client, { members: ["worker"], mode }).pipe(Effect.tap(() => Effect.sync(() => { complete = true; })), Effect.forkScoped);
      yield* failThroughRunner(runner, original.id);
      yield* boundary(postId, waitId, "original-error");
      yield* pause(30);
      expect(complete).toBe(false);
      return { postId, waitId, credential: c.worker! };
    }));
    // Close the database immediately after the handler's complete error batch.
    yield* reopen((runner) => Effect.gen(function* () {
      yield* boundary(initial.postId, initial.waitId, "original-error");
      yield* catchUp;
      const reminder = yield* pendingWake();
      expect((yield* wakeFor(reminder.id)).reminders).toEqual([initial.postId]);
      yield* boundary(initial.postId, initial.waitId, "reminder");
      yield* acceptWake(reminder.id);
      if (acknowledged) success(yield* call(initial.credential, "board.acknowledge", { postId: initial.postId }));
      yield* failThroughRunner(runner, reminder.id);
      yield* boundary(initial.postId, initial.waitId, "reminder-error");
    }));
    yield* reopen(Effect.gen(function* () {
      yield* boundary(initial.postId, initial.waitId, "reminder-error");
      const client = yield* ownerClient();
      const stale = yield* client["board.status"]({ requestId: crypto.randomUUID() } as never);
      const release = yield* Deferred.make<void>();
      const reached = yield* Deferred.make<void>();
      let reads = 0;
      const offset = { ...client,
        "board.status": (input: Parameters<Client["board.status"]>[0]) => ++reads === 1 ? Effect.succeed(stale) : client["board.status"](input),
        subscribe: (input: Parameters<Client["subscribe"]>[0]) => client.subscribe(input).pipe(Stream.rechunk(1), Stream.mapEffect((row) =>
          row.event._tag === "board.AddresseeResolved" ? Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(row)) : Effect.succeed(row))),
      } as Client;
      let complete = false;
      const waiting = yield* waitForAgents(offset, { members: ["worker"], mode }).pipe(Effect.tap(() => Effect.sync(() => { complete = true; })), Effect.forkScoped);
      // Wait until the real helper has captured its snapshot and queried the
      // older lists, before the reactor commits a newer disposition batch.
      yield* eventually(Effect.sync(() => reads), (value) => value >= 1);
      expect(reads).toBeGreaterThanOrEqual(1);
      yield* catchUp;
      yield* Effect.raceFirst(Deferred.await(reached), Fiber.join(waiting).pipe(Effect.andThen(Effect.die(new Error("Owner wait completed before consuming the gated disposition."))))).pipe(Effect.timeout(4_000));
      yield* boundary(initial.postId, initial.waitId, "no-answer");
      expect(complete, "newer status must not let the helper skip a withheld stream disposition").toBe(false);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(waiting).pipe(Effect.timeout(4_000))).toEqual({ outcome: "satisfied", members: [{ agentId: "worker", reason: "settled" }] });
      expect(reads).toBeGreaterThan(1);
      const notice = yield* pendingWake("lead");
      expect((yield* wakeFor(notice.id)).noAnswers).toEqual([{ postId: initial.postId, addressee: agent("worker") }]);
      const rows = yield* readLog;
      expect(eventsOf(rows, "board.AddresseeResolved").filter((event) => event.postId === initial.postId && event.disposition === "no-answer")).toHaveLength(1);
      expect(eventsOf(rows, "board.WakeBuilt").filter((wake) => wake.reminders.includes(initial.postId as never))).toHaveLength(1);
      const before = yield* headSequence;
      yield* catchUp;
      expect(yield* logAfter(before)).toEqual([]);
      expect((yield* boardState).posts[initial.postId]?.status).toBe("open");
    }));
  }));
}
