import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { EventSequence, RequestId } from "@lgtm/contracts";
import * as Server from "../../src/api/server.ts";
import { connect, ancestryHeaders, authorization, upgradeStatus } from "../support/socketClient.ts";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { CommandHandler } from "../../src/commands/CommandHandler.ts";
import { toolNames } from "../../../mcp/src/tools.ts";
import { alertLog, append, eventsOf } from "../support/alertsRig.ts";
import { configure, delivered, failed, ntfyServer, posted, posts, raiseQuestion, setToken, withCarrier } from "../support/carrierRig.ts";
import { agentCredential, call, makeRig, ownerCredential, removeRig, seedAgent, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { pause } from "../support/routingRig.ts";

const start = 1_800_000_000_000;
const read = (id: string) => call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 }).pipe(
  Effect.map((outcome) => success(outcome).items.find((row: { alertId: string }) => row.alertId === id)));
const identity = (id: string) => read(id).pipe(Effect.map((row) => ({ alertId: id,
  generation: row.delivery.generation as number, attempt: row.delivery.attempt as number })));
const retry = (payload: Record<string, unknown>) => call(ownerCredential, "client.alerts.retry", payload);

it("a genuine test waits for carrier acceptance, stores nothing, and discloses no token or raw response", async () => {
  const server = await ntfyServer(); const token = randomUUID(); const lines: string[] = [];
  server.respond(() => {});
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, token);
      const before = yield* alertLog;
      const sql = yield* SqlClient.SqlClient;
      const beforeReceipts = yield* sql`SELECT * FROM receipts`;
      const completed = yield* Deferred.make<void>();
      const task = yield* call(ownerCredential, "client.alerts.test", {}).pipe(
        Effect.tap(() => Deferred.succeed(completed, undefined)), Effect.forkChild);
      yield* posted(server);
      expect(yield* Deferred.isDone(completed)).toBe(false);
      const request = posts(server)[0]!;
      expect(request.headers.authorization === `Bearer ${token}`).toBe(true);
      expect(request.headers.title).toBe("LGTM Studio test notification");
      expect(request.headers["x-sequence-id"]).toMatch(/^test-/);
      request.response.writeHead(200); request.response.end(`provider-private-${token}`);
      const reply = success(yield* Fiber.join(task));
      expect(reply).toMatchObject({ accepted: true });
      expect(yield* alertLog).toEqual(before);
      expect(yield* sql`SELECT * FROM receipts`).toEqual(beforeReceipts);
      expect(JSON.stringify({ reply, events: yield* alertLog, lines })).not.toContain(token);
      expect(JSON.stringify(reply)).not.toContain("provider-private");
    }), { lines });
  } finally { await server.close(); }
});

it.each(["service missing", "token missing", "carrier delivery failed"])("test reports %s with a fixed safe reason", async (reason) => {
  const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(503); response.end("private raw response"); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      if (reason !== "service missing") yield* configure(server.origin);
      if (reason === "carrier delivery failed") yield* setToken(server.origin, randomUUID());
      const before = yield* alertLog;
      expect(success(yield* call(ownerCredential, "client.alerts.test", {}))).toMatchObject({ accepted: false, reason });
      expect(posts(server)).toHaveLength(reason === "carrier delivery failed" ? 1 : 0);
      expect(yield* alertLog).toEqual(before);
    }));
  } finally { await server.close(); }
});

