import { randomUUID } from "node:crypto";
import { AgentId, DeliveryId, PermissionLevel, type Event } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { pickAccount } from "../accounts/pick.ts";
import { canUseMode, checkFolder, folderForSpawn } from "../identity/ceiling.ts";
import { mintAgentToken } from "../identity/tokens.ts";
import type { LogWriteFailed } from "../log/EventLog.ts";
import { agentText } from "../routing/envelope.ts";
import { withLane } from "../routing/lanes.ts";
import { withWaitChecks } from "../routing/waits.ts";
import { freshRequest, readHarnesses, refused, type Input, type Payload, type Plan } from "./internal.ts";

export const start = (input: Input, payload: Payload<"start">): Effect.Effect<Plan, ReturnType<typeof refused> | LogWriteFailed> =>
  Effect.gen(function* () {
    const { runtime, actor, snapshot } = input;
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
          id: deliveryId, target: agentId, sender: actor,
          content: { _tag: "prompt" as const, text: agentText(actor, deliveryId, payload.prompt) },
        },
      }),
    };
    // The new agent's send lane is held through the runner call (lanes.ts).
    // Issue 78: the failure carries the wait checks it causes.
    return {
      events: [event], sideRows: { agentTokens: [{ agentId, tokenHash: token.tokenHash, revokedAt: null }] },
      afterCommit: Effect.gen(function* () {
        // The new id becomes visible at commit, before this lane is acquired.
        // A stop that wins the lane must prevent the later process spawn.
        if ((yield* runtime.views.snapshot).agents[agentId]?.state._tag !== "starting") return;
        yield* Effect.suspend(() => runtime.runner.start({ agentId, token: token.token, folder, grant, harness, account,
          permission: payload.permission, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }),
        })).pipe(
          Effect.flatMap((session) => runtime.log.transact((append) => Effect.gen(function* () {
            // An exit can arrive while the session result is being returned.
            if ((yield* runtime.views.snapshot).agents[agentId]?.state._tag !== "starting") return;
            // Fix round 1, A2: an account that signed out while this session
            // was opening pauses the agent in the same append, so no work
            // reaches it; the owner's "account available" brings it back.
            const snapshot = yield* runtime.views.snapshot;
            const signedOut = snapshot.accounts[account.id]?.status === "needs-sign-in";
            const opened: ReadonlyArray<Event> = [
              { _tag: "SessionOpened", agentId, ...session },
              ...(signedOut ? [{ _tag: "StateChanged" as const, agentId, state: { _tag: "paused" as const, reason: "signed-out" as const, midTurn: false } }] : []),
            ];
            yield* append(actor, freshRequest(), randomUUID(), signedOut ? withWaitChecks(snapshot, opened) : opened, {});
          })).pipe(Effect.catchTag("RequestIdReused", () => Effect.void))),
          Effect.catchTag("RunnerRejected", () => runtime.log.transact((append) => Effect.gen(function* () {
            const snapshot = yield* runtime.views.snapshot;
            yield* append(actor, freshRequest(), randomUUID(), withWaitChecks(snapshot, [
              { _tag: "AgentStartFailed", agentId, reason: "agent start failed" },
            ]), { revokeAgentTokens: [agentId] });
          })).pipe(Effect.catchTag("RequestIdReused", () => Effect.void))),
        );
      }).pipe(withLane(runtime.log, agentId)),
    };
  });
