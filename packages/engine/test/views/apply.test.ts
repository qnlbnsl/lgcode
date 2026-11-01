import { mkdtempSync, rmSync } from "node:fs";

import { canTransition, eventEffect, type Event, type LifecycleState } from "@shepherd/contracts";
import * as fc from "fast-check";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { apply, emptyViews } from "../../src/views/apply.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { accepted, account, delivery, envelopes, event, opened, owner, permission, question, queued, ready, sent, started, wait } from "../support/viewFixtures.ts";

registerRebuildCheck({ noLog: true });
let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/shepherd-apply-");
  vi.stubEnv("SHEPHERD_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const fold = (events: ReadonlyArray<Event>) => envelopes(events).reduce<ReturnType<typeof emptyViews>>(apply, emptyViews());
const agent = (events: ReadonlyArray<Event>) => fold(events).agents["agent-a"];
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const inheritedIdentities = ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"] as const;
// AccountId is a slug: its first character must be a letter.
const accountInheritedIdentities = ["constructor", "toString", "hasOwnProperty", "valueOf"] as const;

it.each(inheritedIdentities)("4c F1 agent %s: catches treating an inherited thread member as a stored event list", (identity) => {
  const value = event({ ...started, agentId: identity });
  const result = fold([value]);
  expect(Object.hasOwn(result.agents, identity)).toBe(true);
  expect(result.agents[identity]).toMatchObject({ agentId: identity, name: "Builder", state: { _tag: "starting" } });
  expect(Object.hasOwn(result.threads, identity)).toBe(true);
  expect(result.threads[identity]).toEqual(envelopes([value]));
});

it.each(inheritedIdentities)("4c F1 thread %s: catches rejecting a thread whose agent has no launch record", (identity) => {
  const value = event({ _tag: "ThreadItem", agentId: identity, itemId: "item", content: { _tag: "text", text: "Hello." }, replay: false });
  const result = fold([value]);
  expect(Object.hasOwn(result.threads, identity)).toBe(true);
  expect(result.threads[identity]).toEqual(envelopes([value]));
  expect(Object.hasOwn(result.agents, identity)).toBe(false);
});

const keyedJourneys = [
  { view: "requests", events: (id: string) => [
    event({ ...permission, permissionRequestId: id }),
    event({ _tag: "PermissionCancelled", agentId: "agent-a", permissionRequestId: id, reason: "cancelled" }),
  ], want: { status: "cancelled", reason: "cancelled" } },
  { view: "questions", events: (id: string) => [
    event({ ...question, questionId: id }),
    event({ _tag: "QuestionAnswered", agentId: "agent-a", questionId: id, answeredBy: owner, text: "events.ts", deliveryId: "answer" }),
  ], want: { status: "answered", answer: "events.ts" } },
  { view: "waits", events: (id: string) => [
    event({ ...wait, waitId: id }),
    event({ _tag: "WaitMemberResolved", agentId: "agent-a", waitId: id, member: { agentId: "agent-b", reason: "settled" } }),
  ], want: { status: "open", resolved: [{ agentId: "agent-b", reason: "settled" }] } },
  { view: "deliveries", events: (id: string) => [
    event({ _tag: "DeliveryQueued", delivery: { ...delivery, id } }),
    event({ _tag: "DeliveryAccepted", agentId: "agent-a", deliveryId: id }),
  ], want: { status: "accepted", content: { _tag: "prompt", text: "Build the log." } } },
  { view: "accounts", events: (id: string) => [
    event({ _tag: "AccountChanged", accountId: id, account: { ...account, id } }),
    event({ _tag: "AccountOutOfUsage", accountId: id, resetAt: 1_900_000_000_000 }),
  ], want: { status: "out-of-usage", resetAt: 1_900_000_000_000, displayName: "Primary" } },
  { view: "devices", events: (id: string) => [
    event({ _tag: "DeviceAdded", deviceId: id, name: "Phone" }),
    event({ _tag: "DeviceRevoked", deviceId: id }),
  ], want: { name: "Phone", revoked: true } },
] as const;

for (const { view, events, want } of keyedJourneys) {
  const identities = view === "accounts" ? accountInheritedIdentities : inheritedIdentities;
  it.each(identities)(`4c F1 ${view} %s: catches losing an own identity on record creation or update`, (identity) => {
    const result = fold(events(identity));
    expect(Object.hasOwn(result[view], identity)).toBe(true);
    expect(result[view][identity]).toMatchObject(want);
  });
}

const orphanUpdates = [
  { view: "agents", event: (id: string) => event({ _tag: "AgentGrouped", agentId: id, groups: ["review"] }) },
  { view: "requests", event: (id: string) => event({ _tag: "PermissionCancelled", agentId: "agent-a", permissionRequestId: id, reason: "cancelled" }) },
  { view: "questions", event: (id: string) => event({ _tag: "QuestionAnswered", agentId: "agent-a", questionId: id, answeredBy: owner, text: "events.ts", deliveryId: "answer" }) },
  { view: "waits", event: (id: string) => event({ _tag: "WaitMemberResolved", agentId: "agent-a", waitId: id, member: { agentId: "agent-b", reason: "settled" } }) },
  { view: "deliveries", event: (id: string) => event({ _tag: "DeliveryAccepted", agentId: "agent-a", deliveryId: id }) },
  { view: "accounts", event: (id: string) => event({ _tag: "AccountNeedsSignIn", accountId: id, reason: "expired" }) },
  { view: "devices", event: (id: string) => event({ _tag: "DeviceRevoked", deviceId: id }) },
] as const;

for (const { view, event: update } of orphanUpdates) {
  const identities = view === "accounts" ? accountInheritedIdentities : inheritedIdentities;
  it.each(identities)(`4c F1 absent ${view} %s: catches updating a prototype member as if an opening event existed`, (identity) => {
    const ordinary = fold([update("never-opened")]);
    expect(Object.keys(ordinary[view])).toEqual([]);
    const result = fold([update(identity)]);
    expect(Object.hasOwn(result[view], identity)).toBe(false);
    expect(Object.keys(result[view])).toEqual([]);
  });
}

it("4c agents: catches dropping launch metadata or failing to project SessionOpened as idle", () => {
  expect(agent([started])).toMatchObject({
    agentId: "agent-a", name: "Builder", role: "worker", groups: ["engine"], parent: owner,
    harness: "first", account: "primary", permission: "read-only", folder: "/tmp/project",
    runMode: "acp", model: "test-model", effort: "high", state: { _tag: "starting" },
  });
  expect(agent([started, opened])).toMatchObject({
    state: { _tag: "idle" }, session: { _tag: "acp", sessionId: "session-a" }, reloadable: true,
  });
});

it("4c agents: catches ignoring grouping, permission mode changes, turn completion, crashes or stops", () => {
  expect(agent([...ready, event({ _tag: "AgentGrouped", agentId: "agent-a", groups: ["review"] }),
    event({ _tag: "ModeChanged", agentId: "agent-a", mode: "edit", level: "edit" })])).toMatchObject({
    groups: ["review"], mode: "edit", permission: "edit",
  });
  expect(agent([...ready, queued, sent, accepted,
    event({ _tag: "TurnEnded", agentId: "agent-a", compact: false })])).toMatchObject({ state: { _tag: "idle" } });
  const crashed = [...ready, event({ _tag: "AgentCrashed", agentId: "agent-a", exitCode: 1, signal: null, stderr: "failed" })];
  expect(agent(crashed)).toMatchObject({ state: { _tag: "crashed" } });
  expect(agent([...crashed, event({ _tag: "AgentStopped", agentId: "agent-a" })])).toMatchObject({ state: { _tag: "stopped" } });
  expect(agent([started, event({ _tag: "AgentStartFailed", agentId: "agent-a", reason: "not installed" })])).toMatchObject({ state: { _tag: "stopped" } });
});

it("4c threads / issue 31: catches filtering DeliveryQueued by envelope.agentId or mixing another agent's thread", () => {
  const input = envelopes([...ready, queued,
    event({ _tag: "PromptSent", agentId: "agent-a", deliveryId: "delivery-a", sender: owner, text: "Build the log." }),
    event({ _tag: "ThreadItem", agentId: "agent-b", itemId: "other", content: { _tag: "text", text: "Other agent." }, replay: false }),
  ]);
  expect(input[3]).not.toHaveProperty("agentId");
  const result = input.reduce<ReturnType<typeof emptyViews>>(apply, emptyViews());
  expect(result.threads["agent-a"]?.map((row) => row.event._tag)).toEqual([
    "AgentStarted", "SessionOpened", "DeliveryQueued", "PromptSent",
  ]);
  expect(result.threads["agent-a"]?.find((row) => row.event._tag === "PromptSent")?.event).toMatchObject({ text: "Build the log." });
  expect(result.threads["agent-b"]?.map((row) => row.event._tag)).toEqual(["ThreadItem"]);
});

it.each([
  ["queued", [queued], "idle"],
  ["sent", [queued, sent], "working"],
  ["accepted", [queued, sent, accepted], "working"],
] as const)("4c row 29 delivery %s: catches collapsing queued, sent and accepted into one delivered state", (status, events, state) => {
  const result = fold([...ready, ...events]);
  expect(result.deliveries["delivery-a"]).toMatchObject({ ...delivery, status });
  expect(result.agents["agent-a"]?.state).toEqual({ _tag: state });
});

it.each([
  ["DeliveryRequeued", "queued"], ["DeliveryReturned", "returned"], ["DeliveryWithdrawn", "withdrawn"],
] as const)("4c delivery %s: catches retaining a sent delivery after its logged disposition", (_tag, status) => {
  const result = fold([...ready, queued, sent, event({
    _tag, agentId: "agent-a", deliveryId: "delivery-a", sender: owner, reason: "request moved",
  })]);
  expect(result.deliveries["delivery-a"]).toMatchObject({ ...delivery, status, reason: "request moved" });
});

it("4c first prompt: catches dropping the initial queued delivery carried by AgentStarted", () => {
  const result = fold([event({ ...started, firstPromptDelivery: delivery })]);
  expect(result.deliveries["delivery-a"]).toMatchObject({ ...delivery, status: "queued" });
  expect(result.agents["agent-a"]?.state).toEqual({ _tag: "starting" });
});

it("4c requests: catches losing permission details, the moved holder, or the selected answer", () => {
  const moved = [...ready, permission, event({
    _tag: "PermissionMoved", agentId: "agent-a", permissionRequestId: "permission-a", from: owner,
    to: { _tag: "agent", agentId: "agent-b" }, deliveryId: "moved-permission",
  })];
  expect(fold(moved).requests["permission-a"]).toMatchObject({
    status: "open", holder: { _tag: "agent", agentId: "agent-b" }, deliveryId: "moved-permission",
    toolCallId: "tool-a", description: "Read the file?", settingsWrite: false,
    options: [{ id: "once", name: "Allow once", kind: "allow_once", level: "read-only", persistent: false }],
  });
  expect(fold([...moved, event({
    _tag: "PermissionAnswered", agentId: "agent-a", permissionRequestId: "permission-a",
    answeredBy: { _tag: "agent", agentId: "agent-b" }, answer: { _tag: "selected", optionId: "once" },
  })]).requests["permission-a"]).toMatchObject({ status: "answered", answer: { _tag: "selected", optionId: "once" } });
});

it("4c requests: catches keeping a cancelled permission open after its adapter disappears", () => {
  expect(fold([...ready, permission, event({
    _tag: "PermissionCancelled", agentId: "agent-a", permissionRequestId: "permission-a", reason: "recovery",
  })]).requests["permission-a"]).toMatchObject({ status: "cancelled", reason: "recovery" });
});

it("4c questions: catches losing the question, its reassignment or the owner's answer", () => {
  const moved = [...ready, question, event({
    _tag: "QuestionMoved", agentId: "agent-a", questionId: "question-a", from: owner,
    to: { _tag: "agent", agentId: "agent-b" }, deliveryId: "moved-question",
  })];
  expect(fold(moved).questions["question-a"]).toMatchObject({
    status: "open", text: "Which file?", holder: { _tag: "agent", agentId: "agent-b" }, deliveryId: "moved-question",
  });
  expect(fold([...moved, event({
    _tag: "QuestionAnswered", agentId: "agent-a", questionId: "question-a", answeredBy: owner,
    text: "events.ts", deliveryId: "answer-delivery",
  })]).questions["question-a"]).toMatchObject({ status: "answered", answer: "events.ts", answeredBy: owner });
});

it("4c waits: catches dropping a partial resolution or satisfying an all-wait before its logged satisfaction", () => {
  const partial = [...ready, wait, event({
    _tag: "WaitMemberResolved", agentId: "agent-a", waitId: "wait-a", member: { agentId: "agent-b", reason: "settled" },
  })];
  expect(fold(partial).waits["wait-a"]).toMatchObject({
    status: "open", mode: "all", blocking: true, members: ["agent-b", "agent-c"],
    resolved: [{ agentId: "agent-b", reason: "settled" }],
  });
  expect(fold([...partial, event({
    _tag: "WaitSatisfied", agentId: "agent-a", waitId: "wait-a",
    members: [{ agentId: "agent-b", reason: "settled" }, { agentId: "agent-c", reason: "stopped" }],
  })]).waits["wait-a"]).toMatchObject({ status: "satisfied", resolved: [
    { agentId: "agent-b", reason: "settled" }, { agentId: "agent-c", reason: "stopped" },
  ] });
});

it("4c row 66 waits: catches reviving a blocking wait that recovery explicitly cancelled", () => {
  expect(fold([...ready, wait, event({
    _tag: "WaitCancelled", agentId: "agent-a", waitId: "wait-a", reason: "recovery",
  })]).waits["wait-a"]).toMatchObject({ status: "cancelled", reason: "recovery" });
});

it("4c rows 28 and 66 account pause: catches losing reset times or unpausing before a successful reload is logged", () => {
  const paused = [...ready, queued, event({ _tag: "AccountOutOfUsage", accountId: "primary", resetAt: 1_900_000_000_000 }),
    event({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "paused", reason: "limit", midTurn: false, resetAt: 1_900_000_000_000 } })];
  expect(fold(paused).accounts["primary"]).toMatchObject({ ...account, status: "out-of-usage", resetAt: 1_900_000_000_000 });
  const available = [...paused, event({ _tag: "AccountAvailable", accountId: "primary", cause: "usage reset" })];
  expect(fold(available).accounts["primary"]).toMatchObject({ status: "available" });
  expect(fold(available).accounts["primary"]).not.toHaveProperty("resetAt");
  expect(agent(available)?.state).toEqual({ _tag: "paused", reason: "limit", midTurn: false, resetAt: 1_900_000_000_000 });
  expect(fold(available).deliveries["delivery-a"]).toMatchObject({ status: "queued" });
  expect(agent([...available, event({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "working" } })])?.state).toEqual({ _tag: "working" });
});

