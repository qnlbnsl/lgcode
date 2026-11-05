import { rolesMaxima, type RolesActionRecord } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import { encodedBytes } from "../client/reads/display.ts";
import { refused, type Input } from "../commands/internal.ts";
import type { RolesView } from "./view.ts";

export const listActions = (input: Input, payload: Record<string, unknown>) => {
  if (input.actor._tag !== "owner") return Effect.fail(refused());
  const records = (input.snapshot.roles as RolesView).actions.filter((row) =>
    (payload.agentId === undefined || row.agentId === payload.agentId)
    && (payload.after === undefined || row.sequence < (payload.after as number))).toReversed();
  const limit = Math.min((payload.limit as number | undefined) ?? rolesMaxima.actionPageItems, rolesMaxima.actionPageItems);
  const items: RolesActionRecord[] = [];
  for (const record of records) {
    if (items.length === limit) break;
    const candidate = [...items, record];
    // Like every paged read, keep an oversized first item whole so its
    // exclusive continuation still reaches the rest of the history.
    if (items.length > 0 && encodedBytes({ requestId: payload.requestId, items: candidate, next: record.sequence }) > rolesMaxima.actionPageBytes) {
      break;
    }
    items.push(record);
  }
  return Effect.succeed({ reply: { requestId: payload.requestId, items,
    ...(items.length < records.length ? { next: items.at(-1)!.sequence } : {}) } });
};
