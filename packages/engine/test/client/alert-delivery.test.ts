import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { call, makeRig, ownerCredential, removeRig, success } from "../support/handlerRig.ts";
import { eventsOf, raised } from "../support/alertsRig.ts";
import { configure, delivered, failed, ntfyServer, posted, posts, raiseQuestion, withCarrier } from "../support/carrierRig.ts";
import { pause } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const startTime = 1_800_000_000_000;

it("6.11 retries at 5s, 30s, 2m, then 10m forever; an hour outage is still failing and later recovers", async () => {
  const server = await ntfyServer(); let healthy = false;
  server.respond(({ response }) => { response.writeHead(healthy ? 200 : 503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      const id = yield* raiseQuestion(); expect(yield* failed(id)).toHaveLength(1);
      const waits = [5_000, 30_000, 120_000, 600_000, 600_000, 600_000, 600_000, 600_000, 600_000];
      for (const [index, wait] of waits.entries()) {
        yield* TestClock.adjust(wait - 1); yield* pause(20);
        expect(posts(server)).toHaveLength(index + 1);
        yield* TestClock.adjust(1);
        const failures = yield* failed(id, index + 2);
        expect(failures).toHaveLength(index + 2);
        expect(failures.at(-1)!.event.attempt).toBe(index + 2);
        if (index + 2 >= 5) expect(failures.at(-1)!.event).toMatchObject({ final: true });
        else expect(failures.at(-1)!.event).not.toMatchObject({ final: true });
      }
      // More than an hour has elapsed. "final" is a display mark, not a stop.
      healthy = true; yield* TestClock.adjust(600_000);
      const delivery = yield* delivered(id); expect(delivery).toHaveLength(1);
      expect(delivery[0]!.event.attempt).toBe(11);
      expect(yield* raised("question:question-6b")).toHaveLength(1);
      expect(posts(server)).toHaveLength(11);
    }), { clockAt: startTime });
  } finally { await server.close(); }
});

it("6.6 a kind disabled during backoff is checked again at send time and recovers when re-enabled", async () => {
  const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      const id = yield* raiseQuestion(); expect(yield* failed(id)).toHaveLength(1);
      success(yield* call(ownerCredential, "client.alerts.settings.set", { kind: "question", push: false }));
      yield* TestClock.adjust(600_000); yield* pause(20); expect(posts(server)).toHaveLength(1);
      server.respond(({ response }) => { response.writeHead(200); response.end(); });
      success(yield* call(ownerCredential, "client.alerts.settings.set", { kind: "question", push: true }));
      expect(yield* delivered(id)).toHaveLength(1); expect(posts(server)).toHaveLength(2);
    }), { clockAt: startTime });
  } finally { await server.close(); }
});

it("6.11 a recorded backoff survives a restart without resetting its deadline or attempt number", async () => {
  const rig = makeRig(); const server = await ntfyServer(); let id = "";
  server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); id = yield* raiseQuestion();
      const failure = yield* failed(id); expect(failure).toHaveLength(1);
      expect(failure[0]!.occurredAt).toBe(startTime);
    }), { rig, clockAt: startTime });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* TestClock.adjust(2_999); yield* pause(20); expect(posts(server)).toHaveLength(1);
      yield* TestClock.adjust(1); expect(yield* failed(id, 2)).toHaveLength(2);
      expect(posts(server)).toHaveLength(2);
      expect((yield* failed(id, 2))[1]!.event.attempt).toBe(2);
      expect(yield* raised("question:question-6b")).toHaveLength(1);
    }), { rig, initialize: false, clockAt: startTime + 2_000 });
  } finally { await server.close(); removeRig(rig); }
});

it("6.11 clearing one alert during backoff skips its retry, while another alert sends without waiting", async () => {
  const server = await ntfyServer(); let healthy = false;
  server.respond(({ response }) => { response.writeHead(healthy ? 200 : 503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      const first = yield* raiseQuestion("first"); expect(yield* failed(first)).toHaveLength(1);
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: first }));
      healthy = true;
      const second = yield* raiseQuestion("second"); expect(yield* delivered(second)).toHaveLength(1);
      expect(posts(server)).toHaveLength(2);
      yield* TestClock.adjust(600_000); yield* pause(20);
      expect(posts(server)).toHaveLength(2);
      expect((yield* eventsOf("client.AlertDelivered")).some((row) => row.event.alertId === first)).toBe(false);
    }), { clockAt: startTime });
  } finally { await server.close(); }
});