it("4c accounts: catches treating sign-out as a usable account, dropping edits, or retaining a removed account", () => {
  expect(fold([...ready, event({ _tag: "AccountNeedsSignIn", accountId: "primary", reason: "expired" })]).accounts["primary"])
    .toMatchObject({ ...account, status: "needs-sign-in", reason: "expired" });
  expect(fold([...ready, event({ _tag: "AccountChanged", accountId: "primary", account: { ...account, displayName: "Renamed", enabled: false } })]).accounts["primary"])
    .toMatchObject({ displayName: "Renamed", enabled: false });
  expect(fold([...ready, event({ _tag: "AccountChanged", accountId: "primary" })]).accounts).not.toHaveProperty("primary");
});

it("4c row 28 signed-out pause: catches losing the account reason, the agent's mid-turn pause or its queued prompt", () => {
  const result = fold([...ready, queued, sent,
    event({ _tag: "AccountNeedsSignIn", accountId: "primary", reason: "session expired" }),
    event({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "paused", reason: "signed-out", midTurn: true } }),
    event({ _tag: "OwnerNeeded", agentId: "agent-a", reason: "sign in to primary" }),
    event({ _tag: "DeliveryQueued", delivery: { ...delivery, id: "delivery-b", content: { _tag: "prompt", text: "After sign-in." } } }),
  ]);
  expect(result.accounts["primary"]).toMatchObject({ status: "needs-sign-in", reason: "session expired" });
  expect(result.agents["agent-a"]?.state).toEqual({ _tag: "paused", reason: "signed-out", midTurn: true });
  expect(result.deliveries["delivery-a"]).toMatchObject({ status: "sent" });
  expect(result.deliveries["delivery-b"]).toMatchObject({ status: "queued" });
});

