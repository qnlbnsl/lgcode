import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { call, freshRequest, ownerCredential, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { connected, eventually, login, pause, readSettings, rpc, setSettings, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

it("a web settings command can disable its own request scope and the terminal can restore the listener", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx);
  const socket = yield* connected(ctx, cookie);
  yield* rpc(socket, "client.web.settings.set", { requestId: freshRequest(), settings: { ...ctx.settings, enabled: false } }).pipe(Effect.result, Effect.forkScoped);
  yield* eventually(() => socket.readyState, (state) => state === 3, "the web command did not close its own connection");
  expect(yield* readSettings).toMatchObject({ enabled: false, serverState: "off" });
  yield* setSettings(ctx.settings);
  yield* login(ctx);
})));

it("a replayed settings receipt leaves connections accepted after the original change open", async () => withWeb((ctx) => Effect.gen(function* () {
  const payload = { requestId: freshRequest(), settings: { ...ctx.settings, heartbeatSeconds: 17 } };
  success(yield* call(ownerCredential, "client.web.settings.set", payload));
  const { cookie } = yield* login(ctx);
  const socket = yield* connected(ctx, cookie);
  success(yield* call(ownerCredential, "client.web.settings.set", payload));
  yield* pause();
  expect(socket.readyState).toBe(1);
  expect((yield* rpc(socket, "client.web.settings", { requestId: freshRequest() }))._tag).toBe("Success");
})));
