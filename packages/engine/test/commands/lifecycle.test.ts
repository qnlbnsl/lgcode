import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  acceptedDelivery, agentIdOf, agentRow, appendSetup, call, crashAgent, eventOf, failureOf, finishedTurn,
  folderIn, harnessSettings, headSequence, logAfter, makeFakeSecrets, makeRig, openWait, ownerCredential,
  provideRig, readLog, removeRig, seedAccount, seedAgent, seedHarness, startPayload, stateOf, success, viewsWithoutSequence,
  type Fakes, type Rig, type SeedState,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Views from "../../src/views/Views.ts";

// Criterion 5.4 (decision rows 62, 66, 70, 71): one case per row of the
// lifecycle-command table. Each case asserts only the event the command
// writes and the change it makes to the views. Downstream effects (the
// adapter's behaviour, waits settling, accounts resuming agents) belong to
// 5.8, 6.5, 6.7 and 6.10. The caller is the owner throughout: who may call is
// authorization.test.ts.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

// Every case runs on a fresh database, with the fake runner and the fake
// secret store, and registers the rebuild check (row 63).
const withRig = <A, E, R>(body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fakes: Fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      return yield* body(fakes);
    }));
  });

// Unit 6a: exactly one SessionOpened for the agent, written after its
// StateChanged to starting.
const expectSessionOpenedAfterStarting = (written: ReadonlyArray<{ readonly _tag: string }>, agentId: string) => {
  expect(written.filter((event) => event._tag === "SessionOpened")).toEqual([expect.objectContaining({ agentId })]);
  const starting = written.findIndex((event) => event._tag === "StateChanged"
    && "state" in event && (event.state as { readonly _tag: string })._tag === "starting");
  expect(starting).toBeGreaterThanOrEqual(0);
  expect(written.findIndex((event) => event._tag === "SessionOpened")).toBeGreaterThan(starting);
};

const tags = (events: ReadonlyArray<{ readonly event: { readonly _tag: string } }>) => events.map((row) => row.event._tag);

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

it.effect("5.4 start: catches a start that writes no AgentStarted, or leaves out the parent, harness, account, model, effort, mode or the checked real folder from the new agent's row", () =>
  withRig((fakes) => Effect.gen(function* () {
    const real = folderIn(rig, "project");
    const before = yield* headSequence;
    const reply = success(yield* call(ownerCredential, "start", startPayload(rig, { folder: real })));
    const agentId = reply.agentId as string;

    const written = (yield* logAfter(before)).map((row) => row.event);
    const started = written.find((event) => event._tag === "AgentStarted");
    expect(started).toMatchObject({ _tag: "AgentStarted", agentId, parent: { _tag: "owner" } });
    // Unit 6a: the runner's session result is written as one SessionOpened after the AgentStarted.
    const tagsWritten = written.map((event) => event._tag);
    expect(written.filter((event) => event._tag === "SessionOpened")).toEqual([expect.objectContaining({ agentId })]);
    expect(tagsWritten.indexOf("SessionOpened")).toBeGreaterThan(tagsWritten.indexOf("AgentStarted"));

    const row = yield* agentRow(agentId);
    expect(row).toMatchObject({
      agentId, name: "Builder", role: "worker", groups: ["engine"], parent: { _tag: "owner" }, harness: "first",
      account: "primary", model: "test-model", effort: "high", permission: "ask", folder: real, runMode: "acp",
      state: { _tag: "idle" },
    });
    expect(fakes.runner.callsOf("start")).toHaveLength(1);
    expect(fakes.runner.callsOf("start")[0]?.input.agentId).toBe(agentId);
  })).pipe(Effect.orDie));

it.effect("5.4 start: catches a first prompt that is dropped, is queued without its sender, or is queued for another agent", () =>
  withRig(() => Effect.gen(function* () {
    const reply = success(yield* call(ownerCredential, "start", startPayload(rig, { prompt: "Build the log." })));
    const views = yield* Views.Views;
    const deliveries = Object.values((yield* views.snapshot).deliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      target: reply.agentId, sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Build the log." }, status: "queued",
    });
  })).pipe(Effect.orDie));

