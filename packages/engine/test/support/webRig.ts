// Unit 5's intended listener seam. This file contains transport clients and
// resource setup only. Authentication, dispatch, settings and timers stay real.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";

import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, vi } from "vitest";
import WebSocket from "ws";

import { buildServices } from "../../src/service.ts";
import { CommandHandler } from "../../src/commands/CommandHandler.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { Restart } from "../../src/recovery/service.ts";
import { makeFakeRunner, type FakeRunner } from "./fakeRunner.ts";
import { loadLists, type EngineLists } from "./fixturePiece.ts";
import { call, freshRequest, makeFakeSecrets, makeRig, ownerCredential, removeRig, success, type Rig } from "./handlerRig.ts";
import { registerRebuildCheck } from "./rebuildCheck.ts";
import { requestFrame } from "./socketClient.ts";

export interface WebSettings {
  readonly enabled: boolean;
  readonly port: number;
  readonly heartbeatSeconds: number;
  readonly proxyMode: boolean;
  readonly publicAddress?: string;
}
export interface WebModule {
  readonly serve: (options: {
    readonly password: Redacted.Redacted<string> | undefined;
    readonly staticRoot: string;
    readonly settings: WebSettings;
    readonly lists: EngineLists;
  }) => Effect.Effect<{ readonly close: Effect.Effect<void, unknown> }, unknown, any>;
}
export interface Reply { readonly status: number; readonly body: string; readonly headers: import("node:http").IncomingHttpHeaders }
export interface WebEndpoint {
  readonly password: string;
  readonly settings: WebSettings;
  readonly origin: string;
  readonly host: string;
}
export interface WebContext extends WebEndpoint {
  readonly rig: Rig;
  readonly runner: FakeRunner;
  readonly lists: EngineLists;
  readonly staticRoot: string;
  readonly open: () => ReturnType<WebModule["serve"]>;
  readonly close: Effect.Effect<void, unknown>;
}

export const freshSecret = () => randomBytes(32).toString("base64url");
export const pause = (ms = 25) => Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
export const eventually = <A>(read: () => A | Promise<A>, ready: (value: A) => boolean, label: string, ms = 3_000) =>
  Effect.promise(async () => {
    const deadline = Date.now() + ms;
    let value = await read();
    while (!ready(value) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      value = await read();
    }
    expect(ready(value), label).toBe(true);
    return value;
  });

export const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as import("node:net").AddressInfo).port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

export const http = (ctx: Pick<WebContext, "settings" | "origin" | "host">, path: string, options: {
  readonly method?: string;
  readonly headers?: Record<string, string | undefined>;
  readonly body?: string;
} = {}): Promise<Reply> => new Promise((resolve, reject) => {
  const headers = { Host: ctx.host, Origin: ctx.origin, ...options.headers };
  const req = request({ hostname: "127.0.0.1", port: ctx.settings.port, path, method: options.method ?? "GET",
    headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)), timeout: 3_000,
  }, (response) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.once("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: response.headers }));
    response.once("error", reject);
  });
  req.once("error", reject);
  req.once("timeout", () => req.destroy(new Error("HTTP request timed out")));
  req.end(options.body);
});
export const post = (ctx: WebEndpoint, path: string, body?: unknown, headers: Record<string, string | undefined> = {}) =>
  http(ctx, path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const login = (ctx: WebEndpoint, headers: Record<string, string | undefined> = {}) => Effect.promise(async () => {
  const reply = await post(ctx, "/api/login", { password: ctx.password }, headers);
  expect(reply.status >= 200 && reply.status < 300, "login must succeed").toBe(true);
  // Do not let an assertion dump a live session token in a test log.
  expect((reply.headers["set-cookie"]?.length ?? 0) > 0, "login must set a session cookie").toBe(true);
  const setCookie = reply.headers["set-cookie"]![0]!;
  return { cookie: setCookie.split(";")[0]!, setCookie, reply };
});

export const upgrade = (ctx: WebEndpoint, headers: Record<string, string | undefined> = {}, autoPong = true) =>
  Effect.gen(function* () {
    const result = yield* Effect.promise(() => new Promise<{ status: number; socket?: WebSocket }>((resolve, reject) => {
    const socket = new WebSocket(`ws://${ctx.host}/api`, {
      headers: Object.fromEntries(Object.entries({ Host: ctx.host, Origin: ctx.origin, ...headers }).filter(([, value]) => value !== undefined)),
      handshakeTimeout: 3_000, autoPong,
    });
    socket.once("open", () => resolve({ status: 101, socket }));
    socket.once("unexpected-response", (_request, response) => { response.resume(); resolve({ status: response.statusCode ?? 0 }); });
    socket.once("error", reject);
    }));
    if (result.socket !== undefined) yield* Effect.addFinalizer(() => Effect.sync(() => result.socket!.terminate()));
    return result;
  });

export const connected = (ctx: WebEndpoint, cookie: string, autoPong = true) => Effect.gen(function* () {
  const result = yield* upgrade(ctx, { Cookie: cookie }, autoPong);
  expect(result.status).toBe(101);
  const socket = result.socket!;
  yield* Effect.addFinalizer(() => Effect.sync(() => socket.terminate()));
  return socket;
});

export const rpc = (socket: WebSocket, tag: string, payload: Record<string, unknown>, id = freshSecret()) =>
  Effect.promise(() => new Promise<Record<string, any>>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`RPC ${tag} timed out`)), 3_000);
    const finish = (error?: Error, value?: Record<string, any>) => {
      clearTimeout(timer); socket.off("message", receive);
      error === undefined ? resolve(value!) : reject(error);
    };
    const receive = (raw: WebSocket.RawData) => {
      for (const frame of String(raw).split("\n").filter(Boolean)) {
        const message = JSON.parse(frame);
        if (message._tag === "Exit" && String(message.requestId) === id) finish(undefined, message.exit);
        if (message._tag === "Defect") finish(undefined, { _tag: "Failure", cause: "protocol defect" });
      }
    };
    socket.on("message", receive);
    socket.send(requestFrame(id, tag, payload));
  }));

