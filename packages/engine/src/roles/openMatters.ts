import type { Snapshot } from "../commands/internal.ts";
import type { PieceAlertSourceRequest, AlertSourceResult } from "../client/alerts/reactor.ts";
import { rolesAlertSources } from "@shephrd/contracts";
import type { EventEnvelope } from "@shephrd/contracts";
import type { RolesView } from "./view.ts";

// The reducer keeps this index, so the first-start scan needs no log search.
// Roles alerts deliberately have no subject; the client opens the agent thread.
export const openMatters = (views: Snapshot): ReadonlyArray<PieceAlertSourceRequest> =>
  Object.values((views.roles as RolesView).agents).flatMap((agent) => agent.matters);
export const alertSource = (envelope: EventEnvelope): AlertSourceResult => rolesAlertSources.flatMap((source) => {
  const action = source(envelope);
  if (action === undefined) return [];
  const { action: tag, ...identity } = action;
  return [{ ...identity, _tag: tag }];
});
