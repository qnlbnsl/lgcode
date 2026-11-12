import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agentCredential, call, failureOf, headSequence, makeRig, ownerCredential, removeRig, seedAgent, success } from "../support/handlerRig.ts";
import { eventually, snapshot } from "../support/routingRig.ts";
import { append, awaitCleared, awaitRaised, barrier, cleared, eventsOf, permission, question, quietLists, raised, withAlerts } from "../support/alertsRig.ts";
import { toolNames } from "../../../mcp/src/tools.ts";

const openings = {
  approval: () => permission(),
  question: () => question(),
  failure: () => append({ _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "Fixture crash." },
    { _tag: "OwnerNeeded", agentId: "worker", reason: "agent crashed" }),
  signIn: () => append({ _tag: "AccountNeedsSignIn", accountId: "primary", reason: "account needs sign-in" }),
  usage: () => append({ _tag: "AccountOutOfUsage", accountId: "primary" }),
  agentAccount: () => append({ _tag: "AccountChanged", accountId: "primary" },
    { _tag: "StateChanged", agentId: "worker", state: { _tag: "paused", reason: "signed-out", midTurn: false } },
    { _tag: "OwnerNeeded", agentId: "worker", reason: "account needs sign-in" }),
  web: () => append({ _tag: "client.WebServerDown", reason: "bind failed" }),
};

const closings: ReadonlyArray<{ name: string; open: keyof typeof openings; event: unknown }> = [
  { name: "permission answered", open: "approval", event: { _tag: "PermissionAnswered", agentId: "worker", permissionRequestId: "request-1", answeredBy: { _tag: "owner" }, answer: { _tag: "selected", optionId: "once" } } },
  { name: "permission cancelled", open: "approval", event: { _tag: "PermissionCancelled", agentId: "worker", permissionRequestId: "request-1", reason: "agent stopped" } },
  { name: "old open request with stopped asker", open: "approval", event: { _tag: "AgentStopped", agentId: "worker" } },
  { name: "old open request with crashed asker", open: "approval", event: { _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "Fixture crash." } },
  { name: "question answered", open: "question", event: { _tag: "QuestionAnswered", agentId: "worker", questionId: "question-1", answeredBy: { _tag: "owner" }, text: "Use foundation.", deliveryId: "reply-1" } },
  { name: "question asker stopped", open: "question", event: { _tag: "AgentStopped", agentId: "worker" } },
  { name: "question asker crashed", open: "question", event: { _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "Fixture crash." } },
  ...["idle", "working", "stopped"].map((state) => ({ name: `crashed agent reaches ${state}`, open: "failure" as const,
    event: state === "stopped" ? { _tag: "AgentStopped", agentId: "worker" } : { _tag: "StateChanged", agentId: "worker", state: { _tag: state } } })),
  { name: "sign-in account available", open: "signIn", event: { _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" } },
  { name: "sign-in account removed", open: "signIn", event: { _tag: "AccountChanged", accountId: "primary" } },
  { name: "usage account available", open: "usage", event: { _tag: "AccountAvailable", accountId: "primary", cause: "usage reset" } },
  { name: "usage account removed", open: "usage", event: { _tag: "AccountChanged", accountId: "primary" } },
  { name: "usage account now needs sign-in", open: "usage", event: { _tag: "AccountNeedsSignIn", accountId: "primary", reason: "account needs sign-in" } },
  ...["idle", "working", "stopped"].map((state) => ({ name: `agent-account reaches ${state}`, open: "agentAccount" as const,
    event: state === "stopped" ? { _tag: "AgentStopped", agentId: "worker" } : { _tag: "StateChanged", agentId: "worker", state: { _tag: state } } })),
  { name: "web binds", open: "web", event: { _tag: "client.WebServerUp" } },
  { name: "web disabled", open: "web", event: { _tag: "client.WebSettingsChanged", settings: { enabled: false, port: 8787, heartbeatSeconds: 25, proxyMode: false } } },
];

it.each(closings)("6.2 closing table: $name clears exactly once", async ({ open, event }) => {
  const rig = makeRig();
  try {
    await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working" });
    yield* append({ _tag: "client.AlertBaseline", position: yield* headSequence });
    const source = yield* openings[open]();
    const sourceSequence = source.at(-1)!.sequence;
    const key = { approval: "permission:request-1", question: "question:question-1", failure: `crash:worker:${sourceSequence}`,
      signIn: "account:primary:sign-in", usage: "account:primary:usage", agentAccount: "agent-account:worker", web: "client:web-down" }[open];
    const kind = { approval: "approval", question: "question", failure: "failure", signIn: "account", usage: "account", agentAccount: "account", web: "client.web-down" }[open];
    const subject = open === "approval" ? { _tag: "permission", id: "request-1" } : open === "question" ? { _tag: "question", id: "question-1" }
      : open === "signIn" || open === "usage" ? { _tag: "account", id: "primary" }
      : open === "web" ? undefined : { _tag: "agent", id: "worker" };
    // A durable pre-existing alert isolates each level closing rule from
    // the separate source-mapping tests. Never mutate the live view.
    const title = { approval: "Permission needs your approval", question: "A question needs your answer", failure: "An agent needs your attention",
      signIn: "An account needs your attention", usage: "An account needs your attention", agentAccount: "An account needs your attention", web: "The web server is down" }[open];
    yield* append({ _tag: "client.AlertRaised", alertId: "existing-alert", alertKey: key, kind, agentId: "worker",
      ...(subject === undefined ? {} : { subject }), title, sourceSequence });
    }), { rig, lists: quietLists() });
    await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const alert = { alertId: "existing-alert" };
    const batch = yield* append(event);
    const ends = yield* awaitCleared(alert.alertId);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.event.sourceSequence).toBe(batch[0]!.sequence);
    expect(ends[0]!.caller).toEqual({ _tag: "piece", namespace: "client" });
    expect(yield* barrier()).toHaveLength(1);
    expect(yield* cleared(alert.alertId)).toHaveLength(1);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});

