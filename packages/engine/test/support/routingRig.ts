import { randomUUID } from "node:crypto";

import type { Actor, Event, PermissionLevel, PermissionOption } from "@shepherd/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import * as EventLog from "../../src/log/EventLog.ts";
import * as Views from "../../src/views/Views.ts";
import { incarnationOf, type FakeRunner, type PermissionRequestedEvent } from "./fakeRunner.ts";
import { agentIdOf, appendSetup, eventOf, headSequence, logAfter, type Logged, type Outcome } from "./handlerRig.ts";

// Shared setup for the unit 5c tests (routing of permission requests and
// questions). It holds no assertion. Each test file still registers the
// rebuild check itself (row 63).

// A real-timer pause. It is not Effect's clock, so it also lets the engine's
// fibers run in a test that holds a TestClock still.
export const pause = (millis: number) =>
  Effect.promise(() => new Promise<void>((resolve) => { setTimeout(resolve, millis); }));

// Polls `check` until `done` holds or about four seconds pass, then returns
// the last value, so the caller's assertion reports what was seen.
export const eventually = <A, E, R>(check: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 400; attempt++) {
      const value = yield* check;
      if (done(value)) return value;
      yield* pause(10);
    }
    return yield* check;
  });

export const snapshot = Effect.gen(function* () {
  const views = yield* Views.Views;
  return yield* views.snapshot;
});
export const requestRow = (id: string) => snapshot.pipe(Effect.map((views) => views.requests[id]));
export const questionRow = (id: string) => snapshot.pipe(Effect.map((views) => views.questions[id]));
export const deliveryRow = (id: string) => snapshot.pipe(Effect.map((views) => views.deliveries[id]));

export const owner: Actor = { _tag: "owner" };
export const agent = (id: string): Actor => ({ _tag: "agent", agentId: agentIdOf(id) });

export const option = (
  id: string, kind: string, level: PermissionLevel, persistent = false, name = `Option ${id}`,
): PermissionOption => ({ id, name, kind, level, persistent });

// The options an ACP adapter typically offers, mapped onto Shepherd's scale
// as `permissionForOptionKind` maps them, plus two one-off options above
// "ask" for the mode checks.
export const standardOptions: ReadonlyArray<PermissionOption> = [
  option("once", "allow_once", "ask"),
  option("reject", "reject_once", "read-only"),
  option("always", "allow_always", "edit", true),
  option("never", "reject_always", "read-only", true),
  option("once-edit", "allow_once", "edit"),
  option("once-full", "allow_once", "full"),
];

export interface Seeded {
  readonly agentId: string;
  readonly token: string;
}

// The runner reports that `asker` wants permission for a tool, and the test
// waits until the engine has recorded the request.
export const requestPermission = (
  runner: FakeRunner, asker: Seeded, overrides: Partial<Omit<PermissionRequestedEvent, "_tag" | "agentId">> = {},
) => Effect.gen(function* () {
  const permissionRequestId = overrides.permissionRequestId ?? `perm-${randomUUID()}`;
  yield* runner.subscribed;
  yield* runner.emit({
    _tag: "permissionRequested",
    agentId: agentIdOf(asker.agentId),
    incarnation: incarnationOf(asker.token),
    toolCallId: `tool-${randomUUID().slice(0, 8)}`,
    description: "Run `pnpm test` in the work folder.",
    options: standardOptions,
    settingsWrite: false,
    ...overrides,
    permissionRequestId,
  });
  const row = yield* eventually(requestRow(permissionRequestId), (found) => found !== undefined);
  if (row === undefined) return yield* Effect.die(new Error(`The engine never recorded permission request ${permissionRequestId}`));
  return { id: permissionRequestId, row };
});

// The runner reports that `who`'s turn ended; the test waits for the engine's
// "turn ended" event for that agent.
export const endTurn = (runner: FakeRunner, who: Seeded, incarnation = incarnationOf(who.token)) =>
  Effect.gen(function* () {
    const before = yield* headSequence;
    yield* runner.subscribed;
    yield* runner.emit({ _tag: "turnEnded", agentId: agentIdOf(who.agentId), incarnation });
    const written = yield* eventually(logAfter(before), (rows) =>
      rows.some((row) => row.event._tag === "TurnEnded" && row.event.agentId === who.agentId));
    if (!written.some((row) => row.event._tag === "TurnEnded" && row.event.agentId === who.agentId)) {
      return yield* Effect.die(new Error(`The engine never wrote a turn end for ${who.agentId}`));
    }
    return written;
  });

// The holder took its delivery: sent (the holder becomes working) and
// accepted, as unit 5d's delivery step would write it.
export const acceptDelivery = (target: string, deliveryId: string) => appendSetup([
  eventOf({ _tag: "DeliverySent", agentId: target, deliveryId, method: "acp" }),
  eventOf({ _tag: "DeliveryAccepted", agentId: target, deliveryId }),
]);

// Every row written by the same append as the first row that matches: one
// append is one transaction, and all its rows share the request id.
export const appendWith = (rows: ReadonlyArray<Logged>, match: (row: Logged) => boolean): ReadonlyArray<Logged> => {
  const first = rows.find(match);
  return first === undefined ? [] : rows.filter((row) => row.requestId === first.requestId);
};

// The events of one kind among the rows, typed.
export const tagged = <T extends Event["_tag"]>(rows: ReadonlyArray<Logged>, tag: T): ReadonlyArray<Extract<Event, { readonly _tag: T }>> =>
  rows.flatMap((row) => row.event._tag === tag ? [row.event as Extract<Event, { readonly _tag: T }>] : []);

// Deliveries queued for a request or question, in the given rows.
export const queuedFor = (rows: ReadonlyArray<Logged>, kind: "permission" | "question", id: string) =>
  rows.flatMap((row) => row.event._tag === "DeliveryQueued"
    && row.event.delivery.source?._tag === kind && row.event.delivery.source.id === id
    ? [row.event.delivery]
    : []);

// Holds the writer's permit, queues each command behind it in turn, runs
// `meanwhile` (such as a raw revocation), then lets them all go. `whileHeld`
// is what the log gained while the permit was held: nothing, if every
// command really waited for the writer. Real sleeps let each queued command
// reach the permit before the next one is queued.
export const behindWriter = <E, R, R2 = never>(
  commands: ReadonlyArray<Effect.Effect<Outcome, E, R>>,
  meanwhile: Effect.Effect<unknown, unknown, R2> = Effect.void,
) =>
  Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const gate = yield* Deferred.make<void>();
    const before = yield* headSequence;
    const holder = yield* log.withWriterPermit(Deferred.await(gate)).pipe(Effect.forkChild);
    yield* pause(50);
    const pending: Array<Fiber.Fiber<Outcome, E>> = [];
    for (const command of commands) {
      pending.push(yield* command.pipe(Effect.forkChild));
      yield* pause(50);
    }
    yield* pause(100);
    yield* meanwhile.pipe(Effect.orDie);
    const whileHeld = yield* logAfter(before);
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(holder);
    const outcomes: Array<Outcome> = [];
    for (const fiber of pending) outcomes.push(yield* Fiber.join(fiber));
    return { outcomes, whileHeld, written: yield* logAfter(before) };
  });
