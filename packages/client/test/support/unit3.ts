import { existsSync } from "node:fs";
import { ClientSnapshot, EventEnvelope, type EventEnvelope as Envelope } from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect } from "vitest";
import type { RequestFrame } from "./clientApiPeer.ts";
export { chunk, succeed, until, clientApiPeer, closeClientApiPeers } from "./clientApiPeer.ts";
export { refuse, bounded, cleanupUnit7b } from "../../../testing/test/support/unit7b.ts";
export type { RequestFrame };

export type WaitReply = { outcome: "satisfied" | "request-held"; members: ReadonlyArray<{ agentId: string; reason: string }> };
export type WaitForAgents = (client: any, options: { members: ReadonlyArray<string>; mode: "any" | "all" }) => Effect.Effect<WaitReply, unknown>;
export const loadWait = async (): Promise<WaitForAgents> => {
  const url = new URL("../../src/waitForAgents.ts", import.meta.url);
  expect(existsSync(url), "WS-3 must supply waitForAgents(client, { members, mode }) in packages/client/src/waitForAgents.ts").toBe(true);
  const api = await import(/* @vite-ignore */ url.href) as { waitForAgents: WaitForAgents };
  expect(api.waitForAgents).toBeTypeOf("function");
  return api.waitForAgents;
};
export const agentRow = (agentId = "agent-a", tag = "idle", reloadable = true) => ({
  agentId, name: `Name ${agentId}`, role: "worker", groups: [], parent: { _tag: "owner" },
  state: tag === "paused" ? { _tag: tag, reason: "limit", midTurn: false } : tag === "interrupted" ? { _tag: tag, previous: "idle" } : { _tag: tag },
  displayedState: ({ idle: "Idle", working: "Working", starting: "Starting", paused: "Paused for a limit", interrupted: "Interrupted", crashed: "Crashed", stopped: "Stopped" } as Record<string, string>)[tag], openPermissionRequests: 0, openQuestionsAsked: 0,
  harness: "first", account: "primary", permission: "ask", folder: "/tmp/fixture-project",
  session: { _tag: "acp", sessionId: `session-${agentId}` }, startedAt: 1_800_000_000_000, reloadable,
});
export const snapshot = (overrides: Record<string, unknown> = {}): any => Schema.decodeUnknownSync(ClientSnapshot)({
  sequence: 10, agents: [agentRow()], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0,
  accounts: [], alerts: [], waitState: { deliveries: [], waits: [] }, ...overrides,
});
export const envelope = (sequence: number, event: Record<string, unknown>, agentId?: string): Envelope => Schema.decodeUnknownSync(EventEnvelope)({
  sequence, eventId: `event-${sequence}`, occurredAt: 1_800_000_000_000 + sequence, caller: { _tag: "owner" },
  requestId: `request-${sequence}`, ...(agentId === undefined ? (typeof event.agentId === "string" ? { agentId: event.agentId } : {}) : { agentId }), event,
});
export const state = (sequence: number, tag: "idle" | "working", agentId = "agent-a") => envelope(sequence, { _tag: "StateChanged", agentId, state: { _tag: tag } });
export const turnEnd = (sequence: number, agentId = "agent-a") => envelope(sequence, { _tag: "TurnEnded", agentId, compact: false });
export const queued = (sequence: number, target = "agent-a", id = `delivery-${sequence}`) => envelope(sequence, {
  _tag: "DeliveryQueued", delivery: { id, target, sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Continue work." } },
});
export const question = (sequence: number, agentId = "agent-a", holder: unknown = { _tag: "owner" }) => envelope(sequence, {
  _tag: "QuestionAsked", agentId, questionId: `question-${sequence}`, holder, deliveryId: `question-delivery-${sequence}`, text: "Which fixture?",
});
export const permission = (sequence: number, agentId = "agent-a", holder: unknown = { _tag: "owner" }) => envelope(sequence, {
  _tag: "PermissionRequested", agentId, permissionRequestId: `permission-${sequence}`, holder, deliveryId: `permission-delivery-${sequence}`, toolCallId: `tool-${sequence}`,
  description: "Read this fixture?", settingsWrite: false, options: [{ id: "once", name: "Allow once", kind: "allow_once", level: "ask", persistent: false }],
});
