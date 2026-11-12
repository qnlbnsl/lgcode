import * as Contracts from "../src/index.ts";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";

for (const caller of [
  { _tag: "service", service: "roles.stallWatch" },
  { _tag: "service", service: "roles.standing-rules", rule: "rule-4" },
  { _tag: "piece", namespace: "board" },
]) {
  it(`1.4/1.30 Caller ${JSON.stringify(caller)}: catches losing audit identities or giving services parent/holder rights`, () => {
    const schema = (Contracts as unknown as { Caller?: Schema.Codec<unknown> }).Caller;
    expect(schema, "E11 must export Caller separately from Actor").toBeDefined();
    expect(Schema.decodeUnknownSync(schema!)(caller)).toEqual(caller);
    expect(Schema.is(Contracts.Actor)(caller)).toBe(false);
  });
}
for (const sender of [{ _tag: "service", service: "roles.stallWatch" }, { _tag: "piece", namespace: "board" }]) {
  for (const event of [
    { _tag: "DeliveryQueued", delivery: { id: "delivery", target: "agent", sender, source: { _tag: "piece", namespace: "board", id: "post" }, content: { _tag: "prompt", text: "Wrapped data." } } },
    { _tag: "PromptSent", agentId: "agent", deliveryId: "delivery", sender, text: "Wrapped data." },
    { _tag: "DeliveryReturned", agentId: "agent", deliveryId: "delivery", sender, reason: "not delivered" },
  ]) {
    it(`1.31 ${event._tag}/${sender._tag}: catches a sender widened on only some delivery events`, () => {
      expect(Schema.is(Contracts.Event)(event), "E15 must preserve this sender through every delivery event").toBe(true);
      expect(Schema.decodeUnknownSync(Contracts.Event)(event)).toEqual(event);
    });
  }
}

it("1.12 E14 catches a service rule lost from PermissionAnswered while QuestionAnswered stays human/agent-only", () => {
  const answeredBy = { _tag: "service", service: "roles.standing-rules", rule: "rule-4" };
  const event = { _tag: "PermissionAnswered", agentId: "agent", permissionRequestId: "permission", answeredBy, answer: { _tag: "selected", optionId: "once" } };
  expect(Schema.is(Contracts.Event)(event)).toBe(true);
  expect(Schema.decodeUnknownSync(Contracts.Event)(event)).toEqual(event);
  expect(Schema.is(Contracts.Event)({ _tag: "QuestionAnswered", agentId: "agent", questionId: "question", answeredBy, text: "Data.", deliveryId: "delivery" })).toBe(false);
});

it("1.34 catches retaining a device credential's event contract", () => {
  expect(Schema.is(Contracts.Event)({ _tag: "DeviceAdded", deviceId: "old-device", name: "Old device" })).toBe(false);
  expect(Schema.is(Contracts.Event)({ _tag: "DeviceRevoked", deviceId: "old-device" })).toBe(false);
});
