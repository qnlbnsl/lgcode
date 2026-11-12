import { join } from "node:path";
import type { EventEnvelope } from "@lgtm/contracts";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { Runner } from "../../src/runner/Runner.ts";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { serve } from "../../src/api/server.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { Views } from "../../src/views/Views.ts";
import { agentIdOf, freshRequest, makeRig, readLog, removeRig, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { connect } from "../support/socketClient.ts";
import { eventually } from "../support/routingRig.ts";
import { agent, provideBoard, queued, seedBoard, snapshot } from "../board/wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRig(rig); });

for (const boundary of ["queue", "send"] as const) for (const removalFirst of [true, false]) {
  it.live(`6.3 repeated concurrent group removal at ${boundary}, removalFirst=${removalFirst}, respects writer reservation order`, () => {
    let beforeTransaction: Effect.Effect<void> = Effect.void;
    return provideBoard(rig, (runner) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedBoard();
      const socket = join(rig.stateFolder, "races.sock");
      const bearer = "membership-race-owner-fixture";
      yield* serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false });
      const owner = yield* connect(socket, bearer);
      const log = yield* EventLog;
      const views = yield* Views;
      const worker = agentIdOf("worker");
      for (let iteration = 0; iteration < 6; iteration++) {
        const label = `review-${boundary}-${removalFirst}-${iteration}`;
        yield* owner.group({ requestId: freshRequest(), agentId: worker, add: [label], remove: [] });
        const { channelId } = yield* owner["board.open"]({ requestId: freshRequest(), name: label, group: label, anchorAgentId: agentIdOf("lead") });
        const post = owner["board.post"]({ requestId: freshRequest(), channelId, to: [agent("worker")] as never, reply: "all", text: `Race ${iteration}.` });
        const remove = owner.group({ requestId: freshRequest(), agentId: worker, add: [], remove: [label] }).pipe(Effect.asVoid, Effect.mapError((error): unknown => error));
        let deliveryId: string | undefined;
        if (boundary === "send") {
          yield* post;
          deliveryId = (yield* queued("worker"))[0]!.id;
        }
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const contending = yield* Deferred.make<void>();
        let held = false;
        const originalApply = views.applyCommitted;
        const originalTransact = log.transact;
        beforeTransaction = Effect.suspend(() => held ? Deferred.succeed(contending, undefined).pipe(Effect.asVoid) : Effect.void);
        const matches = (rows: ReadonlyArray<EventEnvelope>) => rows.some((row) => removalFirst
          ? row.event._tag === "AgentGrouped" && row.agentId === worker
          : boundary === "queue" ? row.event._tag === "DeliveryQueued" && row.event.delivery.target === worker
          : row.event._tag === "DeliverySent" && row.agentId === worker);
        const publication = vi.spyOn(views, "applyCommitted").mockImplementation((rows) => Effect.suspend(() => !held && matches(rows) ? Effect.gen(function* () {
            held = true;
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }) : Effect.void).pipe(Effect.andThen(originalApply(rows))));
        const transactions = vi.spyOn(log, "transact").mockImplementation((use) => Effect.suspend(() =>
          (held ? Deferred.succeed(contending, undefined) : Effect.void).pipe(Effect.andThen(originalTransact(use)))));
        const action: Effect.Effect<void, unknown, EventLog | Views | Runner | SqlClient.SqlClient> = boundary === "queue" ? post.pipe(Effect.asVoid) : dispatchQueued(worker);
        yield* Effect.gen(function* () {
          const first = yield* (removalFirst ? remove : action).pipe(Effect.result, Effect.forkChild);
          yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
          const second = yield* (removalFirst ? action : remove).pipe(Effect.result, Effect.forkChild);
          // This is an attempted production writer acquisition while the first
          // writer still owns its permit, not two sequential test operations.
          yield* Deferred.await(contending).pipe(Effect.timeout(5_000));
          yield* Deferred.succeed(release, undefined);
          expect((yield* Fiber.join(first))._tag).toBe("Success");
          const secondResult = yield* Fiber.join(second);
          expect(secondResult._tag).toBe(boundary === "queue" && removalFirst ? "Failure" : "Success");
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.ensuring(Effect.sync(() => {
          transactions.mockRestore(); publication.mockRestore(); beforeTransaction = Effect.void;
        })));
        const state = yield* snapshot;
        if (boundary === "queue") {
          const wakes = yield* queued("worker");
          if (removalFirst) expect(wakes).toEqual([]);
          else {
            expect(wakes).toHaveLength(1);
            deliveryId = wakes[0]!.id;
            yield* dispatchQueued(worker);
          }
        }
        if (deliveryId !== undefined) {
          const permitted = boundary === "send" && !removalFirst;
          expect((yield* snapshot).deliveries[deliveryId]?.status).toBe(permitted ? "sent" : "withdrawn");
          expect(runner.callsOf("prompt").filter((row) => row.input.delivery.id === deliveryId)).toHaveLength(permitted ? 1 : 0);
          if (permitted) {
            const sent = runner.callsOf("prompt").find((row) => row.input.delivery.id === deliveryId)!.input;
            yield* runner.emit({ _tag: "turnEnded", agentId: worker, incarnation: sent.incarnation,
              deliveryId: sent.delivery.id, sentSequence: sent.sentSequence });
            // The real ingress commits before this member can accept the next
            // iteration's queue. Poll only the named state, never a quiet delay.
            yield* eventually(snapshot, (view) => view.agents.worker?.state._tag === "idle");
          }
        }
        expect(state.agents.worker?.groups).not.toContain(label);
      }
      const history = yield* readLog;
      const withdrawn = new Set(history.flatMap((row) => row.event._tag === "DeliveryWithdrawn" ? [row.event.deliveryId] : []));
      expect(runner.callsOf("prompt").filter((row) => withdrawn.has(row.input.delivery.id))).toEqual([]);
      expect(runner.callsOf("prompt")).toHaveLength(boundary === "send" && !removalFirst ? 6 : 0);
    }), [], {}, Effect.suspend(() => beforeTransaction)).pipe(Effect.orDie);
  }, 60_000);
}
