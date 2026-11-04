import { randomUUID } from "node:crypto";
import {
  AlertSourceRequest, alertTitles, pieceNamespaces, type AlertId, type Event,
  type EventEnvelope, type EventSequence, type PieceNamespace,
} from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { Snapshot } from "../../commands/internal.ts";
import { writePieceBatch } from "../../commands/pieceBatch.ts";
import { subscribe } from "../../log/subscribe.ts";
import { guardPiece } from "../../pieces/guardPiece.ts";
import type { EngineLists } from "../../pieces/lists.ts";
import { Views } from "../../views/Views.ts";
import { engineOpenMatters, engineSource, openQuestions, subjectClosed } from "./sources.ts";
import { clientView, type AlertRow } from "./view.ts";

export type AlertSourceResult = (AlertSourceRequest & { readonly _tag: "raise" })
  | { readonly _tag: "end"; readonly key: string } | undefined;

const decodeSource = Schema.decodeUnknownSync(AlertSourceRequest);
const ownedKind = (namespace: PieceNamespace, source: AlertSourceRequest): boolean => source.kind.startsWith(`${namespace}.`);
const raises = (sources: ReadonlyArray<AlertSourceRequest>, snapshot: Snapshot, sequence: number, baseline = false): Event[] => {
  const keys = new Set(Object.values(clientView(snapshot.client).alerts).filter((row) => row.status === "open").map((row) => row.alertKey));
  const events: Event[] = [];
  for (const source of sources) {
    if (keys.has(source.key) || subjectClosed(source, snapshot)) continue;
    keys.add(source.key);
    // Copy only the contract's identity fields. A source cannot supply prose
    // or a title, even when a JavaScript caller returns extra properties.
    events.push({ _tag: "client.AlertRaised", alertId: randomUUID() as AlertId, alertKey: source.key,
      kind: source.kind, title: alertTitles[source.kind], sourceSequence: sequence as EventSequence,
      ...(source.agentId === undefined ? {} : { agentId: source.agentId }),
      ...(source.subject === undefined ? {} : { subject: source.subject }),
      ...(baseline ? { baseline: true } : {}),
    });
  }
  return events;
};

const resumed = (envelope: EventEnvelope, snapshot: Snapshot): string | undefined => {
  const event = envelope.event;
  if (event._tag !== "StateChanged" || event.state._tag === "stopped" || event.state._tag === "crashed") return undefined;
  const previous = snapshot.threads[event.agentId]?.findLast((row) => row.sequence < envelope.sequence
    && (row.event._tag === "StateChanged" || row.event._tag === "AgentStopped" || row.event._tag === "AgentCrashed"));
  if (previous?.event._tag === "AgentStopped" || previous?.event._tag === "AgentCrashed"
    || (previous?.event._tag === "StateChanged" && (previous.event.state._tag === "stopped" || previous.event.state._tag === "crashed"))) return event.agentId;
  return undefined;
};

const touchesSubject = (row: AlertRow, event: Event): boolean => {
  if (row.kind === "client.web-down") return event._tag === "client.WebServerUp" || event._tag === "client.WebSettingsChanged";
  const subject = row.subject;
  if (subject?._tag === "account") return "accountId" in event && event.accountId === subject.id;
  if (subject?._tag === "permission" && "permissionRequestId" in event && event.permissionRequestId === subject.id) return true;
  if (subject?._tag === "question" && "questionId" in event && event.questionId === subject.id) return true;
  // An alert event also has an agentId, but cannot change that agent's life.
  return "agentId" in event && event.agentId === row.agentId && [
    "AgentStopped", "AgentCrashed", "AgentStartFailed", "StateChanged", "SessionOpened", "TurnEnded", "DeliverySent",
  ].includes(event._tag);
};

const react = (envelope: EventEnvelope, snapshot: Snapshot, lists: EngineLists): ReadonlyArray<Event> => {
  const view = clientView(snapshot.client);
  if (envelope.sequence <= (view.position ?? 0)) return [];
  const sources: AlertSourceRequest[] = [];
  const ends = new Map<PieceNamespace, string>();
  const engine = engineSource(envelope, snapshot);
  if (engine !== undefined) sources.push(engine);
  for (const namespace of pieceNamespaces) {
    const source = lists.alertSources?.[namespace];
    if (source === undefined) continue;
    const result = guardPiece("alertSources", namespace, (): AlertSourceResult => {
      const result = source(envelope);
      return result?._tag === "raise" ? { ...decodeSource(result), _tag: "raise" } : result;
    }, undefined);
    if (result?._tag === "raise" && ownedKind(namespace, result)) sources.push(result);
    else if (result?._tag === "end") ends.set(namespace, result.key);
  }
  const agentId = resumed(envelope, snapshot);
  if (agentId !== undefined) sources.push(...openQuestions(snapshot, agentId));
  const clears: Event[] = [];
  for (const row of Object.values(view.alerts)) {
    if (row.status !== "open") continue;
    const source = { ...row, key: row.alertKey };
    // The snapshot can be ahead of this follower. An older state event
    // cannot close a later alert. A piece's explicit end instead follows
    // its source order, including when raise and end were both in catch-up.
    const ended = row.sourceSequence < envelope.sequence
      && [...ends].some(([namespace, key]) => key === row.alertKey && ownedKind(namespace, source));
    if (ended || (row.sequence < envelope.sequence && touchesSubject(row, envelope.event) && subjectClosed(source, snapshot))) clears.push({
      _tag: "client.AlertCleared", alertId: row.alertId, cause: "subject closed", sourceSequence: envelope.sequence,
    });
  }
  return [...clears, ...raises(sources, snapshot, envelope.sequence)];
};

// Startup can await this same idempotent initialization before returning a
// listener. The writer permit serializes it with the background follower.
export const initializeAlerts = Effect.gen(function* () {
  const views = yield* Views;
  const lists = views.lists!;
  yield* writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 0, build: (snapshot) => {
    if (clientView(snapshot.client).position !== undefined) return { events: [] };
    const sources = [...engineOpenMatters(snapshot)];
    for (const namespace of pieceNamespaces) {
      const scan = lists.openMatters?.[namespace];
      if (scan === undefined) continue;
      const matters = guardPiece("openMatters", namespace, () => scan(snapshot).map((source) => decodeSource(source)), []);
      sources.push(...matters.filter((source) => ownedKind(namespace, source)));
    }
    return { events: [{ _tag: "client.AlertBaseline", position: snapshot.sequence }, ...raises(sources, snapshot, snapshot.sequence, true)] };
  } }, lists);
});

// The service runs this under its recovery gate and restarts defects from
// the view's durable source position. LogWriteFailed stops the follower.
export const alertReactor = Effect.gen(function* () {
  const views = yield* Views;
  const lists = views.lists!;
  yield* initializeAlerts;
  const position = clientView((yield* views.snapshot).client).position!;
  yield* subscribe(position).pipe(Stream.runForEach((envelope) => writePieceBatch({
    namespace: "client", kind: "reactor", sourceSequence: envelope.sequence,
    build: (snapshot) => ({ events: react(envelope, snapshot, lists) }),
  }, lists)));
});
