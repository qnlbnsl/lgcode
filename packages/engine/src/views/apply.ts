import {
  EventSequence as EventSequenceSchema, eventEffect,
  type Account, type Actor, type Caller, type PermissionAction, type AgentId, type Delivery, type Event, type EventEnvelope, type EventSequence, type LifecycleState,
  pieceNamespaces, EngineEvent, type PieceNamespace, type PermissionOption, type SessionReference, type WaitMember,
} from "@shephrd/contracts";
import * as Schema from "effect/Schema";
import { guardPiece } from "../pieces/guardPiece.ts";
import { pieceViews, type PieceView } from "../pieces/viewTables.ts";

// The engine views. Every record keeps the plain data the log holds, so a
// client can read it without the log. Nothing here is a second source of
// truth: the log is, and `rebuild` folds it from sequence 1.
interface AgentRow {
  readonly agentId: AgentId;
  readonly name: string;
  readonly role: string;
  readonly groups: ReadonlyArray<string>;
  readonly parent: Actor;
  readonly harness: string;
  readonly account: string;
  readonly model?: string;
  readonly effort?: string;
  readonly permission: string;
  readonly mode?: string;
  readonly folder: string;
  readonly runMode: string;
  readonly state: LifecycleState;
  readonly session?: SessionReference;
  readonly protocolVersion?: number;
  readonly reloadable?: boolean;
  // Fix round 1, F8 and row 67: true from the sending of a compact delivery
  // until that turn ends or the agent stops working.
  readonly compacting: boolean;
}

interface RequestRow {
  readonly action?: PermissionAction;
  readonly permissionRequestId: string;
  readonly agentId: AgentId;
  readonly status: "open" | "answered" | "cancelled";
  readonly holder: Actor;
  readonly deliveryId: string;
  readonly toolCallId: string;
  readonly description: string;
  readonly options: ReadonlyArray<PermissionOption>;
  readonly settingsWrite: boolean;
  readonly answer?: { readonly _tag: "selected"; readonly optionId: string } | { readonly _tag: "cancelled" };
  readonly answeredBy?: Caller;
  readonly reason?: string;
}

interface QuestionRow {
  readonly questionId: string;
  readonly agentId: AgentId;
  readonly status: "open" | "answered";
  readonly holder: Actor;
  readonly deliveryId: string;
  readonly text: string;
  readonly answer?: string;
  readonly answeredBy?: Actor;
  readonly answerDeliveryId?: string;
}

interface WaitRow {
  readonly waitId: string;
  readonly agentId: AgentId;
  readonly members: ReadonlyArray<AgentId>;
  readonly mode: "any" | "all";
  readonly blocking: boolean;
  // Rows 25 and 50: the sequence of the event that opened the wait.
  readonly since: EventSequence;
  readonly status: "open" | "satisfied" | "cancelled";
  readonly resolved: ReadonlyArray<WaitMember>;
  readonly reason?: string;
}

type DeliveryRow = Delivery & {
  readonly status: "queued" | "sent" | "accepted" | "returned" | "withdrawn";
  readonly method?: string;
  readonly reason?: string;
};

type AccountRow = Account & {
  readonly status: "available" | "out-of-usage" | "needs-sign-in";
  readonly resetAt?: number;
  readonly reason?: string;
};

export interface State {
  readonly client: unknown;
  readonly board: unknown;
  readonly roles: unknown;
  readonly sequence: EventSequence;
  readonly agents: Readonly<Record<string, AgentRow>>;
  readonly threads: Readonly<Record<string, ReadonlyArray<EventEnvelope>>>;
  readonly requests: Readonly<Record<string, RequestRow>>;
  readonly questions: Readonly<Record<string, QuestionRow>>;
  readonly waits: Readonly<Record<string, WaitRow>>;
  readonly deliveries: Readonly<Record<string, DeliveryRow>>;
  readonly accounts: Readonly<Record<string, AccountRow>>;
}

const zero = Schema.decodeUnknownSync(EventSequenceSchema)(0);

