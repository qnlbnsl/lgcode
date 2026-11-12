import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vitest";
import { apply, emptyViews } from "../../src/views/apply.ts";
import { Views } from "../../src/views/Views.ts";
import { snapshot } from "../../src/api/snapshot.ts";
import { controlProjection, restoreControl, snapshotControl } from "./support/controlProjection.ts";
import { agentCredential, appendSetup, seedAgent, seedAccount, headSequence } from "../support/handlerRig.ts";
import { subscribe } from "../../src/log/subscribe.ts";
import { run as runReadRig, read, snapshotFor, permissionFor, questionFor, event, bytes, owner } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it.each(["owner", "agent"] as const)("3.1 %s snapshot plus suffix equals full control replay before, during and after publication", async (kind) => run(Effect.gen(function* () {
  const a = yield* seedAgent({ id: "agent-a", state: "working", groups: ["old"] });
  yield* seedAgent({ id: "child", parent: "agent-a", state: "working" });
  yield* seedAgent({ id: "hidden", state: "working" });
  yield* appendSetup([permissionFor("p1"), questionFor("q1")]);
  const credential = kind === "owner" ? owner : agentCredential(a.token);
  const caller = kind === "owner" ? owner : { _tag: "agent", agentId: a.agentId } as const;
  const ids = new Set(kind === "owner" ? ["agent-a", "child", "hidden"] : ["agent-a", "child"]);
  const before = yield* read("client.snapshot", {}, credential);
  const prefix = yield* subscribe(0).pipe(Stream.take(before.sequence), Stream.runCollect);
  expect(snapshotControl(before, kind === "owner")).toEqual(controlProjection(prefix.reduce(apply, emptyViews()), ids, kind === "owner"));
  const views = yield* Views;
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const realApply = views.applyCommitted;
  const spy = vi.spyOn(views, "applyCommitted").mockImplementation((batch) =>
    Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(realApply(batch))));
  yield* Effect.gen(function* () {
    const writing = yield* appendSetup([
      event({ _tag: "AgentGrouped", agentId: a.agentId, groups: ["new", "review"] }),
      event({ _tag: "StateChanged", agentId: a.agentId, state: { _tag: "paused", reason: "limit", midTurn: true } }),
      event({ _tag: "PermissionMoved", agentId: a.agentId, permissionRequestId: "p1", from: owner, to: { _tag: "agent", agentId: "child" }, deliveryId: "moved-p1" }),
      event({ _tag: "QuestionAnswered", agentId: a.agentId, questionId: "q1", answeredBy: owner, text: "Answer.", deliveryId: "answered-q1" }),
      permissionFor("p2", { agentId: "child" }), questionFor("q2", { agentId: "child" }),
      event({ _tag: "DeliveryHeld", agentId: a.agentId, deliveryId: "empty-hold", reason: "capacity" }),
    ]).pipe(Effect.forkScoped);
    yield* Deferred.await(entered);
    const during = yield* snapshotFor(caller);
    expect(during.sequence).toBe(before.sequence);
    expect(snapshotControl(during, kind === "owner")).toEqual(snapshotControl(before, kind === "owner"));
    // The durable suffix is readable while publication is held. Fold it into
    // the snapshot's control data and compare with independently projected replay.
    const head = yield* headSequence;
    const durable = yield* subscribe(0).pipe(Stream.take(head), Stream.runCollect);
    const suffix = yield* subscribe(before.sequence).pipe(Stream.take(head - before.sequence), Stream.runCollect);
    const visibleSuffix = suffix.filter((row) => row.agentId !== undefined && ids.has(row.agentId));
    const restored = visibleSuffix.reduce(apply, restoreControl(before, emptyViews()));
    const expected = controlProjection(durable.reduce(apply, emptyViews()), ids, kind === "owner");
    expect(controlProjection(restored, ids, kind === "owner")).toEqual(expected);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(writing);
    const after = yield* read("client.snapshot", {}, credential);
    expect(after.sequence).toBe(head);
    expect(snapshotControl(after, kind === "owner")).toEqual(expected);
    expect(after.agents.find((row: any) => row.agentId === a.agentId)).toMatchObject({ groups: ["new", "review"], state: { _tag: "paused" }, openPermissionRequests: 1, openQuestionsAsked: 0 });
    expect(after.requests.find((row: any) => row.id === "p1").holder).toEqual({ _tag: "agent", agentId: "child" });
  }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.ensuring(Effect.sync(() => spy.mockRestore())));
})));

