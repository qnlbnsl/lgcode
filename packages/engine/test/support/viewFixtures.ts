import { Event, EventEnvelope, type Actor } from "@shepherd/contracts";
import * as Schema from "effect/Schema";

// Decode fixtures at their boundary so a malformed event cannot masquerade as
// a projection failure. These are test data, not a second projection reducer.
export const event = Schema.decodeUnknownSync(Event);
export const owner: Actor = { _tag: "owner" };
export const envelopes = (events: ReadonlyArray<Event>): Array<EventEnvelope> =>
  events.map((value, index) => Schema.decodeUnknownSync(EventEnvelope)({
    sequence: index + 1, eventId: `event-${index + 1}`, occurredAt: 1_800_000_000_000 + index,
    caller: owner, requestId: `request-${index + 1}`,
    ...("agentId" in value ? { agentId: value.agentId } : {}), event: value,
  }));

export const account = { id: "primary", harness: "first", displayName: "Primary", enabled: true };
export const started = event({
  _tag: "AgentStarted", agentId: "agent-a", name: "Builder", role: "worker", groups: ["engine"],
  parent: owner, harness: "first", account: "primary", permission: "read-only",
  folder: "/tmp/project", runMode: "acp", model: "test-model", effort: "high",
});
export const opened = event({
  _tag: "SessionOpened", agentId: "agent-a", session: { _tag: "acp", sessionId: "session-a" },
  protocolVersion: 2, reloadable: true,
});
export const ready = [event({ _tag: "AccountChanged", accountId: "primary", account }), started, opened];
export const delivery = {
  id: "delivery-a", target: "agent-a", sender: owner,
  content: { _tag: "prompt", text: "Build the log." },
};
export const queued = event({ _tag: "DeliveryQueued", delivery });
export const sent = event({ _tag: "DeliverySent", agentId: "agent-a", deliveryId: "delivery-a", method: "acp" });
export const accepted = event({ _tag: "DeliveryAccepted", agentId: "agent-a", deliveryId: "delivery-a" });
export const permission = event({
  _tag: "PermissionRequested", agentId: "agent-a", permissionRequestId: "permission-a",
  holder: owner, deliveryId: "permission-delivery", toolCallId: "tool-a", description: "Read the file?",
  options: [{ id: "once", name: "Allow once", kind: "allow_once", level: "read-only", persistent: false }],
  settingsWrite: false,
});
export const question = event({
  _tag: "QuestionAsked", agentId: "agent-a", questionId: "question-a", holder: owner,
  deliveryId: "question-delivery", text: "Which file?",
});
export const wait = event({
  _tag: "WaitOpened", agentId: "agent-a", waitId: "wait-a", members: ["agent-b", "agent-c"],
  mode: "all", blocking: true,
});

// A real append journey spanning every view. The lifecycle is idle -> working
// -> idle; the state machine's event table allows each event at that point.
export const journey = [
  ...ready, queued, sent,
  event({ _tag: "PromptSent", agentId: "agent-a", deliveryId: "delivery-a", sender: owner, text: "Build the log." }),
  accepted, event({ _tag: "TurnStarted", agentId: "agent-a" }),
  event({ _tag: "ThreadItem", agentId: "agent-a", itemId: "item-a", content: { _tag: "text", text: "Working." }, replay: false }),
  permission, question, wait,
  event({ _tag: "PermissionAnswered", agentId: "agent-a", permissionRequestId: "permission-a", answeredBy: owner, answer: { _tag: "selected", optionId: "once" } }),
  event({ _tag: "QuestionAnswered", agentId: "agent-a", questionId: "question-a", answeredBy: owner, text: "events.ts", deliveryId: "answer-delivery" }),
  event({ _tag: "WaitMemberResolved", agentId: "agent-a", waitId: "wait-a", member: { agentId: "agent-b", reason: "settled" } }),
  event({ _tag: "DeviceAdded", deviceId: "phone", name: "Phone" }),
  event({ _tag: "DeviceRevoked", deviceId: "phone" }),
  event({ _tag: "TurnEnded", agentId: "agent-a", compact: false }),
];