it("retry uses the configured production transport, preserves times, and serializes with automatic retry and duplicate requests", async () => {
  const rig = makeRig(); const server = await ntfyServer(); const token = randomUUID(); let saved: Record<string, unknown> = {};
  server.respond(({ response }) => { response.writeHead(503); response.end("private carrier failure"); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, token);
      const id = yield* raiseQuestion("retry-concurrent"); yield* failed(id);
      const before = yield* read(id);
      expect(before).toMatchObject({ raisedAt: start, delivery: { at: start, attempt: 1 } });
      saved = { requestId: "same-retry", ...yield* identity(id) };
      server.respond(() => {});
      yield* TestClock.adjust(1_000);
      const first = yield* retry(saved).pipe(Effect.forkChild);
      yield* posted(server, 2);
      const duplicate = yield* retry(saved).pipe(Effect.forkChild);
      const stale = yield* retry({ ...saved, requestId: "other-retry" }).pipe(Effect.forkChild);
      // The automatic worker's first deadline expires while the manual send holds its lane.
      yield* TestClock.adjust(4_000); yield* pause(20);
      expect(posts(server)).toHaveLength(2);
      expect((yield* read(id)).delivery).toMatchObject({ status: "failed", attempt: 1 });
      success(yield* call(ownerCredential, "client.alerts.settings.set", { kind: "other", push: false }));
      posts(server)[1]!.response.writeHead(200); posts(server)[1]!.response.end(`private-${token}`);
      const reply = success(yield* Fiber.join(first));
      expect(reply).toMatchObject({ accepted: true });
      expect(success(yield* Fiber.join(duplicate))).toEqual(reply);
      expect(yield* Fiber.join(stale)).toMatchObject({ _tag: "Failure", failure: { reason: "notification changed; refresh before retrying" } });
      expect(yield* read(id)).toMatchObject({ raisedAt: start, delivery: { status: "delivered", attempt: 2, at: start + 5_000 } });
      expect(posts(server)[1]!.headers.authorization === `Bearer ${token}`).toBe(true);
      expect(posts(server)[1]!.headers["x-sequence-id"]).toBe(id);
      expect(posts(server)[1]!.body).toContain("Agent: name-worker");
      expect(posts(server)[1]!.body).not.toContain("Which branch?");
      yield* TestClock.adjust(600_000); yield* pause(20);
      expect(posts(server)).toHaveLength(2);
      expect(yield* delivered(id)).toHaveLength(1);
      expect(yield* retry({ ...saved, attempt: 2 })).toMatchObject({ _tag: "Failure", failure: { reason: "request id reused" } });
      const sql = yield* SqlClient.SqlClient;
      expect(JSON.stringify({ events: yield* alertLog, receipts: yield* sql`SELECT * FROM receipts`, reply })).not.toContain(token);
    }), { rig, clockAt: start });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect(success(yield* retry(saved))).toMatchObject({ accepted: true });
      expect(posts(server)).toHaveLength(2);
    }), { rig, initialize: false, clockAt: start + 700_000 });
  } finally { await server.close(); removeRig(rig); }
});

it("failed retry records the next attempt, time and fixed diagnostic, then retains its backoff", async () => {
  const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(503); response.end("raw-secret-error"); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID());
      const id = yield* raiseQuestion("retry-failed"); yield* failed(id);
      yield* TestClock.adjust(1_000);
      const reply = success(yield* retry({ ...yield* identity(id), requestId: "failed-retry" }));
      expect(reply).toMatchObject({ accepted: false, reason: "carrier delivery failed" });
      expect(yield* read(id)).toMatchObject({ raisedAt: start, delivery: { attempt: 2, at: start + 1_000, status: "failed", final: false } });
      yield* TestClock.adjust(29_999); yield* pause(20); expect(posts(server)).toHaveLength(2);
      yield* TestClock.adjust(1); yield* failed(id, 3); expect(posts(server)).toHaveLength(3);
      expect((yield* alertLog).some((row) => JSON.stringify(row).includes("raw-secret-error"))).toBe(false);
    }), { clockAt: start });
  } finally { await server.close(); }
});

it("retry without a token records an honest failure as another attempt, including final marking", async () => {
  const server = await ntfyServer(); server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      const id = yield* raiseQuestion("missing-token"); yield* failed(id);
      for (let attempt = 2; attempt <= 5; attempt++) {
        expect(success(yield* retry(yield* identity(id)))).toMatchObject({ accepted: false, reason: "token missing" });
        expect(yield* read(id)).toMatchObject({ delivery: { status: "failed", attempt, final: attempt >= 5 } });
      }
      expect(posts(server)).toHaveLength(1);
    }), { clockAt: start });
  } finally { await server.close(); }
});

it("retry validates current generation, failure attempt and open identity, including dismissal", async () => {
  const server = await ntfyServer(); server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID());
      const id = yield* raiseQuestion("stale-retry"); yield* failed(id);
      const shown = yield* identity(id);
      for (const payload of [{ ...shown, generation: 0 }, { ...shown, attempt: 2 }, { ...shown, alertId: "__proto__" }]) {
        expect(yield* retry(payload)).toMatchObject({ _tag: "Failure" });
      }
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: id }));
      expect(yield* retry(shown)).toMatchObject({ _tag: "Failure" });
      expect(yield* read(id)).toMatchObject({ status: "cleared", delivery: { attempt: 1 } });
      expect(posts(server)).toHaveLength(1);
    }), { clockAt: start });
  } finally { await server.close(); }
});