it.effect("5.4 start: catches a start with no prompt that still queues a delivery", () =>
  withRig(() => Effect.gen(function* () {
    success(yield* call(ownerCredential, "start", startPayload(rig)));
    const views = yield* Views.Views;
    expect(Object.values((yield* views.snapshot).deliveries)).toHaveLength(0);
  })).pipe(Effect.orDie));

it.effect("5.4 start (row 70): catches an adapter rejection that leaves the agent starting, writes no 'agent start failed', or writes it with other text", () =>
  withRig((fakes) => Effect.gen(function* () {
    fakes.runner.rejectNext("start", "model not available");
    const before = yield* headSequence;
    // The reply of a failed start is not fixed by the table; only the log and the views are.
    yield* call(ownerCredential, "start", startPayload(rig));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written.map((event) => event._tag)).toEqual(expect.arrayContaining(["AgentStarted", "AgentStartFailed"]));
    const failed = written.find((event) => event._tag === "AgentStartFailed");
    expect(failed).toMatchObject({ _tag: "AgentStartFailed", reason: "agent start failed" });

    const views = yield* Views.Views;
    const rows = Object.values((yield* views.snapshot).agents).filter((agent) => agent.name === "Builder");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toEqual({ _tag: "stopped" });
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

it.effect("5.4 prompt: catches a prompt that writes no DeliveryQueued, loses the sender, or queues it for the wrong agent", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    yield* seedAgent({ id: "agent-b" });
    const before = yield* headSequence;
    const reply = success(yield* call(ownerCredential, "prompt", { agentId: "agent-a", text: "Run the tests." }));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      _tag: "DeliveryQueued",
      delivery: { id: reply.deliveryId, target: "agent-a", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Run the tests." } },
    });
    const views = yield* Views.Views;
    const deliveries = (yield* views.snapshot).deliveries;
    expect(deliveries[reply.deliveryId as string]).toMatchObject({ target: "agent-a", sender: { _tag: "owner" }, status: "queued" });
    expect(Object.values(deliveries).filter((delivery) => delivery.target === "agent-b")).toHaveLength(0);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

it.effect("5.4 stop: catches a stop that writes no AgentStopped, leaves an open wait of the agent open, closes a wait of another agent, or stops the agent's children", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    yield* seedAgent({ id: "agent-kid", parent: "agent-a" });
    yield* openWait("agent-a", "wait-1", ["agent-kid"]);
    yield* openWait("agent-a", "wait-2", ["agent-kid"]);
    yield* openWait("agent-kid", "wait-kid", ["agent-a"]);
    const before = yield* headSequence;

    success(yield* call(ownerCredential, "stop", { agentId: "agent-a" }));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written.filter((event) => event._tag === "AgentStopped")).toEqual([{ _tag: "AgentStopped", agentId: "agent-a" }]);
    const cancelled = written.filter((event) => event._tag === "WaitCancelled").map((event) => "waitId" in event ? event.waitId : "");
    expect([...cancelled].sort()).toEqual(["wait-1", "wait-2"]);

    expect(yield* stateOf("agent-a")).toBe("stopped");
    expect(yield* stateOf("agent-kid")).toBe("idle");
    const views = yield* Views.Views;
    const waits = (yield* views.snapshot).waits;
    expect(waits["wait-1"]?.status).toBe("cancelled");
    expect(waits["wait-2"]?.status).toBe("cancelled");
    // Rows 25 and 50 (unit 5d): the stop resolves the kid's wait on agent-a, without cancelling it.
    expect(waits["wait-kid"]).toMatchObject({ status: "satisfied", resolved: [{ agentId: "agent-a", reason: "stopped" }] });
    expect(fakes.runner.callsOf("stop")).toHaveLength(1);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// resume
// ---------------------------------------------------------------------------

const resumable = ["crashed", "interrupted", "stopped"] as const satisfies ReadonlyArray<SeedState>;

for (const from of resumable) it.effect(`5.4 resume (reloadable) from ${from}: catches a resume that writes no StateChanged to starting, or cancels the agent's open waits`, () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    yield* openWait("agent-a", "wait-1", ["agent-b"]);
    if (from === "crashed") yield* crashAgent("agent-a");
    if (from === "stopped") yield* appendSetup([eventOf({ _tag: "AgentStopped", agentId: "agent-a" })], { revokeAgentTokens: [agentIdOf("agent-a")] });
    if (from === "interrupted") yield* appendSetup([eventOf({ _tag: "AgentInterrupted", agentId: "agent-a", previous: "idle" })]);
    expect(yield* stateOf("agent-a")).toBe(from);
    const before = yield* headSequence;

    success(yield* call(ownerCredential, "resume", { agentId: "agent-a" }));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toContainEqual({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "starting" } });
    expect(written.map((event) => event._tag)).not.toContain("WaitCancelled");
    // Unit 6a: the runner's session result is written as one SessionOpened after the StateChanged.
    expectSessionOpenedAfterStarting(written, "agent-a");
    expect(yield* stateOf("agent-a")).toBe("idle");
    // The wait the agent had before is still there for 5d.1 to re-open and re-check (row 67).
    const views = yield* Views.Views;
    expect((yield* views.snapshot).waits["wait-1"]?.status).toBe("open");
    expect(fakes.runner.callsOf("load")).toHaveLength(1);
    expect(fakes.runner.callsOf("start")).toHaveLength(0);
  })).pipe(Effect.orDie));

