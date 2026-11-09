import { Event, EventEnvelope } from "@lgcode/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import * as Apply from "../../src/views/apply.ts";
import { FixtureEvent } from "../support/fixturePiece.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it.each(["client", "board", "roles", "project"])("1a E6 empty views initialize the %s field before that piece is built", (namespace) => {
  expect(Object.hasOwn(Apply.emptyViews(), namespace)).toBe(true);
});

it("1.10 an agent-bearing piece event never joins an engine thread", () => {
  const schema = Schema.Struct({ ...EventEnvelope.fields, event: Schema.Union([Event, FixtureEvent]) });
  const envelope = Schema.decodeUnknownSync(schema)({
    sequence: 1, eventId: "fixture-event", requestId: "fixture-request", occurredAt: 1,
    caller: { _tag: "owner" }, agentId: "agent-a",
    event: { _tag: "client.FixtureRecorded", id: "fixture-a", agentId: "agent-a", text: "Fixture event." },
  });
  const result = Apply.apply(Apply.emptyViews(), envelope as EventEnvelope);
  expect(result.threads["agent-a"]).toBeUndefined();
  expect(result.agents["agent-a"]).toBeUndefined();
  expect(result.sequence).toBe(1);
});

it("1a E21 exports threadAgent and retains the nested target of DeliveryQueued", () => {
  const threadAgent = (Apply as unknown as { threadAgent: (event: unknown) => string | undefined }).threadAgent;
  expect(threadAgent, "The append path and migration must share the thread membership rule").toBeTypeOf("function");
  expect(threadAgent({ _tag: "DeliveryQueued", delivery: {
    id: "delivery-a", target: "agent-a", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Queued." },
  } })).toBe("agent-a");
  expect(threadAgent({ _tag: "client.FixtureRecorded", agentId: "agent-a", id: "a", text: "Text." })).toBeUndefined();
});
