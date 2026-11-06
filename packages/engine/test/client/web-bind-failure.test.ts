import { createServer, Server } from "node:net";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Restart } from "../../src/recovery/service.ts";
import * as HostServer from "../../src/api/server.ts";
import * as Redacted from "effect/Redacted";
import { join } from "node:path";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ancestryHeaders, authorization, ownerBearer, upgrade as hostUpgrade, upgradeStatus } from "../support/socketClient.ts";
import { processWeb } from "../support/processWeb.ts";
import { stopAllServices, waitServing } from "../support/serviceProcess.ts";
import { startCheckedWebService } from "../support/checkedWebService.ts";
import { eventually, freePort, freshSecret, login, pause, readSettings, rows, rpc, setSettings, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });
afterEach(stopAllServices);

const occupy = (port: number): Promise<Server> => new Promise((resolve, reject) => {
  const server = createServer((socket) => socket.destroy());
  server.once("error", reject); server.listen(port, "127.0.0.1", () => resolve(server));
});
const release = (server: Server) => Effect.promise(() => new Promise<void>((resolve, reject) => {
  if (!server.listening) { resolve(); return; }
  server.close((error) => error ? reject(error) : resolve());
}));
const waitForEvent = (tag: string, count: number) => Effect.gen(function* () {
  for (let tries = 0; tries < 100; tries++) {
    const found = (yield* rows).filter((row) => row.event_type === tag);
    if (found.length >= count) return found;
    yield* pause(10);
  }
  const found = (yield* rows).filter((row) => row.event_type === tag);
  expect(found, `missing ${tag}`).toHaveLength(count); return found;
});

it("5.15 repeated retries: catches a supervisor that retries only once or stops before the occupied port becomes available", async () => {
  const port = await freePort(); const blocker = await occupy(port);
  const listen = Server.prototype.listen;
  let attempts = 0;
  const spy = vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server, ...args: Parameters<Server["listen"]>) {
    const options = args[0] as unknown;
    if (typeof options === "object" && options !== null && "port" in options && options.port === port) attempts++;
    return listen.apply(this, args);
  });
  try {
    await withWeb((ctx) => Effect.gen(function* () {
      expect(attempts).toBe(1);
      yield* waitForEvent("client.WebServerDown", 1);
      for (const expected of [2, 3]) {
        yield* TestClock.adjust(29_999); yield* pause();
        expect(attempts, "the supervisor retried before 30 seconds").toBe(expected - 1);
        yield* TestClock.adjust(1);
        yield* eventually(() => attempts, (count) => count === expected, "the same supervisor stopped retrying");
        expect(yield* readSettings).toMatchObject({ serverState: "port-taken" });
        expect((yield* rows).filter((row) => row.event_type === "client.WebServerDown")).toHaveLength(1);
      }
      yield* release(blocker);
      yield* TestClock.adjust(29_999); yield* pause();
      expect(attempts).toBe(3);
      expect(yield* readSettings).toMatchObject({ serverState: "port-taken" });
      yield* TestClock.adjust(1);
      yield* waitForEvent("client.WebServerUp", 1);
      expect(attempts).toBe(4);
      expect(yield* readSettings).toMatchObject({ serverState: "running" });
      yield* login(ctx);
    }), { clock: true, settings: { port } });
  } finally {
    spy.mockRestore();
    if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

it("5.15 bind outage: catches stopping the engine, duplicating the outage, retrying early or failing to clear it when the port is released", async () => {
  const port = await freePort(); const blocker = await occupy(port);
  try {
    await withWeb((ctx) => Effect.gen(function* () {
      const owner = freshSecret(); const socket = join(ctx.rig.stateFolder, "engine.sock");
      yield* HostServer.serve({ socketPath: socket, ownerCredential: Redacted.make(owner), debug: false });
      expect((yield* Effect.promise(() => upgradeStatus(socket, { ...authorization(owner), ...ancestryHeaders() }))).status).toBe(101);
      expect(yield* readSettings).toMatchObject({ serverState: "port-taken" });
      const down = yield* waitForEvent("client.WebServerDown", 1);
      const reason = JSON.parse(down[0]!.payload_json).reason as string;
      expect(typeof reason === "string" && reason.length > 0 && !reason.includes(String(port)) && !reason.includes(ctx.rig.root), "the outage must use a fixed reason instead of a raw bind error").toBe(true);
      yield* TestClock.adjust(30_000); yield* pause();
      expect((yield* rows).filter((row) => row.event_type === "client.WebServerDown")).toHaveLength(1);
      // Restart the supervisor over the same durable view. An open outage
      // must not be appended again merely because a new listener starts.
      yield* ctx.close; yield* ctx.open(); yield* pause();
      expect((yield* rows).filter((row) => row.event_type === "client.WebServerDown")).toHaveLength(1);
      yield* release(blocker);
      yield* TestClock.adjust(29_999); yield* pause();
      expect(yield* readSettings).toMatchObject({ serverState: "port-taken" });
      yield* TestClock.adjust(1); yield* pause();
      yield* waitForEvent("client.WebServerUp", 1);
      expect(yield* readSettings).toMatchObject({ serverState: "running" });
      yield* login(ctx);
      const events = (yield* rows).map((row) => JSON.parse(row.payload_json));
      const raised = events.filter((event) => event._tag === "client.AlertRaised" && event.kind === "client.web-down");
      expect(raised).toHaveLength(1);
      expect(events.some((event) => event._tag === "client.AlertCleared" && event.alertId === raised[0].alertId)).toBe(true);
    }), { clock: true, settings: { port } });
  } finally { if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve())); }
});

