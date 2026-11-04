import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { appendSetup, seedAgent, headSequence } from "../support/handlerRig.ts";
import { run as runReadRig, stream, textItem, event, bytes, owner } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

const cases = [
  { label: "agent match", filter: { agents: ["agent-a"] }, expected: ["a", "account", "alert"] },
  { label: "group match", filter: { groups: ["selected"] }, expected: ["b", "account", "alert"] },
  { label: "agent and group union", filter: { agents: ["agent-a"], groups: ["selected"] }, expected: ["a", "b", "account", "alert"] },
  { label: "neither matches", filter: { agents: ["absent"], groups: ["absent"] }, expected: ["account", "alert"] },
  { label: "kind narrows union", filter: { agents: ["agent-a"], groups: ["selected"], kinds: ["ThreadItem"] }, expected: ["a", "b"] },
  { label: "no list limits", filter: {}, expected: ["a", "b", "c", "account", "alert"] },
  { label: "nonmatching kind", filter: { kinds: ["QuestionAsked"] }, expected: [] },
];
const label = (item: any): string | undefined => item.event?._tag === "ThreadItem" ? item.event.itemId
  : item.event?._tag === "AccountAvailable" ? "account" : item.event?._tag === "client.AlertRaised" ? "alert" : undefined;
for (const phase of ["catch-up", "live"] as const) for (const row of cases) {
  it(`3.4 ${phase} ${row.label}: agent/group union, kind intersection, and unscoped account alerts`, async () => run(Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" }); yield* seedAgent({ id: "agent-b", groups: ["selected"] }); yield* seedAgent({ id: "agent-c" });
    const after = yield* headSequence;
    const events = [textItem("a", "A"), textItem("b", "B", "agent-b"), textItem("c", "C", "agent-c"),
      event({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" }),
      event({ _tag: "client.AlertRaised", alertId: "account-alert", alertKey: "account:primary", kind: "account", subject: { _tag: "account", id: "primary" }, title: "Account needs attention.", sourceSequence: after }),
    ];
    // An unscoped matching sentinel closes every filter case without timers.
    const filter = { ...row.filter, kinds: [...("kinds" in row.filter ? row.filter.kinds : ["ThreadItem", "AccountAvailable", "client.AlertRaised"]), "AccountNeedsSignIn", "AccountOutOfUsage"] };
    if (phase === "catch-up") yield* appendSetup(events);
    const ready = yield* Deferred.make<void>();
    const fiber = yield* stream({ after, filter }).pipe(
      Stream.tap((item) => item.event?._tag === "AccountOutOfUsage" ? Deferred.succeed(ready, undefined) : Effect.void),
      Stream.takeUntil((item) => item.event?._tag === "AccountNeedsSignIn"), Stream.runCollect, Effect.timeout(4_000), Effect.forkChild,
    );
    if (phase === "live") {
      yield* appendSetup([event({ _tag: "AccountOutOfUsage", accountId: "primary" })]);
      yield* Deferred.await(ready);
      yield* appendSetup(events);
    }
    yield* appendSetup([event({ _tag: "AccountNeedsSignIn", accountId: "primary", reason: "End of fixture." })]);
    const received = yield* Fiber.join(fiber);
    expect(received.map(label).filter(Boolean)).toEqual(row.expected);
  })));
}
it.each(["agents", "groups", "kinds"])("3.4 an empty %s list is refused instead of silently widening the stream", async (key) => run(Effect.gen(function* () {
  // Assert the handler exists before accepting any failure as a valid refusal.
  const result = yield* stream({ after: 0, filter: { [key]: [] } }).pipe(Stream.runCollect, Effect.result, Effect.timeout(2_000));
  expect(result._tag).toBe("Failure");
})));
it.each(["catch-up", "live"])("3.4 %s groups use current views and a queued delivery matches its nested target", async (phase) => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a", groups: ["old"] });
  const after = yield* headSequence;
  const grouped = event({ _tag: "AgentGrouped", agentId: "agent-a", groups: ["new"] });
  if (phase === "catch-up") yield* appendSetup([textItem("before-join", "Old event."), grouped]);
  const ready = yield* Deferred.make<void>();
  const fiber = yield* stream({ after, filter: { groups: ["new"] } }).pipe(
    Stream.tap((item) => item.event?._tag === "AccountOutOfUsage" ? Deferred.succeed(ready, undefined) : Effect.void),
    Stream.takeUntil((item) => item.event?._tag === "AccountAvailable"), Stream.runCollect, Effect.timeout(3_000), Effect.forkChild);
  if (phase === "live") {
    yield* appendSetup([textItem("before-join", "Old event."), event({ _tag: "AccountOutOfUsage", accountId: "primary" })]);
    yield* Deferred.await(ready);
    yield* appendSetup([grouped]);
  }
  yield* appendSetup([event({ _tag: "DeliveryQueued", delivery: { id: "nested-target", target: "agent-a", sender: owner, content: { _tag: "prompt", text: "Queued." } } }), event({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" })]);
  const received = yield* Fiber.join(fiber);
  expect(received.some((item) => item.event?.itemId === "before-join")).toBe(phase === "catch-up");
  expect(received.some((item) => item.event?.delivery?.id === "nested-target")).toBe(true);
})));
it("3.4 an oversized event becomes a marker with exact encoded bytes, and reconnect after it reaches the next event", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" }); const after = yield* headSequence;
  const [large, tail] = yield* appendSetup([textItem("big", "界\\\"".repeat(100_000)), textItem("tail", "Small.")]);
  const first = yield* stream({ after }).pipe(Stream.take(1), Stream.runCollect, Effect.timeout(3_000));
  expect(first).toEqual([{ _tag: "client.Oversized", sequence: large!.sequence, tag: "ThreadItem", agentId: "agent-a", bytes: bytes(large) }]);
  const next = yield* stream({ after: first[0].sequence }).pipe(Stream.take(1), Stream.runCollect, Effect.timeout(3_000));
  expect(next).toEqual([tail]);
})));
it("3.4 a named agent filter includes its queued delivery by target even without an envelope agentId", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" }); const after = yield* headSequence;
  const [delivery] = yield* appendSetup([event({ _tag: "DeliveryQueued", delivery: { id: "filtered-target", target: "agent-a", sender: owner, content: { _tag: "prompt", text: "Queued." } } })]);
  const received = yield* stream({ after, filter: { agents: ["agent-a"] } }).pipe(Stream.take(1), Stream.runCollect, Effect.timeout(2_000));
  expect(received).toEqual([delivery]);
})));
it.each(["catch-up", "live"])("3.4 %s filtered agent visibility gains and loses grandchildren with the current holder, while hiding siblings and owner-only events", async (phase) => run(Effect.gen(function* () {
  const parent = yield* seedAgent({ id: "parent" });
  yield* seedAgent({ id: "lead", parent: "parent" }); yield* seedAgent({ id: "worker", parent: "lead" }); yield* seedAgent({ id: "sibling" });
  for (const availability of ["idle", "paused", "idle"] as const) {
    yield* appendSetup([event({ _tag: "StateChanged", agentId: "lead", state: availability === "paused" ? { _tag: "paused", reason: "limit", midTurn: false } : { _tag: "idle" } })]);
    const after = yield* headSequence;
    const batch = [textItem("worker", "Worker text.", "worker"), textItem("sibling", "Sibling text.", "sibling"),
      event({ _tag: "client.AlertRaised", agentId: "parent", alertId: `hidden-${after}`, alertKey: `hidden:${after}`, kind: "failure", title: "Owner-only alert.", sourceSequence: after }),
      textItem("end", "End.", "parent")];
    if (phase === "catch-up") yield* appendSetup(batch);
    const ready = yield* Deferred.make<void>();
    const fiber = yield* stream({ after }, { _tag: "agent", agentId: parent.agentId }).pipe(
      Stream.tap((row) => row.event?.itemId === "ready" ? Deferred.succeed(ready, undefined) : Effect.void),
      Stream.takeUntil((row) => row.event?.itemId === "end"), Stream.runCollect, Effect.timeout(3_000), Effect.forkChild);
    if (phase === "live") {
      yield* appendSetup([textItem("ready", "Ready.", "parent")]); yield* Deferred.await(ready); yield* appendSetup(batch);
    }
    const received = yield* Fiber.join(fiber);
    expect(received.some((row) => row.event?.itemId === "worker")).toBe(availability === "paused");
    expect(received.some((row) => row.event?.itemId === "sibling" || row.event?._tag === "client.AlertRaised" || row.event?._tag === "AccountAvailable")).toBe(false);
  }
})));
it("3.4 skipped events emit a checkpoint by 30 seconds with the scanned cursor and reconnect loses no unscanned event", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" }); const after = yield* headSequence;
  yield* appendSetup([textItem("skip", "Skipped.")]); const scanned = yield* headSequence;
  yield* Effect.gen(function* () {
    const received: any[] = [];
    const fiber = yield* stream({ after, filter: { kinds: ["QuestionAsked"] } }).pipe(Stream.tap((item) => Effect.sync(() => { received.push(item); })), Stream.take(1), Stream.runCollect, Effect.forkChild);
    yield* TestClock.adjust(30_000);
    const checkpoints = yield* Fiber.join(fiber);
    expect(checkpoints).toEqual([{ _tag: "client.Checkpoint", sequence: scanned }]);
    yield* appendSetup([textItem("unscanned", "After checkpoint.")]);
    const resumed = yield* stream({ after: scanned }).pipe(Stream.take(1), Stream.runCollect);
    expect(resumed[0].event.itemId).toBe("unscanned");
  }).pipe(Effect.provide(TestClock.layer()));
})));
