import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, it } from "vitest";
import { Restart } from "../../src/recovery/service.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { http, login, post, upgrade, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

it("5.14 recovery gate: catches serving a command or stream, or returning 401 before recovery is ready", async () => {
  let ready = false;
  const gate = Deferred.makeUnsafe<void>();
  const recovery = Layer.succeed(Restart, {
    ready: Effect.sync(() => ready), whenReady: Deferred.await(gate), recover: Effect.void, returnAccount: () => Effect.void,
  });
  await withWeb((ctx) => Effect.gen(function* () {
    const { cookie } = yield* Effect.gen(function* () {
      // Obtain a real cookie, then close the recovery gate. This is a test
      // double for recovery only; authentication and the listener stay real.
      ready = true; return yield* login(ctx);
    });
    ready = false;
    for (const headers of [{}, { Cookie: cookie }]) {
      for (const path of ["/api", "/api/session", "/api/logout", "/api/login"]) {
        expect((yield* Effect.promise(() => post(ctx, path, { password: ctx.password }, headers))).status).toBe(503);
      }
      expect((yield* upgrade(ctx, headers)).status).toBe(503);
    }
    ready = true; yield* Deferred.succeed(gate, undefined);
    expect((yield* Effect.promise(() => http(ctx, "/api/session", { method: "POST", headers: { Cookie: cookie } }))).status).toBe(204);
  }), { recovery });
});
