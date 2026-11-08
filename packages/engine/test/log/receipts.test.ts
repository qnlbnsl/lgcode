import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { AgentId, RequestId, type Actor, type Event } from "@lgcode/contracts";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as EventLog from "../../src/log/EventLog.ts";
import * as Views from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Redactor from "../../src/log/Redactor.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/lgcode-receipts-");
  vi.stubEnv("LGCODE_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const owner: Actor = { _tag: "owner" };
const agentId = Schema.decodeUnknownSync(AgentId)("agent-a");
const request = (id: string) => Schema.decodeUnknownSync(RequestId)(id);
const bodyHash = (body: string) => createHash("sha256").update(body).digest("hex");
const event: Event = { _tag: "AgentGrouped", agentId, groups: ["backend"] };
const sideRows = { agentTokens: [{ agentId, tokenHash: "b".repeat(64), revokedAt: null }] };

const withLog = <A, E>(
  program: Effect.Effect<A, E, EventLog.EventLog | SqlClient.SqlClient>,
  redactor = Redactor.layer,
) => Effect.gen(function* () {
  yield* migrate;
  return yield* Effect.scoped(Effect.gen(function* () {
    yield* registerRebuildCheck();
    return yield* program;
  })).pipe(
    Effect.provide(EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(redactor))),
  );
}).pipe(
  Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })),
  Effect.scoped,
);