// Identities are any nonempty string, so `constructor`, `toString` and
// `__proto__` are valid keys. Every keyed view is therefore a record without
// a prototype: a key is present only when this reducer wrote it, and writing
// `__proto__` makes an ordinary own property instead of changing a prototype.
type Keyed<T> = Readonly<Record<string, T>>;

const keyed = <T>(): Keyed<T> => Object.create(null) as Keyed<T>;

export const emptyViews = (views: Readonly<Record<PieceNamespace, PieceView>> = pieceViews): State => ({
  client: guardPiece("views", "client", () => views.client.empty(), undefined),
  board: guardPiece("views", "board", () => views.board.empty(), undefined),
  roles: guardPiece("views", "roles", () => views.roles.empty(), undefined),
  sequence: zero, agents: keyed(), threads: keyed(), requests: keyed(), questions: keyed(), waits: keyed(),
  deliveries: keyed(), accounts: keyed(),
});

// The agent whose thread an event belongs to. `DeliveryQueued` names its
// agent only inside the delivery, so the log's agent column misses it
// (issue 31). Account and harness events belong to no thread.
const engineTags = new Set(Object.keys(EngineEvent.pipe(Schema.toTaggedUnion("_tag")).cases));
export const threadAgent = (event: Event): AgentId | undefined =>
  !engineTags.has(event._tag) ? undefined : event._tag === "DeliveryQueued" ? event.delivery.target : "agentId" in event ? event.agentId : undefined;

