import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { eventsOf } from "../support/alertsRig.ts";
import { call, makeRig, ownerCredential, removeRig, success } from "../support/handlerRig.ts";
import { configure, delivered, failed, ntfyServer, posted, posts, raiseQuestion, setToken, withCarrier } from "../support/carrierRig.ts";
import { pause } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it("6.11 switching topic A to B resends an already delivered alert in B's generation, including after restart", async () => {
  const rig = makeRig(); const server = await ntfyServer(); let id = ""; let oldGeneration = 0;
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin, "A"); id = yield* raiseQuestion();
      const first = yield* delivered(id); expect(first).toHaveLength(1); oldGeneration = first[0]!.event.generation;
    }), { rig });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin, "B");
      const both = yield* delivered(id, 2); expect(both).toHaveLength(2);
      const generation = (yield* eventsOf("client.AlertCarrierChanged")).at(-1)!.sequence;
      expect(both[1]!.event).toMatchObject({ generation, attempt: 1 }); expect(generation).toBeGreaterThan(oldGeneration);
      expect(posts(server).map((row) => row.headers["content-type"]?.includes("application/json")
        ? (JSON.parse(row.body) as { topic: string }).topic : row.url.split("/")[1])).toEqual(["A", "B"]);
    }), { rig, initialize: false });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); const barrier = yield* raiseQuestion("restart-barrier"); expect(yield* delivered(barrier)).toHaveLength(1);
      expect(yield* delivered(id, 2)).toHaveLength(2); expect(posts(server)).toHaveLength(3);
    }), { rig, initialize: false });
  } finally { await server.close(); removeRig(rig); }
});

it("6.11 a late success from topic A cannot settle B while B is failing", async () => {
  const server = await ntfyServer(); const rig = makeRig(); let id = "";
  server.respond(({ url, response }) => { if (url.startsWith("/B")) { response.writeHead(503); response.end(); } });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin, "A"); id = yield* raiseQuestion();
      expect(yield* posted(server)).toHaveLength(1);
      const old = posts(server)[0]!;
      yield* configure(server.origin, "B"); expect(yield* failed(id)).toHaveLength(1);
      old.response.writeHead(200); old.response.end();
      const oldResult = yield* delivered(id); expect(oldResult).toHaveLength(1);
      expect(oldResult[0]!.event.generation).toBeLessThan((yield* eventsOf("client.AlertCarrierChanged")).at(-1)!.sequence);
    }), { rig, clockAt: 1_800_000_000_000 });
    server.respond(({ response }) => { response.writeHead(200); response.end(); });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* TestClock.adjust(5_000);
      const both = yield* delivered(id, 2); expect(both).toHaveLength(2);
      expect(both[1]!.event.generation).toBe((yield* eventsOf("client.AlertCarrierChanged")).at(-1)!.sequence);
    }), { rig, initialize: false, clockAt: 1_800_000_000_000 });
  } finally { await server.close(); removeRig(rig); }
});

it("6.11 five authorization failures recover with a new token; token changes never resend delivered alerts", async () => {
  const rig = makeRig(); const server = await ntfyServer(); const repaired = randomUUID(); let id = "";
  server.respond(({ headers, response }) => { response.writeHead(headers.authorization === `Bearer ${repaired}` ? 200 : 401); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID(), "bad");
      id = yield* raiseQuestion(); expect(yield* failed(id)).toHaveLength(1);
      for (const [index, wait] of [5_000, 30_000, 120_000, 600_000].entries()) {
        yield* TestClock.adjust(wait); expect(yield* failed(id, index + 2)).toHaveLength(index + 2);
      }
      expect((yield* failed(id, 5))[4]!.event).toMatchObject({ final: true });
    }), { rig, clockAt: 1_800_000_000_000 });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* setToken(server.origin, repaired, "fixed");
      const result = yield* delivered(id); expect(result).toHaveLength(1);
      expect(result[0]!.event).toMatchObject({ generation: (yield* eventsOf("client.AlertCarrierTokenSet")).at(-1)!.sequence, attempt: 1 });
      expect(posts(server)).toHaveLength(6);
      yield* setToken(server.origin, randomUUID(), "rotate-after-delivery");
      yield* TestClock.adjust(600_000); yield* pause(20);
      expect(posts(server)).toHaveLength(6);
    }), { rig, initialize: false, clockAt: 1_800_000_755_000 });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* TestClock.adjust(600_000); yield* pause(20);
      expect(posts(server)).toHaveLength(6);
      expect(yield* delivered(id)).toHaveLength(1);
      // The carrier settings stay usable through the same authenticated read.
      expect(success(yield* call(ownerCredential, "client.alerts.settings", {})).tokenSet).toBe(true);
    }), { rig, initialize: false, clockAt: 1_800_001_355_000 });
  } finally { await server.close(); removeRig(rig); }
});

it("6.11 an old token's late success does not settle a new token generation across restart", async () => {
  const server = await ntfyServer(); const rig = makeRig(); const oldToken = randomUUID(); const newToken = randomUUID(); let id = "";
  server.respond(({ headers, response }) => { if (headers.authorization === `Bearer ${newToken}`) { response.writeHead(401); response.end(); } });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, oldToken, "old");
      id = yield* raiseQuestion(); expect(yield* posted(server)).toHaveLength(1);
      yield* setToken(server.origin, newToken, "new"); expect(yield* failed(id)).toHaveLength(1);
      posts(server)[0]!.response.writeHead(200); posts(server)[0]!.response.end();
      const result = yield* delivered(id); expect(result).toHaveLength(1);
      expect(result[0]!.event.generation).toBeLessThan((yield* eventsOf("client.AlertCarrierTokenSet")).at(-1)!.sequence);
    }), { rig, clockAt: 1_800_000_000_000 });
    server.respond(({ response }) => { response.writeHead(200); response.end(); });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* TestClock.adjust(5_000);
      const both = yield* delivered(id, 2); expect(both).toHaveLength(2);
      expect(both[1]!.event.generation).toBe((yield* eventsOf("client.AlertCarrierTokenSet")).at(-1)!.sequence);
      expect(posts(server).at(-1)!.headers.authorization === `Bearer ${newToken}`).toBe(true);
    }), { rig, initialize: false, clockAt: 1_800_000_000_000 });
  } finally { await server.close(); removeRig(rig); }
});