it("6.11 an open alert in backoff does not delay a second alert's delivery", async () => {
  const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(503); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      const first = yield* raiseQuestion("backed-off");
      expect(yield* failed(first)).toHaveLength(1);
      expect(success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 })).items
        .find((row: { alertId: string }) => row.alertId === first)).toMatchObject({ status: "open" });
      server.respond(({ response }) => { response.writeHead(200); response.end(); });
      const second = yield* raiseQuestion("independent-backoff");
      const delivery = yield* delivered(second);
      expect(delivery).toHaveLength(1);
      expect(delivery[0]!.occurredAt).toBe(startTime);
      expect(delivery[0]!.event.attempt).toBe(1);
      expect(posts(server)).toHaveLength(2);
      expect((yield* eventsOf("client.AlertDelivered")).some((row) => row.event.alertId === first)).toBe(false);
      expect(yield* failed(first)).toHaveLength(1);
      expect(success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 })).items
        .find((row: { alertId: string }) => row.alertId === first))
        .toMatchObject({ status: "open", delivery: { status: "failed", attempt: 1 } });
      yield* TestClock.adjust(4_999); yield* pause(20);
      expect(posts(server)).toHaveLength(2);
      yield* TestClock.adjust(1);
      const retry = yield* delivered(first);
      expect(retry).toHaveLength(1);
      expect(retry[0]!.event.attempt).toBe(2);
      expect(retry[0]!.occurredAt).toBe(startTime + 5_000);
      expect(posts(server)).toHaveLength(3);
    }), { clockAt: startTime });
  } finally { await server.close(); }
});

it.each(["timeout", "lost response"])("6.11 %s records a failed attempt and retries instead of losing the alert", async (fault) => {
  const server = await ntfyServer();
  server.respond(({ response }) => { if (fault === "lost response") response.destroy(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      const id = yield* raiseQuestion(); expect(yield* posted(server)).toHaveLength(1);
      if (fault === "timeout") {
        yield* TestClock.adjust(9_999); yield* pause(20);
        expect(yield* eventsOf("client.AlertDeliveryFailed")).toHaveLength(0);
        yield* TestClock.adjust(1);
      }
      expect(yield* failed(id)).toHaveLength(1);
      server.respond(({ response }) => { response.writeHead(200); response.end(); });
      yield* TestClock.adjust(5_000); expect(yield* delivered(id)).toHaveLength(1);
      expect(posts(server)).toHaveLength(2);
      expect(yield* raised("question:question-6b")).toHaveLength(1);
    }), { clockAt: startTime });
  } finally { await server.close(); }
});

it("6.11 a failed phone clear runs once and cannot stop delivery of later alerts", async () => {
  const server = await ntfyServer();
  server.respond(({ method, response }) => { response.writeHead(method === "DELETE" ? 503 : 200); response.end("Untrusted carrier response."); });
  const lines: string[] = [];
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      const first = yield* raiseQuestion("first"); expect(yield* delivered(first)).toHaveLength(1);
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: first }));
      const second = yield* raiseQuestion("second"); expect(yield* delivered(second)).toHaveLength(1);
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: first }));
      yield* TestClock.adjust(600_000); yield* pause(20);
      expect(server.requests.filter((row) => row.method === "DELETE")).toHaveLength(1);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).not.toContain("Untrusted carrier response.");
    }), { clockAt: startTime, lines });
  } finally { await server.close(); }
});

it("6.11 an in-flight send holds neither the writer nor another alert's delivery", async () => {
  const server = await ntfyServer(); const timers: ReturnType<typeof setTimeout>[] = [];
  server.respond(({ response }) => {
    if (posts(server).length === 1) {
      // A guard releases a broken implementation so its scope can still close.
      // The assertions require the second send before this response ends.
      timers.push(setTimeout(() => { response.writeHead(200); response.end(); }, 5_000));
    } else { response.writeHead(200); response.end(); }
  });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      yield* raiseQuestion("held"); expect(yield* posted(server)).toHaveLength(1);
      const setting = yield* call(ownerCredential, "client.alerts.settings.set", { kind: "other", push: false }).pipe(Effect.timeout(1_000), Effect.result);
      expect(setting, "a network send must run outside the writer transaction").toMatchObject({ _tag: "Success", success: { _tag: "Success" } });
      const second = yield* raiseQuestion("independent"); expect(yield* delivered(second)).toHaveLength(1);
      expect(posts(server)[0]!.response.writableEnded, "one alert's in-flight request must not serialize all sends").toBe(false);
    }));
  } finally { timers.forEach(clearTimeout); await server.close(); }
});
