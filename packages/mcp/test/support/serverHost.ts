// Keep the process alive after runMcp closes its layer: an operating-system
// process exit must not conceal a leaked client scope in the shutdown test.
import * as Effect from "effect/Effect";
import { realClock, runMcp } from "../../src/index.ts";

if (process.env.SHEPRD_TEST_FAST_RECOVERY_CLOCK === "1") {
  let now = 0;
  Object.assign(realClock, {
    now: () => now,
    sleep: async (milliseconds: number) => {
      now += milliseconds;
      process.stderr.write(`${JSON.stringify({ testRecoveryClock: now, slept: milliseconds })}\n`);
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  });
}

const code = await Effect.runPromise(runMcp({ environment: process.env }));
process.stdout.write(`${JSON.stringify({ testHost: "server-layer-stopped", code })}\n`);
setInterval(() => {}, 1_000);
