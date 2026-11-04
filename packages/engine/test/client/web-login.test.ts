import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { rows, withWeb, login, post, http } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true }); // withWeb registers the real scoped comparison.

it("5.5 login: catches missing browser cookie protections or a password returned to the page", async () => withWeb((ctx) => Effect.gen(function* () {
  const before = yield* rows;
  const { setCookie, cookie, reply } = yield* login(ctx);
  const attributes = setCookie.split(";").slice(1).map((part) => part.trim().toLowerCase());
  expect(attributes).toEqual(expect.arrayContaining(["httponly", "samesite=strict", "path=/"]));
  expect(attributes.some((part) => /^(max-age|expires|domain)=/.test(part))).toBe(false);
  expect(attributes).not.toContain("secure");
  expect(reply.body.includes(ctx.password), "login body leaked the password").toBe(false);
  expect(cookie.includes(ctx.password), "cookie holds the password instead of the session token").toBe(false);
  expect(JSON.stringify(yield* rows) === JSON.stringify(before), "login wrote an event").toBe(true);
  expect((yield* Effect.promise(() => post(ctx, "/api/session", undefined, { Cookie: cookie }))).status).toBe(204);
})));

for (const kind of ["wrong", "empty", "missing", "short", "long", "oversized", "url", "malformed-json"] as const) {
  it(`5.5 login ${kind}: catches accepting an invalid password, reading a URL password, throwing on length, or writing an event`, async () => withWeb((ctx) => Effect.gen(function* () {
    const before = yield* rows;
    const value = kind === "empty" ? "" : kind === "short" ? "x" : kind === "long" ? "x".repeat(100) : kind === "oversized" ? "x".repeat(4097) : "wrong-password";
    const path = kind === "url" ? `/api/login?password=${encodeURIComponent(ctx.password)}` : "/api/login";
    const reply = yield* Effect.promise(() => kind === "malformed-json"
      ? http(ctx, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })
      : post(ctx, path, kind === "missing" || kind === "url" ? {} : { password: value }));
    if (kind === "malformed-json") expect([400, 401]).toContain(reply.status);
    else expect(reply.status).toBe(401);
    expect(reply.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(yield* rows) === JSON.stringify(before), "a refused login wrote an event").toBe(true);
  })));
}

it("5.5 body budget: catches accepting a correct password hidden in a JSON body larger than 4 KiB", async () => withWeb((ctx) => Effect.gen(function* () {
  const reply = yield* Effect.promise(() => post(ctx, "/api/login", { password: ctx.password, padding: "x".repeat(4096) }));
  expect(reply.status).toBe(401);
  expect(reply.headers["set-cookie"]).toBeUndefined();
})));

it("5.5 session probe: catches treating an unauthenticated browser as logged in", async () => withWeb((ctx) => Effect.gen(function* () {
  for (const cookie of [undefined, "unrelated=value", "session=malformed"]) {
    expect((yield* Effect.promise(() => post(ctx, "/api/session", undefined, { Cookie: cookie }))).status).toBe(401);
  }
})));
