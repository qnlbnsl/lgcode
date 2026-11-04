import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { http, login, post, upgrade, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

for (const bad of ["localhost", "ipv6", "foreign", "wrong-port", "suffix", "userinfo", "missing"]) {
  it(`5.4 Host ${bad}: catches trusting a DNS name, IPv6, a near match or a missing Host`, async () => withWeb((ctx) => Effect.gen(function* () {
    const host = bad === "localhost" ? `localhost:${ctx.settings.port}` : bad === "ipv6" ? `[::1]:${ctx.settings.port}`
      : bad === "wrong-port" ? "127.0.0.1:1" : bad === "suffix" ? `${ctx.host}.evil.invalid`
      : bad === "userinfo" ? `evil.invalid@${ctx.host}` : bad === "missing" ? "" : "evil.invalid";
    expect((yield* Effect.promise(() => http(ctx, "/", { headers: { Host: host, Origin: undefined } }))).status).toBe(403);
    expect((yield* upgrade(ctx, { Host: host })).status).toBe(403);
  })));
}

for (const bad of ["missing", "foreign", "localhost", "ipv6", "wrong-port", "wrong-scheme", "null", "suffix", "path"]) {
  it(`5.4/5.5 Origin ${bad}: catches checking only Host or exempting login, session, logout or upgrades from the Origin guard`, async () => withWeb((ctx) => Effect.gen(function* () {
    const { cookie } = yield* login(ctx);
    const origin = bad === "missing" ? undefined : bad === "localhost" ? `http://localhost:${ctx.settings.port}`
      : bad === "ipv6" ? `http://[::1]:${ctx.settings.port}` : bad === "wrong-port" ? "http://127.0.0.1:1"
      : bad === "wrong-scheme" ? `https://${ctx.host}` : bad === "null" ? "null"
      : bad === "suffix" ? `${ctx.origin}.evil.invalid` : bad === "path" ? `${ctx.origin}/path` : "https://evil.invalid";
    for (const path of ["/api/login", "/api/session", "/api/logout", "/api/unknown"]) {
      expect((yield* Effect.promise(() => post(ctx, path, { password: ctx.password }, { Origin: origin, Cookie: cookie }))).status, path).toBe(403);
    }
    expect((yield* upgrade(ctx, { Origin: origin, Cookie: cookie })).status).toBe(403);
    expect((yield* Effect.promise(() => http(ctx, "/api/session", { headers: { Origin: origin, Cookie: cookie } }))).status).toBe(403);
  })));
}

it("5.4 static navigation: catches requiring an Origin or a cookie for a static GET or HEAD", async () => withWeb((ctx) => Effect.gen(function* () {
  for (const method of ["GET", "HEAD"]) {
    const reply = yield* Effect.promise(() => http(ctx, "/", { method, headers: { Origin: undefined } }));
    expect(reply.status).toBe(200);
    if (method === "HEAD") expect(reply.body).toBe("");
    else expect(reply.body).toContain("Shephrd test page");
  }
})));
