import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { randomBytes } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { requiredModule, rulesFixture, useRules, type Services } from "../support/callerRules.ts";
import { freshRequest, seedAgent, seedAccount, seedHarness, startPayload, appendSetup, eventOf } from "../support/handlerRig.ts";

for (const command of ["prompt", "compact", "resume"] as const) {
  it(`1.12 service ${command}: catches tree restrictions on a listed service or owner attribution on its writes`, async () => {
    const services = await requiredModule<Services>("commands/services.ts");
    const lists = await rulesFixture();
    await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount(); yield* seedHarness();
      const target = yield* seedAgent({ id: "unrelated", state: command === "resume" ? "crashed" : "idle" });
      const id = freshRequest();
      yield* services.executeService({ _tag: "service", service: "client.fixture" }, command, {
        requestId: id, agentId: target.agentId, text: "/clear\nUntrusted service nudge.",
      }, lists);
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ caller: string; payload_json: string }>`SELECT caller, payload_json FROM events WHERE request_id = ${id}`;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.caller === "service:client.fixture")).toBe(true);
      expect(rows.map((row) => JSON.parse(row.payload_json)._tag)).not.toContain("CommandRefused");
      if (command === "resume") {
        // Reload writes occur after the command's commit, under fresh ids.
        const later = yield* sql<{ caller: string }>`SELECT caller FROM events WHERE event_type = 'SessionOpened' AND request_id != ${id} AND caller != 'owner'`;
        expect(later.length).toBeGreaterThan(0);
        expect(later.every((row) => row.caller === "service:client.fixture")).toBe(true);
      } else {
        const queued = rows.map((row) => JSON.parse(row.payload_json)).find((e) => e._tag === "DeliveryQueued");
        expect(queued.delivery.sender).toEqual({ _tag: "service", service: "client.fixture" });
        if (command === "prompt") expect(queued.delivery.content.text).toContain("\\/clear");
      }
    }));
  });
}

for (const command of ["answer", "start", "stop", "group", "pass-up", "ask", "wait", "accounts", "accounts set-secret", "accounts mark-available", "harnesses", "debug.compare-views"]) {
  it(`1.12 service ${command}: catches any service gaining this forbidden engine right`, async () => {
    const services = await requiredModule<Services>("commands/services.ts");
    const lists = await rulesFixture();
    // Even a mistaken service entry cannot expand the engine's maximum rights.
    lists.services["client.fixture"] = [command];
    await useRules(lists, (rig) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount(); yield* seedHarness();
      const target = yield* seedAgent({ id: "target" });
      yield* appendSetup([eventOf({ _tag: "PermissionRequested", agentId: target.agentId, permissionRequestId: "request", holder: { _tag: "agent", agentId: target.agentId }, deliveryId: "permission-delivery", toolCallId: "tool", description: "Test action.", options: [{ id: "once", name: "Allow once", kind: "allow_once", level: "ask", persistent: false }], settingsWrite: false })]);
      const outcome = yield* services.executeService({ _tag: "service", service: "client.fixture" }, command, {
        ...startPayload(rig), requestId: freshRequest(), agentId: target.agentId, operation: "list", add: [], remove: [],
        accountId: "primary", name: "CREDENTIAL", nonce: "nonce", value: Redacted.make(randomBytes(24).toString("hex")),
        kind: "permission", id: "request", optionId: "once", text: "Text.", members: [target.agentId], mode: "all", block: false,
        subject: { _tag: "permission", id: "request" },
      }, lists).pipe(Effect.result);
      expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
      const sql = yield* SqlClient.SqlClient;
      expect(yield* sql`SELECT event_type FROM events WHERE caller = 'service:client.fixture' AND event_type != 'CommandRefused'`).toEqual([]);
    }));
  });
}

it("1.12/1.13 catches an unlisted service, a command missing its own service entry, or a piece command missing service access", async () => {
  const services = await requiredModule<Services>("commands/services.ts");
  for (const gate of ["unlisted", "entry", "access"]) {
    const lists = await rulesFixture();
    if (gate === "entry") lists.services["client.fixture"] = [];
    if (gate === "access") (lists.access as Record<string, string[]>)["client.record"] = ["owner"];
    await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const outcome = yield* services.executeService({ _tag: "service", service: gate === "unlisted" ? "client.unknown" : "client.fixture" }, "client.record", {
        requestId: freshRequest(), id: "refused", text: "Data.",
      }, lists).pipe(Effect.result);
      expect(outcome, gate).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
      const sql = yield* SqlClient.SqlClient;
      expect(yield* sql`SELECT * FROM client_fixture`).toEqual([]);
    }));
  }
});

it("1.12 catches a service subscription bypassing the read table or losing owner-only events", async () => {
  const services = await requiredModule<Services>("commands/services.ts");
  const lists = await rulesFixture();
  let invoked = false;
  const original = lists.reads.subscribe as (input: unknown, payload: unknown) => Stream.Stream<unknown, unknown, any>;
  (lists.reads as Record<string, unknown>).subscribe = (input: unknown, payload: unknown) => { invoked = true; return original(input, payload); };
  await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: "private", account: { id: "private", harness: "first", displayName: "Private", enabled: true } })]);
    const rows = yield* services.subscribeService("client.fixture", 0, lists).pipe(Stream.take(1), Stream.runCollect);
    expect(invoked).toBe(true);
    expect(rows[0]?.event._tag).toBe("AccountChanged");
  }));
});
