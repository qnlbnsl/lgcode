import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import type { EventEnvelope } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { EventLog } from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import { Views } from "../../src/views/Views.ts";
import { asEvent, loadLists, productionModule, withFixture, type Caller, type EngineLists } from "../support/fixturePiece.ts";
import { appendSetup, freshRequest, seedAgent } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

interface Page { readonly items: ReadonlyArray<EventEnvelope>; readonly next?: number }
type AgentRead = (input: { caller: Caller; agentId: string; after: number; limit: number }, lists: EngineLists) => Effect.Effect<Page, unknown, any>;
const loadRead = async () => (await productionModule<{ agentRead: AgentRead }>("log/agentRead.ts")).agentRead;
const owner = { _tag: "owner" } as const;
const textEvent = (id: string, text = "Text.") => asEvent({ _tag: "ThreadItem", agentId: "worker", itemId: id, content: { _tag: "text", text }, replay: false });

it("1.10 owner pages equal the rebuilt thread, with a queued delivery on the next page and no gaps", async () => {
  const agentRead = await loadRead();
  const lists = await loadLists();
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker" });
    yield* appendSetup([textEvent("one"), textEvent("two"), asEvent({ _tag: "DeliveryQueued", delivery: {
      id: "queued", target: "worker", sender: owner, content: { _tag: "prompt", text: "Queued." },
    } }), textEvent("three")]);
    const views = yield* Views;
    // Subscribe before checking the views so a racing commit cannot be missed.
    yield* Effect.scoped(Effect.gen(function* () {
      const committed = yield* (yield* EventLog).subscribeCommitted;
      while (!(yield* views.snapshot).threads.worker?.some(({ event }) =>
        event._tag === "DeliverySent" && event.agentId === "worker" && event.deliveryId === "queued")) {
        yield* PubSub.takeAll(committed);
      }
    })).pipe(Effect.timeout(10_000));
    const expected = (yield* views.snapshot).threads.worker!;
    const found: EventEnvelope[] = [];
    let after = 0;
    for (let attempts = 0; attempts < 10; attempts++) {
      const page = yield* agentRead({ caller: owner, agentId: "worker", after, limit: 2 }, lists);
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(page.items.every((row) => row.sequence > after)).toBe(true);
      found.push(...page.items);
      if (page.next === undefined) break;
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.next).toBeGreaterThan(after);
      after = page.next;
    }
    expect(found).toEqual(expected);
    expect(found.some((row) => row.event._tag === "DeliveryQueued")).toBe(true);
    expect(new Set(found.map((row) => row.sequence)).size).toBe(found.length);
  }));
});

it("1.10 an agent page hides agent-less queued envelopes and cannot read a stranger", async () => {
  const agentRead = await loadRead();
  const lists = await loadLists();
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "lead" });
    yield* seedAgent({ id: "worker", parent: "lead" });
    yield* seedAgent({ id: "stranger" });
    yield* appendSetup([asEvent({ _tag: "DeliveryQueued", delivery: {
      id: "queued", target: "worker", sender: owner, content: { _tag: "prompt", text: "Queued." },
    } }), textEvent("visible")]);
    const page = yield* agentRead({ caller: { _tag: "agent", agentId: "lead" }, agentId: "worker", after: 0, limit: 500 }, lists);
    expect(page.items.some((row) => row.event._tag === "ThreadItem")).toBe(true);
    expect(page.items.every((row) => row.agentId === "worker")).toBe(true);
    expect(page.items.some((row) => row.event._tag === "DeliveryQueued")).toBe(false);
    const hidden = yield* agentRead({ caller: { _tag: "agent", agentId: "stranger" }, agentId: "worker", after: 0, limit: 500 }, lists).pipe(Effect.result);
    expect(hidden._tag === "Failure" || hidden.success.items.length === 0).toBe(true);
  }));
});

