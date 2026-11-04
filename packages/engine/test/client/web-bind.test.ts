import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { call, ownerCredential } from "../support/handlerRig.ts";
import { eventually, http, login, readSettings, setSettings, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

const accepts = (host: string, port: number): Promise<boolean> => new Promise((resolve) => {
  const socket = connect({ host, port });
  socket.setTimeout(1_000);
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => { socket.destroy(); resolve(false); });
  socket.once("timeout", () => { socket.destroy(); resolve(false); });
});

for (const proxyMode of [false, true]) {
  it(`5.1/10.1 bind proxy=${proxyMode}: catches listening on a wildcard, a LAN interface or IPv6`, async () => withWeb((ctx) => Effect.gen(function* () {
    yield* login(ctx);
    const addresses = Object.values(networkInterfaces()).flatMap((items) => items ?? [])
      .filter((item) => !item.internal && item.family === "IPv4").map((item) => item.address);
    for (const host of ["::1", ...addresses]) expect(yield* Effect.promise(() => accepts(host, ctx.settings.port)), "web listener accepted a non-127.0.0.1 connection").toBe(false);
  }), { settings: proxyMode ? { proxyMode: true, publicAddress: "https://shephrd.example.test" } : {} }));
}

it("5.1 enabled off: catches keeping the listener or accepted connections alive after the setting commits", async () => withWeb((ctx) => Effect.gen(function* () {
  yield* login(ctx);
  yield* setSettings({ ...ctx.settings, enabled: false });
  yield* eventually(() => accepts("127.0.0.1", ctx.settings.port), (accepted) => !accepted, "disabled web listener still accepts connections");
  expect(yield* readSettings).toMatchObject({ serverState: "off" });
})));

for (const field of ["host", "hostname", "address", "bindAddress"]) {
  it(`5.1 forbidden ${field}: catches accepting a non-loopback bind setting`, async () => withWeb((ctx) => Effect.gen(function* () {
    const result = yield* call(ownerCredential, "client.web.settings.set", { settings: { ...ctx.settings, [field]: "0.0.0.0" } });
    // A schema may discard an unknown field or refuse it. Either outcome
    // must leave the listener loopback-only and exclude it from settings.
    expect(["Success", "Failure"]).toContain(result._tag);
    expect(Object.hasOwn(yield* readSettings, field)).toBe(false);
    const addresses = Object.values(networkInterfaces()).flatMap((items) => items ?? []).filter((item) => !item.internal && item.family === "IPv4");
    for (const { address } of addresses) expect(yield* Effect.promise(() => accepts(address, ctx.settings.port))).toBe(false);
  })));
}