it.effect("5.4 resume (cannot reload): catches a resume of an agent whose adapter cannot reload that changes its state, calls the runner, or is refused with another reason than 'cannot reload'", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", reloadable: false });
    yield* crashAgent("agent-a");
    const views = yield* viewsWithoutSequence;
    const before = yield* headSequence;

    const outcome = yield* call(ownerCredential, "resume", { agentId: "agent-a" });

    expect(failureOf(outcome)).toEqual({ _tag: "CommandRefused", reason: "cannot reload" });
    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toEqual([{ _tag: "CommandRefused", command: "resume", reason: "cannot reload" }]);
    expect(yield* viewsWithoutSequence).toEqual(views);
    expect(yield* stateOf("agent-a")).toBe("crashed");
    expect(fakes.runner.calls).toHaveLength(0);
  })).pipe(Effect.orDie));

it.effect("5.4 resume --fresh (row 66): catches a fresh resume that re-queues deliveries accepted before the last turn end, skips those accepted since, or reloads the old session", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    yield* acceptedDelivery("agent-a", "delivery-old", "Before the turn ended.");
    yield* finishedTurn("agent-a");
    yield* acceptedDelivery("agent-a", "delivery-new-1", "After the turn ended.");
    yield* acceptedDelivery("agent-a", "delivery-new-2", "Also after.");
    yield* crashAgent("agent-a");
    const before = yield* headSequence;

    success(yield* call(ownerCredential, "resume", { agentId: "agent-a", fresh: true }));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toContainEqual({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "starting" } });
    const requeued = written.filter((event) => event._tag === "DeliveryRequeued").map((event) => "deliveryId" in event ? event.deliveryId : "");
    expect([...requeued].sort()).toEqual(["delivery-new-1", "delivery-new-2"]);
    // Unit 6a: the runner's session result is written as one SessionOpened after the StateChanged.
    expectSessionOpenedAfterStarting(written, "agent-a");

    expect(yield* stateOf("agent-a")).toBe("idle");
    const views = yield* Views.Views;
    const deliveries = (yield* views.snapshot).deliveries;
    expect(deliveries["delivery-new-1"]?.status).toBe("queued");
    expect(deliveries["delivery-new-2"]?.status).toBe("queued");
    expect(deliveries["delivery-old"]?.status).toBe("accepted");
    expect(fakes.runner.callsOf("load")).toHaveLength(0);
    expect(fakes.runner.callsOf("start")).toHaveLength(1);
  })).pipe(Effect.orDie));

