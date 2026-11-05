import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EventEnvelope, type Event } from "@shephrd/contracts";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it, vi } from "vitest";
import { EventLog } from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import { subscribe } from "../../src/log/subscribe.ts";
import { agentRead } from "../../src/log/agentRead.ts";
import { Views } from "../../src/views/Views.ts";
import { rebuild } from "../../src/views/rebuild.ts";
import { layer as redactor } from "../../src/log/Redactor.ts";
import { freshRequest, eventOf } from "../support/handlerRig.ts";
import { requiredModule, type Caller } from "../support/callerRules.ts";
import { ready } from "../support/viewFixtures.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const callers: Caller[] = [{ _tag: "owner" }, { _tag: "agent", agentId: "agent-a" }, { _tag: "service", service: "roles.sheepdog" }, { _tag: "service", service: "roles.standing-rules", rule: "rule-4" }, { _tag: "piece", namespace: "board" }];
const keys = ["owner", "agent:agent-a", "service:roles.sheepdog", "service:roles.standing-rules", "piece:board"];
it("1.30 caller identity survives live publication, catch-up, rebuild, paging and a reopened database; receipts ignore the rule", async () => {
  const home = mkdtempSync("/tmp/shephrd-caller-durable-");
  vi.stubEnv("SHEPHRD_HOME", home);
  // Build fresh services for each opening; the file, not a retained layer,
  // must carry the rule. No decoder is reproduced in the test.
  const { layer } = await import("../../src/log/EventLog.ts");
  const { layer: viewsLayer } = await import("../../src/views/Views.ts");
  const open = (body: Effect.Effect<unknown, unknown, any>) => Effect.runPromise(Effect.gen(function* () {
    yield* migrate;
    return yield* Effect.scoped(Effect.gen(function* () { yield* registerRebuildCheck(); return yield* body; })).pipe(
      Effect.provide(layer.pipe(Layer.provideMerge(viewsLayer), Layer.provide(redactor))),
    );
  }).pipe(Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite"), readerWorker: true })), Effect.scoped) as Effect.Effect<unknown, unknown, never>);
  const captured: Array<typeof EventEnvelope.Type> = [];
  const ids = callers.map(() => freshRequest());
  try {
    await open(Effect.gen(function* () {
      const log = yield* EventLog;
      yield* log.append({ _tag: "owner" }, freshRequest(), randomUUID(), ready, {}, false);
      const subscription = yield* log.subscribeCommitted;
      for (const [index, caller] of callers.entries()) {
        const candidate = { sequence: 1, eventId: "probe", occurredAt: 0, caller, event: eventOf({ _tag: "AgentGrouped", agentId: "agent-a", groups: [] }) };
        expect(Schema.is(EventEnvelope)(candidate), "E11 must widen the durable envelope caller").toBe(true);
        const batch = yield* (log.append as unknown as (caller: Caller, requestId: ReturnType<typeof freshRequest>, hash: string, events: Event[], rows: object) => ReturnType<typeof log.append>)(caller, ids[index]!, "same-body", [eventOf({ _tag: "AgentGrouped", agentId: "agent-a", groups: [String(index)] })], {});
        captured.push(...batch);
      }
      expect(yield* PubSub.takeAll(subscription)).toEqual(captured);
      const rows = yield* subscribe(ready.length).pipe(Stream.take(callers.length), Stream.runCollect);
      expect(rows).toEqual(captured);
      const sql = yield* SqlClient.SqlClient;
      expect((yield* sql<{ caller: string }>`SELECT caller FROM events WHERE sequence > ${ready.length} ORDER BY sequence`).map((r) => r.caller)).toEqual(keys);
    }));
    await open(Effect.gen(function* () {
      const replay = yield* subscribe(ready.length).pipe(Stream.take(callers.length), Stream.runCollect);
      expect(replay).toEqual(captured);
      const rebuilt = yield* rebuild(captured.at(-1)!.sequence);
      expect(rebuilt.threads["agent-a"]?.slice(-callers.length)).toEqual(captured);
      const page = yield* agentRead({ caller: { _tag: "owner" }, agentId: "agent-a", after: ready.length, limit: 500 });
      expect(page.items).toEqual(captured);
      const log = yield* EventLog;
      const repeated = yield* (log.append as unknown as (caller: Caller, requestId: ReturnType<typeof freshRequest>, hash: string, events: Event[], rows: object) => ReturnType<typeof log.append>)({ _tag: "service", service: "roles.standing-rules", rule: "different-rule" }, ids[3]!, "same-body", [], {});
      expect(repeated).toEqual([captured[3]]);
    }));
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); }
});
