import type { Client } from "@shephrd/client";
import type { EventEnvelope } from "@shephrd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { runProbes, type ProbeDriver } from "./probes.ts";
import { messageOf, type Reporter } from "./reporter.ts";
import { FINAL_STEP, FLOW_STEPS, type StepSpec } from "./steps.ts";
import {
  eventsUntil, findLeaks, head, isTag, refusal, requestId, since, tagged, threadSources, type LeakSource,
} from "./support.ts";

// Unit 8c: the eight-step journey of the engine design spec, "One request, start
// to finish", as one routine that both the live check and its fake-driver test
// run (the focused reviewer's advice F1 on unit 8b). The routine asserts only
// through the public socket, as the owner, from events. What differs between a
// real agent and the fake agent is in a `FlowDriver`: how the lead is started,
// how it comes to try a start that is too wide, how it starts the worker, and
// how it passes the request up. A real lead does these because its first
// prompt says so; the fake driver does them through the lead's own client.

export interface AgentRef {
  readonly agentId: string;
}

export interface FlowDriver {
  // The owner starts the lead with its first prompt.
  readonly startLead: () => Effect.Effect<AgentRef, unknown, Scope.Scope>;
  // The lead tries to start a worker with a mode wider than its own.
  readonly wideStart: (lead: AgentRef) => Effect.Effect<void, unknown, Scope.Scope>;
  // The lead starts the worker: any account of the worker harness, the folder
  // `workerFolder`, group "auth", in ask mode, with a first prompt.
  readonly startWorker: (lead: AgentRef) => Effect.Effect<void, unknown, Scope.Scope>;
  // The lead opens a wait on the worker and passes the held request up.
  readonly passUp: (lead: AgentRef, worker: AgentRef, permissionRequestId: string) => Effect.Effect<void, unknown, Scope.Scope>;
}

export class StepFailed extends Error {
  readonly stepId: string;
  constructor(stepId: string, message: string) { super(message); this.name = "StepFailed"; this.stepId = stepId; }
}

export interface StepRunner {
  <A, R>(spec: StepSpec, effect: Effect.Effect<A, unknown, R>, reason?: (value: A) => string): Effect.Effect<A, StepFailed, R>;
  readonly skip: (spec: StepSpec, because: string) => Effect.Effect<void>;
}

// Runs an effect as one printed step. A failure is printed once, with its
// message, and fails with `StepFailed`. The caller decides whether to continue.
export const makeStepRunner = (reporter: Reporter, now: () => number = Date.now): StepRunner => Object.assign(
  <A, R>(spec: StepSpec, effect: Effect.Effect<A, unknown, R>, reason?: (value: A) => string): Effect.Effect<A, StepFailed, R> =>
  Effect.gen(function* () {
    const started = now();
    const exit = yield* Effect.exit(effect);
    if (Exit.isSuccess(exit)) {
      reporter.pass(spec, reason === undefined ? "" : reason(exit.value), now() - started);
      return exit.value;
    }
    const message = messageOf(Cause.squash(exit.cause));
    reporter.fail(spec, message, now() - started);
    return yield* Effect.fail(new StepFailed(spec.id, message));
  }),
  { skip: (spec: StepSpec, because: string) => Effect.sync(() => reporter.skip(spec, because)) },
);

export interface FlowOptions {
  readonly owner: Client;
  // Another connection of the owner (the live view, and the phone that answers).
  readonly openOwner: () => Effect.Effect<Client, unknown, Scope.Scope>;
  readonly driver: FlowDriver;
  readonly probes?: ProbeDriver;
  readonly probeNote?: (text: string) => void;
  readonly step: StepRunner;
  readonly leadHarness: string;
  readonly workerHarness: string;
  readonly workerFolder: string;
  // The longest a wait for a real agent may take, and for the engine alone.
  readonly agentTimeout: number;
  readonly engineTimeout: number;
  // How long to watch for a second wake or a second alert after the first.
  readonly settle: number;
  // Every secret the run created, the output of every process it started, and
  // every reply it received, for the final scan.
  readonly secrets: () => Iterable<string>;
  readonly outputs: () => ReadonlyArray<LeakSource>;
  readonly replies: () => ReadonlyArray<string>;
}

export interface FlowResult {
  readonly lead: AgentRef;
  readonly worker: AgentRef;
  readonly permissionRequestId: string;
  readonly waitId: string;
  readonly mark: number;
}

