import type { Event } from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { mintAgentToken } from "../identity/tokens.ts";
import { EventLog } from "../log/EventLog.ts";
import { reload, SETUP_TIMEOUT_MILLIS, spawnInput } from "../recovery/reload.ts";
import { dispatchQueued } from "../routing/deliveries.ts";
import { Runner } from "../runner/Runner.ts";
import { Views } from "../views/Views.ts";
import { refused, type Agent, type Input, type Payload, type Plan } from "./internal.ts";

// Rows 52 and 66. `resume` reloads the agent's session and then runs
// recovery's step 10 for this one agent: a delivery sent but not accepted is
// sent again, or a carry-on goes to an agent that was mid-turn. An agent
// that cannot reload is refused with "cannot reload". `resume --fresh`
// opens a new session and sends again every delivery accepted since the
// last turn end, and each one sent but never accepted, with no carry-on.
export const resume = ({ runtime, snapshot, actor }: Input, agent: Agent, payload: Payload<"resume">) =>
  Effect.gen(function* () {
    const fresh = payload.fresh === true;
    const reloads = runtime.runner.capabilities.loadSession || runtime.runner.capabilities.resumeSession;
    if (!fresh && (agent.reloadable !== true || agent.session === undefined || !reloads)) return yield* refused("cannot reload");
    const token = mintAgentToken();
    const spawn = yield* spawnInput(runtime, snapshot, agent, token.token, "resume");
    const events: Array<Event> = [{ _tag: "StateChanged", agentId: agent.agentId, state: { _tag: "starting" } }];
    if (fresh) {
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
    // A failed reload keeps what the interruption recorded, so a later
    // resume still knows the agent was mid-turn.
    const previous = agent.state._tag === "interrupted" ? agent.state.previous : "starting";
    return {
      events, sideRows: { revokeAgentTokens: [agent.agentId], agentTokens: [{ agentId: agent.agentId, tokenHash: token.tokenHash, revokedAt: null }] },
      // Issue 78: the failure carries the wait checks it causes. The
      // target's send lane is held by CommandHandler around this command.
      afterCommit: Effect.gen(function* () {
        const opened = yield* reload({
          runtime, actor, agent, spawn, token, mode: fresh ? "start" : "load",
          midTurn: !fresh && agent.state._tag === "interrupted" && agent.state.previous === "working",
          timeoutMillis: SETUP_TIMEOUT_MILLIS, storeToken: false,
          still: (current) => current?.state._tag === "starting",
          failed: () => [
            { _tag: "StateChanged", agentId: agent.agentId, state: { _tag: "interrupted", previous } },
            { _tag: "AgentReloadFailed", agentId: agent.agentId, reason: "agent reload failed" },
          ],
        });
        if (opened) yield* dispatchQueued(agent.agentId, { recovered: true, laneHeld: true }).pipe(Effect.catchTag("RequestIdReused", () => Effect.void));
      }).pipe(
        Effect.provideService(EventLog, runtime.log), Effect.provideService(Views, runtime.views),
        Effect.provideService(Runner, runtime.runner), Effect.provideService(SqlClient.SqlClient, runtime.sql),
      ),
    } satisfies Plan;
  });