export const setSettings = (settings: WebSettings) => Effect.gen(function* () {
  return success(yield* call(ownerCredential, "client.web.settings.set", { settings }));
});
export const readSettings = Effect.gen(function* () {
  const handler = yield* CommandHandler;
  const log = yield* EventLog;
  const read = (log.lists ?? engineLists).reads["client.web.settings"] as ((input: unknown, payload: unknown) => Effect.Effect<{ reply: Record<string, unknown> }, unknown, any>) | undefined;
  expect(typeof read, "client.web.settings must be installed in the real read table").toBe("function");
  const result = yield* read!(yield* handler.input({ _tag: "owner" }), { requestId: freshRequest() });
  const { requestId: _requestId, ...settings } = result.reply;
  return settings;
});

export const withWeb = async (
  body: (ctx: WebContext) => Effect.Effect<unknown, unknown, any>,
  options: {
    readonly password?: string | undefined;
    readonly settings?: Partial<WebSettings>;
    readonly lists?: EngineLists;
    readonly clock?: boolean;
    readonly recovery?: Layer.Layer<Restart>;
  } = {},
): Promise<void> => {
  const moduleUrl = new URL("../../src/client/web/server.ts", import.meta.url);
  expect(existsSync(moduleUrl), "Unit 5 must implement client/web/server.ts: serve (the listener seam is documented in test/support/webRig.ts)").toBe(true);
  const module = await import(/* @vite-ignore */ moduleUrl.href) as WebModule;
  expect(typeof module.serve, "the real web listener must export serve").toBe("function");
  const rig = makeRig();
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
  const password = Object.hasOwn(options, "password") ? options.password : freshSecret();
  const settings: WebSettings = { enabled: true, port: await freePort(), heartbeatSeconds: 25, proxyMode: false, ...options.settings };
  const staticRoot = join(rig.root, "page");
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, "index.html"), '<!doctype html><title>Shephrd test page</title><script src="/app.js" defer></script><main>Shephrd test page</main>');
  writeFileSync(join(staticRoot, "app.js"), 'document.querySelector("main").dataset.ready = "yes";');
  const lists = options.lists ?? await loadLists();
  try {
    let program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner();
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text),
      }));
      let run = Effect.gen(function* () {
        yield* registerRebuildCheck();
        const open = () => module.serve({ password: password === undefined ? undefined : Redacted.make(password), settings, staticRoot, lists });
        const listener = yield* open();
        return yield* body({ rig, runner, lists, password: password ?? "", staticRoot, settings,
          origin: `http://127.0.0.1:${settings.port}`, host: `127.0.0.1:${settings.port}`, open, close: listener.close });
      });
      // Engine followers use live time. Only the listener and test body use
      // virtual time, so a one-year session check does not wake a generic
      // engine follower once per second for a year.
      if (options.clock) run = run.pipe(Effect.provide(TestClock.layer()));
      return yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, lists as unknown as Parameters<typeof buildServices>[1]).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer));
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped);
    if (options.recovery !== undefined) program = program.pipe(Effect.provide(options.recovery));
    await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);
  } finally {
    vi.unstubAllEnvs(); removeRig(rig);
  }
};

export const rows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ caller: string; event_type: string; payload_json: string; request_id: string }>`SELECT caller, event_type, payload_json, request_id FROM events ORDER BY sequence`;
});
