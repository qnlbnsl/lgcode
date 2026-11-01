import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { AgentId, RequestId, type Event } from "@shepherd/contracts";
import * as SqliteClient from "@shepherd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { mintAgentToken, verifyAgentToken } from "../../src/identity/tokens.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Redactor from "../../src/log/Redactor.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/shepherd-identity-tokens-");
  vi.stubEnv("HOME", home);
  vi.stubEnv("SHEPHERD_HOME", home);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

const agentId = Schema.decodeUnknownSync(AgentId)("agent-a");
const otherId = Schema.decodeUnknownSync(AgentId)("agent-b");
const request = () => Schema.decodeUnknownSync(RequestId)(randomUUID());
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const opened: Event = {
  _tag: "SessionOpened", agentId, session: { _tag: "acp", sessionId: "session-a" },
  protocolVersion: 2, reloadable: true,
};

const withLog = <A, E>(program: Effect.Effect<A, E, EventLog.EventLog | SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    yield* migrate;
    return yield* program.pipe(Effect.provide(EventLog.layer.pipe(Layer.provide(Redactor.layer))));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })),
    Effect.scoped,
  );

// Format chosen for the otherwise unspecified checksum in decision 73:
// prefix + 32 base64url bytes + '_' + first eight SHA-256 hex digits of those bytes.
it.effect("5.1 format: catches predictable, short, unprefixed or checksum-free agent tokens", () =>
  Effect.sync(() => {
    const issued = Array.from({ length: 64 }, () => mintAgentToken());
    const raw = issued.map(({ token }) => Redacted.value(token));
    expect(new Set(raw).size).toBe(64);
    for (const [index, value] of raw.entries()) {
      expect(value).toMatch(/^shp_a_[A-Za-z0-9_-]{43}_[a-f0-9]{8}$/);
      const payload = Buffer.from(value.slice(6, 49), "base64url");
      expect(payload.byteLength).toBe(32);
      expect(value.slice(50)).toBe(createHash("sha256").update(payload).digest("hex").slice(0, 8));
      expect(issued[index]!.tokenHash).toBe(hash(value));
      expect(String(issued[index]!.token)).not.toContain(value);
    }
    // A counter encoded to 32 bytes would pass the length/uniqueness checks.
    expect(new Set(raw.map((value) => value.slice(6, 22))).size).toBe(64);
  }),
);

it.effect("5.1 checksum: catches looking up a malformed token before validating its checksum", () =>
  withLog(Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const raw = Redacted.value(mintAgentToken().token);
    const damaged = raw.slice(0, -1) + (raw.endsWith("0") ? "1" : "0");
    // A database lookup would fail with SqlError. InvalidCredential must win
    // even when the table is unavailable, without including the supplied token.
    yield* sql`DROP TABLE agent_tokens`;
    const outcome = yield* verifyAgentToken(damaged).pipe(Effect.result);
    expect(Result.isFailure(outcome)).toBe(true);
    if (!Result.isFailure(outcome)) throw new Error("Malformed token was accepted");
    expect(outcome.failure).toMatchObject({ _tag: "InvalidCredential" });
    expect(JSON.stringify(outcome.failure)).not.toContain(damaged);
  })),
);

it.effect("5.1 storage: catches persisting a raw agent token in the database, WAL or receipt", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const issued = mintAgentToken();
    const raw = Redacted.value(issued.token);
    yield* log.append({ _tag: "owner" }, request(), "a".repeat(64), [opened], {
      agentTokens: [{ agentId, tokenHash: issued.tokenHash, revokedAt: null }],
    });
    expect(yield* verifyAgentToken(raw)).toBe(agentId);
    expect(yield* sql`SELECT agent_id, token_hash, revoked_at FROM agent_tokens`).toEqual([
      { agent_id: agentId, token_hash: hash(raw), revoked_at: null },
    ]);
    yield* sql`PRAGMA wal_checkpoint(FULL)`;
    for (const filename of readdirSync(home)) {
      expect(readFileSync(join(home, filename)).includes(Buffer.from(raw))).toBe(false);
    }
  })),
);

