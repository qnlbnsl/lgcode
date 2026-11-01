import { randomUUID } from "node:crypto";
import { PermissionLevel, type Event } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { checkFolder, folderForSpawn } from "../identity/ceiling.ts";
import { mintAgentToken } from "../identity/tokens.ts";
import { withWaitChecks } from "../routing/waits.ts";
import { freshRequest, readHarnesses, refused, type Agent, type Input, type Payload, type Plan } from "./internal.ts";

export const resume = ({ runtime, snapshot, actor }: Input, agent: Agent, payload: Payload<"resume">) =>
  Effect.gen(function* () {
    if (!payload.fresh && (!agent.reloadable || agent.session === undefined)) return yield* refused("cannot reload");
    const parent = agent.parent._tag === "agent" ? snapshot.agents[agent.parent.agentId] : undefined;
    if (agent.parent._tag === "agent" && parent === undefined) return yield* refused();
    const grant = yield* checkFolder({ ...runtime, caller: agent.parent,
      parentFolder: parent?.folder ?? agent.folder, folder: agent.folder,
    }).pipe(Effect.mapError(() => refused()));
    if (grant.realPath !== agent.folder) return yield* refused();
    const folder = yield* folderForSpawn(grant, "resume").pipe(Effect.mapError(() => refused()));
    const harness = (yield* readHarnesses(runtime)).find((settings) => settings.id === agent.harness);
    const account = snapshot.accounts[agent.account];
    if (harness === undefined || account === undefined) return yield* refused();
    const events: Array<Event> = [{ _tag: "StateChanged", agentId: agent.agentId, state: { _tag: "starting" } }];
    if (payload.fresh) {
      const thread = snapshot.threads[agent.agentId] ?? [];
      const turnEnd = thread.findLast((row) => row.event._tag === "TurnEnded")?.sequence ?? 0;
      const accepted = new Set(thread.flatMap((row) => row.sequence > turnEnd && row.event._tag === "DeliveryAccepted"
        ? [row.event.deliveryId] : []));
      for (const deliveryId of accepted) {
        if (snapshot.deliveries[deliveryId]?.status === "accepted") events.push({
          _tag: "DeliveryRequeued", agentId: agent.agentId, deliveryId, reason: "fresh session",
        });
      }
    }
    const token = mintAgentToken();
    const spawn = { agentId: agent.agentId, token: token.token, folder, grant, harness, account,
      permission: Schema.decodeUnknownSync(PermissionLevel)(agent.permission),
      ...(agent.model === undefined ? {} : { model: agent.model }), ...(agent.effort === undefined ? {} : { effort: agent.effort }),
    };
    return {
      events, sideRows: { revokeAgentTokens: [agent.agentId], agentTokens: [{ agentId: agent.agentId, tokenHash: token.tokenHash, revokedAt: null }] },
      afterCommit: Effect.suspend(() => payload.fresh ? runtime.runner.start(spawn) : runtime.runner.load({ ...spawn, session: agent.session! })).pipe(
        Effect.flatMap((session) => runtime.log.transact((append) => Effect.gen(function* () {
          if ((yield* runtime.views.snapshot).agents[agent.agentId]?.state._tag !== "starting") return;
          yield* append(actor, freshRequest(), randomUUID(), [
            { _tag: "SessionOpened", agentId: agent.agentId, ...session },
          ], {});
        })).pipe(Effect.catchTag("RequestIdReused", () => Effect.void))),
        // Issue 78: the failure carries the wait checks it causes. The
        // target's send lane is held by CommandHandler around this command.
        Effect.catchTag("RunnerRejected", () => runtime.log.transact((append) => Effect.gen(function* () {
          const snapshot = yield* runtime.views.snapshot;
          yield* append(actor, freshRequest(), randomUUID(), withWaitChecks(snapshot, [
            { _tag: "StateChanged", agentId: agent.agentId, state: { _tag: "interrupted", previous: "starting" } },
            { _tag: "AgentReloadFailed", agentId: agent.agentId, reason: "agent reload failed" },
          ]), { revokeAgentTokens: [agent.agentId] });
        })).pipe(Effect.catchTag("RequestIdReused", () => Effect.void))),
      ),
    } satisfies Plan;
  });