it.effect("4.2 replay: catches losing receipts on restart or re-inserting events and side rows for a repeat", () =>
  Effect.gen(function* () {
    const first = yield* withLog(Effect.gen(function* () {
      const log = yield* EventLog.EventLog;
      return yield* log.append(owner, request("repeat"), bodyHash("group backend"), [event], sideRows);
    }));
    // Rebuild both layers on the same file: only a durable receipt can replay
    // the original event ids, timestamps and sequences without another write.
    yield* withLog(Effect.gen(function* () {
      const log = yield* EventLog.EventLog;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TRIGGER forbid_repeat_event BEFORE INSERT ON events
        BEGIN SELECT RAISE(ABORT, 'a receipt replay attempted an event write'); END`;
      const repeated = yield* log.append(owner, request("repeat"), bodyHash("group backend"), [event], sideRows);

      expect(repeated).toEqual(first);
      expect(repeated.map((row) => row.sequence)).toEqual([1]);
      expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 1 }]);
      expect(yield* sql`SELECT COUNT(*) AS n FROM agent_tokens`).toEqual([{ n: 1 }]);
      const receipts = yield* sql<{ body_hash: string; result_json: string; first_sequence: number }>`
        SELECT body_hash, result_json, first_sequence FROM receipts`;
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.body_hash).toBe(bodyHash("group backend"));
      expect(receipts[0]?.first_sequence).toBe(1);
      expect(JSON.parse(receipts[0]!.result_json)).toEqual(first);
    }));
  }),
);

it.effect("4.2 body mismatch: catches replaying a different body under the same key or treating its refusal as disk failure", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    yield* log.append(owner, request("reused"), bodyHash("group backend"), [event], {});
    const refused = yield* log.append(owner, request("reused"), bodyHash("stop agent-a"), [
      { _tag: "AgentStopped", agentId },
    ], {}).pipe(Effect.result);

    expect(refused._tag).toBe("Failure");
    if (refused._tag !== "Failure") throw new Error("The reused request id unexpectedly succeeded");
    expect(refused.failure).toBeInstanceOf(EventLog.RequestIdReused);
    expect(refused.failure.reason).toBe("request id reused");
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 1 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 1 }]);
    const next = yield* log.append(owner, request("fresh"), bodyHash("new group"), [event], {});
    expect(next.map((row) => row.sequence)).toEqual([2]);
  })),
);

it.effect("4.2 caller key: catches deduplicating by request id alone across two callers", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const agent: Actor = { _tag: "agent", agentId };
    const first = yield* log.append(owner, request("shared-id"), bodyHash("owner body"), [event], {});
    const second = yield* log.append(agent, request("shared-id"), bodyHash("agent body"), [event], {});

    expect(first.map((row) => row.sequence)).toEqual([1]);
    expect(second.map((row) => row.sequence)).toEqual([2]);
    expect(second[0]?.caller).toEqual(agent);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 2 }]);
    expect(yield* sql`SELECT COUNT(*) AS n, COUNT(DISTINCT caller) AS callers FROM receipts
      WHERE request_id = 'shared-id'`).toEqual([{ n: 2, callers: 2 }]);
  })),
);

it.effect("D1 caller order replay: catches treating reordered actor properties as a new caller and writing a second batch", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const first = yield* log.append({ _tag: "agent", agentId }, request("reordered"), bodyHash("same body"), [event], {});
    const repeated = yield* log.append({ agentId, _tag: "agent" }, request("reordered"), bodyHash("same body"), [event], {});

    expect(repeated).toEqual(first);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 1 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 1 }]);
  })),
);

it.effect("D1 caller order mismatch: catches accepting a different body when only actor property order changed", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    yield* log.append({ _tag: "agent", agentId }, request("reordered-mismatch"), bodyHash("first body"), [event], {});
    const refused = yield* log.append({ agentId, _tag: "agent" }, request("reordered-mismatch"), bodyHash("other body"), [event], {})
      .pipe(Effect.result);

    expect(refused._tag).toBe("Failure");
    if (refused._tag !== "Failure") throw new Error("The reordered caller bypassed request-id reuse detection");
    expect(refused.failure).toBeInstanceOf(EventLog.RequestIdReused);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 1 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 1 }]);
    const next = yield* log.append({ _tag: "agent", agentId }, request("after-reordered-mismatch"), bodyHash("fresh body"), [event], {});
    expect(next.map((row) => row.sequence)).toEqual([2]);
  })),
);

it.effect("D1 caller extras: catches including an extra runtime actor property in the receipt key", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const first = yield* log.append({ _tag: "agent", agentId }, request("extra-property"), bodyHash("same body"), [event], {});
    const extra = { _tag: "agent", agentId, runtimeOnly: "ignored" } as unknown as Actor;
    const repeated = yield* log.append(extra, request("extra-property"), bodyHash("same body"), [event], {});

    expect(repeated).toEqual(first);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 1 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 1 }]);
  })),
);

it.effect("4.2 concurrent duplicate: catches checking receipts outside the writer, double writes, or a false disk-failure latch", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let calls = 0;
    const heldRedactor = Layer.succeed(Redactor.Redactor, {
      redactText: (text: string) => Effect.succeed(text),
      redact: (value: Event) => Effect.gen(function* () {
        if (++calls === 1) {
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }
        return value;
      }),
    });
    yield* withLog(Effect.gen(function* () {
      const log = yield* EventLog.EventLog;
      const sql = yield* SqlClient.SqlClient;
      const send = () => log.append(owner, request("double"), bodyHash("same command"), [event], sideRows);
      const first = yield* Effect.forkChild(send(), { startImmediately: true });
      yield* Deferred.await(entered);
      const second = yield* Effect.forkChild(send(), { startImmediately: true });
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      // Both must succeed. A uniqueness collision surfaced as LogWriteFailed
      // fails these joins, rather than being accepted as a valid duplicate.
      const results = yield* Effect.all([Fiber.join(first), Fiber.join(second)], { concurrency: "unbounded" });
      expect(results[0]).toEqual(results[1]);
      expect(results[0]?.map((row) => row.sequence)).toEqual([1]);
      expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 1 }]);
      expect(yield* sql`SELECT COUNT(*) AS n FROM agent_tokens`).toEqual([{ n: 1 }]);
      expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 1 }]);
      const next = yield* log.append(owner, request("after-double"), bodyHash("fresh command"), [event], {});
      expect(next.map((row) => row.sequence)).toEqual([2]);
    }), heldRedactor);
  }),
);
