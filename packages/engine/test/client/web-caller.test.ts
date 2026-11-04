import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { seedAccount, seedHarness, startPayload, freshRequest } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { connected, eventually, http, login, post, rows, rpc, upgrade, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

it("5.2 unauthenticated entry: catches accepting an API request or upgrade before cookie authentication", async () => withWeb((ctx) => Effect.gen(function* () {
  const before = yield* rows;
  for (const path of ["/api", "/api/session", "/api/logout", "/api/unknown"]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      expect((yield* Effect.promise(() => http(ctx, path, { method }))).status, `${method} ${path}`).toBe(401);
    }
  }
  expect((yield* upgrade(ctx)).status).toBe(401);
  expect(JSON.stringify(yield* rows) === JSON.stringify(before), "unauthenticated traffic wrote an event").toBe(true);
})));

it("5.2 authenticated command: catches bypassing the owner credential path or recording a web/device caller", async () => withWeb((ctx) => Effect.gen(function* () {
  yield* seedHarness(); yield* seedAccount();
  const { cookie } = yield* login(ctx);
  const socket = yield* connected(ctx, cookie);
  const requestId = freshRequest();
  const reply = yield* rpc(socket, "start", { ...startPayload(ctx.rig), requestId });
  expect(reply._tag).toBe("Success");
  const written = (yield* rows).filter((row) => row.request_id === requestId);
  expect(written.some((row) => row.event_type === "AgentStarted")).toBe(true);
  expect(written.every((row) => row.caller === "owner")).toBe(true);
  expect((yield* Effect.promise(() => post(ctx, "/api/session", undefined, { Cookie: cookie }))).status).toBe(204);
})));

it("5.2 web stop preemption: catches a web-specific caller that queues stop behind an endless start setup", async () => withWeb((ctx) => Effect.gen(function* () {
  yield* seedHarness(); yield* seedAccount();
  let interrupted = false;
  ctx.runner.script("start", () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))));
  const { cookie } = yield* login(ctx);
  const startSocket = yield* connected(ctx, cookie);
  const stopSocket = yield* connected(ctx, cookie);
  yield* rpc(startSocket, "start", { ...startPayload(ctx.rig), requestId: freshRequest() }).pipe(Effect.forkScoped);
  const calls = yield* eventually(() => ctx.runner.callsOf("start"), (calls) => calls.length === 1, "start never reached runner setup");
  const agentId = calls[0]!.input.agentId;
  const reply = yield* rpc(stopSocket, "stop", { requestId: freshRequest(), agentId });
  expect(reply._tag).toBe("Success");
  yield* eventually(() => interrupted, Boolean, "web stop did not cancel setup");
  expect((yield* rows).filter((row) => row.event_type === "AgentStopped")).toHaveLength(1);
})));
