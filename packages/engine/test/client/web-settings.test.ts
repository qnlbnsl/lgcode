import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { call, freshRequest, ownerCredential, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { connected, eventually, login, readSettings, rpc, setSettings, upgrade, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

for (const proxyMode of [false, true]) {
  it(`FR-001 refuses plain HTTP public addresses with proxyMode=${proxyMode} without changing settings`, async () => withWeb((ctx) => Effect.gen(function* () {
    const before = yield* readSettings;
    const result = yield* call(ownerCredential, "client.web.settings.set", {
      settings: { ...ctx.settings, proxyMode, publicAddress: "http://sheprd.example.test" }
    });
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.reason).toMatch(/https/i);
    expect(yield* readSettings).toEqual(before);
  })));
}

for (const publicAddress of ["https://sheprd.example.test", "https://sheprd.example.test:9443"]) {
  it(`5.16 canonical address ${publicAddress}: catches rejecting HTTPS or an explicit nondefault port`, async () => withWeb((ctx) => Effect.gen(function* () {
    yield* setSettings({ ...ctx.settings, proxyMode: true, publicAddress });
    expect(yield* readSettings).toMatchObject({ proxyMode: true, publicAddress });
  })));
}
for (const publicAddress of ["http://sheprd.example.test", "http://sheprd.example.test:8080", "ftp://sheprd.example.test", "ws://sheprd.example.test", "javascript:alert(1)", "HTTPS://sheprd.example.test", "https://SHEPRD.example.test", "https://sheprd.example.test/", "https://sheprd.example.test/path", "https://sheprd.example.test:443", "http://sheprd.example.test:80", "https://user:pass@sheprd.example.test", "https://sheprd.example.test?q=1", "https://sheprd.example.test#fragment", " https://sheprd.example.test", "https://sheprd.example.test "]) {
  it(`5.16 noncanonical address ${publicAddress}: catches silently normalizing or accepting a forbidden public address`, async () => withWeb((ctx) => Effect.gen(function* () {
    const before = yield* readSettings;
    const result = yield* call(ownerCredential, "client.web.settings.set", { settings: { ...ctx.settings, proxyMode: true, publicAddress } });
    expect(result._tag).toBe("Failure");
    expect(yield* readSettings).toEqual(before);
  })));
}

it("5.16 missing public address: catches enabling proxy mode without an allow-listed public origin", async () => withWeb((ctx) => Effect.gen(function* () {
  const result = yield* call(ownerCredential, "client.web.settings.set", { settings: { ...ctx.settings, proxyMode: true } });
  expect(result._tag).toBe("Failure");
})));

it("5.16 settings from the web: catches denying owner rights to a session or retaining connections accepted under old settings", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx);
  const first = yield* connected(ctx, cookie); const second = yield* connected(ctx, cookie);
  const changed = { ...ctx.settings, heartbeatSeconds: 17 };
  // The response may lose its socket when the committed change closes it.
  yield* rpc(first, "client.web.settings.set", { requestId: freshRequest(), settings: changed }).pipe(Effect.result, Effect.forkScoped);
  yield* eventually(() => [first.readyState, second.readyState], (states) => states.every((state) => state === 3), "a settings change left a connection open");
  expect(yield* readSettings).toMatchObject(changed);
  const reconnected = yield* connected(ctx, cookie);
  const reply = yield* rpc(reconnected, "client.web.settings", { requestId: freshRequest() });
  expect(reply).toMatchObject({ _tag: "Success", value: changed });
})));

it("5.16 terminal settings: catches preventing the owner's terminal from restoring the web listener after disabling it", async () => withWeb((ctx) => Effect.gen(function* () {
  yield* setSettings({ ...ctx.settings, enabled: false });
  expect(yield* readSettings).toMatchObject({ enabled: false, serverState: "off" });
  yield* setSettings(ctx.settings);
  yield* login(ctx);
})));

for (const field of ["enabled", "port", "publicAddress"] as const) {
  it(`5.16 any change ${field}: catches invalidating connections for only a subset of settings`, async () => withWeb((ctx) => Effect.gen(function* () {
    const { cookie } = yield* login(ctx);
    const stream = yield* connected(ctx, cookie); const read = yield* connected(ctx, cookie);
    const changed = field === "enabled" ? { ...ctx.settings, enabled: false }
      : field === "port" ? { ...ctx.settings, port: ctx.settings.port === 65535 ? 65534 : ctx.settings.port + 1 }
      : { ...ctx.settings, publicAddress: "https://sheprd.example.test" };
    yield* setSettings(changed);
    yield* eventually(() => [stream.readyState, read.readyState], (states) => states.every((state) => state === 3), "a settings field changed without closing all connections");
    if (field === "port") {
      // The configured port changes now. The current listener keeps its old
      // port until the next service start, by contract section 5.
      const result = yield* upgrade(ctx, { Cookie: cookie });
      expect(result.status).toBe(101);
    }
  })));
}

for (const proxyMode of [false, true]) {
  it(`5.16 proxy mode ${proxyMode} to ${!proxyMode}: catches preserving either connection when only proxyMode changes`, async () => withWeb((ctx) => Effect.gen(function* () {
    const { cookie } = yield* login(ctx);
    const stream = yield* connected(ctx, cookie); const read = yield* connected(ctx, cookie);
    yield* setSettings({ ...ctx.settings, proxyMode: !proxyMode });
    yield* eventually(() => [stream.readyState, read.readyState], (states) => states.every((state) => state === 3),
      "changing only proxyMode left an established connection open");
    expect(yield* readSettings).toMatchObject({ proxyMode: !proxyMode, publicAddress: "https://sheprd.example.test" });
  }), { settings: { proxyMode, publicAddress: "https://sheprd.example.test" } }));
}

it("5.16 public address replacement: catches accepting a reconnect under the old origin after its connection was closed", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx, { Host: "old.example.test", Origin: "https://old.example.test" });
  const result = yield* upgrade(ctx, { Cookie: cookie, Host: "old.example.test", Origin: "https://old.example.test" });
  expect(result.status).toBe(101);
  yield* setSettings({ ...ctx.settings, publicAddress: "https://new.example.test" });
  yield* eventually(() => result.socket!.readyState, (state) => state === 3, "old public connection stayed open");
  expect((yield* upgrade(ctx, { Cookie: cookie, Host: "old.example.test", Origin: "https://old.example.test" })).status).toBe(403);
  expect((yield* upgrade(ctx, { Cookie: cookie, Host: "new.example.test", Origin: "https://new.example.test" })).status).toBe(101);
}), { settings: { proxyMode: true, publicAddress: "https://old.example.test" } }));
