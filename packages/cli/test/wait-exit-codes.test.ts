// 7.6, row 62: all journeys use a real service and real lgcode child.
// State is reached through RPC/ACP, never by inserting view/log fixtures.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import type { EventEnvelope } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { connect, type Client } from "../../engine/test/support/socketClient.ts";
import { modeOption } from "../../engine/test/support/acpRunnerRig.ts";
import {
  agentToken, fakeHarness, makeServiceRoot, ownerClient, requestId, serviceEnvironment,
  startFakeAgent, startService, waitServing, writeFakeAdapter, type ServiceRoot, type StartedAgent,
} from "../../engine/test/support/serviceProcess.ts";
import {
  assertNoSecrets, cleanupUnit7b, finishCli, startCli,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);
const run = <A>(effect: Effect.Effect<A, unknown, any>) =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, unknown>);

const eventAfter = (owner: Client, after: number, predicate: (event: EventEnvelope) => boolean) =>
  owner.subscribe({ requestId: requestId(), after } as never).pipe(
    Stream.filter(predicate), Stream.take(1), Stream.runCollect, Effect.timeout(15_000),
    Effect.map((events) => events[0]!),
  );
const openedBeforeExit = (owner: Client, after: number, child: ReturnType<typeof startCli>) =>
  Effect.raceFirst(
    eventAfter(owner, after, (envelope) => envelope.event._tag === "WaitOpened"),
    Effect.promise(() => child.exit).pipe(Effect.flatMap(() => Effect.die(new Error("lgcode exited before committing WaitOpened")))),
  );
const head = (owner: Client) => owner["debug.compare-views"]({ requestId: requestId() } as never).pipe(Effect.map((reply) => reply.sequence));

// A committed group command is the end watermark. Count only this journey's
// events, and only deliveries whose source is this particular wait.
const finishWindow = (owner: Client, after: number, parent: StartedAgent) => Effect.gen(function* () {
  const marker = requestId();
  yield* owner.group({ requestId: requestId(), agentId: parent.agentId, add: [marker], remove: [] } as never);
  return yield* owner.subscribe({ requestId: requestId(), after } as never).pipe(
    Stream.takeUntil((envelope) => envelope.event._tag === "AgentGrouped" && envelope.event.agentId === parent.agentId && envelope.event.groups.includes(marker)),
    Stream.runCollect, Effect.timeout(15_000),
  );
});
const noWaitDelivery = (events: ReadonlyArray<EventEnvelope>): void => {
  const opened = events.filter((envelope) => envelope.event._tag === "WaitOpened");
  expect(opened, "CLI must open exactly one wait in this event window").toHaveLength(1);
  const ids = new Set(opened.map((envelope) => (envelope.event as { waitId: string }).waitId));
  const deliveries = events.filter((envelope) => envelope.event._tag === "DeliveryQueued"
    && envelope.event.delivery.source?._tag === "wait" && ids.has(envelope.event.delivery.source.id));
  expect(deliveries).toHaveLength(0);
};
const workingScript = { turns: [[{ step: "plan", entries: [] }, { step: "slow", ms: 120_000 }]] };

const setup = (busy = false) => Effect.gen(function* () {
  const root = makeServiceRoot("/tmp/s7w-");
  const service = startService(root, { env: { LGCODE_TEST_DEBUG: "1" } });
  yield* waitServing(root, service);
  const owner = yield* ownerClient(root);
  // These cases observe stable crash states, independently of automatic recovery.
  yield* owner["roles.settings.set"]({ requestId: requestId(), settings: { limits: { crashRetries: 0 } } } as never);
  const before = yield* head(owner);
  const parent = yield* startFakeAgent(root, owner, owner, {
    name: "Wait caller", script: busy ? workingScript : { turns: [] },
    ...(busy ? { prompt: "Hold this turn open while waiting for members." } : {}),
  });
  // A real caller waits from inside a turn. An idle holder's requests move
  // to the owner before an already-held wait can observe them (issue 179).
  if (busy) yield* eventAfter(owner, before, (envelope) => envelope.agentId === parent.agentId && envelope.event._tag === "DeliveryAccepted");
  const identity = yield* agentToken(parent);
  const caller = yield* connect(root.socket, identity.token);
  const environment = { ...serviceEnvironment(root), LGCODE_SOCKET: root.socket, LGCODE_TOKEN: identity.token };
  return { root, service, owner, parent, caller, environment, callerToken: identity.token };
});