type Actor = { readonly _tag: string; readonly agentId?: string };
const eventOf = <T>(envelope: EventEnvelope): T => envelope.event as unknown as T;

export const check = (ok: boolean, message: string): Effect.Effect<void> =>
  ok ? Effect.void : Effect.die(new Error(message));

const isAgent = (actor: Actor | undefined, agentId: string): boolean => actor?._tag === "agent" && actor.agentId === agentId;

// The option that lets this one tool call go ahead and nothing more.
export const allowOnce = (options: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly persistent?: boolean }>): string | undefined =>
  (options.find((option) => option.kind === "allow_once")
    ?? options.find((option) => option.kind.startsWith("allow") && option.persistent !== true))?.id;

// The lead's own tool calls (the tools of Shephrd) ask the owner, who is its
// parent. The script answers them with "allow once", and only them: the
// worker's request is the lead's to pass up, and the owner answers that one
// in the step that tests it.
const answerLeadRequests = (owner: Client, lead: AgentRef): Effect.Effect<void> =>
  (owner.subscribe({ requestId: requestId(), after: 0 } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
    Stream.filter(isTag("PermissionRequested", lead.agentId)),
    Stream.runForEach((envelope) => {
      const request = eventOf<{ permissionRequestId: string; holder: Actor; options: ReadonlyArray<{ id: string; kind: string; persistent?: boolean }> }>(envelope);
      const optionId = allowOnce(request.options);
      if (request.holder._tag !== "owner" || optionId === undefined) return Effect.void;
      return (owner.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId } as never) as Effect.Effect<unknown, unknown>).pipe(Effect.ignore);
    }),
    Effect.ignore,
  );