it("3.1 owner snapshot preserves pre-existing deliveries, nonblocking waits, reloadability and every identity without prompt text or account values", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a", reloadable: false });
  yield* seedAgent({ id: "agent-b" });
  yield* seedAccount("names-only");
  yield* appendSetup([
    event({ _tag: "AccountChanged", accountId: "names-only", account: { id: "names-only", harness: "first", enabled: true, environment: { COLOR: "plain-account-fixture-value", API: "secret:fixture-reference" } } }),
    event({ _tag: "DeliveryQueued", delivery: { id: "queued", target: "agent-a", sender: owner, content: { _tag: "prompt", text: "Private delivery body." }, source: { _tag: "wait", id: "older-wait" } } }),
    event({ _tag: "WaitOpened", agentId: "agent-a", waitId: "open-wait", members: ["agent-b"], mode: "all", blocking: false }),
    event({ _tag: "WaitOpened", agentId: "agent-b", waitId: "blocking-wait", members: ["agent-a"], mode: "all", blocking: true }),
    permissionFor("p1"), questionFor("q1"),
  ]);
  const reply = yield* snapshotFor();
  expect(reply.agents.find((row: any) => row.agentId === "agent-a")).toMatchObject({ reloadable: false });
  expect(reply.waitState).toEqual({ deliveries: [{ id: "queued", target: "agent-a", status: "queued", source: "wait" }], waits: [{ agentId: "agent-a", waitId: "open-wait" }] });
  expect(reply.accounts.find((row: any) => row.id === "names-only").environment).toEqual([{ name: "COLOR", secret: false }, { name: "API", secret: true }]);
  expect(reply.requests[0]).toMatchObject({ id: "p1", agentId: "agent-a", holder: owner, sourceSequence: expect.any(Number), display: expect.any(Object) });
  expect(reply.questions[0]).toMatchObject({ id: "q1", display: expect.any(Object) });
  expect(JSON.stringify(reply)).not.toMatch(/plain-account-fixture-value|fixture-reference|Private delivery body/);
})));

it("3.1 an agent snapshot contains identities but omits displays, accounts, alerts, wait state, reloadable and capacityHeld", async () => run(Effect.gen(function* () {
  const a = yield* seedAgent({ id: "agent-a" });
  yield* appendSetup([permissionFor("p1"), questionFor("q1")]);
  const reply = yield* read("client.snapshot", {}, agentCredential(a.token));
  for (const key of ["accounts", "alerts", "waitState"]) expect(reply).not.toHaveProperty(key);
  for (const row of reply.agents) for (const key of ["reloadable", "capacityHeld"]) expect(row).not.toHaveProperty(key);
  for (const row of [...reply.requests, ...reply.questions]) {
    expect(row).not.toHaveProperty("display");
    expect(Object.keys(row).sort()).toEqual(["agentId", "holder", "id", "openedAt", "sourceSequence"]);
    expect(row.openedAt).toEqual(expect.any(Number));
  }
})));

it("3.1 every section and sequence uses one views value even when a second read would see a new commit", async () => {
  const first = { ...emptyViews(), sequence: 41 } as ReturnType<typeof emptyViews>;
  let reads = 0;
  const result = await Effect.runPromise(snapshot(owner).pipe(Effect.provideService(Views, {
    snapshot: Effect.sync(() => { reads++; return reads === 1 ? first : { ...first, sequence: 42 } as typeof first; }),
    applyCommitted: () => Effect.void,
  })));
  expect(result.sequence).toBe(41);
  expect(reads).toBe(1);
});