it.effect("5.4 resume --fresh: catches a fresh resume refused as 'cannot reload' on an agent that cannot reload, which is the case --fresh exists for", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", reloadable: false });
    yield* crashAgent("agent-a");
    const before = yield* headSequence;
    success(yield* call(ownerCredential, "resume", { agentId: "agent-a", fresh: true }));
    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toContainEqual({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "starting" } });
    // Unit 6a: the runner's session result is written as one SessionOpened after the StateChanged.
    expectSessionOpenedAfterStarting(written, "agent-a");
    expect(yield* stateOf("agent-a")).toBe("idle");
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// compact
// ---------------------------------------------------------------------------

it.effect("5.4 compact: catches a compact that writes no compact delivery, queues a prompt instead, or drops the sender", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    const before = yield* headSequence;
    const reply = success(yield* call(ownerCredential, "compact", { agentId: "agent-a" }));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      _tag: "DeliveryQueued", delivery: { id: reply.deliveryId, target: "agent-a", sender: { _tag: "owner" }, content: { _tag: "compact" } },
    });
    const views = yield* Views.Views;
    expect((yield* views.snapshot).deliveries[reply.deliveryId as string]).toMatchObject({
      status: "queued", content: { _tag: "compact" },
    });
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// group
// ---------------------------------------------------------------------------

