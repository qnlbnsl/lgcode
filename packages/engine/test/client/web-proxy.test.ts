import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { http, login, post, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

it("10.1 proxy off: catches accepting a configured public address before proxy mode is enabled", async () => withWeb((ctx) => Effect.gen(function* () {
  expect((yield* Effect.promise(() => post(ctx, "/api/login", { password: ctx.password }, {
    Host: "lgtm.example.test", Origin: "https://lgtm.example.test",
  }))).status).toBe(403);
  yield* login(ctx); // Refusing everything must not satisfy the negative case.
}), { settings: { publicAddress: "https://lgtm.example.test" } }));

it("10.1 public static navigation: catches blocking the first cookie-free navigation from an external link through the proxy", async () => withWeb((ctx) => Effect.gen(function* () {
  const reply = yield* Effect.promise(() => http(ctx, "/", { headers: { Host: "lgtm.example.test", Origin: undefined, "X-Forwarded-For": "ignored" } }));
  expect(reply.status).toBe(200);
  expect(reply.body).toContain("LGTM Studio test page");
}), { settings: { proxyMode: true, publicAddress: "https://lgtm.example.test" } }));