// A fake executable registered under a recognised harness id exercises the
// real error classifier; no real harness executable is ever launched.
const pausedMember = (root: ServiceRoot, owner: Client, caller: Client) => Effect.gen(function* () {
  const accountId = requestId();
  const echo = join(root.root, `echo-${accountId}.json`);
  const adapter = writeFakeAdapter(root, "fake-usage-adapter");
  yield* owner.harnesses({ requestId: requestId(), operation: "set", harness: fakeHarness(adapter, "claude") } as never);
  yield* owner.accounts({ requestId: requestId(), operation: "add", account: {
    id: accountId, harness: "claude", enabled: true, environment: {
      FAKE_AGENT_ECHO: echo,
      FAKE_AGENT_SCRIPT: JSON.stringify({ configOptions: [modeOption()], turns: [[{ step: "out_of_usage", message: "You've hit your limit", resetsAt: new Date(Date.now() + 3_600_000).toISOString() }]] }),
    },
  } } as never);
  const before = yield* head(owner);
  const reply = yield* caller.start({
    requestId: requestId(), name: "Paused member", role: "worker", harness: "claude", account: { _tag: "named", accountId },
    permission: "ask", folder: root.work, runMode: "acp", prompt: "Use the fake usage response.",
  } as never);
  yield* eventAfter(owner, before, (envelope) => envelope.agentId === reply.agentId && envelope.event._tag === "StateChanged" && envelope.event.state._tag === "paused");
  return { agentId: reply.agentId, echo, accountId };
});

type Reason = "settled" | "paused" | "crashed" | "stopped";
const memberIn = (context: Effect.Success<ReturnType<typeof setup>>, reason: Reason) => Effect.gen(function* () {
  if (reason === "paused") return yield* pausedMember(context.root, context.owner, context.caller);
  const before = yield* head(context.owner);
  const member = yield* startFakeAgent(context.root, context.owner, context.caller, {
    script: reason === "crashed" ? { turns: [[{ step: "crash", exitCode: 7 }]] } : { turns: [] },
    ...(reason === "crashed" ? { prompt: "Crash the fake child." } : {}),
  });
  if (reason === "crashed") yield* eventAfter(context.owner, before, (envelope) => envelope.agentId === member.agentId && envelope.event._tag === "AgentCrashed");
  if (reason === "stopped") yield* context.owner.stop({ requestId: requestId(), agentId: member.agentId } as never);
  return member;
});

const precedence: ReadonlyArray<readonly [ReadonlyArray<Reason>, number]> = [
  [["settled"], 0], [["paused"], 2], [["crashed"], 1], [["stopped"], 1],
  [["settled", "paused"], 2], [["paused", "settled"], 2],
  [["paused", "stopped"], 1], [["stopped", "paused"], 1],
  [["crashed", "paused", "settled"], 1], [["paused", "crashed"], 1],
];
for (const [reasons, code] of precedence) {
  it(`W01 ${reasons.join("+")} catches wait --block using the first/last member's status instead of precedence 1 > 2 > 0`, async () => run(Effect.gen(function* () {
    const context = yield* setup();
    const members: Array<StartedAgent> = [];
    for (const reason of reasons) members.push(yield* memberIn(context, reason));
    const before = yield* head(context.owner);
    const child = startCli(context.root, ["wait", "--block", "--mode", "all", ...members.map((member) => member.agentId)], context.environment);
    expect(yield* Effect.promise(() => finishCli(child))).toEqual({ code, signal: null });
    const events = yield* finishWindow(context.owner, before, context.parent);
    noWaitDelivery(events);
    const satisfied = events.find((envelope) => envelope.event._tag === "WaitSatisfied")?.event;
    expect(satisfied?._tag).toBe("WaitSatisfied");
    if (satisfied?._tag === "WaitSatisfied") {
      expect(satisfied.members).toEqual(members.map((member, index) => ({ agentId: member.agentId, reason: reasons[index] })));
    }
    assertNoSecrets(child, [context.callerToken]);
  })), 60_000);
}