it("4c devices: catches revoking every device or forgetting one device's name and revocation", () => {
  const result = fold([
    event({ _tag: "DeviceAdded", deviceId: "phone", name: "Phone" }),
    event({ _tag: "DeviceAdded", deviceId: "desktop", name: "Desktop" }),
    event({ _tag: "DeviceRevoked", deviceId: "phone" }),
  ]);
  expect(result.devices).toMatchObject({ phone: { name: "Phone", revoked: true }, desktop: { name: "Desktop", revoked: false } });
});

it.each(["idle", "working"] as const)("4c rows 52 and 66 post-reload %s: catches leaving a successful reload interrupted or guessing idle", (state) => {
  const before = state === "working" ? [...ready, queued, sent] : ready;
  const result = fold([...before, permission, question,
    event({ _tag: "AgentInterrupted", agentId: "agent-a", previous: state }),
    event({ _tag: "PermissionCancelled", agentId: "agent-a", permissionRequestId: "permission-a", reason: "recovery" }),
    event({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: state } }),
  ]);
  expect(result.agents["agent-a"]?.state).toEqual({ _tag: state });
  expect(result.requests["permission-a"]).toMatchObject({ status: "cancelled" });
  expect(result.questions["question-a"]).toMatchObject({ status: "open", holder: owner });
  if (state === "working") expect(result.deliveries["delivery-a"]).toMatchObject({ status: "sent" });
});

