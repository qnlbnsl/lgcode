import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, expect, it, vi } from "vitest";
import { EventLog } from "../../src/log/EventLog.ts";
import { Views } from "../../src/views/Views.ts";
import { compareViews } from "../../src/views/compare.ts";
import { asEvent, fixtureLists, loadLists, productionModule, withFixture } from "../support/fixturePiece.ts";
import { freshRequest } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

interface GuardModule {
  readonly guardPiece: <T>(table: string, namespace: string, call: () => T, fallback: T) => T;
  readonly drainPieceErrors: () => ReadonlyArray<{ namespace: string; table: string; errorClass: string }>;
}
afterEach(() => vi.restoreAllMocks());

it("1.44 guardPiece preserves a successful result and does not evaluate a function twice", async () => {
  registerRebuildCheck({ noLog: true });
  const { guardPiece, drainPieceErrors } = await productionModule<GuardModule>("pieces/guardPiece.ts");
  let calls = 0;
  expect(guardPiece("success", "client", () => { calls++; return 42; }, 0)).toBe(42);
  expect(calls).toBe(1);
  expect(drainPieceErrors()).toEqual([]);
});

it.each([
  ["views", { records: ["unchanged"] }], ["snapshotSections", undefined],
  ["reach", false], ["holdUnsettled", true], ["requestHeld", false], ["sourceRules", "withdraw"], ["secretKeep", undefined],
] as const)("1.44 %s throw returns the caller's refusing fallback synchronously", async (table, fallback) => {
  registerRebuildCheck({ noLog: true });
  const { guardPiece } = await productionModule<GuardModule>("pieces/guardPiece.ts");
  const output = guardPiece<unknown>(table, "client", () => { throw new Error("Private event text."); }, fallback);
  expect(output).toBe(fallback);
  expect(output instanceof Promise).toBe(false);
});

it("1.44 the sink records only namespace, table and error class, throttled once a minute per pair", async () => {
  registerRebuildCheck({ noLog: true });
  const { guardPiece, drainPieceErrors } = await productionModule<GuardModule>("pieces/guardPiece.ts");
  drainPieceErrors();
  const now = vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);
  const fail = () => { const error = new TypeError("Private event and request text."); error.name = "Untrusted name."; throw error; };
  guardPiece("sink-a", "client", fail, false);
  guardPiece("sink-a", "client", fail, false);
  guardPiece("sink-a", "board", fail, false);
  guardPiece("sink-b", "client", fail, false);
  const first = drainPieceErrors();
  expect(first).toEqual([
    { namespace: "client", table: "sink-a", errorClass: "TypeError" },
    { namespace: "board", table: "sink-a", errorClass: "TypeError" },
    { namespace: "client", table: "sink-b", errorClass: "TypeError" },
  ]);
  expect(JSON.stringify(first)).not.toContain("Private");
  expect(JSON.stringify(first)).not.toContain("Untrusted");
  now.mockReturnValue(2_000_000_059_999);
  guardPiece("sink-a", "client", fail, false);
  expect(drainPieceErrors()).toEqual([]);
  now.mockReturnValue(2_000_000_060_000);
  guardPiece("sink-a", "client", fail, false);
  expect(drainPieceErrors()).toEqual([{ namespace: "client", table: "sink-a", errorClass: "TypeError" }]);
});

it("1.44 a throwing reducer leaves its last view intact, preserves engine writes and matches a rebuild", async () => {
  const base = fixtureLists(await loadLists());
  const lists = { ...base, views: { ...base.views, client: {
    ...base.views.client!, reduce: () => { throw new Error("Private fixture event text."); },
  } } };
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const log = yield* EventLog;
    const views = yield* Views;
    const prior = ((yield* views.snapshot) as unknown as { client: unknown }).client;
    yield* log.append({ _tag: "owner" }, freshRequest(), "a".repeat(64), [asEvent({ _tag: "client.FixtureRecorded", id: "record-a", text: "Private fixture event text." })], {});
    yield* log.append({ _tag: "owner" }, freshRequest(), "b".repeat(64), [asEvent({ _tag: "AccountAvailable", accountId: "account-a", cause: "owner cleared" })], {});
    const current = yield* views.snapshot;
    expect((current as unknown as { client: unknown }).client).toEqual(prior);
    expect((yield* compareViews()).differences).toEqual([]);
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`SELECT COUNT(*) AS n FROM events WHERE sequence <= ${current.sequence} AND event_type != 'roles.SheepdogBaseline'`).toEqual([{ n: 2 }]);
  }));
});

// Required boundary check: strip comments and strings, then mask balanced
// guardPiece calls before looking for table invocations.
// E30 covers table calls. The standing-rule matcher and capacity condition
// are outside these tables and belong to the deferred roles units.
const unguardedCalls = (source: string): string[] => {
  let code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, (token) => " ".repeat(token.length));
  for (const match of [...code.matchAll(/\bguardPiece\s*\(/g)].reverse()) {
    let depth = 1;
    let end = match.index! + match[0].length;
    while (end < code.length && depth > 0) {
      if (code[end] === "(") depth++;
      if (code[end] === ")") depth--;
      end++;
    }
    code = code.slice(0, match.index) + " ".repeat(end - match.index!) + code.slice(end);
  }
  const direct = /(?:\b\w+\.)?\b(?:views|snapshotSections|reach|holdUnsettled|requestHeld|sourceRules|secretKeep|openMatters)\s*\[[^\]]+\](?:\s*\.\s*(?:reduce|snapshotFor|check|keep|openMatters))?\s*\(/g;
  return [...code.matchAll(direct)].map((match) => match[0].replace(/\s*\($/, ""));
};

it("1.44 boundary catches a direct table call and ignores comments and the guard's closure", async () => {
  registerRebuildCheck({ noLog: true });
  await productionModule<GuardModule>("pieces/guardPiece.ts");
  expect(unguardedCalls('lists.snapshotSections[ns](caller, view); // guardPiece()')).toEqual(["lists.snapshotSections[ns]"]);
  expect(unguardedCalls('guardPiece("snapshotSections", ns, () => lists.snapshotSections[ns](caller, view), undefined)')).toEqual([]);
  const root = new URL("../../src/", import.meta.url);
  const failures: string[] = [];
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (entry.name.endsWith(".ts")) for (const call of unguardedCalls(readFileSync(path, "utf8"))) failures.push(`${path}: ${call}`);
    }
  };
  scan(root.pathname);
  expect(failures).toEqual([]);
});