it("5.15 durable outage: catches recording another WebServerDown when a port stays taken across real engine restarts", async () => {
  let blocker: Server | undefined;
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const process = yield* processWeb();
      yield* process.service.stop;
      blocker = yield* Effect.promise(() => occupy(process.ctx.settings.port));
      const countDown = () => {
        const database = new DatabaseSync(join(process.root.state, "events.sqlite"), { readOnly: true });
        try { return Number(database.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = 'client.WebServerDown'").get()!.count); }
        finally { database.close(); }
      };
      for (let restart = 0; restart < 2; restart++) {
        const service = yield* startCheckedWebService(process.root, { SHEPRD_WEB_PASSWORD: process.ctx.password });
        yield* waitServing(process.root, service);
        const upgrade = yield* Effect.promise(() => hostUpgrade(process.root.socket, { ...authorization(ownerBearer(process.root.state)), ...ancestryHeaders() }));
        expect(upgrade.status).toBe(101);
        yield* Effect.addFinalizer(() => Effect.sync(() => upgrade.socket!.terminate()));
        const state = yield* rpc(upgrade.socket!, "client.web.settings", { requestId: `outage-restart-${restart}` });
        expect(state).toMatchObject({ _tag: "Success", value: { serverState: "port-taken" } });
        yield* eventually(countDown, (count) => count === 1, "the outage was missing or duplicated across restarts");
        yield* service.stop;
        expect(countDown()).toBe(1);
      }
    })));
  } finally { if (blocker?.listening) await new Promise<void>((resolve) => blocker!.close(() => resolve())); }
});

it("5.15 disabled outage: catches retaining a web-down alert or retrying after enabled is turned off", async () => {
  const port = await freePort(); const blocker = await occupy(port);
  try {
    await withWeb((ctx) => Effect.gen(function* () {
      yield* waitForEvent("client.WebServerDown", 1);
      // Establish the open alert before testing its removal. The required
      // sheepdog startup event can still be ahead of the alert reactor.
      yield* waitForEvent("client.AlertRaised", 1);
      yield* setSettings({ ...ctx.settings, enabled: false });
      yield* release(blocker);
      yield* TestClock.adjust(90_000); yield* pause();
      expect(yield* readSettings).toMatchObject({ serverState: "off" });
      const events = (yield* rows).map((row) => JSON.parse(row.payload_json));
      const alert = events.find((event) => event._tag === "client.AlertRaised" && event.kind === "client.web-down");
      expect(alert).toBeDefined();
      expect(events.some((event) => event._tag === "client.AlertCleared" && event.alertId === alert.alertId)).toBe(true);
      expect(events.filter((event) => event._tag === "client.WebServerDown")).toHaveLength(1);
    }), { clock: true, settings: { port } });
  } finally { if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve())); }
});

it("5.15 recovery ordering: catches writing the first outage before the piece batch path opens", async () => {
  const port = await freePort(); const blocker = await occupy(port);
  let ready = false; const gate = Deferred.makeUnsafe<void>();
  const recovery = Layer.succeed(Restart, { ready: Effect.sync(() => ready), whenReady: Deferred.await(gate), recover: Effect.void, returnAccount: () => Effect.void });
  try {
    await withWeb(() => Effect.gen(function* () {
      yield* pause();
      expect((yield* rows).filter((row) => row.event_type === "client.WebServerDown")).toHaveLength(0);
      ready = true; yield* Deferred.succeed(gate, undefined);
      yield* waitForEvent("client.WebServerDown", 1);
    }), { clock: true, settings: { port }, recovery });
  } finally { if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve())); }
});
