import type { AlertSourceRequest, Event, EventEnvelope, PermissionRequestId, QuestionId } from "@lgcode/contracts";
import type { Snapshot } from "../../commands/internal.ts";
import { alertKeyPart } from "./keys.ts";
import { clientView } from "./view.ts";

export const inactive = (snapshot: Snapshot, agentId: string): boolean => {
  const state = snapshot.agents[agentId]?.state._tag;
  return state === undefined || state === "stopped" || state === "crashed";
};
export const endsAgentRun = (event: Event, agentId: string): boolean => "agentId" in event && event.agentId === agentId
  && (event._tag === "AgentStopped" || event._tag === "AgentCrashed"
    || (event._tag === "StateChanged" && (event.state._tag === "stopped" || event.state._tag === "crashed")));

// The live snapshot can already include another stop and resume. Only a
// source from the latest run may renew a retained question during catch-up.
export const currentAgentRun = (snapshot: Snapshot, agentId: string, sequence: number): boolean =>
  !snapshot.threads[agentId]?.some((row) => row.sequence > sequence && endsAgentRun(row.event, agentId));

const agentRemedyClosed = (snapshot: Snapshot, agentId: string): boolean => {
  const state = snapshot.agents[agentId]?.state._tag;
  return state === undefined || state === "stopped" || state === "idle" || state === "working";
};
export const subjectClosed = (source: AlertSourceRequest, snapshot: Snapshot): boolean => {
  const subject = source.subject;
  if (source.kind === "approval" && subject?._tag === "permission") {
    const row = snapshot.requests[subject.id];
    return row?.status !== "open" || inactive(snapshot, row.agentId);
  }
  if (source.kind === "question" && subject?._tag === "question") {
    const row = snapshot.questions[subject.id];
    return row?.status !== "open" || inactive(snapshot, row.agentId);
  }
  if ((source.kind === "failure" || source.key.startsWith("agent-account:")) && source.agentId !== undefined) {
    return agentRemedyClosed(snapshot, source.agentId);
  }
  if (source.kind === "account" && subject?._tag === "account") {
    const row = snapshot.accounts[subject.id];
    return row === undefined || (source.key.endsWith(":sign-in") ? row.status !== "needs-sign-in" : row.status !== "out-of-usage");
  }
  if (source.kind === "client.web-down") {
    const view = clientView(snapshot.client);
    return !view.webDown || !view.webSettings.enabled;
  }
  return false;
};

export const engineSource = (envelope: EventEnvelope, snapshot: Snapshot): AlertSourceRequest | undefined => {
  const event = envelope.event;
  let source: AlertSourceRequest | undefined;
  if (event._tag === "OwnerNeeded") {
    const { agentId, subject, reason } = event;
    if (reason === "request needs the owner" && subject !== undefined) {
      if (!currentAgentRun(snapshot, agentId, envelope.sequence)) return undefined;
      source = { kind: subject._tag === "permission" ? "approval" : "question", key: `${subject._tag}:${alertKeyPart(subject.id)}`, agentId, subject };
    } else if (reason === "agent crashed") {
      source = { kind: "failure", key: `crash:${alertKeyPart(agentId)}:${envelope.sequence}`, agentId, subject: { _tag: "agent", id: agentId } };
    } else if (reason === "account needs sign-in" || reason === "account is out of usage, no reset time known") {
      const accountId = snapshot.agents[agentId]?.account;
      if (accountId !== undefined && snapshot.accounts[accountId] !== undefined) return undefined;
      source = { kind: "account", key: `agent-account:${alertKeyPart(agentId)}`, agentId, subject: { _tag: "agent", id: agentId } };
    } else {
      source = { kind: "other", key: `other:${alertKeyPart(agentId)}:${envelope.sequence}`, agentId, subject: { _tag: "agent", id: agentId } };
    }
  } else if (event._tag === "AccountNeedsSignIn" || (event._tag === "AccountOutOfUsage" && event.resetAt === undefined)) {
    source = { kind: "account", key: `account:${alertKeyPart(event.accountId)}:${event._tag === "AccountNeedsSignIn" ? "sign-in" : "usage"}`,
      subject: { _tag: "account", id: event.accountId } };
  } else if (event._tag === "client.WebServerDown") {
    source = { kind: "client.web-down", key: "client:web-down" };
  }
  return source !== undefined && !subjectClosed(source, snapshot) ? source : undefined;
};

export const openQuestions = (snapshot: Snapshot, agentId?: string): ReadonlyArray<AlertSourceRequest> =>
  Object.values(snapshot.questions).filter((row) => row.status === "open" && row.holder._tag === "owner"
    && (agentId === undefined || row.agentId === agentId) && !inactive(snapshot, row.agentId)).map((row) => ({
      kind: "question", key: `question:${alertKeyPart(row.questionId)}`, agentId: row.agentId,
      subject: { _tag: "question", id: row.questionId as QuestionId },
    }));

export const engineOpenMatters = (snapshot: Snapshot): ReadonlyArray<AlertSourceRequest> => {
  const matters: AlertSourceRequest[] = [...openQuestions(snapshot)];
  for (const row of Object.values(snapshot.requests)) {
    if (row.status === "open" && row.holder._tag === "owner" && !inactive(snapshot, row.agentId)) matters.push({
      kind: "approval", key: `permission:${alertKeyPart(row.permissionRequestId)}`, agentId: row.agentId,
      subject: { _tag: "permission", id: row.permissionRequestId as PermissionRequestId },
    });
  }
  for (const row of Object.values(snapshot.accounts)) {
    if (row.status === "needs-sign-in" || (row.status === "out-of-usage" && row.resetAt === undefined)) matters.push({
      kind: "account", key: `account:${alertKeyPart(row.id)}:${row.status === "needs-sign-in" ? "sign-in" : "usage"}`,
      subject: { _tag: "account", id: row.id },
    });
  }
  // Threads retain the engine's OwnerNeeded identities. Only the most recent
  // crash and account remedy for an agent can describe its current pause.
  for (const thread of Object.values(snapshot.threads)) {
    const found = new Set<string>();
    for (const envelope of [...thread].reverse()) {
      if (envelope.event._tag !== "OwnerNeeded" || envelope.event.subject !== undefined) continue;
      const source = engineSource(envelope, snapshot);
      if (source === undefined || found.has(source.kind)) continue;
      found.add(source.kind);
      matters.push(source);
    }
  }
  const view = clientView(snapshot.client);
  if (view.webDown && view.webSettings.enabled) matters.push({ kind: "client.web-down", key: "client:web-down" });
  return matters;
};
