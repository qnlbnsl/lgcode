import { createServer } from "node:http";
import type { Socket } from "node:net";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { NodeWS } from "@effect/platform-node/NodeSocket";
import { defaultWebSettings, type WebSettings } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { application } from "../../api/server.ts";
import { writePieceBatch } from "../../commands/pieceBatch.ts";
import { engineLists, type EngineLists } from "../../pieces/lists.ts";
import { Restart } from "../../recovery/service.ts";
import { Views } from "../../views/Views.ts";
import { installWebRuntime, settingsOf, type ClientWebView } from "../settings.ts";
import { initializeAlerts } from "../alerts/reactor.ts";
import { clientPieceView } from "../alerts/view.ts";
import { makeSession } from "./session.ts";
import { webCaller } from "./webCaller.ts";
import { requestPolicy } from "./proxy.ts";
import { staticResponse } from "./static.ts";

export const serve = (options: {
  readonly password: Redacted.Redacted<string> | undefined;
  readonly staticRoot: string;
  readonly settings?: WebSettings;
  readonly lists?: EngineLists;
  readonly registerSecret?: (secret: Redacted.Redacted<string>) => void;
}) => Effect.gen(function* () {
  const ownerScope = yield* Effect.scope;
  const views = yield* Views;
  // Capture only the approved piece-batch helper's ambient requirements.
  // This piece never receives the raw writer service.
  const batchServices = yield* Effect.context<Effect.Services<ReturnType<typeof writePieceBatch>>>();
  const recovery = yield* Effect.serviceOption(Restart);
  const lists = options.lists ?? engineLists;
  // Finish the installed alert reactor's startup write before returning a
  // ready listener. Recovery still gates initialization in the real service.
  if (lists.reactors.client === engineLists.reactors.client && lists.views.client === clientPieceView
    && (Option.isNone(recovery) || (yield* recovery.value.ready))) yield* initializeAlerts;
  // An explicit listener configuration overrides the view's initialized defaults.
  // The production service omits it and uses the persisted settings.
  let settings = options.settings ?? settingsOf((yield* views.snapshot).client) ?? defaultWebSettings;
  const port = settings.port;
  const usable = options.password !== undefined && Redacted.value(options.password).length >= 8;
  let state: "off" | "no-password" | "running" | "port-taken" = settings.enabled ? (usable ? "port-taken" : "no-password") : "off";
  const session = makeSession(options.password, options.registerSecret ?? (() => {}));
  const rpc = yield* application({ debug: false, lists, webIdentity: (request) => {
    const credential = webCaller(session, request.headers);
    return credential === undefined ? undefined : { credential };
  } });
  let stopped = false;
  let listener: { readonly stop: Effect.Effect<void>; readonly close: Effect.Effect<void> } | undefined;
  let retry: Fiber.Fiber<void, never> | undefined;
  const connections = new Map<NodeWS.WebSocket, { missed: number }>();
  const needsRetry = Latch.makeUnsafe(false);
  const lifecycle = yield* Semaphore.make(1);
  const disconnect = Effect.sync(() => { for (const socket of connections.keys()) socket.terminate(); connections.clear(); });

  const ready = Option.isSome(recovery) ? recovery.value.whenReady : Effect.void;
  const outage = (down: boolean) => ready.pipe(Effect.andThen(writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 0,
    build: (snapshot) => {
      const wasDown = (snapshot.client as ClientWebView)?.webDown === true;
      return { events: wasDown === down ? [] : [down ? { _tag: "client.WebServerDown", reason: "web port unavailable" } : { _tag: "client.WebServerUp" }] };
    },
  }, lists)), Effect.provide(batchServices), Effect.catchCause((cause) => Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.logError("web server status could not be recorded")));

  const app = Effect.scoped(Effect.gen(function* () {
    if (Option.isSome(recovery) && !(yield* recovery.value.ready)) return HttpServerResponse.empty({ status: 503 });
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = request.url.split("?")[0]!;
    const upgrade = request.headers.upgrade?.toLowerCase() === "websocket";
    const api = path === "/api" || path.startsWith("/api/");
    const navigation = !api && !upgrade && (request.method === "GET" || request.method === "HEAD");
    const policy = requestPolicy(request.headers, settings, port, navigation);
    if (!policy.accepted) return HttpServerResponse.empty({ status: 403 });
    // All callers, including unauthenticated static and login requests, pass
    // the same cookie boundary. Only these two routes may proceed without it.
    const caller = webCaller(session, request.headers);
    if (path === "/api/login" && request.method === "POST" && !upgrade) {
      // Drain oversized bodies without retaining their contents. Cancelling
      // the Node stream would destroy the socket before the HTTP 401 reply.
      const body = yield* request.stream.pipe(Stream.runFold(
        () => ({ bytes: 0, chunks: [] as Uint8Array[] }),
        (body, chunk) => {
          const bytes = Math.min(4097, body.bytes + chunk.byteLength);
          return { bytes, chunks: bytes <= 4096 ? [...body.chunks, chunk] : [] };
        }
      ), Effect.orElseSucceed(() => ({ bytes: 4097, chunks: [] as Uint8Array[] })));
      if (body.bytes > 4096) return HttpServerResponse.empty({ status: 401 });
      const text = Buffer.concat(body.chunks).toString("utf8");
      let value: unknown;
      try { value = (JSON.parse(text) as { password?: unknown }).password; } catch { value = undefined; }
      if (!session.checkPassword(value)) return HttpServerResponse.empty({ status: 401 });
      return HttpServerResponse.empty({ status: 204, headers: { "set-cookie": session.cookie(policy.secure) } });
    }
    if (navigation) return yield* staticResponse(options.staticRoot, request.url, request.method === "HEAD");
    if (caller === undefined) return HttpServerResponse.empty({ status: 401 });
    if (path === "/api/session" && request.method === "POST" && !upgrade) return HttpServerResponse.empty({ status: 204 });
    if (path === "/api/logout" && request.method === "POST" && !upgrade) {
      session.rotate(); yield* disconnect;
      return HttpServerResponse.empty({ status: 204 });
    }
    if (path === "/api" && upgrade) return yield* rpc;
    return HttpServerResponse.empty({ status: 404 });
  })).pipe(Effect.catchCause(() => Effect.succeed(HttpServerResponse.empty({ status: 500 }))));

  const bind = Effect.gen(function* () {
    const requests = yield* Scope.make();
    const services = yield* Effect.context<never>();
    const node = createServer();
    const sockets = new Set<Socket>();
    node.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    const wss = new NodeWS.WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
    // handleUpgrade emits no connection event. Register immediately in its
    // callback, before the RPC reader sees any client message.
    const handleUpgrade = wss.handleUpgrade.bind(wss);
    wss.handleUpgrade = (request, socket, head, callback) => {
      // Recheck at the actual upgrade, closing the gap between request
      // authorization and a concurrent logout or settings commit.
      const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(",") : value]));
      const accepted = settings.enabled && requestPolicy(headers, settings, port, false).accepted;
      const status = !accepted ? 403 : webCaller(session, headers) === undefined ? 401 : undefined;
      if (status !== undefined) { socket.end(`HTTP/1.1 ${status} Refused\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`); return; }
      return handleUpgrade(request, socket, head, (ws, req) => {
        if (connections.size >= 32) {
          const oldest = connections.keys().next().value;
          if (oldest !== undefined) { connections.delete(oldest); oldest.terminate(); }
        }
        const heartbeat = { missed: 0 };
        connections.set(ws, heartbeat);
        ws.on("pong", () => { heartbeat.missed = 0; });
        const heartbeatFiber = Fiber.runIn(Effect.runForkWith(services)(Effect.forever(
          Effect.sleep(settings.heartbeatSeconds * 1000).pipe(Effect.andThen(Effect.sync(() => {
            if (heartbeat.missed >= 2) ws.terminate();
            else { heartbeat.missed++; ws.ping(); }
          })))
        )), requests);
        ws.once("close", () => { connections.delete(ws); heartbeatFiber.interruptUnsafe(); });
        ws.on("error", () => {});
        callback(ws, req);
      });
    };
    node.on("request", yield* NodeHttpServer.makeHandler(app, { scope: requests }));
    node.on("upgrade", yield* NodeHttpServer.makeUpgradeHandler(Effect.succeed(wss), app, { scope: requests }));
    const stop = Effect.sync(() => {
      // Stop accepting before finalizing request scopes. The request that
      // disabled this listener may itself still be finishing its receipt.
      node.close(() => {});
      for (const socket of wss.clients) socket.terminate();
      for (const socket of sockets) socket.destroy();
    });
    const close = Effect.gen(function* () {
      yield* stop;
      yield* Scope.close(requests, Exit.void);
      yield* Effect.promise(() => new Promise<void>((resolve) => { wss.close(() => resolve()); }));
      yield* Effect.promise(() => new Promise<void>((resolve) => { node.close(() => resolve()); }));
    });
    const result = yield* Effect.callback<void, "unavailable">((resume) => {
      const failed = () => { node.removeListener("listening", listening); resume(Effect.fail("unavailable")); };
      const listening = () => { node.removeListener("error", failed); resume(Effect.void); };
      node.once("error", failed); node.once("listening", listening);
      node.listen({ host: "127.0.0.1", port });
      return Effect.sync(() => { node.off("error", failed); node.off("listening", listening); });
    }).pipe(Effect.result);
    if (result._tag === "Failure") { yield* close; return false; }
    listener = { stop, close };
    state = "running"; needsRetry.closeUnsafe();
    return true;
  }).pipe(Effect.uninterruptible);

  const attempt = Effect.gen(function* () {
    if (stopped || !settings.enabled || !usable) return;
    if (yield* bind) { yield* outage(false); return; }
    state = "port-taken"; needsRetry.openUnsafe();
    yield* outage(true);
  });
  const supervisor = Effect.forever(needsRetry.await.pipe(Effect.andThen(Effect.sleep(30_000)), Effect.andThen(Effect.suspend(() => state === "port-taken" ? lifecycle.withPermits(1)(attempt) : Effect.void))));
  const changed = lifecycle.withPermits(1)(Effect.gen(function* () {
    const next = settingsOf((yield* views.snapshot).client) ?? settings;
    if (stopped || next === settings) return;
    settings = next;
    yield* disconnect;
    if (!settings.enabled) {
      if (listener !== undefined) {
        yield* listener.stop;
        // Finalization runs in the listener's lifetime scope, outside the
        // RPC request that may have committed this change.
        yield* listener.close.pipe(Effect.uninterruptible, Effect.forkIn(ownerScope));
        listener = undefined;
      }
      state = "off"; needsRetry.closeUnsafe();
      yield* outage(false);
    } else if (!usable) state = "no-password";
    else if (listener === undefined) yield* attempt;
  }));
  const removeRuntime = installWebRuntime(views, { settings: () => settings, serverState: () => state, changed });
  const close = Effect.gen(function* () {
    if (stopped) return;
    stopped = true; removeRuntime();
    if (retry !== undefined) yield* Fiber.interrupt(retry);
    yield* disconnect;
    if (listener !== undefined) { yield* listener.close; listener = undefined; }
  });
  yield* Effect.addFinalizer(() => close);
  // Bind before returning, but never wait for recovery merely to report an
  // outage: requests must already be able to receive HTTP 503.
  if (usable && settings.enabled) {
    if (yield* bind) yield* outage(false).pipe(Effect.forkScoped);
    else { needsRetry.openUnsafe(); yield* outage(true).pipe(Effect.forkScoped); }
  } else if (!usable) yield* Effect.logInfo("web server disabled: web password is unset or shorter than eight characters");
  retry = yield* supervisor.pipe(Effect.forkScoped);
  return { close };
});