it("4c eight-view property: catches dropping a view branch or mutating nested records on generated valid event sequences", () => {
  fc.assert(fc.property(fc.record({
    identity: fc.oneof(fc.constantFrom(...inheritedIdentities), fc.string({ minLength: 1, maxLength: 40 })),
    accountIdentity: fc.oneof(fc.constantFrom(...accountInheritedIdentities), fc.nat().map((id) => `account-${id}`)),
    text: fc.string({ maxLength: 80 }), accept: fc.boolean(), cancelPermission: fc.boolean(),
    answerQuestion: fc.boolean(), cancelWait: fc.boolean(), limit: fc.boolean(), revoke: fc.boolean(),
  }), (sample) => {
    const events = [...ready,
      event({ _tag: "DeliveryQueued", delivery: { ...delivery, content: { _tag: "prompt", text: sample.text } } }), sent,
      ...(sample.accept ? [accepted] : []),
      event({ _tag: "ThreadItem", agentId: "agent-a", itemId: "generated-item", content: { _tag: "text", text: sample.text }, replay: false }),
      permission, sample.cancelPermission
        ? event({ _tag: "PermissionCancelled", agentId: "agent-a", permissionRequestId: "permission-a", reason: "cancelled" })
        : event({ _tag: "PermissionAnswered", agentId: "agent-a", permissionRequestId: "permission-a", answeredBy: owner, answer: { _tag: "selected", optionId: "once" } }),
      question, ...(sample.answerQuestion ? [event({ _tag: "QuestionAnswered", agentId: "agent-a", questionId: "question-a", answeredBy: owner, text: sample.text, deliveryId: "answer-a" })] : []),
      wait, sample.cancelWait
        ? event({ _tag: "WaitCancelled", agentId: "agent-a", waitId: "wait-a", reason: "cancelled" })
        : event({ _tag: "WaitSatisfied", agentId: "agent-a", waitId: "wait-a", members: [{ agentId: "agent-b", reason: "settled" }, { agentId: "agent-c", reason: "settled" }] }),
      event({ _tag: "DeviceAdded", deviceId: "phone", name: sample.text }),
      ...(sample.revoke ? [event({ _tag: "DeviceRevoked", deviceId: "phone" })] : []),
      event({ _tag: "TurnEnded", agentId: "agent-a", compact: false }),
      ...(sample.limit ? [
        event({ _tag: "AccountOutOfUsage", accountId: "primary", resetAt: 1_900_000_000_000 }),
        event({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "paused", reason: "limit", midTurn: false, resetAt: 1_900_000_000_000 } }),
      ] : []),
    ].map((value) => event({
      ...value,
      ...("agentId" in value ? { agentId: sample.identity } : {}),
      ...("permissionRequestId" in value ? { permissionRequestId: sample.identity } : {}),
      ...("questionId" in value ? { questionId: sample.identity } : {}),
      ...("waitId" in value ? { waitId: sample.identity } : {}),
      ...("deliveryId" in value ? { deliveryId: sample.identity } : {}),
      ...("accountId" in value ? { accountId: sample.accountIdentity } : {}),
      ...("deviceId" in value ? { deviceId: sample.identity } : {}),
      ...(value._tag === "AgentStarted" ? { account: sample.accountIdentity } : {}),
      ...(value._tag === "AccountChanged" && value.account !== undefined ? { account: { ...value.account, id: sample.accountIdentity } } : {}),
      ...(value._tag === "DeliveryQueued" ? { delivery: { ...value.delivery, id: sample.identity, target: sample.identity } } : {}),
    }));
    let state: LifecycleState["_tag"] = "starting";
    let result = emptyViews();
    for (const envelope of deepFreeze(envelopes(events))) {
      const value = envelope.event;
      if (value._tag !== "AgentStarted") {
        const effect = eventEffect(state, value._tag);
        expect(effect).not.toBe("invalid");
        if (value._tag === "StateChanged") {
          expect(canTransition(state, value.state._tag)).toBe(true);
          state = value.state._tag;
        } else if (effect !== "keep" && effect !== "transition" && effect !== "invalid") state = effect;
      }
      const before = structuredClone(result);
      deepFreeze(result);
      const next = apply(result, envelope);
      expect(result).toEqual(before);
      expect(apply(result, envelope)).toEqual(next);
      result = next;
    }
    expect(result.sequence).toBe(events.length);
    expect(result.agents[sample.identity]?.state).toEqual(sample.limit
      ? { _tag: "paused", reason: "limit", midTurn: false, resetAt: 1_900_000_000_000 } : { _tag: "idle" });
    expect(result.threads[sample.identity]?.find((row) => row.event._tag === "ThreadItem")?.event)
      .toMatchObject({ content: { _tag: "text", text: sample.text } });
    expect(result.requests[sample.identity]).toMatchObject({ status: sample.cancelPermission ? "cancelled" : "answered" });
    expect(result.questions[sample.identity]).toMatchObject(sample.answerQuestion
      ? { status: "answered", answer: sample.text } : { status: "open", text: "Which file?" });
    expect(result.waits[sample.identity]).toMatchObject({ status: sample.cancelWait ? "cancelled" : "satisfied" });
    expect(result.deliveries[sample.identity]).toMatchObject({ status: sample.accept ? "accepted" : "sent", content: { text: sample.text } });
    expect(result.accounts[sample.accountIdentity]).toMatchObject({ status: sample.limit ? "out-of-usage" : "available" });
    expect(result.devices[sample.identity]).toMatchObject({ name: sample.text, revoked: sample.revoke });
  }), { numRuns: 100, seed: 4044 });
});

