import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vitest";
import { EventLog } from "../../src/log/EventLog.ts";
import { subscribe } from "../../src/log/subscribe.ts";
import { Views } from "../../src/views/Views.ts";
import { emptyViews } from "../../src/views/apply.ts";
import { asEvent, fixtureLists, loadLists, productionModule, withFixture, type Caller, type EngineLists, type View } from "../support/fixturePiece.ts";
import { freshRequest } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

interface SnapshotReply {
  readonly sequence: number;
  readonly client?: { readonly records: ReadonlyArray<{ readonly id: string; readonly text: string; readonly sequence: number }> };
  readonly board?: unknown;
  readonly roles?: unknown;
  readonly failedSections?: ReadonlyArray<string>;
}
type Snapshot = (caller: Caller, lists: EngineLists) => Effect.Effect<SnapshotReply, unknown, any>;
const loadSnapshot = async () => (await productionModule<{ snapshot: Snapshot }>("api/snapshot.ts")).snapshot;
const owner = { _tag: "owner" } as const;

it("1.7 snapshot reads one views value and every section receives that exact value, with its own sequence", async () => {
  registerRebuildCheck({ noLog: true });
  const snapshot = await loadSnapshot();
  const base = await loadLists();
  const first = { ...emptyViews(), sequence: 11, client: { records: [] } } as unknown as View;
  const second = { ...first, sequence: 12 } as unknown as View;
  let reads = 0;
  const sectionInputs: unknown[] = [];
  const lists = { ...base, snapshotSections: {
    client: (_caller: Caller, view: View) => { sectionInputs.push(view); return { records: [{ id: "one", text: "", sequence: view.sequence }] }; },
    board: (_caller: Caller, view: View) => { sectionInputs.push(view); return { sequence: view.sequence }; },
    roles: (_caller: Caller, view: View) => { sectionInputs.push(view); return { sequence: view.sequence }; },
  } };
  const reply = await Effect.runPromise(snapshot(owner, lists).pipe(Effect.provideService(Views, {
    snapshot: Effect.sync(() => (++reads === 1 ? first : second)), applyCommitted: () => Effect.void,
  })) as Effect.Effect<SnapshotReply, unknown, never>);
  expect(reads).toBe(1);
  expect(reply.sequence).toBe(11);
  expect(reply.client).toEqual({ records: [{ id: "one", text: "", sequence: 11 }] });
  expect(reply.board).toEqual({ sequence: 11 });
  expect(reply.roles).toEqual({ sequence: 11 });
  expect(sectionInputs).toHaveLength(3);
  expect(sectionInputs.every((view) => view === first)).toBe(true);
});

it("1.7 a section may be included for the owner and omitted for an agent", async () => {
  registerRebuildCheck({ noLog: true });
  const snapshot = await loadSnapshot();
  const lists = fixtureLists(await loadLists());
  const view = { ...emptyViews(), client: { records: [] } } as View;
  const run = (caller: Caller) => Effect.runPromise(snapshot(caller, lists).pipe(Effect.provideService(Views, {
    snapshot: Effect.succeed(view), applyCommitted: () => Effect.void,
  })) as Effect.Effect<SnapshotReply, unknown, never>);
  expect((await run(owner)).client).toEqual({ records: [] });
  expect(Object.hasOwn(await run({ _tag: "agent", agentId: "agent-a" }), "client")).toBe(false);
});

it("1.22 default snapshot sections are absent for every namespace", async () => {
  registerRebuildCheck({ noLog: true });
  const snapshot = await loadSnapshot();
  const lists = await loadLists();
  const reply = await Effect.runPromise(snapshot(owner, lists).pipe(Effect.provideService(Views, {
    snapshot: Effect.succeed(emptyViews()), applyCommitted: () => Effect.void,
  })) as Effect.Effect<SnapshotReply, unknown, never>);
  for (const namespace of ["client", "board", "roles"]) expect(Object.hasOwn(reply, namespace)).toBe(false);
});

it("1.44 a throwing snapshot section is omitted and marked failed while healthy sections survive", async () => {
  registerRebuildCheck({ noLog: true });
  const snapshot = await loadSnapshot();
  const base = await loadLists();
  const lists = { ...base, snapshotSections: { ...base.snapshotSections,
    client: () => { throw new Error("Private request text."); }, board: () => ({ count: 3 }),
  } };
  const reply = await Effect.runPromise(snapshot(owner, lists).pipe(Effect.provideService(Views, {
    snapshot: Effect.succeed(emptyViews()), applyCommitted: () => Effect.void,
  })) as Effect.Effect<SnapshotReply, unknown, never>);
  expect(Object.hasOwn(reply, "client")).toBe(false);
  expect(reply.failedSections).toContain("client");
  expect(reply.board).toEqual({ count: 3 });
  expect(JSON.stringify(reply)).not.toContain("Private");
});

it("1.7 before, during and after COMMIT/publication, snapshot plus catch-up includes every transition exactly once", async () => {
  const snapshot = await loadSnapshot();
  const lists = fixtureLists(await loadLists());
  await withFixture(lists, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const log = yield* EventLog;
    const views = yield* Views;
    yield* log.append(owner, freshRequest(), "1".repeat(64), [asEvent({ _tag: "client.FixtureRecorded", id: "a", text: "A" })], {});
    const before = yield* snapshot(owner, lists);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const realApply = views.applyCommitted;
    const spy = vi.spyOn(views, "applyCommitted").mockImplementation((batch) =>
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(realApply(batch))));
    yield* Effect.gen(function* () {
      const writing = yield* log.append(owner, freshRequest(), "2".repeat(64), [asEvent({ _tag: "client.FixtureRecorded", id: "b", text: "B" })], {}).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      const during = yield* snapshot(owner, lists).pipe(Effect.timeout(2_000));
      expect(before.sequence).toBe(1);
      expect(during.sequence).toBe(1);
      const catchUp = yield* subscribe(during.sequence).pipe(Stream.take(1), Stream.runCollect);
      expect(catchUp.map((envelope) => envelope.sequence)).toEqual([2]);
      const ids = [...during.client!.records.map((row) => row.id), ...catchUp.map((row) => (row.event as unknown as { id: string }).id)];
      expect(ids).toEqual(["a", "b"]);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(writing);
      const after = yield* snapshot(owner, lists);
      expect(after.sequence).toBe(2);
      expect(after.client!.records).toEqual([
        { id: "a", text: "A", sequence: 1 }, { id: "b", text: "B", sequence: 2 },
      ]);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.ensuring(Effect.sync(() => spy.mockRestore())));
  }));
});
