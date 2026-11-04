import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import type { EventEnvelope } from "@shephrd/contracts";
import { expect, it } from "vitest";
import * as Server from "../../src/api/server.ts";
import { appendSetup, eventOf, makeFakeSecrets, makeRig, provideRig, removeRig, seedAgent } from "../support/handlerRig.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import { connect } from "../support/socketClient.ts";
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