it.effect.each(["start", "resume", "reload"] as const)(
  "5.1 rotation/%s: catches retaining the preceding spawn's credential or revoking a sibling",
  () => withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const first = mintAgentToken();
    const sibling = mintAgentToken();
    yield* log.append({ _tag: "owner" }, request(), "b".repeat(64), [opened], {
      agentTokens: [
        { agentId, tokenHash: first.tokenHash, revokedAt: null },
        { agentId: otherId, tokenHash: sibling.tokenHash, revokedAt: null },
      ],
    });
    const next = mintAgentToken();
    expect(Redacted.value(next.token)).not.toBe(Redacted.value(first.token));
    yield* log.append({ _tag: "owner" }, request(), "c".repeat(64), [opened], {
      revokeAgentTokens: [agentId],
      agentTokens: [{ agentId, tokenHash: next.tokenHash, revokedAt: null }],
    });
    expect(Result.isFailure(yield* verifyAgentToken(Redacted.value(first.token)).pipe(Effect.result))).toBe(true);
    expect(yield* verifyAgentToken(Redacted.value(next.token))).toBe(agentId);
    expect(yield* verifyAgentToken(Redacted.value(sibling.token))).toBe(otherId);
  })),
);

it.effect.each(["stop", "crash", "restart"] as const)(
  "5.1 revoke/%s: catches a stopped, crashed or pre-restart credential remaining valid",
  (cause) => withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const first = mintAgentToken();
    const second = mintAgentToken();
    yield* log.append({ _tag: "owner" }, request(), "d".repeat(64), [opened], {
      agentTokens: [
        { agentId, tokenHash: first.tokenHash, revokedAt: null },
        { agentId: otherId, tokenHash: second.tokenHash, revokedAt: null },
      ],
    });
    const event: Event = cause === "crash"
      ? { _tag: "AgentCrashed", agentId, exitCode: 1, signal: null, stderr: "fake crash" }
      : cause === "restart"
      ? { _tag: "AgentInterrupted", agentId, previous: "idle" }
      : { _tag: "AgentStopped", agentId };
    yield* log.append({ _tag: "owner" }, request(), "e".repeat(64), [event], {
      revokeAgentTokens: cause === "restart" ? "all" : [agentId],
    });
    expect(Result.isFailure(yield* verifyAgentToken(Redacted.value(first.token)).pipe(Effect.result))).toBe(true);
    const sibling = yield* verifyAgentToken(Redacted.value(second.token)).pipe(Effect.result);
    expect(Result.isFailure(sibling)).toBe(cause === "restart");
    const rows = yield* sql<{ revoked_at: number | null }>`SELECT revoked_at FROM agent_tokens WHERE agent_id = ${agentId}`;
    expect(rows[0]!.revoked_at).not.toBeNull();
  })),
);

it.effect("5.1 writer verification: catches caching validity instead of reading revocation inside the caller's transaction", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const issued = mintAgentToken();
    const raw = Redacted.value(issued.token);
    yield* log.append({ _tag: "owner" }, request(), "f".repeat(64), [opened], {
      agentTokens: [{ agentId, tokenHash: issued.tokenHash, revokedAt: null }],
    });
    expect(yield* verifyAgentToken(raw)).toBe(agentId);
    // This deliberately uncommitted update is visible only on the writer.
    // It is a transaction probe, not a second production write path.
    yield* sql.withTransaction(Effect.gen(function* () {
      yield* sql`UPDATE agent_tokens SET revoked_at = 123 WHERE token_hash = ${issued.tokenHash}`;
      const outcome = yield* verifyAgentToken(raw).pipe(Effect.result);
      expect(Result.isFailure(outcome)).toBe(true);
      return yield* Effect.fail("roll back transaction probe" as const);
    })).pipe(Effect.result);
    expect(yield* verifyAgentToken(raw)).toBe(agentId);
  })),
);

it.effect("5.1 atomic rotation: catches committing revocation or a fresh token when its event batch rolls back", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const first = mintAgentToken();
    yield* log.append({ _tag: "owner" }, request(), "1".repeat(64), [opened], {
      agentTokens: [{ agentId, tokenHash: first.tokenHash, revokedAt: null }],
    });
    yield* sql`CREATE TRIGGER fail_rotation AFTER INSERT ON agent_tokens
      BEGIN SELECT RAISE(ABORT, 'rotation must roll back'); END`;
    const next = mintAgentToken();
    const outcome = yield* log.append({ _tag: "owner" }, request(), "2".repeat(64), [opened], {
      revokeAgentTokens: [agentId],
      agentTokens: [{ agentId, tokenHash: next.tokenHash, revokedAt: null }],
    }).pipe(Effect.result);
    expect(Result.isFailure(outcome)).toBe(true);
    expect(yield* verifyAgentToken(Redacted.value(first.token))).toBe(agentId);
    expect(Result.isFailure(yield* verifyAgentToken(Redacted.value(next.token)).pipe(Effect.result))).toBe(true);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 1 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 1 }]);
  })),
);
