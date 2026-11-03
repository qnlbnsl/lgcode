// Connection assembly pattern: T3 Code apps/server/src/ws.ts, lines
// 3293-3330, 3360-3367 and 3374-3385 (MIT licence). No source code is copied.
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { CommandsRpcGroup, ServiceRpcGroup, type AgentId } from "@shephrd/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as RpcServer from "effect/rpc/RpcServer";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as SqlClient from "effect/sql/SqlClient";

import { CommandHandler } from "../commands/CommandHandler.ts";
import { verifyDeviceCredential } from "../identity/devices.ts";
import { verifyAgentToken } from "../identity/tokens.ts";
import { EventLog } from "../log/EventLog.ts";
import { subscribe } from "../log/subscribe.ts";
import { Restart } from "../recovery/service.ts";
import { Views } from "../views/Views.ts";
import { compareViews } from "../views/compare.ts";
import { outsideAdapters } from "./ancestry.ts";

type Services = CommandHandler | EventLog | Views | SqlClient.SqlClient;
type Application = Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest | Scope.Scope>;
type Credential = Parameters<CommandHandler["Service"]["execute"]>[0];
type Handlers = { readonly [R in RpcGroup.Rpcs<typeof CommandsRpcGroup> as R["_tag"]]: Rpc.ToHandlerFn<R, Services> };

const refused = (status: number, text: string) => HttpServerResponse.text(text, { status });
const reasons = new Set([
  "command refused", "cannot reload", "no usable account", "invalid credential",
  "request id reused", "recovering", "database read failed", "database write failed",
  "database write failed: busy", "database write failed: disk full", "database write failed: constraint",
]);
const commandError = (requestId: unknown, reason = "command refused") => ({
  _tag: "CommandError" as const, requestId, reason: reasons.has(reason) ? reason : "command refused",
});

// This listener can be opened before migrations or recovery. Its only
// initial response, including to an unauthenticated upgrade, is recovering.
export const listen = (socketPath: string) => Effect.gen(function* () {
  let application: Application = Effect.succeed(refused(503, "recovering"));
  const connections = new Set<Socket>();
  const nodeServer = createServer();
  nodeServer.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  const disconnect = Effect.sync(() => { for (const socket of connections) socket.destroy(); });
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) => Scope.close(scope, exit));
  const requests = yield* Effect.acquireRelease(Scope.make(), (scope, exit) => Scope.close(scope, exit));
  const server = yield* NodeHttpServer.make(() => nodeServer, {
    path: socketPath, disablePreemptiveShutdown: true,
  }).pipe(Scope.provide(scope));
  yield* server.serve(Effect.suspend(() => application)).pipe(Scope.provide(requests));
  yield* Effect.addFinalizer(() => disconnect);
  return {
    install: (next: Application) => Effect.sync(() => { application = next; }),
    // The lazily allocated WebSocketServer belongs to the server scope and
    // waits for its clients. Close the separate request scope first.
    close: disconnect.pipe(Effect.andThen(Scope.close(requests, Exit.void)), Effect.andThen(Scope.close(scope, Exit.void))),
  };
});