// Return the observed rows on timeout, so a missing behavior is an assertion
// failure that shows the empty log, rather than a timeout exception.
const awaitFirst = () => eventually(raised(), (rows) => rows.length > 0);

it("6.2 duplicate sources keep one alert open per key", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working" });
    yield* question();
    yield* append({ _tag: "OwnerNeeded", agentId: "worker", reason: "request needs the owner", subject: { _tag: "question", id: "question-1" } });
    expect(yield* awaitRaised("question:question-1")).toHaveLength(1);
    expect(yield* barrier()).toHaveLength(1);
    expect(yield* raised("question:question-1")).toHaveLength(1);
  }));
});

it("6.2 a failed reload keeps a crash alert open until successful idle", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    // The roles stall watch resumes a crashed agent by design, which closes the
    // crash alert; on a fast computer it does so before the checks below, so it
    // is turned off for this engine rule (issue 562).
    yield* append({ _tag: "roles.SettingsChanged", settings: { stallWatch: false } });
    yield* seedAgent({ id: "worker", state: "working" });
    yield* openings.failure();
    const rows = yield* awaitFirst();
    expect(rows).toHaveLength(1);
    yield* append({ _tag: "AgentReloadFailed", agentId: "worker", reason: "fixture reload refused" });
    // No question barrier: the asker is crashed, so use another account source.
    yield* openings.signIn();
    expect(yield* awaitRaised("account:primary:sign-in")).toHaveLength(1);
    expect(yield* cleared(rows[0]!.event.alertId)).toEqual([]);
    yield* append({ _tag: "StateChanged", agentId: "worker", state: { _tag: "idle" } });
    expect(yield* awaitCleared(rows[0]!.event.alertId)).toHaveLength(1);
  }));
});

it("6.2 sign-out after a usage limit clears the usage remedy and opens the sign-in remedy", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* openings.usage();
    const usage = yield* awaitRaised("account:primary:usage");
    expect(usage).toHaveLength(1);
    yield* openings.signIn();
    const signIn = yield* awaitRaised("account:primary:sign-in");
    expect(signIn).toHaveLength(1);
    expect(signIn[0]!.event.alertId).not.toBe(usage[0]!.event.alertId);
    expect(yield* awaitCleared(usage[0]!.event.alertId)).toHaveLength(1);
    expect(yield* cleared(signIn[0]!.event.alertId)).toEqual([]);
  }));
});

