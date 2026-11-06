import { connect, Server, Socket } from "node:net";
import { networkInterfaces } from "node:os";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { call, ownerCredential } from "../support/handlerRig.ts";
import { connected, eventually, login, readSettings, setSettings, withWeb } from "../support/webRig.ts";

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
  }), { settings: proxyMode ? { proxyMode: true, publicAddress: "https://sheprd.example.test" } : {} }));
}

it("5.1 enabled off: catches keeping the listener or accepted connections alive after the setting commits", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx);
  const accepted = yield* connected(ctx, cookie);
  yield* setSettings({ ...ctx.settings, enabled: false });
  yield* eventually(() => accepted.readyState, (state) => state === 3, "disable retained an accepted web connection");
  yield* eventually(() => accepts("127.0.0.1", ctx.settings.port), (accepted) => !accepted, "disabled web listener still accepts connections");
  expect(yield* readSettings).toMatchObject({ serverState: "off" });
})));

it("5.1 disable ordering: catches returning from settings before stopping accepts and destroying accepted TCP sockets", async () => withWeb((ctx) => Effect.gen(function* () {
  // Observe the actual Node operations. Peer close notifications arrive on a
  // later network turn and cannot establish when the server stopped.
  const peer = yield* Effect.acquireRelease(Effect.promise(() => new Promise<Socket>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: ctx.settings.port });
    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  })), (socket) => Effect.sync(() => socket.destroy()));
  const peerPort = peer.localPort;
  const operations: string[] = [];
  const close = Server.prototype.close;
  const destroy = Socket.prototype.destroy;
  yield* Effect.acquireRelease(Effect.sync(() => vi.spyOn(Server.prototype, "close").mockImplementation(function (this: Server, ...args: Parameters<Server["close"]>) {
    const address = this.address();
    if (typeof address === "object" && address?.port === ctx.settings.port) operations.push("stop accepting");
    return close.apply(this, args);
  })), (spy) => Effect.sync(() => spy.mockRestore()));
  yield* Effect.acquireRelease(Effect.sync(() => vi.spyOn(Socket.prototype, "destroy").mockImplementation(function (this: Socket, ...args: Parameters<Socket["destroy"]>) {
    if (this.localPort === ctx.settings.port && this.remotePort === peerPort) operations.push("destroy accepted socket");
    return destroy.apply(this, args);
  })), (spy) => Effect.sync(() => spy.mockRestore()));
  yield* setSettings({ ...ctx.settings, enabled: false });
  operations.push("settings completed");
  // Assert immediately, before any polling or yielding to network callbacks.
  expect(operations).toContain("stop accepting");
  expect(operations).toContain("destroy accepted socket");
  expect(operations.indexOf("stop accepting")).toBeLessThan(operations.indexOf("settings completed"));
  expect(operations.indexOf("destroy accepted socket")).toBeLessThan(operations.indexOf("settings completed"));
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
