// Criterion 7.3 (unit 7a; spec "The command handler": `subscribe` for an
// agent shows only its own thread and its children's, and a parent's rights
// reach only its own children, not its grandchildren): for every event type,
// an agent's `subscribe` returns only events of itself and its children, and
// agent-less events are owner-only. The cases are driven from the contracts'
// event union, so a new event type fails here until it has a sample. Issue
// 41: a subscriber that stops acknowledging is disconnected, and the service
// keeps serving the others. The server is built in process.
import { randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Event, eventVisibility, type EventEnvelope } from "@shephrd/contracts";
import { rolesSamples } from "../../../contracts/test/roles/fixtures.ts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as Server from "../../src/api/server.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  appendSetup, eventOf, makeFakeSecrets, makeRig, provideRig, readLog, removeRig, seedAccount, seedAgent, seedHarness,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ancestryHeaders, authorization, connect, requestFrame, upgrade } from "../support/socketClient.ts";

const ownerSecret = randomBytes(32).toString("base64url");

// Every requirement is provided inside the test; the cast keeps the missing
// production module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);
const tags = Object.keys(Event.pipe(Schema.toTaggedUnion("_tag")).cases).sort();
const agentBearing = new Set(tags.filter((tag) => "agentId" in (Event.pipe(Schema.toTaggedUnion("_tag")).cases as Record<string, { fields: object }>)[tag]!.fields));

const owner = { _tag: "owner" } as const;
const permissionOption = { id: "once", name: "Allow once", kind: "allow_once", level: "read-only", persistent: false };
const harness = {
  id: "second", runMode: "acp", adapterPath: "/usr/bin/true", adapterArguments: [],
  permissionMapping: { "read-only": "r", ask: "a", edit: "e", full: "f" }, reportedModes: [],
  defaultPermission: "ask", models: [], efforts: [], denyReadMechanism: { _tag: "none" },
};

// A repeated AgentStarted must keep each agent's parent, or it would move the agent.
const parents: Record<string, string> = { "agent-child": "agent-self", "agent-grandchild": "agent-child", "agent-sibling": "agent-stranger" };

