import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type * as Layer from "effect/Layer";
import type * as Redactor from "../../src/log/Redactor.ts";
import { expect } from "vitest";

import { incarnationOf, type FakeRunner, type DeliveryUpdateEvent, type PromptReplyEvent, type FakeRunnerEvent } from "./fakeRunner.ts";
import {
  agentCredential, agentIdOf, agentRow, appendSetup, call, eventOf, makeFakeSecrets,
  ownerCredential, provideRig, seedAccount, seedHarness, startPayload, success,
  type Rig,
} from "./handlerRig.ts";
import { makeFakeRunner } from "./fakeRunner.ts";
import { deliveryRow, endTurn, eventually, pause, snapshot } from "./routingRig.ts";

// Real command handler, log, SQLite and views. Only the process boundary is fake.
// The caller registers its rebuild finalizer inside this scope.
export const deliveryRig = <A, E, R>(rig: Rig, body: (runner: FakeRunner) => Effect.Effect<A, E, R>, redactor?: Layer.Layer<Redactor.Redactor>) =>
  Effect.gen(function* () {
    const runner = yield* makeFakeRunner();
    return yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), ...(redactor === undefined ? {} : { redactor }) }, Effect.gen(function* () {
      yield* seedAccount();
      yield* seedHarness();
      yield* runner.subscribed;
      return yield* body(runner).pipe(Effect.provide(runner.layer));
    }));
  });

export interface Spawned {
  readonly agentId: ReturnType<typeof agentIdOf>;
  readonly token: string;
}

export const spawn = (rig: Rig, runner: FakeRunner, parent?: Spawned, extra: Record<string, unknown> = {}) =>
  Effect.gen(function* () {
    const reply = success(yield* call(parent ? agentCredential(parent.token) : ownerCredential, "start", startPayload(rig, extra)));
    const agentId = agentIdOf(reply.agentId);
    const started = runner.callsOf("start").find((entry) => entry.input.agentId === agentId)!;
    // Issue 64 belongs to 6a: the fake adapter's successful session-open
    // notification is written through the real log until that producer exists.
    // Do not overwrite a session when the builder already records it.
    if ((yield* agentRow(agentId))?.session === undefined) {
      yield* appendSetup([eventOf({
        _tag: "SessionOpened", agentId, session: { _tag: "acp", sessionId: `fake-session-${agentId}` },
        protocolVersion: 2, reloadable: true,
      })]);
    }
    return { agentId, token: Redacted.value(started.input.token) } satisfies Spawned;
  });

export const promptsTo = (runner: FakeRunner, target: Spawned) =>
  runner.callsOf("prompt").filter((entry) => entry.input.agentId === target.agentId);

export const send = (runner: FakeRunner, target: Spawned, text: string, sender?: Spawned) =>
  Effect.gen(function* () {
    const reply = success(yield* call(sender ? agentCredential(sender.token) : ownerCredential, "prompt", { agentId: target.agentId, text }));
    const row = yield* eventually(deliveryRow(reply.deliveryId), (row) => row?.status === "sent");
    expect(row?.status, `delivery ${reply.deliveryId} must reach the runner`).toBe("sent");
    expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toContain(reply.deliveryId);
    return reply.deliveryId as string;
  });

export const notice = (runner: FakeRunner, target: Spawned, event: Omit<DeliveryUpdateEvent, "agentId" | "incarnation"> | Omit<PromptReplyEvent, "agentId" | "incarnation">) =>
  runner.emit({ ...event, agentId: target.agentId, incarnation: incarnationOf(target.token) } as FakeRunnerEvent);

export const accept = (runner: FakeRunner, target: Spawned, deliveryId: string) => Effect.gen(function* () {
  yield* notice(runner, target, { _tag: "deliveryUpdate", deliveryId, kind: "message", replay: false, text: "Working on it." });
  expect((yield* eventually(deliveryRow(deliveryId), (row) => row?.status === "accepted"))?.status).toBe("accepted");
});

export const finish = (runner: FakeRunner, target: Spawned, deliveryId: string) => Effect.gen(function* () {
  yield* accept(runner, target, deliveryId);
  return yield* endTurn(runner, target);
});

export const waitFor = (waiter: Spawned, members: ReadonlyArray<Spawned>, mode: "any" | "all" = "all", block = false) =>
  call(agentCredential(waiter.token), "wait", { members: members.map((member) => member.agentId), mode, block });
export const waitRow = (waitId: string) => snapshot.pipe(Effect.map((state) => state.waits[waitId]));
export const wakeRows = (waitId: string) => snapshot.pipe(Effect.map((state) => Object.values(state.deliveries)
  .filter((delivery) => delivery.source?._tag === "wait" && delivery.source.id === waitId)));
export const noWake = (waitId: string) => Effect.gen(function* () {
  yield* pause(40);
  expect(yield* wakeRows(waitId)).toEqual([]);
});
export const oneWake = (waitId: string, waiter: Spawned, members: ReadonlyArray<{ agentId: string; reason: string }>) =>
  Effect.gen(function* () {
    const row = yield* eventually(waitRow(waitId), (row) => row?.status === "satisfied");
    expect(row?.status).toBe("satisfied");
    expect(row?.resolved).toHaveLength(members.length);
    expect(row?.resolved).toEqual(expect.arrayContaining([...members]));
    const wakes = yield* wakeRows(waitId);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.target).toBe(waiter.agentId);
    const text = JSON.stringify(wakes[0]?.content);
    for (const member of members) {
      expect(text).toContain(member.agentId);
      expect(text).toContain(member.reason);
    }
    return wakes[0]!;
  });
export const crash = (runner: FakeRunner, target: Spawned) => Effect.gen(function* () {
  yield* runner.emit({ _tag: "exited", agentId: target.agentId, incarnation: incarnationOf(target.token), exitCode: 1, signal: null, stderr: "fake exit" });
  expect((yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "crashed"))?.state._tag).toBe("crashed");
});
