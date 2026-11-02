// Failure rule 8: the disk or the database fails. The engine refuses new
// commands and says why. It never acts without writing first, so nothing
// happens that the log does not show. Criteria 8.3 to 8.5.
//
// The failure is a trigger planted in the event database that aborts the
// insert of one kind of event, which the engine meets as a failed write. A
// full disk and a busy database are reported by the same path with other
// reasons; their wording is checked by the log's own tests
// (test/log/disk-failure.test.ts), not here.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import type { EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";

import {
  eventsUntil, isTag, peekEcho, plantDatabaseFault, promptsOf, refusal, requestId, runSql, scenario, since, stopAllServices, tagged, threadText, waitFor,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const abortInserts = (name: string, eventType: string) =>
  `CREATE TRIGGER ${name} BEFORE INSERT ON events WHEN NEW.event_type = '${eventType}' BEGIN SELECT RAISE(ABORT, 'planted failure'); END`;

const options = [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }];

scenario("8 disk: when a message cannot be written the call is refused with the database failure, nothing reaches the agent, every later command is refused with the same reason while reading still works, and after the fault is gone and the service restarts the same request acts once (breaks if the engine sends the message before writing it, hides the reason, keeps taking commands, or loses the request id's fresh start)", (w) => Effect.gen(function* () {
  const agent = yield* w.start(w.owner, { name: "Listener", permission: "ask", prompt: "Hello." });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", agent.agentId));
  const before = promptsOf(peekEcho(agent.echo)!).length;
  const mark = yield* w.watermark();

  plantDatabaseFault(w.root, abortInserts("planted_queue", "DeliveryQueued"), "SELECT 1");
  const lost = requestId();
  const first = yield* refusal(w.owner.prompt({ requestId: lost, agentId: agent.agentId, text: "Lost." } as never));
  expect(first, "a message was accepted although it could not be written").toMatch(/^database write failed/);

  // The refusal is the engine saying why; later commands, whatever they are, get the same answer.
  const second = yield* refusal(w.owner.group({ requestId: requestId(), agentId: agent.agentId, add: ["late"], remove: [] } as never));
  expect(second, "the engine kept taking commands after a failed write").toBe(first);
  // Reading still works, and shows that nothing happened.
  const quiet = yield* since(w.owner, mark);
  expect(tagged(quiet, "DeliveryQueued"), "a message that could not be written is in the log").toHaveLength(0);
  expect(tagged(quiet, "DeliverySent")).toHaveLength(0);
  expect(tagged(quiet, "AgentGrouped"), "a command refused for the database failure still acted").toHaveLength(0);
  expect(promptsOf(peekEcho(agent.echo)!), "the agent received a message the log does not show").toHaveLength(before);

  // Recovery is a restart with the fault removed.
  yield* w.kill("SIGKILL");
  runSql(w.root, "DROP TRIGGER planted_queue");
  yield* w.boot();
  const reply = (yield* w.owner.prompt({ requestId: lost, agentId: agent.agentId, text: "Lost." } as never)) as { deliveryId: string };
  yield* eventsUntil(w.owner, mark, "the resent message to be taken", (envelope) =>
    envelope.event._tag === "DeliveryAccepted" && envelope.agentId === agent.agentId
    && (envelope.event as unknown as { deliveryId: string }).deliveryId === reply.deliveryId, 30_000);
  const settled = yield* since(w.owner, mark);
  expect(tagged(settled, "DeliveryQueued").filter((envelope) =>
    (envelope.event as unknown as { delivery: { id: string } }).delivery.id === reply.deliveryId), "the resent request queued more than once").toHaveLength(1);
  const received = yield* waitFor("the reloaded adapter's inbound prompts", () => {
    const texts = promptsOf(peekEcho(agent.echo)!);
    return texts.includes("Lost.") ? texts : undefined;
  });
  expect(received.filter((text) => text === "Lost.")).toHaveLength(1);
}));

// What the fake adapter writes when the script reaches an `exec` step: a file
// that only the adapter can create, so the scenario can see from outside the
// service that the adapter went on after an answer (the engine is latched after
// the failed write and cannot report anything itself).
const marker = (path: string) => ({
  step: "exec",
  argv: ["-e", "require('node:fs').writeFileSync(process.argv[1], 'x')", path],
});

