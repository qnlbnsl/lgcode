import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { randomBytes } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { requiredModule, rulesFixture, useRules, type Services } from "../support/callerRules.ts";
import { freshRequest, seedAgent, seedAccount, seedHarness, startPayload, appendSetup, eventOf } from "../support/handlerRig.ts";
import { withFixture } from "../support/fixturePiece.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";

for (const command of ["prompt", "compact", "resume"] as const) {
  it(`1.12 service ${command}: catches tree restrictions on a listed service or owner attribution on its writes`, async () => {
    const services = await requiredModule<Services>("commands/services.ts");
    const lists = await rulesFixture();
    await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount(); yield* seedHarness();
      const target = yield* seedAgent({ id: "unrelated", state: command === "resume" ? "crashed" : "idle" });
      const sql = yield* SqlClient.SqlClient;
      const mark = (yield* sql<{ sequence: number }>`SELECT MAX(sequence) AS sequence FROM events`)[0]!.sequence;
      const id = freshRequest();
      yield* services.executeService({ _tag: "service", service: "client.fixture" }, command, {
        requestId: id, agentId: target.agentId, text: "/clear\nUntrusted service nudge.",
      }, lists);
      const rows = yield* sql<{ caller: string; payload_json: string }>`SELECT caller, payload_json FROM events WHERE request_id = ${id}`;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.caller === "service:client.fixture")).toBe(true);
      expect(rows.map((row) => JSON.parse(row.payload_json)._tag)).not.toContain("CommandRefused");
      if (command === "resume") {
        // Reload writes occur after the command's commit, under fresh ids.
        const later = yield* sql<{ caller: string }>`SELECT caller FROM events WHERE event_type = 'SessionOpened' AND agent_id = ${target.agentId} AND sequence > ${mark} AND request_id != ${id}`;
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

for (const fresh of [false, true]) {
  for (const rule of [undefined, "reload-fixture"]) {
    it(`1.12 service resume ${fresh ? "start" : "load"}, rule ${rule ?? "absent"}: catches owner attribution, lost rules or live tokens after rejected setup`, async () => {
      const services = await requiredModule<Services>("commands/services.ts");
      const lists = await rulesFixture();
      const runner = await Effect.runPromise(makeFakeRunner());
      await withFixture(lists, () => Effect.gen(function* () {
        yield* registerRebuildCheck();
        yield* seedAccount(); yield* seedHarness();
        const target = yield* seedAgent({ id: "rejected-service-resume", state: "crashed" });
        const method = fresh ? "start" : "load";
        runner.rejectNext(method, "fixture setup rejected");
        const sql = yield* SqlClient.SqlClient;
        const mark = (yield* sql<{ sequence: number }>`SELECT MAX(sequence) AS sequence FROM events`)[0]!.sequence;
        const id = freshRequest();
        yield* services.executeService({ _tag: "service", service: "client.fixture", ...(rule === undefined ? {} : { rule }) }, "resume", {
          requestId: id, agentId: target.agentId, fresh,
        }, lists);
        // Observe the later failure transaction, including every row regardless
        // of caller, rather than filtering away the attribution fault.
        const later = sql<{ sequence: number; request_id: string; caller: string; caller_rule: string | null; payload_json: string }>`
          SELECT sequence, request_id, caller, caller_rule, payload_json FROM events
          WHERE agent_id = ${target.agentId} AND sequence > ${mark} ORDER BY sequence`;
        for (let tries = 0; tries < 100; tries++) {
          if ((yield* later).some((row) => JSON.parse(row.payload_json)._tag === "AgentReloadFailed")) break;
          yield* Effect.sleep(10);
        }
        const rows = yield* later;
        expect(rows.map((row) => JSON.parse(row.payload_json))).toEqual([
          { _tag: "StateChanged", agentId: target.agentId, state: { _tag: "starting" } },
          { _tag: "StateChanged", agentId: target.agentId, state: { _tag: "interrupted", previous: "starting" } },
          { _tag: "AgentReloadFailed", agentId: target.agentId, reason: "agent reload failed" },
        ]);
        expect(rows.map((row) => [row.caller, row.caller_rule])).toEqual([
          ["service:client.fixture", rule ?? null],
          ["service:client.fixture", rule ?? null],
          ["service:client.fixture", rule ?? null],
        ]);
        expect(rows[0]!.request_id).toBe(id);
        expect(rows[1]!.request_id).not.toBe(id);
        expect(rows[1]!.request_id).toBe(rows[2]!.request_id);
        expect(runner.callsOf(method).map((call) => call.input.agentId)).toEqual([target.agentId]);
        expect(runner.callsOf(fresh ? "load" : "start")).toHaveLength(0);
        expect(runner.callsOf("prompt")).toHaveLength(0);
        // Both the old crash token and the newly minted setup token are dead.
        const tokens = yield* sql<{ revoked_at: number | null }>`SELECT revoked_at FROM agent_tokens WHERE agent_id = ${target.agentId}`;
        expect(tokens).toHaveLength(2);
        expect(tokens.every((row) => row.revoked_at !== null)).toBe(true);
      }), { runner });
    });
  }
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