for (const subject of ["permission", "question"] as const) {
  for (const timing of ["already held", "arrives while blocked"] as const) {
    it(`W02 ${subject} ${timing} catches a blocking wait deadlocking its caller on a held request/question`, async () => run(Effect.gen(function* () {
      const context = yield* setup(true);
      const beforeMember = yield* head(context.owner);
      const permissionGate = join(context.root.root, "permission-gate");
      const member = yield* startFakeAgent(context.root, context.owner, context.caller, {
        script: subject === "permission" ? { turns: [[{ step: "plan", entries: [] }, { step: "wait_for_file", path: permissionGate }, { step: "permission", toolCallId: "read-once", title: "Read a file", options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        ] }]] } : workingScript,
      });
      const route = () => Effect.gen(function* () {
        if (subject === "question") {
          const identity = yield* agentToken(member);
          const memberClient = yield* connect(context.root.socket, identity.token);
          yield* memberClient.ask({ requestId: requestId(), text: "Which file should I read?" } as never);
        } else writeFileSync(permissionGate, "release");
        const routed = yield* eventAfter(context.owner, beforeMember, (envelope) => envelope.agentId === member.agentId
          && (subject === "question" ? envelope.event._tag === "QuestionAsked" : envelope.event._tag === "PermissionRequested"));
        expect((routed.event as { holder: unknown }).holder).toEqual({ _tag: "agent", agentId: context.parent.agentId });
      });
      // Keep the question member working, so a mistaken settled return cannot
      // satisfy this test. A permission itself keeps its member unsettled.
      yield* context.owner.prompt({ requestId: requestId(), agentId: member.agentId, text: "Stay busy until the route is released." } as never);
      yield* eventAfter(context.owner, beforeMember, (envelope) => envelope.agentId === member.agentId && envelope.event._tag === "DeliveryAccepted");
      if (timing === "already held") yield* route();
      const beforeWait = yield* head(context.owner);
      const child = startCli(context.root, ["wait", "--block", "--mode", "all", member.agentId], context.environment);
      if (timing === "arrives while blocked") {
        // The member is demonstrably busy; only this committed WaitOpened
        // permits the gate or question to be released.
        yield* openedBeforeExit(context.owner, beforeWait, child);
        yield* route();
      }
      const exit = yield* Effect.promise(() => finishCli(child));
      expect(exit.signal).toBeNull();
      // Decision row 26: waiting on the caller exits 2, even though the
      // blocking wait was successfully cancelled instead of deadlocking.
      expect(exit.code).toBe(2);
      expect(`${child.stdout()}${child.stderr()}`).toMatch(/request.held|holding|permission|question/i);
      const events = yield* finishWindow(context.owner, beforeWait, context.parent);
      expect(events.some((envelope) => envelope.event._tag === "WaitCancelled" && envelope.event.reason === "request held")).toBe(true);
      noWaitDelivery(events);
    })), 60_000);
  }
}

it("W03 catches SIGTERM leaving the blocking wait open, hiding 'wait cancelled', or producing a wake delivery", async () => run(Effect.gen(function* () {
  const context = yield* setup();
  const member = yield* startFakeAgent(context.root, context.owner, context.caller, { script: workingScript, prompt: "Keep working." });
  const before = yield* head(context.owner);
  const child = startCli(context.root, ["wait", "--block", "--mode", "all", member.agentId], context.environment);
  yield* openedBeforeExit(context.owner, before, child);
  assertNoSecrets(child, [context.callerToken]);
  child.child.kill("SIGTERM");
  yield* Effect.promise(() => finishCli(child));
  expect(`${child.stdout()}${child.stderr()}`).toMatch(/wait cancelled/i);
  yield* eventAfter(context.owner, before, (envelope) => envelope.event._tag === "WaitCancelled");
  noWaitDelivery(yield* finishWindow(context.owner, before, context.parent));
})), 60_000);

