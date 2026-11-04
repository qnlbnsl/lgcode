import { randomUUID } from "node:crypto";
import { AgentId, DeliveryId, PermissionLevel, type Event } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { pickAccount } from "../accounts/pick.ts";
import { canUseMode, checkFolder, folderForSpawn } from "../identity/ceiling.ts";
import { mintAgentToken } from "../identity/tokens.ts";
import type { LogWriteFailed } from "../log/EventLog.ts";
import { agentText, senderOf } from "../routing/envelope.ts";
import { bounded, SETUP_TIMEOUT_MILLIS } from "../recovery/reload.ts";
import { withLane, withPreemption } from "../routing/lanes.ts";
import { withWaitChecks } from "../routing/waits.ts";
import { freshRequest, readHarnesses, refused, type Input, type Payload, type Plan } from "./internal.ts";

export const start = (input: Input, payload: Payload<"start">): Effect.Effect<Plan, ReturnType<typeof refused> | LogWriteFailed> =>
  Effect.gen(function* () {
    const { runtime, actor, snapshot } = input;
    if (actor._tag !== "owner" && actor._tag !== "agent") return yield* refused();
    const parent = actor._tag === "agent" ? snapshot.agents[actor.agentId] : undefined;
    if (actor._tag === "agent" && (parent === undefined || !canUseMode(actor, Schema.decodeUnknownSync(PermissionLevel)(parent.permission), payload.permission))) {
      return yield* refused();
    }
    const harness = (yield* readHarnesses(runtime)).find((settings) => settings.id === payload.harness);
    if (harness === undefined || (payload.runMode !== undefined && payload.runMode !== harness.runMode)) return yield* refused();
    const model = payload.model ?? harness.defaultModel;
    const effort = payload.effort ?? harness.defaultEffort;
    if ((model !== undefined && harness.models.length > 0 && !harness.models.includes(model))
      || (effort !== undefined && harness.efforts.length > 0 && !harness.efforts.includes(effort))) return yield* refused();
    const account = pickAccount(snapshot, payload.harness, payload.account);
    if (account === undefined) return yield* refused("no usable account");
    const grant = yield* checkFolder({ ...runtime, caller: actor, parentFolder: parent?.folder ?? payload.folder, folder: payload.folder }).pipe(
      Effect.mapError(() => refused()),
    );
    const folder = yield* folderForSpawn(grant, "start").pipe(Effect.mapError(() => refused()));
    const agentId = Schema.decodeUnknownSync(AgentId)(randomUUID());
    const deliveryId = Schema.decodeUnknownSync(DeliveryId)(randomUUID());
    const token = mintAgentToken();
    const event: Event = {
      _tag: "AgentStarted", agentId, name: payload.name, role: payload.role, groups: payload.groups ?? [],
      parent: actor, harness: harness.id, account: account.id, permission: payload.permission,
      folder, runMode: payload.runMode ?? harness.runMode,
      ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }),
      ...(payload.prompt === undefined ? {} : {
        firstPromptDelivery: {
          id: deliveryId, target: agentId, sender: senderOf(actor),
          content: { _tag: "prompt" as const, text: agentText(senderOf(actor), deliveryId, payload.prompt) },
        },
      }),
    };
    // The new agent's send lane is held through the runner call (lanes.ts).
    // Issue 78: the failure carries the wait checks it causes.
    return {
      events: [event], sideRows: { agentTokens: [{ agentId, tokenHash: token.tokenHash, revokedAt: null }] },
      // Fix round 1, A3: the start registers a cancel signal before it asks
      // for the lane, so a `stop` can pre-empt a setup that is still running
      // (lanes.ts), and the setup is bounded by the same two minutes as a
      // resume. A timeout stops the process and fails like a rejection below.
      afterCommit: withPreemption(runtime.log, agentId)((handle) => Effect.gen(function* () {
        // Writes the end of a start that did not open a session. The runner's
        // reason never reaches the log.
        const failStart = runtime.log.transact((append) => Effect.gen(function* () {
          const snapshot = yield* runtime.views.snapshot;
          yield* append(actor, freshRequest(), randomUUID(), withWaitChecks(snapshot, [
            { _tag: "AgentStartFailed", agentId, reason: "agent start failed" },
          ], runtime.lists), { revokeAgentTokens: [agentId] });
        })).pipe(Effect.catchTag("RequestIdReused", () => Effect.void));
        const cancelled = yield* Effect.gen(function* () {
          // The new id becomes visible at commit, before this lane is acquired.
          // A stop that wins the lane must prevent the later process spawn.
          // Fix round 1, A2: a sign-out pauses a starting agent too; it still
          // opens its session, which the pause then keeps.
          const waiting = (yield* runtime.views.snapshot).agents[agentId]?.state._tag;
          if (waiting !== "starting" && waiting !== "paused") return false;
          return yield* handle.cancellable(bounded(runtime, agentId, SETUP_TIMEOUT_MILLIS, Effect.suspend(() => runtime.runner.start({
            agentId, token: token.token, folder, grant, harness, account,
            permission: payload.permission, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }),
          })))).pipe(
            Effect.flatMap(Option.match({ onNone: () => Effect.succeed(true), onSome: (session) => runtime.log.transact((append) => Effect.gen(function* () {
              // An exit can arrive while the session result is being returned.
              const before = (yield* runtime.views.snapshot).agents[agentId]?.state._tag;
              if (before !== "starting" && before !== "paused") return false;
              // Fix round 1, A2: an account that signed out while this session
              // was opened keeps the agent paused, in the same append, so no
              // work reaches it; the owner's "account available" brings it back.
              // An agent paused while starting whose account has since come back
              // goes idle here, as it has a session now.
              const snapshot = yield* runtime.views.snapshot;
              const signedOut = snapshot.accounts[account.id]?.status === "needs-sign-in";
              const lifecycle: ReadonlyArray<Event> = signedOut
                ? [{ _tag: "StateChanged", agentId, state: { _tag: "paused", reason: "signed-out", midTurn: false } }]
                : before === "paused" ? [{ _tag: "StateChanged", agentId, state: { _tag: "idle" } }] : [];
              const opened: ReadonlyArray<Event> = [{ _tag: "SessionOpened", agentId, session: session.session,
                protocolVersion: session.protocolVersion, reloadable: session.reloadable }, ...lifecycle];
              yield* append(actor, freshRequest(), randomUUID(), lifecycle.length > 0 ? withWaitChecks(snapshot, opened, runtime.lists) : opened, {});
              return false;
            })).pipe(Effect.catchTag("RequestIdReused", () => Effect.succeed(false))) })),
            Effect.catchTag("RunnerRejected", () => failStart.pipe(Effect.as(false))),
          );
        }).pipe(withLane(runtime.log, agentId));
        if (!cancelled) return;
        // Round 2, F-1: a stop cancelled the setup. The stop writes the
        // agent's end only if it commits. Once it has ended, any way it ended,
        // an agent still starting gets the failure from this start.
        yield* handle.settled(SETUP_TIMEOUT_MILLIS);
        const after = (yield* runtime.views.snapshot).agents[agentId]?.state._tag;
        if (after !== "starting" && after !== "paused") return;
        yield* Effect.suspend(() => runtime.runner.stop({ agentId })).pipe(Effect.catchTag("RunnerRejected", () => Effect.void));
        yield* failStart;
      })),
    };
  });
