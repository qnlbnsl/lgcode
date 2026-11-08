import { existsSync } from "node:fs";
import { EventEnvelope } from "@lgcode/contracts";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { emptyViews, apply } from "../../src/views/apply.ts";
import { ready, permission } from "../support/viewFixtures.ts";
import { eventOf } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

it("1.16 the client's pure fold and engine projection agree on settlement, held requests and reasons at every sequence", async () => {
  const url = new URL("../../../contracts/src/settled.ts", import.meta.url);
  expect(existsSync(url), "E19 must provide the shared fold, not a separate client interpretation").toBe(true);
  type State = ReturnType<typeof emptyViews>;
  const api = await import(/* @vite-ignore */ url.href) as {
    foldSettled: (state: unknown, envelope: typeof EventEnvelope.Type) => unknown;
    settled: (state: unknown, id: string) => boolean;
    holds: (state: unknown, id: string) => boolean;
    reasonOf: (state: unknown, id: string) => string | undefined;
  };
  fc.assert(fc.property(fc.array(fc.constantFrom("delivery", "permission", "question", "wait", "capacity"), { maxLength: 12 }), (steps) => {
    const events = [...ready];
    for (const [index, step] of steps.entries()) {
      const id = `item-${index}`;
      if (step === "capacity") events.push(
        eventOf({ _tag: "DeliveryQueued", delivery: { id, target: "agent-a", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Held work." } } }),
        eventOf({ _tag: "DeliverySent", agentId: "agent-a", deliveryId: id, method: "acp" }),
        eventOf({ _tag: "DeliveryRequeued", agentId: "agent-a", deliveryId: id, reason: "capacity" }),
        eventOf({ _tag: "DeliveryHeld", agentId: "agent-a", deliveryId: id, reason: "capacity" }),
        eventOf({ _tag: "DeliveryWithdrawn", agentId: "agent-a", deliveryId: id, reason: "wake withdrawn" }),
        eventOf({ _tag: "DeliveryReleased", agentId: "agent-a" }),
      );
      if (step === "delivery") events.push(eventOf({ _tag: "DeliveryQueued", delivery: { id, target: "agent-a", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Data." } } }), eventOf({ _tag: "DeliveryWithdrawn", agentId: "agent-a", deliveryId: id, reason: "request closed" }));
      if (step === "permission") events.push(permission, eventOf({ _tag: "PermissionCancelled", agentId: "agent-a", permissionRequestId: "permission-a", reason: "agent stopped" }));
      if (step === "question") events.push(eventOf({ _tag: "QuestionAsked", agentId: "agent-a", questionId: id, holder: { _tag: "agent", agentId: "agent-a" }, deliveryId: id, text: "Data." }), eventOf({ _tag: "QuestionAnswered", agentId: "agent-a", questionId: id, answeredBy: { _tag: "owner" }, text: "Reply.", deliveryId: id }));
      if (step === "wait") events.push(eventOf({ _tag: "WaitOpened", agentId: "agent-a", waitId: id, members: ["other"], mode: "all", blocking: false }), eventOf({ _tag: "WaitCancelled", agentId: "agent-a", waitId: id, reason: "connection closed" }));
    }
    let engine = emptyViews();
    let client: unknown = { agents: {}, requests: {}, questions: {}, deliveries: {}, waits: {} };
    for (const [i, event] of events.entries()) {
      const envelope = Schema.decodeUnknownSync(EventEnvelope)({ sequence: i + 1, eventId: `event-${i}`, occurredAt: i, caller: { _tag: "owner" }, event });
      engine = apply(engine, envelope);
      client = api.foldSettled(client, envelope);
      if (event._tag === "DeliveryWithdrawn" && event.reason === "wake withdrawn") {
        expect(api.settled(engine, "agent-a")).toBe(false);
        expect(api.settled(client, "agent-a")).toBe(false);
      }
      for (const id of ["agent-a", "other"]) {
        expect(api.settled(client, id)).toBe(api.settled(engine, id));
        expect(api.holds(client, id)).toBe(api.holds(engine, id));
        expect(api.reasonOf(client, id)).toBe(api.reasonOf(engine, id));
      }
    }
  }), { numRuns: 30 });
});