const lookup = <T>(record: Keyed<T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const put = <T>(record: Keyed<T>, key: string, value: T): Keyed<T> => {
  const next = Object.assign(Object.create(null) as Record<string, T>, record);
  next[key] = value;
  return next;
};

const omit = <T>(record: Keyed<T>, key: string): Keyed<T> => {
  const next = Object.assign(Object.create(null) as Record<string, T>, record);
  delete next[key];
  return next;
};

// Update a record that exists. A stored history may name a record whose
// opening event is missing (issue 44); the projection stays total and
// leaves such an event out of that view, the same way live and on rebuild.
const change = <T>(record: Keyed<T>, key: string, update: (row: T) => T): Keyed<T> => {
  const row = lookup(record, key);
  return row === undefined ? record : put(record, key, update(row));
};

// The lifecycle follows the contracts' event table, so this reducer and the
// state machine cannot disagree. An event the table calls invalid in the
// current state changes nothing: the engine refuses such events before they
// are written, and a stored history is never rejected here.
const nextState = (current: LifecycleState, event: Event): LifecycleState => {
  const effect = eventEffect(current._tag, event._tag);
  switch (effect) {
    case "invalid":
    case "keep":
    case "paused": return current;
    case "transition": return event._tag === "StateChanged" ? event.state : current;
    case "interrupted": return event._tag === "AgentInterrupted"
      ? { _tag: "interrupted", previous: event.previous }
      : current;
    case "starting": return { _tag: "starting" };
    case "working": return { _tag: "working" };
    case "idle": return { _tag: "idle" };
    case "crashed": return { _tag: "crashed" };
    case "stopped": return { _tag: "stopped" };
  }
};

const withoutReason = (row: DeliveryRow): DeliveryRow => {
  const { reason: _reason, ...rest } = row;
  return rest;
};

const agentsAfter = (state: State, event: Event): State["agents"] => {
  switch (event._tag) {
    case "AgentStarted": return put(state.agents, event.agentId, {
      agentId: event.agentId, name: event.name, role: event.role, groups: event.groups, parent: event.parent,
      harness: event.harness, account: event.account,
      ...(event.model === undefined ? {} : { model: event.model }),
      ...(event.effort === undefined ? {} : { effort: event.effort }),
      permission: event.permission, folder: event.folder, runMode: event.runMode, state: { _tag: "starting" },
      compacting: false,
    });
    case "SessionOpened": return change(state.agents, event.agentId, (row) => ({
      ...row, state: nextState(row.state, event), session: event.session,
      protocolVersion: event.protocolVersion, reloadable: event.reloadable,
    }));
    case "AgentGrouped": return change(state.agents, event.agentId, (row) => ({ ...row, groups: event.groups }));
    case "ModeChanged": return change(state.agents, event.agentId, (row) => ({
      ...row, mode: event.mode, permission: event.level,
    }));
    case "DeliverySent": return change(state.agents, event.agentId, (row) => {
      const next = nextState(row.state, event);
      const compacting = next._tag === "working" && lookup(state.deliveries, event.deliveryId)?.content._tag === "compact";
      return next === row.state && compacting === row.compacting ? row : { ...row, state: next, compacting };
    });
    case "AgentStartFailed":
    case "TurnStarted":
    case "TurnEnded":
    case "StateChanged":
    case "AgentCrashed":
    case "AgentInterrupted":
    case "AgentReloadFailed":
    case "AgentStopped": return change(state.agents, event.agentId, (row) => {
      const next = nextState(row.state, event);
      const compacting = row.compacting && event._tag !== "TurnEnded" && next._tag === "working";
      return next === row.state && compacting === row.compacting ? row : { ...row, state: next, compacting };
    });
    default: return state.agents;
  }
};

const withoutAction = ({ action: _action, ...row }: RequestRow) => row;
export const permissionAction = (event: PermissionAction): PermissionAction => Object.fromEntries(
  ["toolKind", "toolInput", "locations", "inputRedacted", "inputTruncated"].flatMap((key) => {
    const value = event[key as keyof PermissionAction];
    return value === undefined ? [] : [[key, value]];
  }),
);
const requestsAfter = (state: State, event: Event): State["requests"] => {
  switch (event._tag) {
    case "PermissionRequested": return put(state.requests, event.permissionRequestId, {
      permissionRequestId: event.permissionRequestId, agentId: event.agentId, status: "open", holder: event.holder,
      deliveryId: event.deliveryId, toolCallId: event.toolCallId, description: event.description,
      options: event.options, settingsWrite: event.settingsWrite,
      ...(Object.keys(permissionAction(event)).length === 0 ? {} : { action: permissionAction(event) }),
    });
    case "PermissionMoved": return change(state.requests, event.permissionRequestId, (row) => ({
      ...row, holder: event.to, deliveryId: event.deliveryId,
    }));
    case "PermissionAnswered": return change(state.requests, event.permissionRequestId, (row) => ({
      ...withoutAction(row), status: "answered", answer: event.answer, answeredBy: event.answeredBy,
    }));
    case "PermissionCancelled": return change(state.requests, event.permissionRequestId, (row) => ({
      ...withoutAction(row), status: "cancelled", reason: event.reason,
    }));
    default: return state.requests;
  }
};

const questionsAfter = (state: State, event: Event): State["questions"] => {
  switch (event._tag) {
    case "QuestionAsked": return put(state.questions, event.questionId, {
      questionId: event.questionId, agentId: event.agentId, status: "open", holder: event.holder,
      deliveryId: event.deliveryId, text: event.text,
    });
    case "QuestionMoved": return change(state.questions, event.questionId, (row) => ({
      ...row, holder: event.to, deliveryId: event.deliveryId,
    }));
    case "QuestionAnswered": return change(state.questions, event.questionId, (row) => ({
      ...row, status: "answered", answer: event.text, answeredBy: event.answeredBy, answerDeliveryId: event.deliveryId,
    }));
    default: return state.questions;
  }
};

const wasResolved = (resolved: ReadonlyArray<WaitMember>, member: WaitMember): ReadonlyArray<WaitMember> =>
  [...resolved.filter((row) => row.agentId !== member.agentId), member];

const waitsAfter = (state: State, { sequence, event }: EventEnvelope): State["waits"] => {
  switch (event._tag) {
    case "WaitOpened": return put(state.waits, event.waitId, {
      waitId: event.waitId, agentId: event.agentId, members: event.members, mode: event.mode,
      blocking: event.blocking, since: sequence, status: "open", resolved: [],
    });
    case "WaitMemberResolved": return change(state.waits, event.waitId, (row) => ({
      ...row, resolved: wasResolved(row.resolved, event.member),
    }));
    case "WaitSatisfied": return change(state.waits, event.waitId, (row) => ({
      ...row, status: "satisfied", resolved: event.members,
    }));
    case "WaitCancelled": return change(state.waits, event.waitId, (row) => ({
      ...row, status: "cancelled", reason: event.reason,
    }));
    default: return state.waits;
  }
};

const deliveriesAfter = (state: State, event: Event): State["deliveries"] => {
  switch (event._tag) {
    case "AgentStarted": return event.firstPromptDelivery === undefined
      ? state.deliveries
      : put(state.deliveries, event.firstPromptDelivery.id, { ...event.firstPromptDelivery, status: "queued" });
    case "DeliveryQueued": return put(state.deliveries, event.delivery.id, { ...event.delivery, status: "queued" });
    case "DeliverySent": return change(state.deliveries, event.deliveryId, (row) => ({
      ...withoutReason(row), status: "sent", method: event.method,
    }));
    case "DeliveryAccepted": return change(state.deliveries, event.deliveryId, (row) => ({
      ...withoutReason(row), status: "accepted",
    }));
    case "DeliveryRequeued": return change(state.deliveries, event.deliveryId, (row) => ({
      ...row, status: "queued", reason: event.reason,
    }));
    case "DeliveryReturned": return change(state.deliveries, event.deliveryId, (row) => ({
      ...row, status: "returned", reason: event.reason,
    }));
    case "DeliveryWithdrawn": return change(state.deliveries, event.deliveryId, (row) => ({
      ...row, status: "withdrawn", reason: event.reason,
    }));
    default: return state.deliveries;
  }
};

// Whether an account is usable is separate from whether an agent resumed. An
// account becoming available leaves paused agents and queued deliveries as
// they are: the successful reload logs its own state change (rows 28 and 66).
const accountsAfter = (state: State, event: Event): State["accounts"] => {
  switch (event._tag) {
    case "AccountChanged": {
      if (event.account === undefined) return omit(state.accounts, event.accountId);
      const existing = lookup(state.accounts, event.accountId);
      // An edit keeps what the log said about the account's usability.
      return put(state.accounts, event.accountId, {
        ...event.account,
        status: existing?.status ?? "available",
        ...(existing?.resetAt === undefined ? {} : { resetAt: existing.resetAt }),
        ...(existing?.reason === undefined ? {} : { reason: existing.reason }),
      });
    }
    case "AccountNeedsSignIn": return change(state.accounts, event.accountId, ({ resetAt: _resetAt, ...row }) => ({
      ...row, status: "needs-sign-in", reason: event.reason,
    }));
    case "AccountOutOfUsage": return change(state.accounts, event.accountId, ({ reason: _reason, resetAt: _resetAt, ...row }) => ({
      ...row, status: "out-of-usage", ...(event.resetAt === undefined ? {} : { resetAt: event.resetAt }),
    }));
    case "AccountAvailable": return change(state.accounts, event.accountId, ({ reason: _reason, resetAt: _resetAt, ...row }) => ({
      ...row, status: "available",
    }));
    default: return state.accounts;
  }
};

// Live publication and rebuilding use this same pure fold.
export const applyWith = (state: State, envelope: EventEnvelope, views: Readonly<Record<PieceNamespace, PieceView>> = pieceViews): State => {
  const event = envelope.event;
  const owner = threadAgent(event);
  const pieces = { client: state.client, board: state.board, roles: state.roles };
  for (const namespace of pieceNamespaces) {
    pieces[namespace] = guardPiece("views", namespace, () => views[namespace].reduce(state[namespace], event, envelope.sequence), state[namespace]);
  }
  return {
    ...pieces,
    sequence: envelope.sequence,
    agents: agentsAfter(state, event),
    threads: owner === undefined
      ? state.threads
      : put(state.threads, owner, [...(lookup(state.threads, owner) ?? []), envelope]),
    requests: requestsAfter(state, event),
    questions: questionsAfter(state, event),
    waits: waitsAfter(state, envelope),
    deliveries: deliveriesAfter(state, event),
    accounts: accountsAfter(state, event),
  };
};

export const apply = (state: State, envelope: EventEnvelope): State => applyWith(state, envelope);