it("1.10 a large requested limit is clamped to 500 events and the next cursor resumes at 501", async () => {
  const agentRead = await loadRead();
  const lists = await loadLists();
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const log = yield* EventLog;
    yield* log.append(owner, freshRequest(), "c".repeat(64), Array.from({ length: 501 }, (_, i) => textEvent(`item-${i}`)), {});
    const first = yield* agentRead({ caller: owner, agentId: "worker", after: 0, limit: 1_000 }, lists);
    expect(first.items).toHaveLength(500);
    expect(first.items[0]!.sequence).toBe(1);
    expect(first.items.at(-1)!.sequence).toBe(500);
    expect(first.next).toBeDefined();
    const second = yield* agentRead({ caller: owner, agentId: "worker", after: first.next!, limit: 1_000 }, lists);
    expect(second.items.map((row) => row.sequence)).toEqual([501]);
    expect(second.next).toBeUndefined();
  }));
});

it("1.10 the 900 KiB byte budget counts encoded multibyte text and never cuts or strands an oversized event", async () => {
  const agentRead = await loadRead();
  const lists = await loadLists();
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    // Each of the first two records is about 600 KiB UTF-8, though its
    // JavaScript string length is about 200k. The third is over the budget.
    yield* appendSetup([textEvent("a", "界".repeat(200_000)), textEvent("b", "界".repeat(200_000)), textEvent("large", "x".repeat(950 * 1024)), textEvent("last")]);
    let after = 0;
    const pages: Page[] = [];
    for (let i = 0; i < 5; i++) {
      const page = yield* agentRead({ caller: owner, agentId: "worker", after, limit: 500 }, lists);
      pages.push(page);
      if (page.next === undefined) break;
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.next).toBeGreaterThan(after);
      after = page.next;
    }
    expect(pages.map((page) => page.items.length)).toEqual([1, 1, 1, 1]);
    expect(pages.flatMap((page) => page.items.map((row) => row.sequence))).toEqual([1, 2, 3, 4]);
    expect(Buffer.byteLength(JSON.stringify(pages[0]!.items))).toBeLessThanOrEqual(900 * 1024);
    expect(Buffer.byteLength(JSON.stringify(pages[2]!.items))).toBeGreaterThan(900 * 1024);
    expect((pages[2]!.items[0]!.event as { content: { text: string } }).content.text.length).toBe(950 * 1024);
  }));
});

it("1.10 migration backfills old queued targets and creates an indexed thread_agent_id", async () => {
  registerRebuildCheck({ noLog: true });
  const home = mkdtempSync("/tmp/lgcode-old-thread-");
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The version-one event table, before E21's new nullable column.
      yield* sql`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY)`;
      yield* sql`INSERT INTO schema_migrations (id) VALUES (1)`;
      yield* sql`CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, caller TEXT NOT NULL,
        request_id TEXT NOT NULL, agent_id TEXT, event_type TEXT NOT NULL, occurred_at INTEGER NOT NULL, payload_json TEXT NOT NULL)`;
      for (const [id, agentId, e] of [
        ["ordinary", "worker", textEvent("old")],
        ["queued", null, asEvent({ _tag: "DeliveryQueued", delivery: { id: "old-delivery", target: "worker", sender: owner, content: { _tag: "prompt", text: "Queued." } } })],
        ["account", null, asEvent({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" })],
      ] as const) yield* sql`INSERT INTO events (event_id, caller, request_id, agent_id, event_type, occurred_at, payload_json)
        VALUES (${id}, 'owner', ${id}, ${agentId}, ${e._tag}, 1, ${JSON.stringify(e)})`;
      yield* migrate;
      const columns = yield* sql<{ name: string }>`PRAGMA table_info(events)`;
      expect(columns.map((column) => column.name)).toContain("thread_agent_id");
      // This assertion reports the missing migration before any query can
      // error because the new column does not exist on the RED baseline.
      expect(yield* sql`SELECT thread_agent_id FROM events ORDER BY sequence`).toEqual([
        { thread_agent_id: "worker" }, { thread_agent_id: "worker" }, { thread_agent_id: null },
      ]);
      const indexes = yield* sql<{ name: string }>`PRAGMA index_list(events)`;
      const indexed: string[] = [];
      for (const index of indexes) {
        const fields = yield* sql.unsafe<{ name: string }>(`PRAGMA index_info(${JSON.stringify(index.name)})`);
        indexed.push(...fields.map((field) => field.name));
      }
      expect(indexed).toContain("thread_agent_id");
      yield* migrate;
      expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 3 }]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })), Effect.scoped));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
