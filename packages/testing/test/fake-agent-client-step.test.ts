// Row 71 and issue 160: the scripted tool step must speak the same RPC as
// actual clients, and must distinguish a refusal from a successful reply.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { cleanupUnit7b } from "./support/unit7b.ts";
import {
  agentToken, makeServiceRoot, ownerClient, requestId, startFakeAgent, startService, waitServing,
} from "../../engine/test/support/serviceProcess.ts";

afterEach(cleanupUnit7b);
const run = <A>(effect: Effect.Effect<A, unknown, any>) => Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, unknown>);

for (const scenario of [
  { id: "F01", command: "ask", input: { text: "What should I do next?" }, outcome: "ok", event: "QuestionAsked" },
  { id: "F02", command: "accounts", input: { operation: "list" }, outcome: "failed", event: "CommandRefused" },
] as const) {
  it(`${scenario.id} catches shepherd_command sending a non-RPC frame or reporting an error reply as success (${scenario.command})`, async () => run(Effect.gen(function* () {
    const root = makeServiceRoot("/tmp/s7f-");
    const service = startService(root, { env: { SHEPHERD_TEST_DEBUG: "1" } });
    yield* waitServing(root, service);
    const owner = yield* ownerClient(root);
    const before = (yield* owner["debug.compare-views"]({ requestId: requestId() } as never)).sequence;
    const agent = yield* startFakeAgent(root, owner, owner, {
      script: { turns: [[
        { step: "shepherd_command", command: scenario.command, input: { requestId: requestId(), ...scenario.input } },
        { step: "end_turn", stopReason: "end_turn" },
      ]] }, prompt: "Call the engine through the shared client.",
    });
    const identity = yield* agentToken(agent);
    for (const pid of [identity.pid, service.pid]) {
      expect(readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(identity.token), "token reached child arguments").toBe(false);
    }
    const events = yield* owner.subscribe({ requestId: requestId(), after: before } as never).pipe(
      Stream.takeUntil((envelope) => envelope.agentId === agent.agentId && envelope.event._tag === "TurnEnded"),
      Stream.runCollect, Effect.timeout(20_000),
    );
    const text = events.flatMap((envelope) => envelope.event._tag === "ThreadItem" && envelope.event.content._tag === "text" ? [envelope.event.content.text] : []).join("");
    expect(text).toContain(`shepherd_command:${scenario.outcome}`);
    expect(events.some((envelope) => envelope.event._tag === scenario.event)).toBe(true);
    if (scenario.command === "ask") {
      expect(events.filter((envelope) => envelope.event._tag === "QuestionAsked")).toHaveLength(1);
      const question = events.find((envelope) => envelope.event._tag === "QuestionAsked")!.event;
      expect(question).toMatchObject({ agentId: agent.agentId, text: scenario.input.text });
    } else {
      expect(events.filter((envelope) => envelope.event._tag === "CommandRefused" && envelope.event.command === "accounts")).toHaveLength(1);
      // Account creation belongs to startFakeAgent, before the prompt. Only
      // events after this command's refusal can show an unintended change.
      const refused = events.find((envelope) => envelope.event._tag === "CommandRefused" && envelope.event.command === "accounts")!;
      expect(events.some((envelope) => envelope.sequence > refused.sequence && envelope.event._tag === "AccountChanged")).toBe(false);
    }
    expect(JSON.stringify(events).includes(identity.token), "agent token reached an event").toBe(false);
    expect(service.output().includes(identity.token), "agent token reached service output").toBe(false);
  })), 45_000);
}

it("F03 catches wait_for_file running its next step before the gate exists or never releasing after it appears", async () => run(Effect.gen(function* () {
  const root = makeServiceRoot("/tmp/s7g-");
  const gate = join(root.root, "gate");
  const service = startService(root, { env: { SHEPHERD_TEST_DEBUG: "1" } });
  yield* waitServing(root, service);
  const owner = yield* ownerClient(root);
  const before = (yield* owner["debug.compare-views"]({ requestId: requestId() } as never)).sequence;
  const agent = yield* startFakeAgent(root, owner, owner, {
    script: { turns: [[
      { step: "plan", entries: [] }, { step: "wait_for_file", path: gate },
      { step: "text", text: "The gate was released." }, { step: "end_turn", stopReason: "end_turn" },
    ]] }, prompt: "Wait for the test's file.",
  });
  yield* owner.subscribe({ requestId: requestId(), after: before } as never).pipe(
    Stream.filter((envelope) => envelope.agentId === agent.agentId && envelope.event._tag === "DeliveryAccepted"),
    Stream.take(1), Stream.runDrain, Effect.timeout(10_000),
  );
  // A writer barrier observes the committed prefix while the gate is closed.
  const marker = requestId();
  yield* owner.group({ requestId: requestId(), agentId: agent.agentId, add: [marker], remove: [] } as never);
  const prefix = yield* owner.subscribe({ requestId: requestId(), after: before } as never).pipe(
    Stream.takeUntil((envelope) => envelope.event._tag === "AgentGrouped" && envelope.event.groups.includes(marker)),
    Stream.runCollect, Effect.timeout(10_000),
  );
  expect(prefix.some((envelope) => envelope.agentId === agent.agentId && envelope.event._tag === "TurnEnded"), "gate was ignored").toBe(false);
  expect(prefix.some((envelope) => envelope.event._tag === "ThreadItem" && envelope.event.content._tag === "text" && envelope.event.content.text.includes("gate was released"))).toBe(false);
  writeFileSync(gate, "release");
  const suffix = yield* owner.subscribe({ requestId: requestId(), after: prefix.at(-1)!.sequence } as never).pipe(
    Stream.takeUntil((envelope) => envelope.agentId === agent.agentId && envelope.event._tag === "TurnEnded"),
    Stream.runCollect, Effect.timeout(10_000),
  );
  expect(suffix.filter((envelope) => envelope.event._tag === "ThreadItem" && envelope.event.content._tag === "text" && envelope.event.content.text === "The gate was released.")).toHaveLength(1);
})), 45_000);