it.effect("5.4 group: catches a group command that writes no AgentGrouped, ignores 'remove', or replaces the labels instead of adding to them", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", groups: ["alpha", "beta"] });
    const before = yield* headSequence;
    success(yield* call(ownerCredential, "group", { agentId: "agent-a", add: ["gamma"], remove: ["alpha"] }));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toHaveLength(1);
    expect(written[0]?._tag).toBe("AgentGrouped");
    expect([...(((yield* agentRow("agent-a"))?.groups) ?? [])].sort()).toEqual(["beta", "gamma"]);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

it.effect("5.4 accounts list: catches a list that writes an event or changes a view", () =>
  withRig(() => Effect.gen(function* () {
    const views = yield* viewsWithoutSequence;
    const before = yield* headSequence;
    const reply = success(yield* call(ownerCredential, "accounts", { operation: "list" }));
    expect((reply.accounts as ReadonlyArray<{ id: string }>).map((account) => account.id)).toEqual(["primary"]);
    expect(yield* logAfter(before)).toEqual([]);
    expect(yield* viewsWithoutSequence).toEqual(views);
  })).pipe(Effect.orDie));

it.effect("5.4 accounts add: catches an add that writes no AccountChanged or leaves the account out of the list", () =>
  withRig(() => Effect.gen(function* () {
    const before = yield* headSequence;
    const account = { id: "spare", harness: "first", displayName: "Spare", enabled: true };
    success(yield* call(ownerCredential, "accounts", { operation: "add", account }));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toEqual([{ _tag: "AccountChanged", accountId: "spare", account }]);
    const views = yield* Views.Views;
    expect((yield* views.snapshot).accounts["spare"]).toMatchObject({ ...account, status: "available" });
  })).pipe(Effect.orDie));

it.effect("5.4 accounts set: catches a set that adds a second account instead of replacing the first, or keeps the old name", () =>
  withRig(() => Effect.gen(function* () {
    const before = yield* headSequence;
    const account = { id: "primary", harness: "first", displayName: "Renamed", enabled: true };
    success(yield* call(ownerCredential, "accounts", { operation: "set", account }));

    const written = (yield* logAfter(before)).map((row) => row.event);
    expect(written).toEqual([{ _tag: "AccountChanged", accountId: "primary", account }]);
    const views = yield* Views.Views;
    const accounts = (yield* views.snapshot).accounts;
    expect(Object.keys(accounts)).toEqual(["primary"]);
    expect(accounts["primary"]?.displayName).toBe("Renamed");
  })).pipe(Effect.orDie));

it.effect("5.4 accounts set-secret (row 55): catches a value that reaches an event, a view or the reply, or a secret reference that does not resolve to the value", () =>
  withRig((fakes) => Effect.gen(function* () {
    const value = "sk-live-planted-0123456789abcdef";
    const before = yield* headSequence;
    const reply = success(yield* call(ownerCredential, "accounts set-secret", {
      accountId: "primary", name: "API_KEY", nonce: "nonce-1", value: Redacted.make(value),
    }));

    const written = yield* logAfter(before);
    expect(written.map((row) => row.event._tag)).toEqual(["AccountChanged"]);
    const views = yield* Views.Views;
    const account = (yield* views.snapshot).accounts["primary"];
    // The reference may sit in the account's `secret` or in an environment value (the name is the owner's).
    const references = JSON.stringify(account).match(/secret:[a-zA-Z0-9_-]+/g) ?? [];
    expect(references).toHaveLength(1);
    expect(fakes.secrets.stored.get(references[0]!)).toBe(value);

    for (const place of [JSON.stringify(written), JSON.stringify(yield* views.snapshot), JSON.stringify(reply)]) {
      expect(place).not.toContain(value);
    }
    const sql = yield* SqlClient.SqlClient;
    expect(JSON.stringify(yield* sql`SELECT * FROM receipts`)).not.toContain(value);
    expect(JSON.stringify(yield* readLog)).not.toContain(value);
  })).pipe(Effect.orDie));

it.effect("5.4 accounts mark-available: catches a command that writes no AccountAvailable, writes another cause than 'owner cleared', or leaves the account out of usage", () =>
  withRig(() => Effect.gen(function* () {
    yield* appendSetup([eventOf({ _tag: "AccountOutOfUsage", accountId: "primary", resetAt: 4_000_000_000_000 })]);
    const views = yield* Views.Views;
    expect((yield* views.snapshot).accounts["primary"]?.status).toBe("out-of-usage");
    const before = yield* headSequence;

    success(yield* call(ownerCredential, "accounts mark-available", { accountId: "primary" }));

    expect((yield* logAfter(before)).map((row) => row.event)).toEqual([
      { _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" },
    ]);
    expect((yield* views.snapshot).accounts["primary"]?.status).toBe("available");
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// harnesses
// ---------------------------------------------------------------------------

it.effect("5.4 harnesses list: catches a list that writes an event or changes a view", () =>
  withRig(() => Effect.gen(function* () {
    const views = yield* viewsWithoutSequence;
    const before = yield* headSequence;
    const reply = success(yield* call(ownerCredential, "harnesses", { operation: "list" }));
    expect(Array.isArray(reply.harnesses)).toBe(true);
    expect(yield* logAfter(before)).toEqual([]);
    expect(yield* viewsWithoutSequence).toEqual(views);
  })).pipe(Effect.orDie));

// The views have no harness-settings projection yet (issue 51), so the view
// change of this row is read through the command's own list.
it.effect("5.4 harnesses set: catches a set that writes no HarnessChanged, or whose settings a later list does not return", () =>
  withRig(() => Effect.gen(function* () {
    const harness = harnessSettings("first", { adapterArguments: ["--stdio", "--changed"] });
    const before = yield* headSequence;
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness }));

    expect((yield* logAfter(before)).map((row) => row.event)).toEqual([{ _tag: "HarnessChanged", harness }]);
    const listed = success(yield* call(ownerCredential, "harnesses", { operation: "list" }));
    expect(listed.harnesses).toContainEqual(harness);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// Invalid states (the state table of row 24, refused as "command refused")
// ---------------------------------------------------------------------------

type Target = { readonly name: string; readonly payload: Record<string, unknown> };
const lifecycleCommands: Readonly<Record<string, Target>> = {
  prompt: { name: "prompt", payload: { agentId: "agent-a", text: "Hello." } },
  compact: { name: "compact", payload: { agentId: "agent-a" } },
  resume: { name: "resume", payload: { agentId: "agent-a" } },
  stop: { name: "stop", payload: { agentId: "agent-a" } },
};

// Written out in full, not read from the contract, so a wrong edit of the
// contract's table fails here.
const refusedCases: ReadonlyArray<readonly [string, SeedState]> = [
  ["prompt", "crashed"], ["prompt", "stopped"],
  ["compact", "starting"], ["compact", "working"], ["compact", "paused"], ["compact", "interrupted"],
  ["compact", "crashed"], ["compact", "stopped"],
  ["resume", "starting"], ["resume", "working"], ["resume", "idle"], ["resume", "paused"],
  ["stop", "stopped"],
];

for (const [command, state] of refusedCases) it.effect(`5.4 invalid state: catches ${command} on a ${state} agent that is not refused with 'command refused' and a single CommandRefused event`, () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", state });
    const views = yield* viewsWithoutSequence;
    const before = yield* headSequence;
    const target = lifecycleCommands[command]!;

    const outcome = yield* call(ownerCredential, target.name, target.payload);

    expect(failureOf(outcome)).toEqual({ _tag: "CommandRefused", reason: "command refused" });
    expect((yield* logAfter(before)).map((row) => row.event)).toEqual([
      { _tag: "CommandRefused", command, reason: "command refused" },
    ]);
    expect(yield* viewsWithoutSequence).toEqual(views);
    expect(fakes.runner.calls).toHaveLength(0);
  })).pipe(Effect.orDie));

// The states a command is accepted in, from the same table: a refusal there is the opposite break.
const acceptedCases: ReadonlyArray<readonly [string, SeedState]> = [
  ["prompt", "starting"], ["prompt", "working"], ["prompt", "idle"], ["prompt", "paused"], ["prompt", "interrupted"],
  ["compact", "idle"],
  ["resume", "interrupted"], ["resume", "crashed"], ["resume", "stopped"],
  ["stop", "starting"], ["stop", "working"], ["stop", "idle"], ["stop", "paused"], ["stop", "interrupted"], ["stop", "crashed"],
];

for (const [command, state] of acceptedCases) it.effect(`5.4 valid state: catches ${command} on a ${state} agent that is refused`, () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", state });
    const target = lifecycleCommands[command]!;
    const outcome = yield* call(ownerCredential, target.name, target.payload);
    expect(failureOf(outcome)).toBeUndefined();
  })).pipe(Effect.orDie));

// Group is allowed in every state, including stopped (the table has no refusal for it).
for (const state of ["starting", "working", "idle", "paused", "interrupted", "crashed", "stopped"] as const) it.effect(
  `5.4 group on a ${state} agent: catches a group command refused in a state the table allows`,
  () => withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", state });
    const outcome = yield* call(ownerCredential, "group", { agentId: "agent-a", add: ["x"], remove: [] });
    expect(failureOf(outcome)).toBeUndefined();
    expect((yield* agentRow("agent-a"))?.groups).toContain("x");
  })).pipe(Effect.orDie));