export const application = (options: { readonly ownerCredential: Redacted.Redacted<string>; readonly debug: boolean }) => Effect.gen(function* () {
  const services = yield* Effect.context<Services>();
  const handler = yield* CommandHandler;
  const log = yield* EventLog;
  const views = yield* Views;
  const recovery = yield* Effect.serviceOption(Restart);
  const expected = Buffer.from(Redacted.value(options.ownerCredential));
  // The runtime group really omits debug. Use its superset type only to
  // share assembly of the dynamically enumerated, schema-checked handlers.
  const group = (options.debug ? CommandsRpcGroup : ServiceRpcGroup) as typeof CommandsRpcGroup;

  const authenticate = (raw: string) => Effect.gen(function* () {
    const bytes = Buffer.from(raw);
    if (bytes.length === expected.length && timingSafeEqual(bytes, expected)) return { credential: { _tag: "owner" } as Credential };
    if (raw.startsWith("shp_a_")) {
      const agentId = yield* verifyAgentToken(raw);
      return { credential: { _tag: "agent", token: Redacted.make(raw) } as Credential, agentId };
    }
    yield* verifyDeviceCredential(raw);
    return { credential: { _tag: "device", credential: Redacted.make(raw) } as Credential };
  }).pipe(Effect.option);

  const app: Application = Effect.scoped(Effect.gen(function* () {
    if (Option.isSome(recovery) && !(yield* recovery.value.ready)) return refused(503, "recovering");
    const request = yield* HttpServerRequest.HttpServerRequest;
    const bearer = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? "");
    if (bearer === null || bearer[1]!.length > 256) return refused(401, "invalid credential");
    const raw = bearer[1]!;
    const identity = yield* authenticate(raw);
    if (Option.isNone(identity)) return refused(401, "invalid credential");
    const { credential, agentId } = identity.value as { credential: Credential; agentId?: AgentId };
    if (credential._tag === "owner" && !(yield* outsideAdapters(request.headers["shephrd-ancestors"], request.headers["shephrd-process-group"]))) return refused(403, "owner credential refused");
    // Ordinary HTTP is used by serve --detach to detect this service. It
    // performs the same authentication but never starts an RPC session.
    if (request.headers.upgrade?.toLowerCase() !== "websocket") return refused(400, "websocket required");
    const invalidated = yield* Deferred.make<void>();
    const invalidate = Deferred.succeed(invalidated, undefined);
    const authenticateRequest = (requestId: string) => authenticate(raw).pipe(Effect.flatMap((current) =>
      Option.isNone(current)
        ? invalidate.pipe(Effect.andThen(Effect.fail(commandError(requestId, "invalid credential"))))
        : Effect.void,
    ));
    const check = authenticate(raw).pipe(Effect.flatMap((current) => Option.isNone(current) ? invalidate : Effect.void));
    if (credential._tag !== "owner") {
      const changes = yield* log.subscribeCommitted;
      // Recheck after subscribing to close the handshake/watcher gap. Batch
      // notifications so a busy log never builds a queue of credential reads.
      if (Option.isNone(yield* authenticate(raw))) return refused(401, "invalid credential");
      yield* Effect.forever(PubSub.takeAll(changes).pipe(Effect.andThen(check))).pipe(Effect.forkScoped);
      // Side-row-only revocations publish no event. Check those as well.
      yield* Effect.forever(Effect.sleep(100).pipe(Effect.andThen(check))).pipe(Effect.forkScoped);
    }
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket.pipe(Effect.provide(RpcSerialization.layerJson));
    const pending = new Map<string, number>();
    const boundedProtocol: RpcServer.Protocol["Service"] = {
      ...protocol,
      run: (receive) => protocol.run((clientId, message) => {
        if (message._tag === "Ack" || message._tag === "Interrupt") pending.delete(String(message.requestId));
        return receive(clientId, message);
      }),
      send: (clientId, message, transferables) => {
        if (message._tag === "Chunk") pending.set(String(message.requestId), Date.now());
        if (message._tag === "Exit") pending.delete(String(message.requestId));
        return protocol.send(clientId, message, transferables);
      },
    };
    // Ack deadlines cover stalled catch-up streams, including a quiet log.
    yield* Effect.forever(Effect.sleep(100).pipe(Effect.andThen(Effect.suspend(() =>
      [...pending.values()].some((at) => Date.now() - at >= 5_000) ? invalidate : Effect.void,
    )))).pipe(Effect.forkScoped);
    const boundedLog = { ...log, subscribeCommitted: Effect.gen(function* () {
      const subscription = yield* log.subscribeCommitted;
      // Disconnect without dropping when the live backlog reaches the bound.
      yield* Effect.forever(Effect.sleep(10).pipe(Effect.andThen(PubSub.remaining(subscription)),
        Effect.flatMap((count) => count >= 2_048 ? invalidate : Effect.void))).pipe(Effect.forkScoped);
      return subscription;
    }) };
    const handlers = yield* group.toHandlers(Effect.succeed(Object.fromEntries([...group.requests.keys()].map((name) => [name, (payload: { requestId: string; after: number }) => {
      if (name === "subscribe") return Stream.unwrap(authenticateRequest(payload.requestId).pipe(Effect.as(subscribe(payload.after).pipe(
        Stream.filterEffect((envelope) => agentId === undefined ? Effect.succeed(true) : views.snapshot.pipe(Effect.map((snapshot) => {
          if (envelope.agentId === undefined) return false;
          const parent = snapshot.agents[envelope.agentId]?.parent;
          return envelope.agentId === agentId || (parent?._tag === "agent" && parent.agentId === agentId);
        }))),
        Stream.mapError(() => commandError(payload.requestId)),
        Stream.provideService(EventLog, boundedLog),
      ))));
      if (name === "debug.compare-views") return authenticateRequest(payload.requestId).pipe(Effect.andThen(credential._tag === "owner"
        ? compareViews().pipe(Effect.map((result) => ({ requestId: payload.requestId, sequence: result.sequence, equal: result.differences.length === 0, differences: result.differences.map((difference) => difference.path.join(".")) })), Effect.mapError(() => commandError(payload.requestId)))
        : Effect.fail(commandError(payload.requestId))));
      return handler.execute(credential, name, payload).pipe(Effect.mapError((error) => commandError(payload.requestId, error.reason)));
    }])) as unknown as Handlers));
    yield* RpcServer.make(group).pipe(Effect.provide(handlers), Effect.provideService(RpcServer.Protocol, boundedProtocol), Effect.forkScoped);
    return yield* Effect.raceFirst(httpEffect, Deferred.await(invalidated).pipe(Effect.as(HttpServerResponse.empty())));
  })).pipe(Effect.provide(services), Effect.catchCause(() =>
    Effect.logError("request failed: defect").pipe(Effect.as(refused(500, "request failed"))),
  ));
  return app;
});

export const serve = (options: { readonly socketPath: string; readonly ownerCredential: Redacted.Redacted<string>; readonly debug: boolean }) => Effect.gen(function* () {
  const listener = yield* listen(options.socketPath);
  yield* listener.install(yield* application(options));
});
