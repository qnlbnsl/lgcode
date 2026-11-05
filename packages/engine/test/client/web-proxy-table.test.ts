import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { login, post, upgrade, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

const forwarded = ["X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host", "Forwarded"];
for (const header of forwarded) {
  it(`10.2 proxy off ${header}: catches trusting or ignoring a forwarded header outside proxy mode`, async () => withWeb((ctx) => Effect.gen(function* () {
    const { cookie } = yield* login(ctx);
    for (const value of ["", "https", "http", "garbage"]) {
      const headers = { [header]: value, Cookie: cookie };
      expect((yield* Effect.promise(() => post(ctx, "/api/session", undefined, headers))).status).toBe(403);
      expect((yield* upgrade(ctx, headers)).status).toBe(403);
    }
  })));
}

// Hand-derived rows from contract section 5. Public Origin permits a proxy
// to rewrite Host. Public Host never permits a loopback or foreign Origin.
const cases = [
  { id: "local", host: "local", origin: "local", forwarded: false, status: 204, secure: false },
  { id: "public-direct", host: "public", origin: "public", forwarded: false, status: 204, secure: true },
  { id: "rewritten-host", host: "local", origin: "public", forwarded: true, status: 204, secure: true },
  { id: "rewritten-host-no-forwarded", host: "local", origin: "public", forwarded: false, status: 204, secure: true },
  { id: "arbitrary-rewritten-host", host: "foreign", origin: "public", forwarded: true, status: 204, secure: true },
  { id: "public-host-local-origin", host: "public", origin: "local", forwarded: false, status: 403, secure: false },
  { id: "forwarded-only", host: "local", origin: "local", forwarded: true, status: 403, secure: false },
  { id: "foreign-origin", host: "public", origin: "foreign", forwarded: true, status: 403, secure: false },
  { id: "other-scheme", host: "public", origin: "other-scheme", forwarded: false, status: 403, secure: false },
  { id: "other-port", host: "public", origin: "other-port", forwarded: false, status: 403, secure: false },
  { id: "missing-origin", host: "public", origin: "missing", forwarded: true, status: 403, secure: false },
] as const;

for (const row of cases) {
  it(`10.2 https ${row.id}: catches the wrong proxy-table decision or trusting X-Forwarded-Proto for Secure`, async () => {
    const publicAddress = "https://shephrd.example.test:9443";
    await withWeb((ctx) => Effect.gen(function* () {
      const { cookie } = yield* login(ctx);
      const origin = row.origin === "local" ? ctx.origin : row.origin === "public" ? publicAddress
        : row.origin === "missing" ? undefined : row.origin === "other-scheme" ? "http://shephrd.example.test:9443"
        : row.origin === "other-port" ? "https://shephrd.example.test:9444" : "https://evil.invalid";
      // No forwarded protocol is needed. When present, its value changes no
      // public row. Local rows with that header become public and are tested
      // separately by forwarded-only.
      const protocols = row.id === "local" ? [undefined] : [undefined, "https", "http", "nonsense"];
      for (const protocol of protocols) {
        const headers = { Host: row.host === "local" ? ctx.host : row.host === "foreign" ? "proxy-upstream.internal" : "shephrd.example.test:9443", Origin: origin,
          ...(row.forwarded ? { "X-Forwarded-For": "untrusted-value" } : {}),
          ...(protocol === undefined ? {} : { "X-Forwarded-Proto": protocol }), Cookie: cookie };
        const probe = yield* Effect.promise(() => post(ctx, "/api/session", undefined, headers));
        expect(probe.status).toBe(row.status);
        expect((yield* upgrade(ctx, headers)).status).toBe(row.status === 204 ? 101 : 403);
        const reply = yield* Effect.promise(() => post(ctx, "/api/login", { password: ctx.password }, { ...headers, Cookie: undefined }));
        if (row.status === 204) expect(reply.status >= 200 && reply.status < 300).toBe(true);
        else expect(reply.status).toBe(403);
        if (row.status === 204) {
          const attributes = (reply.headers["set-cookie"]?.[0] ?? "").split(";").map((part) => part.trim().toLowerCase());
          expect(attributes.includes("secure")).toBe(row.secure);
        } else expect(reply.headers["set-cookie"]).toBeUndefined();
      }
    }), { settings: { proxyMode: true, publicAddress } });
  });
}

for (const header of forwarded) {
  it(`10.2 proxy on detects ${header}: catches classifying a forwarded loopback request as local`, async () => withWeb((ctx) => Effect.gen(function* () {
    expect((yield* Effect.promise(() => post(ctx, "/api/login", { password: ctx.password }, { [header]: "ignored" }))).status).toBe(403);
  }), { settings: { proxyMode: true, publicAddress: "https://shephrd.example.test" } }));
}
