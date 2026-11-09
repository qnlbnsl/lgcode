import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Logger from "effect/Logger";
import { CurrentLogAnnotations } from "effect/References";
import { afterEach, expect, it, vi } from "vitest";
import { serviceLog } from "../../src/api/serviceLog.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { redactingLoggerLayer } from "../../src/identity/logger.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { drainPieceErrors, guardPiece } from "../../src/pieces/guardPiece.ts";
import { Views } from "../../src/views/Views.ts";
import { fixtureLists, loadLists, withFixture } from "../support/fixturePiece.ts";
import { eventOf, freshRequest } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

afterEach(() => vi.restoreAllMocks());

for (const protocol of [false, true]) {
  it(`FR-042 protocol=${protocol}: the service drain retains safe piece identity and throttles a failing reducer`, async () => {
    drainPieceErrors();
    vi.spyOn(Date, "now").mockReturnValue(2_100_000_000_000 + (protocol ? 60_000 : 0));
    const base = fixtureLists(await loadLists());
    const secret = "fixture-private-credential-0123456789";
    const lines: string[] = [];
    const redactor = makeRedactor({ secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set() });
    const lists = { ...base, reactors: {}, views: { ...base.views, client: { ...base.views.client!, reduce() {
      const error = new TypeError(`Private event text ${secret}`, { cause: "Private cause" });
      error.name = "Private name";
      throw error;
    } } } };
    await withFixture(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const log = yield* EventLog;
      for (const id of ["one", "two"]) yield* log.append({ _tag: "owner" }, freshRequest(), id.repeat(64), [eventOf({ _tag: "AccountChanged", accountId: id, account: { id, harness: "first" } })], {});
      expect(Object.keys((yield* (yield* Views).snapshot).accounts)).toEqual(["one", "two"]);
    }), { logger: redactingLoggerLayer(redactor, serviceLog(protocol, (line) => { lines.push(line); })) });
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: "ERROR", message: "piece table failed", annotations: { namespace: "client", table: "views", errorClass: "TypeError" } });
    expect(lines.join("\n")).not.toMatch(/Private|fixture-private-credential/);
  });
}

it("FR-042 the normal sink permits only fixed piece categories and their three bounded fields", async () => {
  registerRebuildCheck({ noLog: true });
  const lines: string[] = [];
  const redactor = makeRedactor({ secrets: () => [Redacted.make("private-secret-value")], tokenHashes: () => new Set() });
  const logger = redactingLoggerLayer(redactor, serviceLog(false, (line) => { lines.push(line); }));
  await Effect.runPromise(Effect.gen(function* () {
    yield* Effect.logError("piece table failed").pipe(Effect.annotateLogs({ namespace: "roles", table: "reach", errorClass: "RangeError", arbitrary: "Private annotation", cause: new Error("Private cause") }));
    yield* Effect.logError("piece table failed").pipe(Effect.annotateLogs({ namespace: "Private namespace", table: "Private table", errorClass: "Private class" }));
    yield* Effect.logError("Private message").pipe(Effect.annotateLogs({ namespace: "client", table: "views", errorClass: "Error" }));
  }).pipe(Effect.provide(logger)));
  const entries = lines.map((line) => JSON.parse(line));
  expect(entries[0]).toEqual({ timestamp: expect.any(String), level: "ERROR", message: "piece table failed", annotations: { namespace: "roles", table: "reach", errorClass: "RangeError" } });
  expect(entries[1]).toEqual({ timestamp: expect.any(String), level: "ERROR", message: "piece table failed" });
  expect(entries[2]).toEqual({ timestamp: expect.any(String), level: "ERROR", message: "service diagnostic" });
  expect(lines.join("\n")).not.toMatch(/Private|arbitrary/);
});


it("the service drain finishes the removed diagnostic batch when interrupted after its first log", async () => {
  drainPieceErrors();
  vi.spyOn(Date, "now").mockReturnValue(2_100_000_120_000);
  const lines: Array<{ message: unknown; annotations: unknown }> = [];
  let firstLog!: () => void;
  const logged = new Promise<void>((resolve) => { firstLog = resolve; });
  const logger = Logger.layer([Logger.make(({ fiber, message }) => {
    if (!Array.isArray(message) || message[0] !== "piece table failed") return;
    lines.push({ message: message[0], annotations: fiber.getRef(CurrentLogAnnotations) });
    // Interrupt the actual service drain fiber at a deterministic batch boundary.
    if (lines.length === 1) { fiber.interruptUnsafe(); firstLog(); }
  })]);
  await withFixture({ ...fixtureLists(await loadLists()), reactors: {} }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    for (const table of ["views", "reach", "openMatters"]) {
      guardPiece(table, "client", () => { throw new TypeError("private diagnostic content"); }, undefined);
    }
    yield* Effect.promise(() => logged);
  }), { logger });
  expect(lines).toHaveLength(3);
  expect(lines.map((line) => line.annotations)).toEqual([
    { namespace: "client", table: "views", errorClass: "TypeError" },
    { namespace: "client", table: "reach", errorClass: "TypeError" },
    { namespace: "client", table: "openMatters", errorClass: "TypeError" },
  ]);
  expect(drainPieceErrors()).toEqual([]);
});
