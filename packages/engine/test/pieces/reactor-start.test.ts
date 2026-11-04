import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { expect, it } from "vitest";
import { Restart } from "../../src/recovery/service.ts";
import { fixtureLists, loadLists, withFixture } from "../support/fixturePiece.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it("1.36 a piece's configured reactor waits for recovery.whenReady and starts once after the gate opens", async () => {
  const base = fixtureLists(await loadLists());
  const ready = await Effect.runPromise(Deferred.make<void>());
  const entered = await Effect.runPromise(Deferred.make<void>());
  const waiting = await Effect.runPromise(Deferred.make<void>());
  let calls = 0;
  let finished = false;
  const reactor = Effect.sync(() => { calls++; }).pipe(
    Effect.andThen(Deferred.succeed(entered, undefined)), Effect.andThen(Effect.never),
    Effect.ensuring(Effect.sync(() => { finished = true; })),
  );
  const lists = { ...base, reactors: { ...base.reactors, client: reactor } };
  const recovery = Layer.succeed(Restart, {
    ready: Deferred.isDone(ready),
    whenReady: Deferred.succeed(waiting, undefined).pipe(Effect.andThen(Deferred.await(ready))),
    recover: Effect.void, returnAccount: () => Effect.void,
  });
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* Deferred.await(waiting).pipe(Effect.timeout(5_000));
    expect(calls).toBe(0);
    yield* Deferred.succeed(ready, undefined);
    yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    expect(calls).toBe(1);
    expect(finished).toBe(false);
  }), { recovery });
  expect(finished, "The reactor belongs to the service scope").toBe(true);
});

it("1.38 a reactor defect is logged without its message and the configured reactor is restarted", async () => {
  const base = fixtureLists(await loadLists());
  const restarted = await Effect.runPromise(Deferred.make<void>());
  const logs: string[] = [];
  const logger = Logger.layer([Logger.make((entry) => { logs.push(Logger.formatJson.log(entry)); })]);
  let calls = 0;
  const reactor = Effect.suspend(() => {
    calls++;
    return calls === 1 ? Effect.die(new Error("PRIVATE REACTOR EVENT TEXT"))
      : Deferred.succeed(restarted, undefined).pipe(Effect.andThen(Effect.never));
  });
  await withFixture({ ...base, reactors: { ...base.reactors, client: reactor } }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* Deferred.await(restarted).pipe(Effect.timeout(25_000));
    expect(calls).toBe(2);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain("PRIVATE REACTOR EVENT TEXT");
    expect(logs.some((line) => /error/i.test(line))).toBe(true);
  }), { logger });
});
