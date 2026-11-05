import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { capacityHoldCount } from "../../src/routing/deliveries.ts";
import { hold, runCapacity } from "../support/capacityRig.ts";
import { accept, notice, promptsTo, send, spawn, waitFor, waitRow } from "../support/deliveryRig.ts";
import { incarnationOf } from "../support/fakeRunner.ts";
import { agentCredential, agentRow, call, headSequence, logAfter, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { deliveryRow, eventually, snapshot, tagged } from "../support/routingRig.ts";

for (const releaseBy of ["owner", "holder"] as const) for (const retryAccepted of [false, true]) {
  it(`FR-016 ${releaseBy}, retry accepted=${retryAccepted}: an old attempt's end cannot end a same-ID capacity retry or reset its outage`, async () =>
    runCapacity((rig, runner) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const parent = yield* spawn(rig, runner);
      const target = yield* spawn(rig, runner, parent);
      const deliveryId = yield* send(runner, target, "Retry this work after capacity returns.");
      const oldSent = (yield* readLog).findLast(({ event }) => event._tag === "DeliverySent" && event.deliveryId === deliveryId)!;
      yield* hold(runner, target, deliveryId);
      success(yield* call(releaseBy === "owner" ? ownerCredential : agentCredential(parent.token), "release", { agentId: target.agentId }));
      const calls = yield* eventually(Effect.sync(() => promptsTo(runner, target)), (calls) => calls.length === 2);
      expect(calls.map(({ input }) => input.delivery.id)).toEqual([deliveryId, deliveryId]);
      expect((yield* deliveryRow(deliveryId))?.status).toBe("sent");
      const retrySent = (yield* readLog).findLast(({ event }) => event._tag === "DeliverySent" && event.deliveryId === deliveryId)!;
      expect(retrySent.sequence).toBeGreaterThan(oldSent.sequence);
      if (retryAccepted) yield* accept(runner, target, deliveryId);
      const waiting = success(yield* waitFor(parent, [target]));
      const before = yield* headSequence;
      const identity = { agentId: target.agentId, incarnation: incarnationOf(target.token), deliveryId };
      yield* runner.emitRaw({ _tag: "turnEnded", ...identity, sentSequence: oldSent.sequence, usage: { inputTokens: 99 } });
      // The consumer is sequential. This later, durable mode event proves it
      // has consumed the old end, without relying on a scheduling delay.
      yield* runner.emitRaw({ _tag: "modeReported", agentId: target.agentId, incarnation: identity.incarnation,
        mode: "edit", level: "edit", ceiling: "full" });
      const rows = yield* eventually(logAfter(before), (rows) => tagged(rows, "ModeChanged").length === 1);
      expect(tagged(rows, "ModeChanged")).toHaveLength(1);
      expect(tagged(rows, "TurnEnded")).toEqual([]);
      expect((yield* agentRow(target.agentId))?.state._tag).toBe("working");
      expect(capacityHoldCount(yield* snapshot, target.agentId)).toBe(1);
      expect((yield* waitRow(String(waiting.waitId)))?.status).toBe("open");
      yield* notice(runner, target, { _tag: "promptReply", deliveryId, outcome: { _tag: "success" } });
      expect((yield* eventually(deliveryRow(deliveryId), (row) => row?.status === "accepted"))?.status).toBe("accepted");
      yield* runner.emitRaw({ _tag: "turnEnded", ...identity, sentSequence: retrySent.sequence, usage: { inputTokens: 7 } });
      expect((yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "idle"))?.state._tag).toBe("idle");
      expect(capacityHoldCount(yield* snapshot, target.agentId)).toBe(0);
      expect((yield* eventually(waitRow(String(waiting.waitId)), (row) => row?.status === "satisfied"))?.status).toBe("satisfied");
      expect(tagged(yield* logAfter(before), "TurnEnded")).toEqual([
        { _tag: "TurnEnded", agentId: target.agentId, compact: false, usage: { inputTokens: 7 } },
      ]);
    })));
}