// One valid payload per event type. `a` is the agent the event is about,
// `n` makes its identifiers unique. Terminal events for the subscriber itself
// are left out (`terminal`), because they would end its own access.
const samples: Record<string, (a: string, n: string) => Record<string, unknown>> = {
  ...rolesSamples,
  AgentStarted: (a) => ({ agentId: a, name: `n-${a}`, role: "worker", groups: [], parent: parents[a] === undefined ? owner : { _tag: "agent", agentId: parents[a] }, harness: "first", account: "primary", permission: "ask", folder: "/tmp", runMode: "acp" }),
  AgentStartFailed: (a) => ({ agentId: a, reason: "agent start failed" }),
  SessionOpened: (a, n) => ({ agentId: a, session: { _tag: "acp", sessionId: `s-${n}` }, protocolVersion: 2, reloadable: true }),
  PromptSent: (a, n) => ({ agentId: a, deliveryId: `d-${n}`, sender: owner, text: "Prompt text." }),
  ThreadItem: (a, n) => ({ agentId: a, itemId: `i-${n}`, content: { _tag: "text", text: "Thread text." }, replay: false }),
  TurnStarted: (a) => ({ agentId: a }),
  TurnEnded: (a) => ({ agentId: a, compact: false }),
  StateChanged: (a) => ({ agentId: a, state: { _tag: "paused", reason: "limit", midTurn: false } }),
  ModeChanged: (a) => ({ agentId: a, mode: "default", level: "ask" }),
  ModeRefused: (a) => ({ agentId: a, mode: "full-access", ceiling: "ask", reason: "mode exceeds permission ceiling" }),
  PermissionRequested: (a, n) => ({ agentId: a, permissionRequestId: `p-${n}`, holder: owner, deliveryId: `pd-${n}`, toolCallId: `t-${n}`, description: "Read?", options: [permissionOption], settingsWrite: false }),
  PermissionAnswered: (a, n) => ({ agentId: a, permissionRequestId: `p-${n}`, answeredBy: owner, answer: { _tag: "selected", optionId: "once" } }),
  PermissionMoved: (a, n) => ({ agentId: a, permissionRequestId: `p-${n}`, from: owner, to: owner, deliveryId: `pm-${n}` }),
  PermissionCancelled: (a, n) => ({ agentId: a, permissionRequestId: `p-${n}`, reason: "agent interrupted" }),
  QuestionAsked: (a, n) => ({ agentId: a, questionId: `q-${n}`, holder: owner, deliveryId: `qd-${n}`, text: "Which?" }),
  QuestionAnswered: (a, n) => ({ agentId: a, questionId: `q-${n}`, answeredBy: owner, text: "This one.", deliveryId: `qa-${n}` }),
  QuestionMoved: (a, n) => ({ agentId: a, questionId: `q-${n}`, from: owner, to: owner, deliveryId: `qm-${n}` }),
  OwnerNeeded: (a) => ({ agentId: a, reason: "no parent can answer" }),
  WaitOpened: (a, n) => ({ agentId: a, waitId: `w-${n}`, members: [a], mode: "any", blocking: false }),
  WaitMemberResolved: (a, n) => ({ agentId: a, waitId: `w-${n}`, member: { agentId: a, reason: "settled" } }),
  WaitSatisfied: (a, n) => ({ agentId: a, waitId: `w-${n}`, members: [{ agentId: a, reason: "settled" }] }),
  WaitCancelled: (a, n) => ({ agentId: a, waitId: `w-${n}`, reason: "connection closed" }),
  DeliveryQueued: (a, n) => ({ delivery: { id: `dq-${n}`, target: a, sender: owner, content: { _tag: "prompt", text: "Queued." } } }),
  DeliverySent: (a, n) => ({ agentId: a, deliveryId: `dq-${n}`, method: "acp" }),
  DeliveryAccepted: (a, n) => ({ agentId: a, deliveryId: `dq-${n}` }),
  DeliveryRequeued: (a, n) => ({ agentId: a, deliveryId: `dq-${n}`, reason: "agent busy" }),
  DeliveryReturned: (a, n) => ({ agentId: a, deliveryId: `dq-${n}`, sender: owner, reason: "agent stopped" }),
  DeliveryWithdrawn: (a, n) => ({ agentId: a, deliveryId: `dq-${n}`, reason: "request moved" }),
  AgentCrashed: (a) => ({ agentId: a, exitCode: 1, signal: null, stderr: "crash" }),
  AgentInterrupted: (a) => ({ agentId: a, previous: "idle" }),
  AgentReloadFailed: (a) => ({ agentId: a, reason: "agent reload failed" }),
  AgentStopped: (a) => ({ agentId: a }),
  AgentGrouped: (a) => ({ agentId: a, groups: ["engine"] }),
  AccountChanged: (_a, n) => ({ accountId: `acct-${n}`, account: { id: `acct-${n}`, harness: "first", displayName: "Other", enabled: true } }),
  AccountNeedsSignIn: () => ({ accountId: "primary", reason: "signed out" }),
  AccountOutOfUsage: () => ({ accountId: "primary", resetAt: 1_900_000_000_000 }),
  AccountAvailable: () => ({ accountId: "primary", cause: "owner cleared" }),
  HarnessChanged: () => ({ harness }),
  CommandRefused: () => ({ command: "start", reason: "refused" }),
  "client.AlertBaseline": () => ({ position: 0 }),
  "client.AlertRaised": (a, n) => ({ alertId: `alert-${n}`, alertKey: `permission:${n}`, kind: "approval", agentId: a, subject: { _tag: "permission", id: `p-${n}` }, title: "Permission needs your approval", sourceSequence: 0 }),
  "client.AlertDelivered": (_a, n) => ({ alertId: `alert-${n}`, carrier: "ntfy", generation: 0, attempt: 1 }),
  "client.AlertDeliveryFailed": (_a, n) => ({ alertId: `alert-${n}`, carrier: "ntfy", generation: 0, attempt: 1, reason: "carrier unavailable" }),
  "client.AlertCleared": (_a, n) => ({ alertId: `alert-${n}`, cause: "subject closed", sourceSequence: 0 }),
  "client.AlertSettingsChanged": () => ({ kind: "approval", push: false }),
  "client.AlertCarrierChanged": () => ({ carrier: { _tag: "none" } }),
  "client.AlertCarrierTokenSet": () => ({ origin: "https://alerts.example.test", carrierGeneration: "fixture-generation" }),
  "client.AlertCarrierTokenCleared": () => ({}),
  "client.WebSettingsChanged": () => ({ settings: { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false } }),
  "client.WebServerDown": () => ({ reason: "port taken" }),
  "client.WebServerUp": () => ({}),
};
const terminal = new Set(["AgentStartFailed", "AgentCrashed", "AgentStopped"]);

const sample = (tag: string, agentId: string, n: string) => eventOf({ _tag: tag, ...samples[tag]!(agentId, n) });

// Self, child, grandchild and stranger agents, as the engine would have left them.
const family = Effect.gen(function* () {
  const self = yield* seedAgent({ id: "agent-self" });
  const child = yield* seedAgent({ id: "agent-child", parent: "agent-self" });
  const grandchild = yield* seedAgent({ id: "agent-grandchild", parent: "agent-child" });
  const stranger = yield* seedAgent({ id: "agent-stranger" });
  const sibling = yield* seedAgent({ id: "agent-sibling", parent: "agent-stranger" });
  return { self, child, grandchild, stranger, sibling };
});

