import { randomBytes } from "node:crypto";
import type { Event } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { EventEnvelope } from "@shephrd/contracts";
import { expect, it } from "vitest";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { useRules, rulesFixture, type Caller } from "../support/callerRules.ts";
import { freshRequest } from "../support/handlerRig.ts";
import { withFixture } from "../support/fixturePiece.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as SqlClient from "effect/sql/SqlClient";

it("1.46 redaction preserves caller and sender ids, source namespace and rule while hiding the same values in text", async () => {
  const word = randomBytes(16).toString("hex");
  const service = `roles.${word}`;
  const rule = `rule-${word}`;
  // A namespace is a fixed public name. Registering that word here checks
  // identity handling for short values without storing a credential fixture.
  const redactor = makeRedactor({ secrets: () => [Redacted.make(word), Redacted.make("client")], tokenHashes: () => new Set() });
  const events = [
    { _tag: "PermissionAnswered", agentId: "agent", permissionRequestId: "permission", answeredBy: { _tag: "service", service, rule }, answer: { _tag: "selected", optionId: "once" } },
    { _tag: "DeliveryQueued", delivery: { id: "delivery", target: "agent", sender: { _tag: "piece", namespace: "client" }, source: { _tag: "piece", namespace: "client", id: "post" }, content: { _tag: "prompt", text: `client ${word}` } } },
    { _tag: "PromptSent", agentId: "agent", deliveryId: "delivery", sender: { _tag: "service", service }, text: `client ${word}` },
  ];
  const cleaned = await Effect.runPromise(Effect.gen(function* () {
    const redact = yield* Redactor;
    return yield* Effect.forEach(events, (event) => redact.redact(event as unknown as Event));
  }).pipe(Effect.provide(redactor.layer)));
  expect(cleaned[0]).toMatchObject({ answeredBy: { _tag: "service", service, rule } });
  expect(cleaned[1]).toMatchObject({ delivery: { sender: { _tag: "piece", namespace: "client" }, source: { namespace: "client" }, content: { text: "[REDACTED] [REDACTED]" } } });
  expect(cleaned[2]).toMatchObject({ sender: { service }, text: "[REDACTED] [REDACTED]" });
});

it("1.46 receipt identity exemptions survive the real writer while free-text key and toolInput fields stay redacted", async () => {
  const lists = await rulesFixture();
  const word = randomBytes(16).toString("hex");
  const redactor = makeRedactor({ secrets: () => [Redacted.make(word)], tokenHashes: () => new Set() });
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const log = yield* EventLog;
    const caller = { _tag: "service" as const, service: `roles.${word}`, rule: `rule-${word}` };
    const event = { _tag: "PermissionAnswered", agentId: "agent", permissionRequestId: "permission", answeredBy: caller, answer: { _tag: "selected", optionId: "once" } };
    const id = freshRequest();
    // The schema widening is tested separately. This writer call must also
    // preserve identity fields in nested receipt envelopes.
    expect(Schema.is(EventEnvelope)({ sequence: 1, eventId: "test", occurredAt: 0, caller, event }), "E11/E14 must accept service audit identities").toBe(true);
    const append = log.append as unknown as (caller: Caller, requestId: typeof id, hash: string, events: Event[], rows: object) => ReturnType<typeof log.append>;
    yield* append(caller, id, "hash", [event as unknown as Event], {});
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${id}`;
    expect(JSON.parse(rows[0]!.result_json)).toMatchObject([{ caller, event: { answeredBy: caller } }]);
  }), { redactor: redactor.layer });
});