// A real worker may ask more than once. Every request after the first that
// reaches the owner is answered "allow once", so the turn can end.
const answerLaterWorkerRequests = (owner: Client, worker: AgentRef, first: () => string | undefined): Effect.Effect<void> => {
  const options = new Map<string, ReadonlyArray<{ id: string; kind: string; persistent?: boolean }>>();
  return (owner.subscribe({ requestId: requestId(), after: 0 } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
    Stream.filter((envelope) => envelope.agentId === worker.agentId),
    Stream.runForEach((envelope) => {
      if (envelope.event._tag === "PermissionRequested") {
        const asked = eventOf<{ permissionRequestId: string; options: ReadonlyArray<{ id: string; kind: string; persistent?: boolean }> }>(envelope);
        options.set(asked.permissionRequestId, asked.options);
        return Effect.void;
      }
      if (envelope.event._tag !== "PermissionMoved") return Effect.void;
      const moved = eventOf<{ permissionRequestId: string; to: Actor }>(envelope);
      const optionId = allowOnce(options.get(moved.permissionRequestId) ?? []);
      if (moved.to._tag !== "owner" || moved.permissionRequestId === first() || optionId === undefined) return Effect.void;
      return (owner.answer({ requestId: requestId(), kind: "permission", id: moved.permissionRequestId, optionId } as never) as Effect.Effect<unknown, unknown>).pipe(Effect.ignore);
    }),
    Effect.ignore,
  );
};

export const FLOW_STEP = Object.fromEntries(FLOW_STEPS.map((spec) => [spec.id, spec])) as Record<(typeof FLOW_STEPS)[number]["id"], StepSpec>;

// What the log says went wrong, when a step fails: the events that explain a
// stuck run (a crash, a sign-in prompt, a usage limit, a refusal).
export const troubleIn = (events: ReadonlyArray<EventEnvelope>, expectedRefusals: ReadonlyArray<string> = []): ReadonlyArray<string> => events.flatMap((envelope) => {
  const event = envelope.event as unknown as { _tag: string; reason?: string; command?: string; exitCode?: number | null; signal?: string | null };
  switch (event._tag) {
    case "AgentCrashed": return [`agent ${envelope.agentId ?? "?"} crashed (exit ${String(event.exitCode)}, signal ${String(event.signal)})`];
    case "AgentStartFailed": return [`agent ${envelope.agentId ?? "?"} did not start: ${event.reason ?? ""}`];
    case "AccountNeedsSignIn": return [`an account needs signing in: ${event.reason ?? ""}`];
    case "AccountOutOfUsage": return ["an account is out of usage"];
    case "CommandRefused": return expectedRefusals.includes(event.command ?? "") ? [] : [`a ${event.command ?? "?"} command was refused: ${event.reason ?? ""}`];
    case "AgentReloadFailed": return [`agent ${envelope.agentId ?? "?"} could not be reloaded: ${event.reason ?? ""}`];
    default: return [];
  }
});

export const flow = (options: FlowOptions): Effect.Effect<FlowResult, StepFailed, Scope.Scope> => Effect.gen(function* () {
  const { owner, driver, step } = options;
  const scope = yield* Scope.Scope;
  const phone = yield* options.openOwner().pipe(Effect.orDie);
  const watcher = yield* options.openOwner().pipe(Effect.orDie);
  const mark = yield* head(owner);
  const wait = options.agentTimeout;
  const quick = options.engineTimeout;
  let firstFailure: StepFailed | undefined;
  const collect = <A, R>(effect: Effect.Effect<A, StepFailed, R>) => effect.pipe(Effect.catch((error) => {
    firstFailure ??= error;
    return Effect.succeed(undefined);
  }));

  let leadApprovals: Fiber.Fiber<void, never> | undefined;
  const lead = yield* step(FLOW_STEP.lead, Effect.gen(function* () {
    const started = yield* driver.startLead();
    leadApprovals = yield* answerLeadRequests(owner, started).pipe(Effect.forkIn(scope));
    const events = yield* eventsUntil(owner, mark, "the lead's AgentStarted", isTag("AgentStarted", started.agentId), quick);
    const recorded = eventOf<{ harness: string; parent: Actor }>(tagged(events, "AgentStarted", started.agentId)[0]!);
    yield* check(recorded.harness === options.leadHarness, `the lead runs on ${recorded.harness}, not ${options.leadHarness}`);
    yield* check(recorded.parent._tag === "owner", "the lead's recorded parent is not the owner");
    return started;
  }), (agent) => `lead ${agent.agentId}`);

  // Step 2 of the spec: the command handler refuses a mode wider than the lead's own.
  yield* collect(step(FLOW_STEP["wide-start"], Effect.gen(function* () {
    yield* driver.wideStart(lead);
    const events = yield* eventsUntil(owner, mark, "the refusal of the lead's start with a wider mode", (envelope) =>
      envelope.event._tag === "CommandRefused" && isAgent(envelope.caller, lead.agentId)
      && (envelope.event as unknown as { command: string }).command === "start", wait);
    yield* check(tagged(events, "AgentStarted").every((envelope) => !isAgent(eventOf<{ parent: Actor }>(envelope).parent, lead.agentId)),
      "a refused start still started an agent");
    return eventOf<{ reason: string }>(events[events.length - 1]!).reason;
  }), (reason) => `refused: ${reason}`));

  // Steps 1 and 2: the real start.
  const worker = yield* step(FLOW_STEP["worker-start"], Effect.gen(function* () {
    yield* driver.startWorker(lead);
    const events = yield* eventsUntil(owner, mark, "the worker's AgentStarted", (envelope) =>
      envelope.event._tag === "AgentStarted" && isAgent(eventOf<{ parent: Actor }>(envelope).parent, lead.agentId), wait);
    const started = events[events.length - 1]!;
    const recorded = eventOf<{ harness: string; parent: Actor; account: string; groups: string[]; permission: string; folder: string; firstPromptDelivery?: unknown }>(started);
    yield* check(recorded.harness === options.workerHarness, `the worker runs on ${recorded.harness}, not ${options.workerHarness}`);
    yield* check(recorded.groups.length === 1 && recorded.groups[0] === "auth", `the worker's groups are ${JSON.stringify(recorded.groups)}, not ["auth"]`);
    yield* check(recorded.permission === "ask", `the worker's permission is ${recorded.permission}, not ask`);
    yield* check(recorded.folder === options.workerFolder, `the worker's folder is ${recorded.folder}, not ${options.workerFolder}`);
    yield* check(recorded.firstPromptDelivery !== undefined, "the first prompt was not queued with the start");
    return { agentId: started.agentId! } satisfies AgentRef;
  }), (agent) => `worker ${agent.agentId}`);

  // Step 3 and 4: the session, and the first prompt as the lead's.
  yield* collect(step(FLOW_STEP.session, Effect.gen(function* () {
    const started = tagged(yield* since(owner, mark), "AgentStarted", worker.agentId)[0]!;
    const first = eventOf<{ firstPromptDelivery: { id: string; sender: Actor } }>(started).firstPromptDelivery;
    yield* check(isAgent(first.sender, lead.agentId), "the first prompt is not recorded as sent by the lead");
    const events = yield* eventsUntil(owner, mark, "the worker's session to open", isTag("SessionOpened", worker.agentId), wait);
    yield* check(tagged(events, "SessionOpened", worker.agentId).length === 1, "the worker's session was recorded other than once");
    yield* eventsUntil(owner, mark, "the worker to take its first prompt", (envelope) =>
      envelope.event._tag === "DeliveryAccepted" && envelope.agentId === worker.agentId
      && eventOf<{ deliveryId: string }>(envelope).deliveryId === first.id, wait);
  })));

  // Step 4 and 5: a second connection sees the work while the permission is open.
  const liveView = yield* collect(step(FLOW_STEP["live-view"], Effect.gen(function* () {
    const events = yield* eventsUntil(watcher, mark, "the worker's permission request on the second connection", (row) => isTag("PermissionRequested", worker.agentId)(row) || isTag("TurnEnded", worker.agentId)(row), wait);
    yield* check(tagged(events, "PermissionRequested", worker.agentId).length > 0,
      "the worker's turn ended without a permission request (issue 272)");
    yield* check(tagged(events, "TurnEnded", worker.agentId).length === 0, "the worker's turn ended before its permission was answered");
    // The step claims the second connection sees the work, so work must be there.
    yield* check(tagged(events, "ThreadItem", worker.agentId).length > 0, "the second connection saw no thread item of the worker before its permission request, so it showed no work");
    return events;
  })));
  // A failed visibility assertion may still leave a real request to route.
  // Read that evidence independently instead of treating the failure as its absence.
  const inspected = liveView === undefined ? yield* Effect.exit(since(owner, mark)) : Exit.succeed(liveView);
  if (Exit.isFailure(inspected) && !Cause.hasDies(inspected.cause) && !Cause.hasFails(inspected.cause)) return yield* Effect.failCause(inspected.cause);
  const requested = Exit.isSuccess(inspected) ? inspected.value : [];
  const missingRequest = Exit.isFailure(inspected)
    ? "the worker's permission request could not be inspected after live-view failed"
    : "no permission request (live-view failed; issue 272)";
  let requestIdValue: string | undefined;
  let waitId: string | undefined;
  let laterApprovals: Fiber.Fiber<void, never> | undefined;
  const available = tagged(requested, "PermissionRequested", worker.agentId);
  if (available.length === 0) {
    for (const id of ["routed", "pass-up", "owner-answer", "wake"] as const) {
      yield* step.skip(FLOW_STEP[id], missingRequest);
    }
  } else {
    const request = eventOf<{ permissionRequestId: string; holder: Actor; description: string; options: ReadonlyArray<{ id: string; kind: string; persistent?: boolean }> }>(available[0]!);
    requestIdValue = request.permissionRequestId;
    yield* collect(step(FLOW_STEP.routed, Effect.gen(function* () {
      const asked = tagged(requested, "PermissionRequested", worker.agentId);
      yield* check(asked.length === 1, `the worker's first turn made ${asked.length} permission requests in the log, not one`);
      const permission = eventOf<{ permissionRequestId: string; holder: Actor; description: string; options: ReadonlyArray<{ id: string; kind: string; persistent?: boolean }> }>(asked[0]!);
      yield* check(isAgent(permission.holder, lead.agentId), "the request did not go to the worker's lead");
      yield* check(allowOnce(permission.options) !== undefined, "the request has no allow-once option to answer with");
      return permission;
    }), (permission) => `request ${permission.permissionRequestId}`));
    laterApprovals = yield* answerLaterWorkerRequests(owner, worker, () => requestIdValue).pipe(Effect.forkIn(scope));

    // Step 6: the lead passes the request up, and the owner is called once.
    waitId = yield* collect(step(FLOW_STEP["pass-up"], Effect.gen(function* () {
      yield* driver.passUp(lead, worker, request.permissionRequestId);
      const events = yield* eventsUntil(owner, mark, "the owner to be told", (envelope) =>
        envelope.event._tag === "OwnerNeeded" && envelope.agentId === worker.agentId
        && eventOf<{ subject?: { id: string } }>(envelope).subject?.id === requestIdValue, wait);
      const moved = tagged(events, "PermissionMoved", worker.agentId).filter((envelope) => eventOf<{ permissionRequestId: string }>(envelope).permissionRequestId === requestIdValue);
      yield* check(moved.length === 1, `the request was moved ${moved.length} times, not once`);
      const move = eventOf<{ from: Actor; to: Actor }>(moved[0]!);
      yield* check(isAgent(move.from, lead.agentId) && move.to._tag === "owner", "the request did not move from the lead to the owner");
      const opened = tagged(events, "WaitOpened").filter((envelope) =>
        (envelope.agentId === lead.agentId || isAgent(envelope.caller, lead.agentId))
        && eventOf<{ members: ReadonlyArray<string> }>(envelope).members.length === 1
        && eventOf<{ members: ReadonlyArray<string> }>(envelope).members[0] === worker.agentId);
      yield* check(opened.length === 1, `the lead opened ${opened.length} waits on the worker, not one`);
      yield* check(opened[0]!.sequence < moved[0]!.sequence, "the lead's wait was opened after it passed the request up, so it was not open before the worker finished");
      return eventOf<{ waitId: string }>(opened[0]!).waitId;
    }), (id) => `wait ${id}`));

    // Step 7: the owner answers from a second connection; the first answer wins.
    yield* collect(step(FLOW_STEP["owner-answer"], Effect.gen(function* () {
      const optionId = allowOnce(request.options);
      yield* check(optionId !== undefined, "the permission request has no allow-once option");
      yield* (phone.answer({ requestId: requestId(), kind: "permission", id: requestIdValue, optionId } as never) as Effect.Effect<unknown, unknown>);
      const again = yield* refusal(phone.answer({ requestId: requestId(), kind: "permission", id: requestIdValue, optionId } as never) as Effect.Effect<unknown, unknown>);
      yield* check(again !== undefined, "a second answer from the owner was accepted");
    })));

    // Step 8: the worker's turn ends and the lead is woken exactly once.
    yield* collect(step(FLOW_STEP.wake, Effect.gen(function* () {
      yield* eventsUntil(owner, mark, "the worker's turn to end", isTag("TurnEnded", worker.agentId), wait);
      const queued = yield* eventsUntil(owner, mark, "the lead's wake", (envelope) => {
        if (envelope.event._tag !== "DeliveryQueued") return false;
        const delivery = eventOf<{ delivery: { target: string; source?: { _tag: string } } }>(envelope).delivery;
        return delivery.target === lead.agentId && delivery.source?._tag === "wait";
      }, wait);
      const wake = eventOf<{ delivery: { id: string } }>(queued[queued.length - 1]!).delivery;
      const accepted = yield* eventsUntil(owner, mark, "the lead to take the wake", (envelope) =>
        envelope.event._tag === "DeliveryAccepted" && envelope.agentId === lead.agentId
        && eventOf<{ deliveryId: string }>(envelope).deliveryId === wake.id, wait);
      const takenAt = accepted[accepted.length - 1]!.sequence;
      yield* eventsUntil(owner, mark, "the lead to answer the wake", (envelope) =>
        envelope.event._tag === "TurnEnded" && envelope.agentId === lead.agentId && envelope.sequence > takenAt, wait);
      // Watch a while longer: a second wake or a second alert would show here.
      yield* Effect.sleep(options.settle);
      const all = yield* since(owner, mark);
      const answers = tagged(all, "PermissionAnswered", worker.agentId).filter((envelope) => eventOf<{ permissionRequestId: string }>(envelope).permissionRequestId === requestIdValue);
      yield* check(answers.length === 1, `the request was answered ${answers.length} times, not once`);
      const answeredBy = eventOf<{ answeredBy: Actor }>(answers[0]!).answeredBy;
      yield* check(answeredBy._tag === "owner", "the request was not answered by the owner");
      const satisfied = tagged(all, "WaitSatisfied");
      yield* check(satisfied.length === 1, `the lead's wait was satisfied ${satisfied.length} times, not once`);
      const done = eventOf<{ waitId: string; members: ReadonlyArray<{ agentId: string; reason: string }> }>(satisfied[0]!);
      const observedWait = tagged(all, "WaitOpened", lead.agentId).find((row) => {
        const opened = eventOf<{ members: ReadonlyArray<string> }>(row);
        return opened.members.length === 1 && opened.members[0] === worker.agentId;
      });
      const expectedWait = waitId ?? (observedWait === undefined ? undefined : eventOf<{ waitId: string }>(observedWait).waitId);
      yield* check(done.waitId === expectedWait, "the wait that was satisfied is not the one the lead opened");
      yield* check(done.members.length === 1 && done.members[0]!.agentId === worker.agentId && done.members[0]!.reason === "settled",
        `the wait's members are ${JSON.stringify(done.members)}, not the worker settled`);
      const wakes = tagged(all, "DeliveryQueued").filter((envelope) => {
        const delivery = eventOf<{ delivery: { target: string; source?: { _tag: string } } }>(envelope).delivery;
        return delivery.target === lead.agentId && delivery.source?._tag === "wait";
      });
      yield* check(wakes.length === 1, `the lead was woken ${wakes.length} times, not once`);
      const alerts = tagged(all, "OwnerNeeded", worker.agentId).filter((envelope) => eventOf<{ subject?: { id: string } }>(envelope).subject?.id === requestIdValue);
      yield* check(alerts.length === 1, `the owner was called ${alerts.length} times for the request, not once`);
      const children = tagged(all, "AgentStarted").filter((envelope) => isAgent(eventOf<{ parent: Actor }>(envelope).parent, lead.agentId));
      yield* check(children.length === 1, `the lead started ${children.length} agents, not one`);
      // The wide start and the second answer are refused on purpose.
      const trouble = troubleIn(all, ["start", "answer"]);
      yield* check(trouble.length === 0, `the log also holds: ${trouble.join("; ")}`);
    })));
  }

  // The journey's broad legacy approvals must end before exact-command probes.
  if (leadApprovals !== undefined) yield* Fiber.interrupt(leadApprovals);
  if (laterApprovals !== undefined) yield* Fiber.interrupt(laterApprovals);
  if (firstFailure !== undefined && options.probes?.prepare !== undefined) {
    const prepared = yield* Effect.exit(Effect.scoped(options.probes.prepare({ lead, worker })));
    if (Exit.isFailure(prepared)) options.probeNote?.(`probe preparation failed: ${messageOf(Cause.squash(prepared.cause))}`);
  }
  const probeExit = options.probes === undefined ? undefined
    : yield* Effect.exit(runProbes(options.probes, step, { lead, worker }, options.probeNote));

  // Criterion 8.5: the views rebuilt from the log equal the live views, and no
  // secret appears in any form in an event, a reply, the accounts list or the
  // output of a process this run started.
  yield* step(FINAL_STEP, Effect.gen(function* () {
    // A restart invalidates old sockets. Reconnection belongs to this step,
    // so even a dead service after a failed probe records a final failure.
    const finalOwner = options.probes === undefined ? owner : yield* options.openOwner();
    const reply = yield* (finalOwner["debug.compare-views"]({ requestId: requestId() } as never) as Effect.Effect<{ sequence: number; equal: boolean; differences: ReadonlyArray<string> }, unknown>);
    yield* check(reply.equal && reply.differences.length === 0, `the live views differ from the rebuild: ${JSON.stringify(reply.differences.slice(0, 5))}`);
    const all = yield* since(finalOwner, 0);
    const accounts = yield* (finalOwner.accounts({ requestId: requestId(), operation: "list" } as never) as Effect.Effect<unknown, unknown>);
    const secrets = [...options.secrets()];
    yield* check(secrets.length > 0, "the run has no secret to scan for, so the scan would pass without looking");
    for (const secret of secrets) yield* check(secret.length > 8, "a secret of the run is too short to scan for");
    const leaks = findLeaks(secrets, [
      { label: "the events", text: JSON.stringify(all) },
      { label: "the accounts list", text: JSON.stringify(accounts) },
      { label: "the replies and refusals", text: options.replies().join("\n") },
      ...options.outputs(),
      ...threadSources(all),
    ]);
    yield* check(leaks.length === 0, `a credential or secret was found: ${leaks.join("; ")}`);
    return secrets.length;
  }), (count) => `${count} secret forms scanned for`);

  if (firstFailure !== undefined) return yield* Effect.fail(firstFailure);
  if (probeExit !== undefined && Exit.isFailure(probeExit)) return yield* Effect.failCause(probeExit.cause);
  return { lead, worker, permissionRequestId: requestIdValue!, waitId: waitId!, mark };
}).pipe(Effect.catchCause((cause) => Cause.hasDies(cause) || Cause.hasFails(cause)
  ? Effect.fail(Cause.squash(cause) instanceof StepFailed ? Cause.squash(cause) as StepFailed : new StepFailed("flow", messageOf(Cause.squash(cause))))
  : Effect.failCause(cause)));