it.each(["paused", "interrupted"] as const)("4c row 66 failed reload %s: catches clearing a pause or pretending a failed reload succeeded", (state) => {
  const previous = state === "paused"
    ? event({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "paused", reason: "signed-out", midTurn: false } })
    : event({ _tag: "AgentInterrupted", agentId: "agent-a", previous: "idle" });
  const result = fold([...ready, question, previous, event({ _tag: "AgentReloadFailed", agentId: "agent-a", reason: "cannot reload" })]);
  expect(result.agents["agent-a"]?.state).toEqual(state === "paused"
    ? { _tag: "paused", reason: "signed-out", midTurn: false } : { _tag: "interrupted", previous: "idle" });
  expect(result.questions["question-a"]).toMatchObject({ status: "open", holder: owner });
});

it("4c purity property: catches input mutation, nondeterminism, or missed state transitions across generated valid histories", () => {
  fc.assert(fc.property(fc.array(fc.record({
    choice: fc.nat(), text: fc.string({ maxLength: 50 }),
  }), { minLength: 1, maxLength: 60 }), (steps) => {
    let expected: LifecycleState = { _tag: "idle" };
    const events: Event[] = [...ready];
    const names = ["starting", "working", "idle", "paused", "interrupted", "crashed", "stopped"] as const;
    let groups: string[] = ["engine"];
    for (const [index, step] of steps.entries()) {
      const allowed = names.filter((name) => canTransition(expected._tag, name));
      const next = allowed[step.choice % allowed.length]!;
      const state: LifecycleState = next === "paused" ? { _tag: "paused", reason: "limit", midTurn: false }
        : next === "interrupted" ? { _tag: "interrupted", previous: expected._tag as "starting" | "working" | "idle" }
        : { _tag: next };
      expect(eventEffect(expected._tag, "StateChanged")).toBe("transition");
      events.push(event({ _tag: "StateChanged", agentId: "agent-a", state }));
      expected = state;
      groups = [step.text];
      expect(eventEffect(expected._tag, "AgentGrouped")).toBe("keep");
      events.push(event({ _tag: "AgentGrouped", agentId: "agent-a", groups }));
      events.push(event({ _tag: "ThreadItem", agentId: "agent-a", itemId: `generated-${index}`, content: { _tag: "text", text: step.text }, replay: false }));
    }
    const input = deepFreeze(envelopes(events));
    let result = emptyViews();
    for (const envelope of input) {
      const before = structuredClone(result);
      const eventBefore = structuredClone(envelope);
      deepFreeze(result);
      const first = apply(result, envelope);
      const second = apply(result, envelope);
      expect(first).toEqual(second);
      expect(result).toEqual(before);
      expect(envelope).toEqual(eventBefore);
      result = first;
    }
    expect(result.sequence).toBe(events.length);
    expect(result.agents["agent-a"]).toMatchObject({ state: expected, groups });
    expect(result.threads["agent-a"]?.filter((row) => row.event._tag === "ThreadItem").map((row) =>
      row.event._tag === "ThreadItem" && row.event.content._tag === "text" ? row.event.content.text : undefined,
    )).toEqual(steps.map((step) => step.text));
  }), { numRuns: 100, seed: 4046 });
});
