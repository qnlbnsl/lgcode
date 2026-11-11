import { alertTitles } from "@lgcode/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { Snapshot } from "../../commands/internal.ts";
import type { AlertSender, AlertPayload, AlertDestination } from "./AlertSender.ts";
import { clientView, type AlertRow, type ClientView } from "./view.ts";

const clean = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "");
const cut = (value: string, maximum: number): string => {
  let result = "";
  for (const character of value) { if (result.length + character.length > maximum) break; result += character; }
  return result;
};
const threadLink = (row: AlertRow, web: ClientView["webSettings"]): string | undefined => {
  if (!web.proxyMode || web.publicAddress === undefined || row.agentId === undefined) return undefined;
  try {
    const url = new URL(web.publicAddress);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return undefined;
    // Navigate to the static entry document. The page reads its thread
    // route from the hash, which stays in the browser during navigation.
    return `${url.origin}/#/thread/${encodeURIComponent(row.agentId)}`;
  } catch { return undefined; }
};
export const alertPayload = (row: AlertRow, snapshot: Snapshot): AlertPayload => {
  const agent = row.agentId === undefined ? undefined : snapshot.agents[row.agentId];
  const web = clientView(snapshot.client).webSettings;
  const labels = (agent?.groups ?? []).slice(0, 8).map(clean);
  const team: string[] = []; let remaining = 128;
  for (const label of labels) {
    const budget = remaining - (team.length === 0 ? 0 : 2);
    if (budget <= 0) break;
    const text = cut(label, budget);
    remaining -= text.length + (team.length === 0 ? 0 : 2); team.push(text);
  }
  const link = threadLink(row, web);
  return { alertId: row.alertId, kind: row.kind, title: alertTitles[row.kind], team,
    ...(agent === undefined ? {} : { agentName: cut(clean(agent.name), 64) }),
    ...(link === undefined ? {} : { link }),
  };
};

// Only fixed service-owned reasons escape this boundary. An absent token
// counts as a failed attempt, even for a server that permits anonymous posts.
export const sendNotification = (sender: AlertSender["Service"], payload: AlertPayload, destination: AlertDestination) =>
  Effect.gen(function* () {
    if (destination.carrier._tag === "none") return yield* Effect.fail("service missing" as const);
    if (destination.token === undefined) return yield* Effect.fail("token missing" as const);
    yield* sender.send(payload, destination);
  }).pipe(Effect.timeout(10_000), Effect.catchCause((cause) => Cause.hasInterrupts(cause) ? Effect.interrupt
    : Effect.fail(cause.reasons.some((reason) => reason._tag === "Fail" && reason.error === "service missing")
      ? "service missing" as const : cause.reasons.some((reason) => reason._tag === "Fail" && reason.error === "token missing")
      ? "token missing" as const : "carrier delivery failed" as const)));