// One event of every type for each agent (but no terminal event for the
// subscriber), and one of every agent-less type.
const plantRound = (round: string, ids: ReadonlyArray<string>, subscriber: string) => Effect.gen(function* () {
  for (const tag of tags) {
    if (agentBearing.has(tag)) {
      for (const agentId of ids) {
        if (agentId === subscriber && terminal.has(tag)) continue;
        yield* appendSetup([sample(tag, agentId, `${round}-${tag}-${agentId}`)]);
      }
    } else {
      yield* appendSetup([sample(tag, ids[0]!, `${round}-${tag}`)]);
    }
  }
});

const markerFor = (agentId: string, round: string) => eventOf({ _tag: "ThreadItem", agentId, itemId: `marker-${round}`, content: { _tag: "text", text: "marker" }, replay: false });
const isMarker = (round: string) => (envelope: EventEnvelope) => envelope.event._tag === "ThreadItem" && envelope.event.itemId === `marker-${round}`;

const withServer = <A, E>(body: (socket: string) => Effect.Effect<A, E, any>) => Effect.gen(function* () {
  const rig = makeRig();
  chmodSync(rig.stateFolder, 0o700);
  const socket = join(rig.stateFolder, "engine.sock");
  const runner = yield* makeFakeRunner();
  return yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedHarness();
    yield* seedAccount();
    yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(ownerSecret), debug: false });
    return yield* body(socket);
  })).pipe(Effect.ensuring(Effect.sync(() => removeRig(rig))));
});

// Every envelope the bearer's subscription delivers, from `after` up to and
// including the first one `last` accepts.
const collect = (socket: string, bearer: string, after: number, last: (envelope: EventEnvelope) => boolean) => Effect.scoped(Effect.gen(function* () {
  const client = yield* connect(socket, bearer);
  const stream = client.subscribe({ requestId: `request-subscribe-${after}-${randomBytes(4).toString("hex")}`, after } as never) as Stream.Stream<EventEnvelope, unknown>;
  return yield* stream.pipe(Stream.takeUntil(last), Stream.runCollect, Effect.timeout(30_000));
})).pipe(Effect.map((chunk) => [...chunk]));

it("7.3 the samples cover every event type in the contracts' union (breaks when a new event type is added without a visibility case)", () => {
  expect(Object.keys(samples).sort()).toEqual(tags);
  for (const tag of tags) {
    expect(() => sample(tag, "agent-x", "check")).not.toThrow();
    if (tag.startsWith("client.")) expect(eventVisibility[tag as keyof typeof eventVisibility]).toBe("owner-only");
  }
});

live("7.3 for every event type, an agent's subscribe returns exactly the events of itself and its children, in catch-up and live, and never a grandchild's, a stranger's or an agent-less event (breaks if the filter is skipped on either path, follows the whole subtree, or lets agent-less events through)", () =>
  withServer((socket) => Effect.gen(function* () {
    const { self, child, grandchild, stranger, sibling } = yield* family;
    const ids = [self.agentId, child.agentId, grandchild.agentId, stranger.agentId, sibling.agentId];
    yield* plantRound("replay", ids, self.agentId);
    yield* appendSetup([markerFor(self.agentId, "replay")]);
    const visible = new Set<string>([self.agentId, child.agentId]);

    const expectedAfter = (after: number) => readLog.pipe(Effect.map((rows) => rows
      .filter((row) => row.sequence > after && eventVisibility[row.event._tag] !== "owner-only" && "agentId" in row.event && visible.has((row.event as { agentId: string }).agentId))
      .map((row) => row.sequence)));

    // Catch-up: everything already in the log.
    const replay = yield* collect(socket, self.token, 0, isMarker("replay"));
    expect(replay.map((envelope) => envelope.sequence)).toEqual(yield* expectedAfter(0));
    expect(replay.every((envelope) => eventVisibility[envelope.event._tag] !== "owner-only")).toBe(true);
    for (const envelope of replay) expect(visible.has(envelope.agentId ?? "none"), JSON.stringify(envelope.event)).toBe(true);

    // Every type was really exercised on both sides of the rule.
    const rows = yield* readLog;
    for (const tag of tags) {
      const ofTag = rows.filter((row) => row.event._tag === tag);
      if (String(eventVisibility[tag as keyof typeof eventVisibility]) === "owner-only") {
        expect([tag, ofTag.length > 0]).toEqual([tag, true]);
        expect(replay.some((row) => row.event._tag === tag), tag).toBe(false);
        continue;
      }
      if (agentBearing.has(tag)) {
        expect([tag, ofTag.some((row) => visible.has((row.event as { agentId: string }).agentId))]).toEqual([tag, true]);
        expect([tag, ofTag.some((row) => !visible.has((row.event as { agentId: string }).agentId))]).toEqual([tag, true]);
      } else {
        expect([tag, ofTag.length > 0]).toEqual([tag, true]);
      }
    }

    // Live: a subscription open before the second round sees it filtered too.
    const head = rows.at(-1)!.sequence;
    const liveRound = yield* Effect.scoped(Effect.gen(function* () {
      const client = yield* connect(socket, self.token);
      const stream = client.subscribe({ requestId: "request-subscribe-live", after: head } as never) as Stream.Stream<EventEnvelope, unknown>;
      const fiber = yield* stream.pipe(Stream.takeUntil(isMarker("live")), Stream.runCollect, Effect.timeout(30_000), Effect.forkScoped);
      yield* plantRound("live", ids, self.agentId);
      yield* appendSetup([markerFor(self.agentId, "live")]);
      return [...(yield* Fiber.join(fiber))];
    }));
    expect(liveRound.map((envelope) => envelope.sequence)).toEqual(yield* expectedAfter(head));
    expect(liveRound.every((envelope) => eventVisibility[envelope.event._tag] !== "owner-only")).toBe(true);
  })), 120_000);

