// A4: only the branded identities declared in contracts/{ids,events,
// accounts,harnesses,commands}.ts bypass string-value redaction. A shape is
// local to its schema position: an environment entry named `id` is text.
// Unbranded adapter strings (itemId, callId, optionId, sessionId) stay text.
export interface RedactionStructure {
  readonly identity?: true;
  readonly fields?: Readonly<Record<string, RedactionStructure>>;
  readonly elements?: RedactionStructure;
}

const identity: RedactionStructure = { identity: true };
const actor: RedactionStructure = { fields: { agentId: identity } };
const account: RedactionStructure = { identity: true, fields: { id: identity, harness: identity } };
const harness: RedactionStructure = { identity: true, fields: { id: identity } };
const member: RedactionStructure = { identity: true, fields: { agentId: identity } };
const delivery: RedactionStructure = { fields: {
  id: identity, target: identity, sender: actor, source: { fields: { id: identity } },
} };

export const eventStructure: RedactionStructure = { fields: {
  agentId: identity, accountId: identity, deliveryId: identity, deviceId: identity,
  permissionRequestId: identity, questionId: identity, waitId: identity,
  account, harness, parent: actor, sender: actor, holder: actor, answeredBy: actor, from: actor, to: actor,
  delivery, firstPromptDelivery: delivery, subject: { fields: { id: identity } },
  member, members: { elements: member }, process: { fields: { bootId: identity } },
} };

export const receiptStructure: RedactionStructure = { fields: {
  requestId: identity, agentId: identity, deliveryId: identity, questionId: identity, waitId: identity,
  accounts: { elements: account }, harnesses: { elements: harness }, members: { elements: member },
  envelopes: { elements: { fields: {
    eventId: identity, requestId: identity, agentId: identity, caller: actor, event: eventStructure,
  } } },
} };

export const fieldStructure = (structure: RedactionStructure | undefined, key: string): RedactionStructure | undefined =>
  key === "_tag" ? identity
    : structure?.fields !== undefined && Object.hasOwn(structure.fields, key) ? structure.fields[key] : undefined;