it.effect("5.4 unknown agent: catches a lifecycle command on an agent that does not exist that writes anything but a refusal", () =>
  withRig(() => Effect.gen(function* () {
    const before = yield* headSequence;
    const outcome = yield* call(ownerCredential, "stop", { agentId: "agent-nobody" });
    expect(failureOf(outcome)?._tag).toBe("CommandRefused");
    expect((yield* logAfter(before)).map((row) => row.event._tag)).toEqual(["CommandRefused"]);
  })).pipe(Effect.orDie));

// The handler's tag list, so a refusal never hides a half-written command.
it.effect("5.4 refusal writes nothing else: catches a refused command that leaves a delivery, a token or a process row behind", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", state: "stopped" });
    const sql = yield* SqlClient.SqlClient;
    const tokens = yield* sql`SELECT * FROM agent_tokens`;
    const deliveries = Object.keys((yield* (yield* Views.Views).snapshot).deliveries);
    yield* call(ownerCredential, "prompt", { agentId: "agent-a", text: "Hello." });
    expect(yield* sql`SELECT * FROM agent_tokens`).toEqual(tokens);
    expect(Object.keys((yield* (yield* Views.Views).snapshot).deliveries)).toEqual(deliveries);
    expect(tags(yield* readLog).at(-1)).toBe("CommandRefused");
  })).pipe(Effect.orDie));
