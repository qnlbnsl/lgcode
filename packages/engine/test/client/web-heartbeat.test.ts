import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { connected, eventually, login, pause, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

for (const seconds of [25, 7]) {
  it(`5.9 heartbeat ${seconds}s: catches a missing heartbeat, an early heartbeat or ignoring the configured interval on either connection`, async () => withWeb((ctx) => Effect.gen(function* () {
    const { cookie } = yield* login(ctx);
    const stream = yield* connected(ctx, cookie); const read = yield* connected(ctx, cookie);
    let streamPings = 0; let readPings = 0;
    stream.on("ping", () => { streamPings++; }); read.on("ping", () => { readPings++; });
    yield* pause();
    yield* TestClock.adjust(seconds * 1000 - 1);
    yield* pause();
    expect([streamPings, readPings]).toEqual([0, 0]);
    yield* TestClock.adjust(1);
    yield* eventually(() => [streamPings, readPings], (pings) => pings.every((n) => n === 1), "each connection must receive its own heartbeat");
    yield* pause(); // Let the actual network deliver the automatic pong.
    yield* TestClock.adjust(seconds * 1000);
    yield* eventually(() => [streamPings, readPings], (pings) => pings.every((n) => n === 2), "heartbeats must repeat");
  }), { clock: true, settings: { heartbeatSeconds: seconds } }));
}
