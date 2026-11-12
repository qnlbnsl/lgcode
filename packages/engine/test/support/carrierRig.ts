import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { expect, vi } from "vitest";
import { layer as persistentSecrets } from "../../src/accounts/SecretStore.ts";
import { SecretStore } from "../../src/commands/SecretStore.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { engineLists, type EngineLists } from "../../src/pieces/lists.ts";
import { Restart } from "../../src/recovery/service.ts";
import { buildServices } from "../../src/service.ts";
import { makeFakeRunner, type FakeRunner } from "./fakeRunner.ts";
import { call, makeRig, ownerCredential, removeRig, seedAccount, seedAgent, seedHarness, success, type Rig } from "./handlerRig.ts";
import { eventsOf, awaitRaised, question } from "./alertsRig.ts";
import { eventually, snapshot } from "./routingRig.ts";

export interface Request {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  readonly response: ServerResponse;
}
// This double replaces only the external HTTP service. Production planning,
// persistence, credential resolution, payload construction and transport run.
export async function ntfyServer() {
  const requests: Request[] = [];
  let respond = (request: Request) => { request.response.writeHead(200, { "content-type": "application/json" }); request.response.end('{"id":"accepted"}'); };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const captured: Request = { method: request.method!, url: request.url!, headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"), response };
    requests.push(captured);
    respond(captured);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test HTTP server has no port");
  return {
    origin: `http://127.0.0.1:${address.port}`, requests,
    respond: (next: typeof respond) => { respond = next; },
    close: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}
export type Ntfy = Awaited<ReturnType<typeof ntfyServer>>;
export const posts = (server: Ntfy) => server.requests.filter((request) => request.method === "POST");
export const posted = (server: Ntfy, count = 1) => eventually(Effect.sync(() => posts(server)), (rows) => rows.length >= count);
export const delivered = (id: string, count = 1) => eventually(eventsOf("client.AlertDelivered").pipe(
  Effect.map((rows) => rows.filter((row) => row.event.alertId === id))), (rows) => rows.length >= count);
export const failed = (id: string, count = 1) => eventually(eventsOf("client.AlertDeliveryFailed").pipe(
  Effect.map((rows) => rows.filter((row) => row.event.alertId === id))), (rows) => rows.length >= count);

export const configure = (origin: string, topic = "owner_alerts") => Effect.gen(function* () {
  const outcome = yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { _tag: "ntfy", server: origin, topic } });
  expect(outcome._tag, "6b must install the carrier planner and accept a private literal origin").toBe("Success");
  return success(outcome);
});
export const setToken = (origin: string, value: string, nonce = "first-token") => Effect.gen(function* () {
  const outcome = yield* call(ownerCredential, "client.alerts.carrier.set-token", { origin, nonce, value: Redacted.make(value) });
  expect(outcome._tag, "6b must commit an origin-bound token without returning its value").toBe("Success");
  return success(outcome);
});
export const raiseQuestion = (id = "question-6b") => Effect.gen(function* () {
  if ((yield* snapshot).agents.worker === undefined) yield* seedAgent({ id: "worker", state: "working" });
  yield* question("worker", id);
  const rows = yield* awaitRaised(`question:${id}`);
  expect(rows).toHaveLength(1);
  return rows[0]!.event.alertId;
});
export const storedValues = (rig: Rig): Record<string, string> => {
  try { return JSON.parse(readFileSync(join(rig.stateFolder, "secrets.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
};

export interface CarrierOptions {
  readonly rig?: Rig;
  readonly initialize?: boolean;
  readonly lists?: EngineLists;
  readonly lines?: string[];
  readonly clockAt?: number;
  readonly extra?: Layer.Layer<any, any, any>;
  readonly decorateStore?: (store: SecretStore["Service"]) => SecretStore["Service"];
}
export async function withCarrier(body: (rig: Rig, runner: FakeRunner) => Effect.Effect<unknown, unknown, any>, options: CarrierOptions = {}) {
  const rig = options.rig ?? makeRig();
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
  const program = Effect.gen(function* () {
    if (options.clockAt !== undefined) yield* TestClock.setTime(options.clockAt);
    const runner = yield* makeFakeRunner();
    const baseStore = persistentSecrets(rig);
    const store = options.decorateStore === undefined ? baseStore : Layer.effect(SecretStore,
      Effect.map(SecretStore, options.decorateStore)).pipe(Layer.provide(baseStore));
    const dependencies = Layer.mergeAll(runner.layer, store, Layer.succeed(Redactor, {
      // Deliberately transparent: the tests must catch direct disclosure, even
      // if a caller supplies no redaction registry.
      redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text),
    }), options.extra ?? Layer.empty);
    const services = buildServices(rig, options.lists ?? engineLists).pipe(Layer.provideMerge(dependencies));
    return yield* Effect.scoped(Effect.gen(function* () {
      yield* runner.subscribed;
      yield* eventually(eventsOf("client.AlertBaseline"), (rows) => rows.length > 0);
      if (options.initialize !== false) { yield* seedHarness(); yield* seedAccount(); }
      return yield* body(rig, runner);
    })).pipe(Effect.provide(services), Effect.provide(runner.layer));
  }).pipe(
    Effect.provide(Layer.succeed(Restart, { ready: Effect.succeed(true), whenReady: Effect.void, recover: Effect.void, returnAccount: () => Effect.void })),
    Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
    Effect.provide(NodeServices.layer),
    Effect.provide(Logger.layer([Logger.make((entry) => { options.lines?.push(Logger.formatJson.log(entry)); })])),
    Effect.scoped,
  );
  try {
    await Effect.runPromise((options.clockAt === undefined ? program : program.pipe(Effect.provide(TestClock.layer()))) as Effect.Effect<unknown, unknown, never>);
  } finally { vi.unstubAllEnvs(); if (options.rig === undefined) removeRig(rig); }
}
