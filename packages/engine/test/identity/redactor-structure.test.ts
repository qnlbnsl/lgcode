import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { AgentId, Event, RequestId } from "@shephrd/contracts";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { expect } from "vitest";

import { makeRedactor } from "../../src/identity/redactor.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Views from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const agentId = Schema.decodeUnknownSync(AgentId)("1b4e28ba-2fa1-4a64-8711-123456789abc");
const instance = (secret: string) => makeRedactor({ secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set() });
const event = (text: string): Event => ({ _tag: "ThreadItem", agentId, itemId: "item", content: { _tag: "text", text }, replay: false });

it.effect("board completionReplyText preserves a whole post id containing a registered secret", () => {
  // A synthetic collision marker, never an actual credential.
  const marker = "synthetic-collision";
  const postId = `post-before-${marker}-after`;
  const wake = Schema.decodeUnknownSync(Event)({
    _tag: "board.WakeBuilt", wakeId: "wake", targetAgentId: "target", carried: [], mustReply: [],
    completions: [postId], completionReplyText: [postId], reminders: [], noAnswers: [],
  });
  return Effect.gen(function* () {
    const redactor = yield* Redactor;
    const redacted = yield* redactor.redact(wake);
    expect(redacted._tag).toBe("board.WakeBuilt");
    if (redacted._tag !== "board.WakeBuilt") throw new Error("wrong event tag");
    expect(redacted.completionReplyText).toEqual([postId]);
    expect(yield* redactor.redact(event(marker))).toEqual(event("[REDACTED]"));
  }).pipe(Effect.provide(instance(marker).layer));
});

it.effect.each(["x", "1", "text", "ThreadItem", agentId])(
  "A4 explicit secret %s preserves object keys, tags and a UUID agentId, but still redacts text",
  (secret) => Effect.gen(function* () {
    const redactor = yield* Redactor;
    expect(yield* redactor.redact(event(secret))).toEqual(event("[REDACTED]"));
  }).pipe(Effect.provide(instance(secret).layer)),
);

it.effect("A4 event and receipt identities survive collisions while record values are still redacted", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync("/tmp/shephrd-a4-")),
    (folder) => Effect.gen(function* () {
      yield* migrate;
      return yield* Effect.gen(function* () {
        yield* registerRebuildCheck();
        const log = yield* EventLog.EventLog;
        const sql = yield* SqlClient.SqlClient;
        const rid = Schema.decodeUnknownSync(RequestId)("acct");
        const redactor = yield* Redactor;
        const account = { id: "acct", harness: "fake", displayName: "acct", environment: { _tag: "acct", id: "acct", agentId: "acct", text: "acct" } } as never;
        const input: Event = { _tag: "AccountChanged", accountId: "acct" as never, account };
        expect.soft(yield* redactor.redact(input)).toEqual({ ...input, account: {
          id: "acct", harness: "fake", displayName: "[REDACTED]",
          environment: { _tag: "[REDACTED]", id: "[REDACTED]", agentId: "[REDACTED]", text: "[REDACTED]" },
        } });
        yield* log.append({ _tag: "owner" }, rid, "a".repeat(64), [input], {}, () => ({
          requestId: rid, agentId, deliveryId: "acct", accounts: [account],
          text: "acct", _tag: "acct", ["acct"]: "acct",
        }));
        const rows = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts`;
        expect(JSON.parse(rows[0]!.result_json).reply).toEqual({
          requestId: rid, agentId, deliveryId: "acct", accounts: [{
            id: "acct", harness: "fake", displayName: "[REDACTED]",
            environment: { _tag: "[REDACTED]", id: "[REDACTED]", agentId: "[REDACTED]", text: "[REDACTED]" },
          }], text: "[REDACTED]", _tag: "acct", acct: "[REDACTED]",
        });
      }).pipe(Effect.scoped, Effect.provide(EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provideMerge(instance("acct").layer))));
    }).pipe(Effect.provide(SqliteClient.layer({ filename: join(folder, "events.sqlite") })), Effect.scoped),
    (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
  ),
);

it.effect.each([
  { _tag: "DeliveryQueued", delivery: { id: "acct", target: "acct", sender: { _tag: "agent", agentId: "acct" }, content: { _tag: "prompt", text: "safe" }, source: { _tag: "question", id: "acct" } } },
  { _tag: "WaitOpened", agentId: "acct", waitId: "acct", members: ["acct"], mode: "all", blocking: false },
  { _tag: "WaitSatisfied", agentId: "acct", waitId: "acct", members: [{ agentId: "acct", reason: "settled" }] },
  { _tag: "PermissionMoved", agentId: "acct", permissionRequestId: "acct", deliveryId: "acct", from: { _tag: "agent", agentId: "acct" }, to: { _tag: "owner" } },
  { _tag: "QuestionMoved", agentId: "acct", questionId: "acct", deliveryId: "acct", from: { _tag: "owner" }, to: { _tag: "agent", agentId: "acct" } },
  { _tag: "OwnerNeeded", agentId: "acct", reason: "safe", subject: { _tag: "permission", id: "acct" } },
  { _tag: "SessionOpened", agentId: "acct", session: { _tag: "acp", sessionId: "safe" }, protocolVersion: 2, reloadable: true,
    process: { groupId: 42, bootId: "acct", startTime: "123", userId: 1000, executable: "/tmp/safe" } },
])("A4 $_tag preserves nested branded identities even when they equal an explicit secret", (input) =>
  Effect.gen(function* () {
    const redactor = yield* Redactor;
    expect(yield* redactor.redact(input as Event)).toEqual(input);
  }).pipe(Effect.provide(instance("acct").layer)),
);
