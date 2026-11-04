import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { loadLists, withFixture } from "../support/fixturePiece.ts";
import { freshRequest } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// A synthetic collision value, never a real credential.
const marker = "beef";
const roleFileHash = marker.repeat(16);
const instance = () => makeRedactor({ secrets: () => [Redacted.make(marker)], tokenHashes: () => new Set() });
const redact = (event: Record<string, unknown>) => Effect.gen(function* () {
  const redactor = yield* Redactor;
  return yield* redactor.redact(event as never);
}).pipe(Effect.provide(instance().layer));

it("RI01 action subject, notice recipient and post identities survive a registered text collision", async () => {
  const event = {
    _tag: "roles.StallSeen", agentId: "agent-beef", noticeRecipient: "lead-beef", postId: "post-beef",
    triggerSequence: 1, sourceSequence: 2, occurrence: 1, notice: "sent",
  };
  expect(await Effect.runPromise(redact(event))).toEqual(event);
});

it("RI02 a committed role-file reply preserves roleFileHash while generic hash and recipient fields still redact", async () => {
  await withFixture(await loadLists(), () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const log = yield* EventLog;
    const requestId = freshRequest();
    yield* log.append({ _tag: "owner" }, requestId, "a".repeat(64), [], {}, () => ({
      requestId, roleFileHash, hash: marker, recipient: marker,
    }));
    const sql = yield* SqlClient.SqlClient;
    const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`;
    expect(JSON.parse(receipts[0]!.result_json).reply).toEqual({
      requestId, roleFileHash, hash: "[REDACTED]", recipient: "[REDACTED]",
    });
  }), { redactor: instance().layer });
});

it("RI03 only the named role-file identity bypasses redaction; content, advice, role/group names and generic fields remain text", async () => {
  const event = {
    _tag: "roles.RoleFileSet", roleFileHash, content: marker, advice: marker,
    role: `worker:${marker}`, group: marker, hash: marker, recipient: marker,
  };
  expect(await Effect.runPromise(redact(event))).toEqual({
    ...event, roleFileHash, content: "[REDACTED]", advice: "[REDACTED]",
    role: "worker:[REDACTED]", group: "[REDACTED]", hash: "[REDACTED]", recipient: "[REDACTED]",
  });
});
