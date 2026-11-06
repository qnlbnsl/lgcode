import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import type { EventEnvelope } from "@sheprd/contracts";
import { expect, it } from "vitest";
import * as Server from "../../src/api/server.ts";
import { appendSetup, eventOf, makeFakeSecrets, makeRig, provideRig, removeRig, seedAgent, headSequence, readLog } from "../support/handlerRig.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import { connect } from "../support/socketClient.ts";
import { Views } from "../../src/views/Views.ts";
import { eventually } from "../support/routingRig.ts";
import { currentVisibilityOracle } from "../support/currentVisibilityOracle.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const marker = (id: string, agentId = "root") => eventOf({ _tag: "ThreadItem", agentId, itemId: id, content: { _tag: "text", text: "Marker." }, replay: false });

it.each(["catch-up", "live"])("1.28 %s socket visibility gains the worker while its lead is unavailable and ends that read on recovery", async (mode) => {
  const rig = makeRig();
  const bearer = randomBytes(32).toString("base64url");
  try {
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner();
      return yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
        yield* registerRebuildCheck();
        const root = yield* seedAgent({ id: "root" });
        yield* seedAgent({ id: "lead", parent: "root" });
        yield* seedAgent({ id: "worker", parent: "lead" });
        const socket = join(rig.stateFolder, "engine.sock");
        yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false });
        const collect = (round: string, state: "paused" | "idle", after: number) => Effect.scoped(Effect.gen(function* () {
          yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: "lead", state: state === "paused" ? { _tag: state, reason: "limit", midTurn: false } : { _tag: state } })]);
          const plant = appendSetup([marker(`worker-${round}`, "worker"), marker(`end-${round}`)]);
          if (mode === "catch-up") yield* plant;
          const client = yield* connect(socket, root.token);
          const stream = client.subscribe({ requestId: `subscribe-${round}`, after } as never) as Stream.Stream<EventEnvelope, unknown>;
          const ready = yield* Deferred.make<void>();
          const fiber = yield* stream.pipe(
            Stream.tap((row) => row.event._tag === "ThreadItem" && row.event.itemId === `ready-${round}` ? Deferred.succeed(ready, undefined) : Effect.void),
            Stream.takeUntil((row) => row.event._tag === "ThreadItem" && row.event.itemId === `end-${round}`), Stream.runCollect, Effect.timeout(10_000), Effect.forkScoped,
          );
          if (mode === "live") {
            yield* appendSetup([marker(`ready-${round}`)]);
            yield* Deferred.await(ready);
            yield* plant;
          }
          return yield* Fiber.join(fiber);
        }));
        const unavailable = yield* collect("paused", "paused", 0);
        expect(unavailable.some((row) => row.event._tag === "ThreadItem" && row.event.itemId === "worker-paused")).toBe(true);
        const recovered = yield* collect("recovered", "idle", unavailable.at(-1)!.sequence);
        expect(recovered.some((row) => row.event._tag === "ThreadItem" && row.event.itemId === "worker-recovered")).toBe(false);
        expect(recovered.at(-1)!.event).toMatchObject({ _tag: "ThreadItem", itemId: "end-recovered" });
      }));
    });
    await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);
  } finally { removeRig(rig); }
});

for (const surface of ["subscribe", "client.subscribe"] as const) it(`${surface} changes visibility on one open socket through pause, crash and recovery, then replays with recovered rights`, async () => {
  const rig = makeRig();
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const runner = yield* makeFakeRunner();
      return yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
        yield* registerRebuildCheck();
        const root = yield* seedAgent({ id: "root" });
        yield* seedAgent({ id: "lead", parent: "root" });
        yield* seedAgent({ id: "worker", parent: "lead" });
        yield* seedAgent({ id: "stranger" });
        const socket = join(rig.stateFolder, "temporal.sock");
        yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(randomBytes(32).toString("base64url")), debug: false });
        const after = yield* headSequence;
        const client = yield* connect(socket, root.token) as Effect.Effect<any, any, any>;
        const rows: EventEnvelope[] = [];
        const seen = new Set<string>();
        const fiber = yield* (client[surface]({ requestId: "temporal", after }) as Stream.Stream<EventEnvelope, any>).pipe(
          Stream.tap((row) => Effect.sync(() => { rows.push(row); if (row.event._tag === "ThreadItem") seen.add(row.event.itemId); })),
          Stream.runDrain, Effect.forkScoped,
        );
        const barrier = (name: string) => Effect.gen(function* () {
          yield* appendSetup([marker(name)]);
          yield* eventually(Effect.sync(() => seen.has(name)), Boolean).pipe(Effect.tap((found) => Effect.sync(() => expect(found).toBe(true))));
        });
        yield* barrier("ready");
        const phases = ["idle", "paused", "recovered", "crashed", "restarted"] as const;
        for (const phase of phases) {
          const start = rows.length;
          if (phase === "paused") yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: "lead", state: { _tag: "paused", reason: "limit", midTurn: false } })]);
          if (phase === "recovered") yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: "lead", state: { _tag: "idle" } })]);
          if (phase === "crashed") yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "lead", exitCode: 1, signal: null, stderr: "Fixture." })]);
          if (phase === "restarted") yield* appendSetup([
            eventOf({ _tag: "StateChanged", agentId: "lead", state: { _tag: "starting" } }),
            eventOf({ _tag: "SessionOpened", agentId: "lead", session: { _tag: "acp", sessionId: "restarted" }, protocolVersion: 2, reloadable: true }),
          ]);
          const batch = yield* appendSetup([marker(`worker-${phase}`, "worker"), marker(`lead-${phase}`, "lead"), marker(`stranger-${phase}`, "stranger")]);
          const current = yield* (yield* Views).snapshot;
          yield* barrier(`end-${phase}`);
          const delivered = rows.slice(start);
          expect(delivered.filter((row) => batch.some((source) => source.sequence === row.sequence)).map((row) => row.sequence))
            .toEqual(batch.filter((row) => currentVisibilityOracle(root.agentId, row, current)).map((row) => row.sequence));
          expect(delivered.some((row) => row.event._tag === "ThreadItem" && row.event.itemId === `worker-${phase}`)).toBe(phase === "paused" || phase === "crashed");
          expect(delivered.some((row) => row.event._tag === "ThreadItem" && row.event.itemId === `lead-${phase}`)).toBe(true);
        }
        yield* Fiber.interrupt(fiber);
        const replay = yield* (client[surface]({ requestId: "recovered-replay", after }) as Stream.Stream<EventEnvelope, any>).pipe(
          Stream.takeUntil((row) => row.event._tag === "ThreadItem" && row.event.itemId === "end-restarted"), Stream.runCollect, Effect.timeout(4_000));
        const current = yield* (yield* Views).snapshot;
        const all = (yield* readLog).filter((row) => row.sequence > after);
        expect(replay.map((row) => row.sequence)).toEqual(all.filter((row) => currentVisibilityOracle(root.agentId, row, current)).map((row) => row.sequence));
        expect(replay.some((row) => row.agentId === "worker")).toBe(false);
        expect(replay.some((row) => row.agentId === "lead")).toBe(true);
      }));
    }) as Effect.Effect<unknown, unknown>);
  } finally { removeRig(rig); }
});
