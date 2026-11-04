import * as Effect from "effect/Effect";
import type { Snapshot } from "../../commands/internal.ts";
import { executeService } from "../../commands/services.ts";
import type { EngineLists } from "../../pieces/lists.ts";
import type { RolesView } from "../view.ts";
import { sheepdogCaller } from "./notices.ts";
import { actionRequestId } from "./requests.ts";
import { resolveSettings, roleSettings } from "./settings.ts";

export const sheepdogEnabled = (snapshot: Snapshot): boolean => (snapshot.roles as RolesView).settings.sheepdog !== false;
// No harness qualifies for standing rules in this build. The matcher and
// pre-check stay absent even when the owner leaves this switch on.
export const standingRulesEnabled = (snapshot: Snapshot): boolean => (snapshot.roles as RolesView).settings.standingRules !== false;
export const withinCapacityLimit = (snapshot: Snapshot, agentId: string, holds: number): boolean => {
  if (!sheepdogEnabled(snapshot) || !Object.hasOwn(snapshot.agents, agentId)) return false;
  const roles = snapshot.roles as RolesView;
  const agent = snapshot.agents[agentId]!;
  return holds < resolveSettings(roles.settings, roleSettings(roles.file, agent.role)).capacityRetries;
};

export const releaseHolds = (snapshot: Snapshot, lists: EngineLists) => Effect.gen(function* () {
  for (const agent of Object.values(snapshot.agents)) {
    if (!agent.capacityHeld) continue;
    const held = snapshot.threads[agent.agentId]?.findLast((row) => row.event._tag === "DeliveryHeld");
    if (held === undefined) continue;
    yield* executeService(sheepdogCaller, "release", {
      requestId: actionRequestId({ rule: "switch-off", subject: agent.agentId, triggerSequence: held.sequence,
        kind: "release", recipient: agent.agentId, occurrence: 1 }), agentId: agent.agentId,
    }, lists).pipe(Effect.catchTag("CommandRefused", () => Effect.void));
  }
});
