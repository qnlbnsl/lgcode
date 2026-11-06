import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { http, login, post, upgrade, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

// node:http.request substitutes its own Host for an empty value. Preserve
// the literal header on the wire for both static requests and upgrades.
const emptyHostStatus = (port: number, origin: string, websocket: boolean) => Effect.promise(() => new Promise<number>((resolve, reject) => {
  const socket = connect({ host: "127.0.0.1", port });
  socket.once("error", reject);
  socket.setTimeout(3_000, () => { socket.destroy(); reject(new Error("raw Host probe timed out")); });
  socket.once("connect", () => socket.write(websocket
    ? `GET /api HTTP/1.1\r\nHost: \r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    : "GET / HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n"));
  let reply = "";
  socket.on("data", (data) => {
    reply += data.toString();
    const status = /^HTTP\/1\.1 (\d{3})/.exec(reply)?.[1];
    if (status !== undefined) { socket.destroy(); resolve(Number(status)); }
  });
}));

for (const bad of ["localhost", "ipv6", "foreign", "wrong-port", "suffix", "userinfo", "missing"]) {
  it(`5.4 Host ${bad}: catches trusting a DNS name, IPv6, a near match or a missing Host`, async () => withWeb((ctx) => Effect.gen(function* () {
    if (bad === "missing") {
      expect(yield* emptyHostStatus(ctx.settings.port, ctx.origin, false)).toBe(403);
      expect(yield* emptyHostStatus(ctx.settings.port, ctx.origin, true)).toBe(403);
      return;
    }
    const host = bad === "localhost" ? `localhost:${ctx.settings.port}` : bad === "ipv6" ? `[::1]:${ctx.settings.port}`
      : bad === "wrong-port" ? "127.0.0.1:1" : bad === "suffix" ? `${ctx.host}.evil.invalid`
      : bad === "userinfo" ? `evil.invalid@${ctx.host}` : "evil.invalid";
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
    else expect(reply.body).toContain("Sheprd test page");
  }
})));
