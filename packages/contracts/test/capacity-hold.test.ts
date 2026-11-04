import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { Event, EventEnvelope } from "../src/events.ts";
import { foldSettled, settled, type SettledInput } from "../src/settled.ts";

const decode = Schema.decodeUnknownSync(Event);
it.each([
  { _tag: "DeliveryHeld", agentId: "target", deliveryId: "delivery", reason: "capacity" },
  { _tag: "DeliveryReleased", agentId: "target" },
])("CAP01 $_tag: catches a hold or release being absent or losing its identity on the wire", (event) => {
  expect(Schema.is(Event)(event)).toBe(true);
  expect(decode(JSON.parse(JSON.stringify(Schema.encodeSync(Event)(decode(event)))))).toEqual(event);
});

it("CAP02 catches losing a capacity return's cause while keeping historical returns readable", () => {
  const old = { _tag: "DeliveryReturned", agentId: "target", deliveryId: "delivery", sender: { _tag: "owner" }, reason: "returned" };
  expect(decode(old)).toEqual(old);
  expect(decode({ ...old, cause: "capacity" })).toEqual({ ...old, cause: "capacity" });
  expect(() => decode({ ...old, cause: "invented" })).toThrow();
});

it("CAP03 catches an idle agent with an empty held queue being called settled", () => {
  const input = {
    agents: { target: { state: { _tag: "idle" }, capacityHeld: true } },
    deliveries: {}, requests: {}, questions: {}, waits: {},
  };
  expect(settled(input, "target")).toBe(false);
  const released = { ...input, agents: { target: { state: { _tag: "idle" }, capacityHeld: false } } };
  expect(settled(released, "target")).toBe(true);
});

for (const ending of ["DeliveryReleased", "AgentStopped", "AgentCrashed"] as const) it(`CAP04 ${ending}: catches the shared client fold dropping an empty hold or retaining it after its ending`, () => {
  let input: SettledInput = { agents: { target: { state: { _tag: "working" } } }, deliveries: {}, requests: {}, questions: {}, waits: {} };
  let sequence = 0;
  const step = (wire: unknown) => {
    expect(Schema.is(Event)(wire), "capacity events must exist before their client fold can run").toBe(true);
    const envelope = Schema.decodeUnknownSync(EventEnvelope)({ sequence: ++sequence, eventId: `event-${sequence}`, occurredAt: sequence, caller: { _tag: "owner" }, event: wire });
    input = foldSettled(input, envelope);
  };
  step({ _tag: "DeliveryHeld", agentId: "target", deliveryId: "already-withdrawn", reason: "capacity" });
  expect(input.agents.target?.state._tag).toBe("idle");
  expect(settled(input, "target")).toBe(false);
  step(ending === "AgentCrashed"
    ? { _tag: ending, agentId: "target", exitCode: 1, signal: null, stderr: "test crash" }
    : { _tag: ending, agentId: "target" });
  expect(input.agents.target).toHaveProperty("capacityHeld", false);
  expect(settled(input, "target")).toBe(ending === "DeliveryReleased");
});