it("6.2 owner dismiss is in its planner batch, has no source, and a repeated dismiss writes nothing", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working" });
    yield* question();
    const rows = yield* awaitRaised("question:question-1");
    expect(rows).toHaveLength(1);
    const alertId = rows[0]!.event.alertId;
    const requestId = "dismiss-request-1";
    success(yield* call(ownerCredential, "client.alerts.dismiss", { requestId, alertId }));
    const ends = yield* cleared(alertId);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ caller: { _tag: "owner" }, requestId });
    expect(ends[0]!.event).not.toHaveProperty("sourceSequence");
    success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId }));
    expect(yield* cleared(alertId)).toHaveLength(1);
    expect((yield* snapshot).questions["question-1"]?.status).toBe("open");
  }));
});

it("6.2 dismiss racing a source close commits only one clear", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working" });
    yield* question();
    const rows = yield* awaitRaised("question:question-1");
    expect(rows).toHaveLength(1);
    const alertId = rows[0]!.event.alertId;
    const outcomes = yield* Effect.all([
      call(ownerCredential, "client.alerts.dismiss", { alertId }),
      call(ownerCredential, "answer", { kind: "question", id: "question-1", text: "Use foundation." }),
    ], { concurrency: "unbounded" });
    outcomes.forEach(success);
    expect(yield* awaitCleared(alertId)).toHaveLength(1);
    expect(yield* barrier()).toHaveLength(1);
    expect(yield* cleared(alertId)).toHaveLength(1);
  }));
});

it.each(["stopped", "crashed"] as const)("6.2 a %s asker's open question returns on resume, while its request stays closed", async (state) => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working" });
    yield* question(); yield* permission();
    const first = yield* awaitRaised("question:question-1");
    expect(first).toHaveLength(1);
    const approvals = yield* awaitRaised("permission:request-1");
    expect(approvals).toHaveLength(1);
    yield* append(
      { _tag: "PermissionCancelled", agentId: "worker", permissionRequestId: "request-1", reason: `agent ${state}` },
      state === "stopped" ? { _tag: "AgentStopped", agentId: "worker" }
        : { _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "Fixture crash." },
    );
    expect(yield* awaitCleared(first[0]!.event.alertId)).toHaveLength(1);
    yield* append({ _tag: "StateChanged", agentId: "worker", state: { _tag: "idle" } });
    const returned = yield* awaitRaised("question:question-1", 2);
    expect(returned).toHaveLength(2);
    expect(returned[1]!.event.alertId).not.toBe(first[0]!.event.alertId);
    expect(yield* raised("permission:request-1")).toHaveLength(1);
  }));
});

it("6.2 the stop command cancels its owner-held request and clears its alert", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working" });
    yield* permission();
    const rows = yield* awaitRaised("permission:request-1");
    expect(rows).toHaveLength(1);
    success(yield* call(ownerCredential, "stop", { agentId: "worker" }));
    expect((yield* eventsOf("PermissionCancelled")).map((row) => row.event)).toContainEqual(expect.objectContaining({ permissionRequestId: "request-1", reason: "agent stopped" }));
    expect(yield* awaitCleared(rows[0]!.event.alertId)).toHaveLength(1);
  }));
});

it("6.18 installed dismiss accepts the owner, refuses an agent, and is absent from MCP tools", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const worker = yield* seedAgent({ id: "worker", state: "working" });
    yield* question();
    const rows = yield* awaitRaised("question:question-1");
    expect(rows).toHaveLength(1);
    const alertId = rows[0]!.event.alertId;
    expect(failureOf(yield* call(agentCredential(worker.token), "client.alerts.dismiss", { alertId }))?._tag).toBe("CommandRefused");
    expect(yield* cleared(alertId)).toEqual([]);
    expect(toolNames as readonly string[]).not.toContain("client.alerts.dismiss");
    success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId }));
    expect(yield* cleared(alertId)).toHaveLength(1);
  }));
});