it("3.1 display projections retain every identity and only the newest 256 displays of each kind", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" });
  const fullOptions = Array.from({ length: 12 }, (_, i) => ({ id: `option-${i}-${"i".repeat(118)}`, name: "界\\\"\n".repeat(100), kind: "allow_once", level: "ask", persistent: false }));
  for (let i = 0; i < 300; i++) yield* appendSetup([permissionFor(`p-${i}`, { description: "界\\\"\n".repeat(600), options: fullOptions }), questionFor(`q-${i}`, { text: "界\\\"\n".repeat(600) })]);
  const reply = yield* snapshotFor();
  for (const [key, prefix] of [["requests", "p"], ["questions", "q"]] as const) {
    expect(reply[key]).toHaveLength(300);
    const displayed = reply[key].filter((row: any) => row.display !== undefined);
    expect(displayed.map((row: any) => row.id)).toEqual(Array.from({ length: 256 }, (_, i) => `${prefix}-${i + 44}`));
    expect(reply[`${key}WithoutDisplay`]).toBe(44);
    for (const row of displayed) {
      expect(bytes(row.display)).toBeLessThanOrEqual(4096);
      expect(Buffer.byteLength(row.display.preview)).toBeLessThanOrEqual(512);
      expect(row.display.options.length).toBeLessThanOrEqual(8);
      for (const option of row.display.options) expect(Buffer.byteLength(option.name)).toBeLessThanOrEqual(128);
    }
  }
})));

it("3.1 encoded display budgets count escaping, multibyte names, overlong ids, unknown kinds and omitted options", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" });
  const options = Array.from({ length: 12 }, (_, i) => ({ id: i === 0 ? "long-id-".repeat(25) : `option-${i}`, name: "\"\\\n界".repeat(100), kind: "future-kind-".repeat(100), level: "ask", persistent: false }));
  const input = permissionFor("budget", { description: "\"\\\n界".repeat(500), options, toolKind: "read", toolInput: { content: "Full action input must be fetched by source sequence." } });
  yield* appendSetup([input]);
  const reply = yield* snapshotFor();
  const display = reply.requests[0].display;
  expect(display, "a bounded display should fit after omitting the overlong option").toBeDefined();
  expect(bytes(display)).toBeLessThanOrEqual(4096);
  expect(display.optionCount).toBe(12);
  expect(display.toolKind).toBe("read");
  expect(JSON.stringify(reply)).not.toContain("Full action input");
  expect(display.options.length).toBeGreaterThan(0);
  expect(display.options.length).toBeLessThanOrEqual(8);
  expect(display.options.length).toBeLessThan(display.optionCount);
  for (const option of display.options) {
    expect(options.some((original) => original.id === option.id)).toBe(true);
    expect(option.id).not.toContain("long-id");
    expect(option.kind).toBe("unknown");
    expect(Buffer.byteLength(option.name)).toBeLessThanOrEqual(128);
    expect(option.name).not.toContain("\ufffd");
  }
  expect(Buffer.byteLength(display.preview)).toBeLessThanOrEqual(512);
  expect(display.preview).not.toContain("\ufffd");
  expect(display.bytes).toBeGreaterThan(bytes(input));
})));

it("3.1 a service snapshot has the owner's engine wait state and reloadable flags", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a", reloadable: false });
  const reply = yield* snapshotFor({ _tag: "service", service: "roles.stallWatch" });
  expect(reply.waitState).toEqual({ deliveries: [], waits: [] });
  expect(reply.agents[0]).toMatchObject({ agentId: "agent-a", reloadable: false });
  expect(reply.accounts).toEqual(expect.any(Array));
})));
