// A real service on an isolated port. Settings are installed through the
// Unix socket, then the service restarts, as the port setting requires.
import * as Effect from "effect/Effect";
import { expect } from "vitest";
import { ancestryHeaders, authorization, ownerBearer, upgrade } from "./socketClient.ts";
import { makeServiceRoot, waitServing, type ServiceRoot } from "./serviceProcess.ts";
import { startCheckedWebService, type CheckedWebService } from "./checkedWebService.ts";
import { freePort, freshSecret, http, rpc, type WebEndpoint } from "./webRig.ts";

export interface ProcessWeb {
  readonly root: ServiceRoot;
  readonly ctx: WebEndpoint;
  readonly service: CheckedWebService;
  readonly restart: () => Effect.Effect<CheckedWebService, unknown, import("effect/Scope").Scope>;
}

export const processWeb = (password = freshSecret()) => Effect.gen(function* () {
  const root = makeServiceRoot(); const port = yield* Effect.promise(freePort);
  const initial = yield* startCheckedWebService(root);
  yield* waitServing(root, initial);
  const settings = { enabled: true, port, heartbeatSeconds: 25, proxyMode: false };
  yield* Effect.scoped(Effect.gen(function* () {
    const result = yield* Effect.promise(() => upgrade(root.socket, { ...authorization(ownerBearer(root.state)), ...ancestryHeaders() }));
    expect(result.status).toBe(101);
    yield* Effect.addFinalizer(() => Effect.sync(() => result.socket!.terminate()));
    const exit = yield* rpc(result.socket!, "client.web.settings.set", { requestId: "web-process-settings", settings });
    expect(exit._tag, "the service must install the real web settings planner").toBe("Success");
  }));
  yield* initial.stop;
  const ctx: WebEndpoint = { settings, origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}`, password };
  let service: CheckedWebService;
  const restart = () => Effect.gen(function* () {
    if (service !== undefined) yield* service.stop;
    service = yield* startCheckedWebService(root, { LGCODE_WEB_PASSWORD: password });
    yield* waitServing(root, service);
    let listening = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      listening = yield* Effect.promise(() => http(ctx, "/api/session", { method: "POST" }).then((reply) => reply.status === 401, () => false));
      if (listening) break;
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
    }
    expect(listening, "the configured loopback web listener did not start").toBe(true);
    return service;
  });
  const running = yield* restart();
  return { root, ctx, service: running, restart } satisfies ProcessWeb;
});
