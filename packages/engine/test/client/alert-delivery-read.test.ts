import { Alert } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { SecretStore } from "../../src/commands/SecretStore.ts";
import { append, eventsOf } from "../support/alertsRig.ts";
import { call, makeRig, ownerCredential, removeRig, success } from "../support/handlerRig.ts";
import { configure, delivered, failed, ntfyServer, posted, posts, raiseQuestion, setToken, withCarrier } from "../support/carrierRig.ts";
import { pause } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const startTime = 1_800_000_000_000;
const read = (id: string) => Effect.gen(function* () {
  const page = success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 }));
  const alert = page.items.find((item: { alertId: string }) => item.alertId === id);
  expect(alert).toBeDefined();
  // Exercise the public schema too: a field dropped on the wire is still lost.
  return Schema.decodeUnknownSync(Alert)(alert);
});

it("FR-017 owner reads retain fifth failure across restart, then show recovery and clear without losing retries", async () => {
  const rig = makeRig(); const server = await ntfyServer(); let id = ""; let generation = 0;
  server.respond(({ response }) => { response.writeHead(503); response.end("Untrusted carrier response."); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); id = yield* raiseQuestion();
      const first = yield* failed(id); generation = first[0]!.event.generation;
      expect(yield* read(id)).toMatchObject({ status: "open", delivery: {
        status: "failed", generation, attempt: 1, reason: "carrier delivery failed", final: false,
      } });
      for (const [index, wait] of [5_000, 30_000, 120_000, 600_000].entries()) {
        yield* TestClock.adjust(wait); yield* failed(id, index + 2);
      }
      expect(yield* read(id)).toMatchObject({ status: "open", delivery: {
        status: "failed", generation, attempt: 5, reason: "carrier delivery failed", final: true,
      } });
    }), { rig, clockAt: startTime });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect(yield* read(id)).toMatchObject({ delivery: { status: "failed", attempt: 5, final: true } });
      yield* TestClock.adjust(599_999); yield* pause(20); expect(posts(server)).toHaveLength(5);
      server.respond(({ response }) => { response.writeHead(200); response.end(); });
      yield* TestClock.adjust(1); yield* delivered(id);
      expect(yield* read(id)).toMatchObject({ delivery: { status: "delivered", generation, attempt: 6 } });
      expect((yield* read(id)).delivery).not.toHaveProperty("reason");
      expect((yield* read(id)).delivery).not.toHaveProperty("final");
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: id }));
      expect(yield* read(id)).toMatchObject({ status: "cleared", delivery: { status: "delivered", attempt: 6 } });
      yield* TestClock.adjust(600_000); yield* pause(20); expect(posts(server)).toHaveLength(6);
    }), { rig, initialize: false, clockAt: startTime + 755_000 });
  } finally { await server.close(); removeRig(rig); }
});

it("FR-017 a missing backing token is readable without posting, and token replacement clears that failure", async () => {
  const server = await ntfyServer();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      yield* setToken(server.origin, "test-token-value", "missing-value");
      const token = (yield* eventsOf("client.AlertCarrierTokenSet")).at(-1)!.event;
      yield* (yield* SecretStore).removeCarrierValue!(token.carrierGeneration);
      const id = yield* raiseQuestion(); yield* failed(id);
      expect(posts(server)).toHaveLength(0);
      expect(yield* read(id)).toMatchObject({ delivery: {
        status: "failed", attempt: 1, reason: "token missing", final: false,
      } });
      yield* setToken(server.origin, "replacement-token", "replacement"); yield* delivered(id);
      const generation = (yield* eventsOf("client.AlertCarrierTokenSet")).at(-1)!.sequence;
      expect(yield* read(id)).toMatchObject({ delivery: { status: "delivered", generation, attempt: 1 } });
      expect(posts(server)).toHaveLength(1);
      yield* setToken(server.origin, "rotated-token", "rotate-delivered");
      const rotated = (yield* eventsOf("client.AlertCarrierTokenSet")).at(-1)!.sequence;
      expect(yield* read(id)).toMatchObject({ delivery: { status: "delivered", generation: rotated, attempt: 1 } });
      yield* TestClock.adjust(600_000); yield* pause(20); expect(posts(server)).toHaveLength(1);
    }), { clockAt: startTime });
  } finally { await server.close(); }
});

it("FR-017 owner reads ignore old generation results and clearing a failing alert stops its retries", async () => {
  const server = await ntfyServer();
  server.respond(({ url, response }) => { if (url.startsWith("/B")) { response.writeHead(503); response.end(); } });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin, "A");
      const id = yield* raiseQuestion(); yield* posted(server);
      expect(yield* read(id)).not.toHaveProperty("delivery");
      const old = posts(server)[0]!;
      yield* configure(server.origin, "B"); yield* failed(id);
      const generation = (yield* eventsOf("client.AlertCarrierChanged")).at(-1)!.sequence;
      old.response.writeHead(200); old.response.end(); yield* delivered(id);
      expect(yield* read(id)).toMatchObject({ delivery: { status: "failed", generation, attempt: 1 } });
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: id }));
      yield* TestClock.adjust(600_000); yield* pause(20);
      expect(posts(server)).toHaveLength(2);
      expect(yield* read(id)).toMatchObject({ status: "cleared", delivery: { status: "failed", generation } });
      yield* configure(server.origin, "C");
      expect(yield* read(id)).not.toHaveProperty("delivery");
    }), { clockAt: startTime });
  } finally { await server.close(); }
});

it("FR-017 failure presentation allows only fixed safe reasons even when replaying an arbitrary historical reason", async () => {
  await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const id = yield* raiseQuestion();
    yield* append({ _tag: "client.AlertDeliveryFailed", alertId: id, carrier: "ntfy", generation: 0,
      attempt: 5, reason: "Untrusted historical diagnostic.", final: true });
    expect(yield* read(id)).toMatchObject({ delivery: {
      status: "failed", generation: 0, attempt: 5, reason: "carrier delivery failed", final: true,
    } });
  }));
});
