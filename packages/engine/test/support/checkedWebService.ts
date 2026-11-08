import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { expect } from "vitest";
import { compareViews, ownerClient, startService, type ServiceProcess, type ServiceRoot } from "./serviceProcess.ts";

export interface CheckedWebService extends ServiceProcess {
  readonly stop: Effect.Effect<void, unknown>;
}

// Compare this process's live views before its database closes. Every setup
// and restart gets its own finalizer, including when a test assertion fails.
export const startCheckedWebService = (root: ServiceRoot, env: Record<string, string | undefined> = {}) => Effect.gen(function* () {
  const service = startService(root, { env: { ...env, LGCODE_TEST_DEBUG: "1" } });
  let stopped = false;
  const stop = Effect.suspend(() => {
    if (stopped) return Effect.void;
    stopped = true;
    return Effect.scoped(Effect.gen(function* () {
      const owner = yield* ownerClient(root);
      const result = yield* compareViews(owner);
      expect(Exit.isSuccess(result), "the live child must answer its rebuild comparison").toBe(true);
      if (Exit.isSuccess(result)) {
        // Do not print live values: a difference could contain a secret.
        expect(result.value.equal && result.value.differences.length === 0,
          "the live child's views differ from its durable log").toBe(true);
      }
    })).pipe(Effect.ensuring(Effect.promise(async () => {
      if (!service.exited()) service.child.kill("SIGTERM");
      await service.exit;
    })));
  });
  yield* Effect.addFinalizer(() => stop);
  return { ...service, stop } satisfies CheckedWebService;
});