it("a missing service retry fails with a safe reason when replaying a failed legacy identity", async () => {
  await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck(); const id = yield* raiseQuestion("legacy-no-service");
    yield* append({ _tag: "client.AlertDeliveryFailed", alertId: id, carrier: "ntfy", generation: 0, attempt: 1, reason: "historical response" });
    expect(success(yield* retry(yield* identity(id)))).toMatchObject({ accepted: false, reason: "service missing" });
    expect(yield* read(id)).toMatchObject({ delivery: { reason: "service missing", attempt: 2 } });
  }));
});

it("Not now is durable, idempotent, replayed in settings and owner snapshot, and absent for agents", async () => {
  const rig = makeRig();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect(success(yield* call(ownerCredential, "client.alerts.settings", {}))).toHaveProperty("pushPromptDismissed", false);
      success(yield* call(ownerCredential, "client.alerts.prompt.dismiss", { requestId: "not-now" }));
      success(yield* call(ownerCredential, "client.alerts.prompt.dismiss", { requestId: "not-now" }));
      success(yield* call(ownerCredential, "client.alerts.prompt.dismiss", {}));
      expect(yield* eventsOf("client.AlertPromptDismissed")).toHaveLength(1);
    }), { rig });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect(success(yield* call(ownerCredential, "client.alerts.settings", {}))).toHaveProperty("pushPromptDismissed", true);
      expect(success(yield* call(ownerCredential, "client.snapshot", {}))).toHaveProperty("client.pushPromptDismissed", true);
      const agent = yield* seedAgent({ id: "reader", state: "working" });
      const reply = success(yield* call(agentCredential(agent.token), "client.snapshot", {}));
      expect(reply.client).toBeUndefined();
      expect(yield* eventsOf("client.AlertPromptDismissed")).toHaveLength(1);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});

it.each(["client.alerts.retry", "client.alerts.test", "client.alerts.prompt.dismiss"])("%s is owner only and never becomes an agent tool", async (name) => {
  const server = await ntfyServer();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID());
      const worker = yield* seedAgent({ id: "worker", state: "working" });
      const payload = { alertId: "unknown", generation: 0, attempt: 1 };
      expect(yield* call(agentCredential(worker.token), name, payload)).toMatchObject({ _tag: "Failure" });
      expect(yield* (yield* CommandHandler).execute({ _tag: "service", service: "roles.stallWatch" }, name, { requestId: "service-refused", ...payload }).pipe(Effect.result)).toMatchObject({ _tag: "Failure" });
      expect(toolNames as readonly string[]).not.toContain(name);
      expect(posts(server)).toHaveLength(0);
      expect(yield* eventsOf("client.AlertPromptDismissed")).toHaveLength(0);
    }));
  } finally { await server.close(); }
});


it("the authenticated API installs notification handlers, preserves delivery times, and refuses unauthenticated access", async () => {
  const server = await ntfyServer(); const bearer = randomUUID();
  server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier((rig) => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID());
      const id = yield* raiseQuestion("wire-retry"); yield* failed(id);
      const socket = join(rig.stateFolder, "engine.sock");
      yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false });
      const refused = yield* Effect.promise(() => upgradeStatus(socket, { ...ancestryHeaders(), ...authorization("invalid") }));
      expect(refused.status).toBe(401);
      expect(posts(server)).toHaveLength(1);
      const client = yield* connect(socket, bearer);
      const requestId = () => Schema.decodeUnknownSync(RequestId)(randomUUID());
      const page = yield* client["client.alerts.list"]({ requestId: requestId(), after: Schema.decodeUnknownSync(EventSequence)(0), limit: 100 });
      const alert = page.items.find((row) => row.alertId === id)!;
      expect(alert.delivery).toMatchObject({ at: start, attempt: 1, status: "failed" });
      server.respond(({ response }) => { response.writeHead(200); response.end(); });
      expect(yield* client["client.alerts.retry"]({ requestId: requestId(), alertId: alert.alertId,
        generation: alert.delivery!.generation, attempt: alert.delivery!.attempt })).toMatchObject({ accepted: true });
      expect(yield* client["client.alerts.test"]({ requestId: requestId() })).toMatchObject({ accepted: true });
      yield* client["client.alerts.prompt.dismiss"]({ requestId: requestId() });
      expect(yield* client["client.alerts.settings"]({ requestId: requestId() })).toHaveProperty("pushPromptDismissed", true);
      expect(yield* client["client.alerts.retry"]({ requestId: requestId(), alertId: alert.alertId,
        generation: alert.delivery!.generation, attempt: alert.delivery!.attempt }).pipe(Effect.result))
        .toMatchObject({ _tag: "Failure", failure: { reason: "notification changed; refresh before retrying" } });
      expect(posts(server)).toHaveLength(3);
      expect(yield* eventsOf("client.AlertRaised")).toHaveLength(1);
    }), { clockAt: start });
  } finally { await server.close(); }
});