it("W04 enforces agents-only blocking wait under decision row 26 by refusing an owner without opening a wait", async () => run(Effect.gen(function* () {
  const context = yield* setup();
  const member = yield* memberIn(context, "settled");
  const before = yield* head(context.owner);
  const child = startCli(context.root, ["wait", "--block", "--mode", "all", member.agentId], serviceEnvironment(context.root));
  const exit = yield* Effect.promise(() => finishCli(child));
  expect(exit.code).not.toBe(0);
  expect(exit.signal).toBeNull();
  expect(child.stderr()).toMatch(/refus|owner|agent/i);
  const events = yield* finishWindow(context.owner, before, context.parent);
  expect(events.some((envelope) => envelope.event._tag === "CommandRefused" && envelope.event.command === "wait")).toBe(true);
  expect(events.filter((envelope) => envelope.event._tag === "WaitOpened")).toHaveLength(0);
})), 60_000);

it("W05 catches mapping interrupted to success or letting it override a crash/stop after service recovery", async () => {
  const root = makeServiceRoot("/tmp/s7i-");
  const first = startService(root, { env: { LGCODE_TEST_DEBUG: "1" } });
  let parent!: StartedAgent;
  let member!: StartedAgent;
  let settled!: StartedAgent;
  let stopped!: StartedAgent;
  let crashed!: StartedAgent;
  let parentPid = 0;
  await run(Effect.gen(function* () {
    yield* waitServing(root, first);
    const owner = yield* ownerClient(root);
    yield* owner["roles.settings.set"]({ requestId: requestId(), settings: { limits: { crashRetries: 0 } } } as never);
    parent = yield* startFakeAgent(root, owner, owner, { script: { turns: [] } });
    const identity = yield* agentToken(parent);
    parentPid = identity.pid;
    const caller = yield* connect(root.socket, identity.token);
    member = yield* startFakeAgent(root, owner, caller, { script: { turns: [], reloadable: false } });
    yield* agentToken(member);
    settled = yield* startFakeAgent(root, owner, caller, { script: { turns: [] } });
    stopped = yield* startFakeAgent(root, owner, caller, { script: { turns: [] } });
    yield* owner.stop({ requestId: requestId(), agentId: stopped.agentId } as never);
    const beforeCrash = yield* head(owner);
    crashed = yield* startFakeAgent(root, owner, caller, { script: { turns: [[{ step: "crash", exitCode: 9 }]] }, prompt: "Crash this fake child." });
    yield* eventAfter(owner, beforeCrash, (envelope) => envelope.agentId === crashed.agentId && envelope.event._tag === "AgentCrashed");
  }));
  first.child.kill("SIGKILL");
  await first.exit;
  const second = startService(root, { env: { LGCODE_TEST_DEBUG: "1" } });
  await run(Effect.gen(function* () {
    yield* waitServing(root, second);
    const owner = yield* ownerClient(root);
    const identity = yield* agentToken(parent, parentPid);
    for (const [members, code] of [
      [[member], 2], [[member, settled], 2], [[settled, member], 2],
      [[member, stopped], 1], [[stopped, member], 1], [[crashed, member], 1],
    ] as const) {
      const before = yield* head(owner);
      const child = startCli(root, ["wait", "--block", "--mode", "all", ...members.map((entry) => entry.agentId)], {
        ...serviceEnvironment(root), LGCODE_SOCKET: root.socket, LGCODE_TOKEN: identity.token,
      });
      expect(yield* Effect.promise(() => finishCli(child))).toEqual({ code, signal: null });
      const events = yield* finishWindow(owner, before, parent);
      expect(events.some((envelope) => envelope.event._tag === "WaitSatisfied" && envelope.event.members.some((entry) => entry.agentId === member.agentId && entry.reason === "interrupted"))).toBe(true);
      noWaitDelivery(events);
      assertNoSecrets(child, [identity.token]);
    }
  }));
}, 90_000);
