import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { call, ownerCredential, success } from "../support/handlerRig.ts";
import { eventsOf } from "../support/alertsRig.ts";
import { configure, failed, ntfyServer, posts, raiseQuestion, setToken, withCarrier } from "../support/carrierRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it.each([
  ["https://PUSH.EXAMPLE:443", "https://push.example"],
  ["http://127.1", "http://127.0.0.1"],
  ["http://10.2.3.4", "http://10.2.3.4"],
  ["http://172.16.0.1", "http://172.16.0.1"],
  ["http://192.168.3.4", "http://192.168.3.4"],
  ["http://169.254.1.2", "http://169.254.1.2"],
  ["http://[::1]", "http://[::1]"],
  ["http://[fd12::1]", "http://[fd12::1]"],
  ["http://[fe80::1]", "http://[fe80::1]"],
  ["http://[::ffff:192.168.1.1]", "http://[::ffff:c0a8:101]"],
])("6.15 accepts %s using the URL parser's canonical private or encrypted origin", async (input, want) => {
  await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* configure(input!);
    expect(success(yield* call(ownerCredential, "client.alerts.settings", {})).carrier)
      .toEqual({ _tag: "ntfy", server: want, topic: "owner_alerts" });
    expect((yield* eventsOf("client.AlertCarrierChanged")).at(-1)?.event.carrier)
      .toEqual({ _tag: "ntfy", server: want, topic: "owner_alerts" });
  }));
});

it.each([
  "http://push.example", "http://localhost", "http://8.8.8.8", "http://172.15.255.255",
  "http://172.32.0.1", "http://192.169.0.1", "http://[2001:4860:4860::8888]",
  "http://[::ffff:8.8.8.8]", "ftp://127.0.0.1", "https://user@push.example",
  "https://user:password@push.example", "https://push.example/path", "https://push.example?topic=x",
  "https://push.example#fragment", "not a URL",
])("6.15 refuses unsafe server %s without changing the committed destination", async (server) => {
  await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* configure("https://push.example");
    const before = yield* eventsOf("client.AlertCarrierChanged");
    const outcome = yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { _tag: "ntfy", server, topic: "owner_alerts" } });
    expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
    expect(yield* eventsOf("client.AlertCarrierChanged")).toEqual(before);
    expect(success(yield* call(ownerCredential, "client.alerts.settings", {})).carrier.server).toBe("https://push.example");
  }));
});

it.each(["", "a/b", "has space", "line\nbreak", "é", "a?x=y", "a".repeat(65)])(
  "6.15 rejects an invalid topic %j rather than letting it alter an HTTP path", async (topic) => {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* configure("https://push.example", "a".repeat(64));
      const before = yield* eventsOf("client.AlertCarrierChanged");
      expect(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { _tag: "ntfy", server: "https://push.example", topic } }))
        .toMatchObject({ _tag: "Failure" });
      expect(yield* eventsOf("client.AlertCarrierChanged")).toEqual(before);
    }));
  });

it("6.15 a redirect is a failed attempt and never reaches the redirect's server", async () => {
  const first = await ntfyServer(); const trap = await ntfyServer();
  first.respond(({ response }) => { response.writeHead(307, { location: `${trap.origin}/stolen` }); response.end(); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* configure(first.origin);
      yield* setToken(first.origin, randomUUID());
      const id = yield* raiseQuestion();
      expect(yield* failed(id)).toHaveLength(1);
      expect(posts(first)).toHaveLength(1);
      expect(trap.requests).toHaveLength(0);
      expect(yield* eventsOf("client.AlertDelivered")).toHaveLength(0);
    }));
  } finally { await first.close(); await trap.close(); }
});

it("6.15 an over-64-KiB response is bounded even when the server keeps streaming", async () => {
  const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(200); response.write(Buffer.alloc(65_537, 120)); /* no end */ });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* configure(server.origin);
      const id = yield* raiseQuestion();
      // Must finish reading or abort at the bound, before the 10-second send
      // timeout. This observes the real response socket, not a fetch mock.
      const { eventually } = yield* Effect.promise(() => import("../support/routingRig.ts"));
      expect(yield* eventually(Effect.sync(() => server.requests[0]?.response.destroyed === true), Boolean)).toBe(true);
      const attempts = [...yield* eventsOf("client.AlertDelivered"), ...yield* eventsOf("client.AlertDeliveryFailed")];
      expect(attempts.some((row) => row.event.alertId === id)).toBe(true);
    }));
  } finally { await server.close(); }
});