it("a dismissal during an in-flight manual retry remains cleared after acceptance and stops subsequent retries", async () => {
  const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID());
      const id = yield* raiseQuestion("dismiss-during-retry"); yield* failed(id);
      server.respond(({ method, response }) => { if (method === "DELETE") { response.writeHead(200); response.end(); } });
      const task = yield* retry(yield* identity(id)).pipe(Effect.forkChild);
      yield* posted(server, 2);
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: id }));
      posts(server)[1]!.response.writeHead(200); posts(server)[1]!.response.end();
      expect(success(yield* Fiber.join(task))).toMatchObject({ accepted: true });
      expect(yield* read(id)).toMatchObject({ status: "cleared", delivery: { status: "delivered", attempt: 2 } });
      yield* TestClock.adjust(600_000); yield* pause(20);
      expect(posts(server)).toHaveLength(2);
      expect(yield* eventsOf("client.AlertCleared")).toHaveLength(1);
    }), { clockAt: start });
  } finally { await server.close(); }
});

it("a carrier generation change during retry cannot mark the replacement destination as delivered", async () => {
  const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID());
      const id = yield* raiseQuestion("changed-during-retry"); yield* failed(id);
      server.respond(() => {});
      const task = yield* retry(yield* identity(id)).pipe(Effect.forkChild);
      yield* posted(server, 2);
      success(yield* call(ownerCredential, "client.alerts.settings.set", { kind: "question", push: false }));
      yield* configure(server.origin, "replacement");
      posts(server)[1]!.response.writeHead(200); posts(server)[1]!.response.end();
      expect(yield* Fiber.join(task)).toMatchObject({ _tag: "Failure", failure: { reason: "notification changed; refresh before retrying" } });
      expect(yield* read(id)).not.toHaveProperty("delivery");
      expect(posts(server)).toHaveLength(2);
      const attempts = yield* eventsOf("client.AlertDelivered");
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.event.generation).toBeLessThan((yield* eventsOf("client.AlertCarrierChanged")).at(-1)!.sequence);
    }), { clockAt: start });
  } finally { await server.close(); }
});


it("a latched delivery-write failure refuses later manual retries before another network send", async () => {
  const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID());
      const id = yield* raiseQuestion("latched-retry"); yield* failed(id);
      const shown = yield* identity(id);
      const sql = yield* SqlClient.SqlClient;
      yield* sql.unsafe("CREATE TRIGGER reject_manual_delivery BEFORE INSERT ON events WHEN NEW.event_type = 'client.AlertDelivered' BEGIN SELECT RAISE(ABORT, 'test delivery write rejected'); END");
      server.respond(({ response }) => { response.writeHead(200); response.end(); });
      expect(yield* retry(shown)).toMatchObject({ _tag: "Failure", failure: { _tag: "LogWriteFailed" } });
      expect(posts(server)).toHaveLength(2);
      yield* sql.unsafe("DROP TRIGGER reject_manual_delivery");
      expect(yield* retry(shown)).toMatchObject({ _tag: "Failure", failure: { _tag: "LogWriteFailed" } });
      expect(posts(server)).toHaveLength(2);
      expect(yield* read(id)).toMatchObject({ delivery: { status: "failed", attempt: 1 } });
    }), { clockAt: start });
  } finally { await server.close(); }
});
