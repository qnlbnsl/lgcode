import { waitForAgents, type Client } from "@shephrd/client";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { expect } from "vitest";
import { compareViews } from "../../src/views/compare.ts";
import { currentIncarnation } from "../support/fakeRunner.ts";
import { agentIdOf, call, ownerCredential, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { acceptWake, catchUp, eventually, it, pendingWake, reactorRig } from "./reactorFixtures.ts";
import { postAs, snapshot } from "./wakeFixtures.ts";

const { run, ownerClient } = reactorRig(() => registerRebuildCheck());
for (const mode of ["any", "all"] as const) {
  it.live(`owner ${mode} wait applies both real turn endings through the newer no-answer status sequence`, () => run((c, runner) => Effect.gen(function* () {
    const postId = yield* postAs(c.lead!);
    yield* acceptWake((yield* pendingWake()).id);
    const waitId = String(success(yield* call(c.lead!, "wait", { members: ["worker"], mode, block: false })).waitId);
    const client = yield* ownerClient();
    const stale = yield* client["client.snapshot"]({ requestId: crypto.randomUUID() } as never);
    yield* runner.subscribed;
    for (let turn = 0; turn < 2; turn++) {
      yield* runner.emit({ _tag: "turnEnded", agentId: agentIdOf("worker"), incarnation: yield* currentIncarnation("worker") });
      expect((yield* eventually(snapshot, (state) => state.agents.worker?.state._tag === "idle")).agents.worker?.state._tag).toBe("idle");
      if (turn === 0) {
        expect((yield* snapshot).waits[waitId]?.status).toBe("open");
        expect(success(yield* call(ownerCredential, "board.status", { agentId: "worker" })).holdsUnsettled).toBe(true);
        yield* catchUp;
        yield* acceptWake((yield* pendingWake()).id);
      }
    }
    expect((yield* snapshot).waits[waitId]?.status).toBe("open");
    yield* catchUp;
    const status = yield* client["board.status"]({ requestId: crypto.randomUUID() } as never);
    if (!("holdsUnsettled" in status) || !Array.isArray(status.holdsUnsettled)) return yield* Effect.die(new Error("Expected aggregate board status condition lists."));
    expect(status.sequence).toBeGreaterThan(stale.sequence);
    expect(status.holdsUnsettled).not.toContain("worker");
    expect((yield* snapshot).waits[waitId]?.status).toBe("satisfied");
    const reached = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const turnEnds: number[] = [];
    const offset = { ...client,
      "client.snapshot": () => Effect.succeed(stale),
      subscribe: (input: Parameters<Client["subscribe"]>[0]) => client.subscribe(input).pipe(Stream.rechunk(1), Stream.mapEffect((row) => Effect.gen(function* () {
        if (row.event._tag === "TurnEnded" && row.agentId === "worker") turnEnds.push(row.sequence);
        if (row.event._tag === "board.AddresseeResolved" && row.event.postId === postId) {
          yield* Deferred.succeed(reached, undefined);
          yield* Deferred.await(release);
        }
        return row;
      }))),
    } as Client;
    let complete = false;
    const waiting = yield* waitForAgents(offset, { members: ["worker"], mode }).pipe(
      Effect.tap(() => Effect.sync(() => { complete = true; })), Effect.forkScoped);
    yield* Effect.raceFirst(Deferred.await(reached), Fiber.join(waiting).pipe(Effect.andThen(Effect.die(new Error("Owner wait completed before consuming the gated disposition."))))).pipe(Effect.timeout(4_000));
    expect(turnEnds).toHaveLength(2);
    expect(complete, "fresh cleared holds cannot bypass the older stream's disposition").toBe(false);
    yield* Deferred.succeed(release, undefined);
    expect(yield* Fiber.join(waiting).pipe(Effect.timeout(4_000))).toEqual({ outcome: "satisfied", members: [{ agentId: "worker", reason: "settled" }] });
    expect((yield* compareViews()).differences).toEqual([]);
  })));
}