// The protocol client numbers its own requests from 2 ** 30, so the answer to a
// permission request is recognised by its shape, a response whose result holds
// an outcome, not by a number.
const answersIn = (echoFile: string): number => (peekEcho(echoFile)?.inbound ?? []).filter((frame) => {
  const result = (frame as { result?: { outcome?: unknown } }).result;
  return result !== undefined && result !== null && typeof result === "object" && result.outcome !== undefined;
}).length;

scenario("8 disk: when the answer to a permission request cannot be written the answer does not reach the agent, and the request is still open in the log (breaks if the answer is sent to the agent before it is written, so the agent acts on a decision the log does not hold)", (w) => Effect.gen(function* () {
  const first = join(w.root.root, "after-first-answer");
  const second = join(w.root.root, "after-second-answer");
  const agent = yield* w.start(w.owner, {
    name: "Asker", permission: "ask", prompt: "Go.",
    script: { turns: [[
      { step: "permission", toolCallId: "call-one", title: "Write the first file", options },
      marker(first),
      { step: "permission", toolCallId: "call-two", title: "Write the second file", options },
      marker(second),
      { step: "text", text: "end of the turn" },
    ]] },
  });
  const idOf = (events: ReadonlyArray<EventEnvelope>, index: number) =>
    (tagged(events, "PermissionRequested", agent.agentId)[index]!.event as unknown as { permissionRequestId: string }).permissionRequestId;

  // Positive control: an answer that is written reaches the adapter, and the
  // matcher below sees it. Without this a matcher that never matches passes.
  const firstRequested = yield* eventsUntil(w.owner, 0, "the first request", isTag("PermissionRequested", agent.agentId));
  yield* w.owner.answer({ requestId: requestId(), kind: "permission", id: idOf(firstRequested, 0), optionId: "allow-once" } as never);
  yield* waitFor("the adapter to go on after the first answer", () => existsSync(first) ? true : undefined);
  expect(answersIn(agent.echo), "the matcher did not see the answer that was written and delivered").toBe(1);

  const requested = yield* eventsUntil(w.owner, 0, "the second request", (envelope) =>
    envelope.event._tag === "PermissionRequested" && envelope.agentId === agent.agentId && envelope.sequence > firstRequested[firstRequested.length - 1]!.sequence);
  const id = idOf(requested, 1);
  const mark = yield* w.watermark();

  plantDatabaseFault(w.root, abortInserts("planted_answer", "PermissionAnswered"), "SELECT 1");
  const failed = yield* refusal(w.owner.answer({ requestId: requestId(), kind: "permission", id, optionId: "allow-once" } as never));
  expect(failed, "an answer was accepted although it could not be written").toMatch(/^database write failed/);

  // The adapter-side barrier: a bounded quiet window in which an answer that
  // was sent before it was written would make the adapter write its marker and
  // record a second response frame. Neither may happen.
  yield* Effect.sleep(2_000);
  expect(existsSync(second), "the adapter went on after an answer the log does not hold").toBe(false);
  expect(answersIn(agent.echo), "a permission answer reached the adapter although it could not be written").toBe(1);

  // Reading still works and shows the request open and the agent still waiting.
  const quiet = yield* since(w.owner, mark);
  expect(tagged(quiet, "PermissionAnswered")).toHaveLength(0);
  expect(tagged(quiet, "TurnEnded", agent.agentId), "the agent went on after an answer the log does not hold").toHaveLength(0);
  expect(threadText(quiet, agent.agentId)).not.toContain("permission:selected");

  // Recovery is a restart with the fault removed (the final check needs a
  // service that takes commands). The log still holds exactly the one answer.
  yield* w.kill("SIGKILL");
  runSql(w.root, "DROP TRIGGER planted_answer");
  yield* w.boot();
  const history = yield* since(w.owner, 0);
  expect(tagged(history, "PermissionAnswered", agent.agentId), "the log holds an answer that was never written")
    .toHaveLength(1);
}));