live("7.3 the owner's subscribe returns every event, agent-less ones included (breaks if the owner is filtered like an agent)", () =>
  withServer((socket) => Effect.gen(function* () {
    const { self, child, grandchild, stranger, sibling } = yield* family;
    yield* plantRound("owner", [self.agentId, child.agentId, grandchild.agentId, stranger.agentId, sibling.agentId], self.agentId);
    yield* appendSetup([markerFor(stranger.agentId, "owner")]);
    const all = (yield* readLog).map((row) => row.sequence);
    const seen = yield* collect(socket, ownerSecret, 0, isMarker("owner"));
    expect(seen.map((envelope) => envelope.sequence)).toEqual(all);
  })), 120_000);

live("7.3 issue 41: a subscriber that stops acknowledging is disconnected while the writer runs on, and another subscriber still receives every event in order (breaks if a stalled subscription buffers without bound or stalls the others)", () =>
  withServer((socket) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-stalled" });
    const start = (yield* readLog).at(-1)!.sequence;
    const stalled = yield* Effect.promise(() => upgrade(socket, { ...authorization(agent.token), ...ancestryHeaders() }));
    expect(stalled.status).toBe(101);
    let ended = false;
    const frames: Array<{ _tag?: string; requestId?: string }> = [];
    stalled.socket!.on("message", (data) => {
      try { frames.push(JSON.parse(String(data))); } catch { /* not JSON */ }
      if (frames.some((frame) => frame._tag === "Exit" && frame.requestId === "1")) ended = true;
    });
    stalled.socket!.once("close", () => { ended = true; });
    // The client never sends an Ack, so the server's stream for it stops after its first chunk.
    stalled.socket!.send(requestFrame("1", "subscribe", { requestId: "request-stalled", after: start }));

    const total = 10_000;
    const text = "x".repeat(1_024);
    const healthy = yield* Effect.scoped(Effect.gen(function* () {
      const client = yield* connect(socket, agent.token);
      const stream = client.subscribe({ requestId: "request-healthy", after: start } as never) as Stream.Stream<EventEnvelope, unknown>;
      const fiber = yield* stream.pipe(Stream.take(total), Stream.runCollect, Effect.timeout(90_000), Effect.forkScoped);
      for (let batch = 0; batch < total / 500; batch++) {
        yield* appendSetup(Array.from({ length: 500 }, (_, index) => eventOf({
          _tag: "ThreadItem", agentId: agent.agentId, itemId: `flood-${batch}-${index}`, content: { _tag: "text", text }, replay: false,
        })));
      }
      return [...(yield* Fiber.join(fiber))];
    }));
    expect(healthy.length).toBe(total);
    expect(healthy.map((envelope) => envelope.sequence)).toEqual(Array.from({ length: total }, (_, index) => start + 1 + index));

    const deadline = Date.now() + 20_000;
    while (!ended && Date.now() < deadline) yield* Effect.sleep(25);
    expect(ended, "the stalled subscription was neither ended nor disconnected after 10,000 unacknowledged events").toBe(true);
    stalled.socket!.terminate();

    // The service keeps serving: a new connection subscribes and sees the head.
    const after = yield* collect(socket, agent.token, start + total - 1, () => true);
    expect(after.map((envelope) => envelope.sequence)).toEqual([start + total]);
  })), 180_000);
