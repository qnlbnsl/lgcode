import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect, it } from "vitest";
import { apply, emptyViews } from "../../src/views/apply.ts";
import { Views } from "../../src/views/Views.ts";
import { snapshot } from "../../src/api/snapshot.ts";
import { visibleTo } from "../../src/api/visibility.ts";
import { agentCredential, appendSetup, seedAgent, seedAccount } from "../support/handlerRig.ts";
import { subscribe } from "../../src/log/subscribe.ts";
import { run as runReadRig, read, snapshotFor, permissionFor, questionFor, event, bytes, owner } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it.each(["owner", "agent"] as const)("3.1 %s snapshot plus subscribe reaches the same visible agent, request and question state as full replay", async (kind) => run(Effect.gen(function* () {
  const a = yield* seedAgent({ id: "agent-a" });
  yield* seedAgent({ id: "hidden" });
  yield* appendSetup([permissionFor("p1"), questionFor("q1")]);
  const credential = kind === "owner" ? owner : agentCredential(a.token);
  const caller = kind === "owner" ? owner : { _tag: "agent", agentId: a.agentId } as const;
  const before = yield* read("client.snapshot", {}, credential);
  yield* appendSetup([
    event({ _tag: "PermissionAnswered", agentId: a.agentId, permissionRequestId: "p1", answeredBy: owner, answer: { _tag: "selected", optionId: "once" } }),
    questionFor("q2"),
  ]);
  const views = yield* Views;
  const current = yield* views.snapshot;
  const full = yield* subscribe(0).pipe(Stream.take(current.sequence), Stream.runCollect);
  const visible = full.filter((row) => visibleTo(caller, row, current));
  const suffix = yield* subscribe(before.sequence).pipe(Stream.take(current.sequence - before.sequence), Stream.runCollect);
  const after = yield* read("client.snapshot", {}, credential);
  const requests = new Set(before.requests.map((row: any) => row.id));
  const questions = new Set(before.questions.map((row: any) => row.id));
  for (const { event: e } of suffix.filter((row) => visibleTo(caller, row, current))) {
    if (e._tag === "PermissionAnswered") requests.delete(e.permissionRequestId);
    if (e._tag === "QuestionAsked") questions.add(e.questionId);
  }
  const replay = visible.reduce(apply, emptyViews());
  expect(after.sequence).toBe(current.sequence);
  expect(after.agents.map((row: any) => row.agentId).sort()).toEqual(Object.keys(replay.agents).sort());
  expect(after.requests.map((row: any) => row.id).sort()).toEqual([...requests].sort());
  expect(after.questions.map((row: any) => row.id).sort()).toEqual([...questions].sort());
  expect(after.requests).toHaveLength(0);
  expect(after.questions.map((row: any) => row.id)).toEqual(["q1", "q2"]);
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
    expect(Object.keys(row).sort()).toEqual(["agentId", "holder", "id", "sourceSequence"]);
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
  const reply = yield* snapshotFor({ _tag: "service", service: "roles.sheepdog" });
  expect(reply.waitState).toEqual({ deliveries: [], waits: [] });
  expect(reply.agents[0]).toMatchObject({ agentId: "agent-a", reloadable: false });
  expect(reply.accounts).toEqual(expect.any(Array));
})));
