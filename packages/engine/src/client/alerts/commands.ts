import { alertKindNames, type AlertKind } from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import { refused, type Input, type PiecePlan } from "../../commands/internal.ts";
import type { ReadHandler } from "../../api/reads.ts";
import { clientView } from "./view.ts";

const settings = ({ snapshot, actor }: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
  if (actor._tag !== "owner") return yield* refused();
  const view = clientView(snapshot.client);
  return { reply: { requestId: payload.requestId, kinds: alertKindNames.map((kind) => ({ kind, push: view.push[kind] })),
    carrier: view.carrier, tokenSet: view.tokenSet } };
});
const list = ({ runtime, snapshot, actor }: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
  if (actor._tag !== "owner") return yield* refused();
  const view = clientView(snapshot.client);
  const rows = Object.values(view.alerts).filter((row) => row.sequence > (payload.after as number)
    && (payload.status === undefined || row.status === payload.status)).sort((a, b) => a.sequence - b.sequence);
  const items = [];
  let bytes = 2;
  let next: number | undefined;
  let lastSequence = 0;
  for (const row of rows) {
    if (items.length >= (payload.limit as number)) { next = lastSequence; break; }
    // Reducers use only events and sequences. Timestamps come from the log,
    // so both the live projection and its rebuild remain deterministic.
    const times = yield* runtime.sql<{ sequence: number; occurred_at: number }>`
      SELECT sequence, occurred_at FROM events WHERE sequence = ${row.sequence} OR sequence = ${row.clearedSequence ?? -1}`;
    const mark = view.delivery[row.alertId];
    const delivery = mark?.generation !== view.generation ? undefined : {
      generation: mark.generation, attempt: mark.attempt,
      ...(mark.status === "failed" ? { status: mark.status, reason: mark.reason, final: mark.final } : { status: mark.status }),
    };
    const item = { alertId: row.alertId, alertKey: row.alertKey, kind: row.kind, title: row.title,
      sourceSequence: row.sourceSequence, status: row.status,
      ...(delivery === undefined ? {} : { delivery }),
      raisedAt: times.find((time) => time.sequence === row.sequence)!.occurred_at,
      ...(row.agentId === undefined ? {} : { agentId: row.agentId }),
      ...(row.subject === undefined ? {} : { subject: row.subject }),
      ...(row.baseline === undefined ? {} : { baseline: row.baseline }),
      ...(row.clearedSequence === undefined ? {} : { clearedAt: times.find((time) => time.sequence === row.clearedSequence)!.occurred_at }),
    };
    const size = Buffer.byteLength(JSON.stringify(item)) + (items.length > 0 ? 1 : 0);
    if (items.length > 0 && bytes + size > 900 * 1024) { next = lastSequence; break; }
    items.push(item);
    bytes += size;
    lastSequence = row.sequence;
  }
  return { reply: { requestId: payload.requestId, items, ...(next === undefined ? {} : { next }) } };
}).pipe(Effect.catchTag("SqlError", () => Effect.fail(refused("database read failed"))));

export const alertReads = { "client.alerts.list": list, "client.alerts.settings": settings } satisfies Record<string, ReadHandler>;
export const alertPlanners = {
  "client.alerts.dismiss": ({ snapshot, actor }: Input, payload: Record<string, unknown>): Effect.Effect<PiecePlan, ReturnType<typeof refused>> => {
    if (actor._tag !== "owner") return Effect.fail(refused());
    const alerts = clientView(snapshot.client).alerts;
    const row = Object.hasOwn(alerts, payload.alertId as string) ? alerts[payload.alertId as string] : undefined;
    if (row === undefined) return Effect.fail(refused("alert not found"));
    return Effect.succeed({ events: row.status === "open" ? [{ _tag: "client.AlertCleared", alertId: row.alertId, cause: "dismissed" }] : [],
      reply: () => ({ requestId: payload.requestId }) });
  },
  "client.alerts.settings.set": ({ actor }: Input, payload: Record<string, unknown>): Effect.Effect<PiecePlan, ReturnType<typeof refused>> =>
    actor._tag !== "owner" ? Effect.fail(refused()) : Effect.succeed({
      events: [{ _tag: "client.AlertSettingsChanged", kind: payload.kind as AlertKind, push: payload.push as boolean }],
      reply: () => ({ requestId: payload.requestId }),
    }),

};
