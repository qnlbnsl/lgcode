// Failure rule 8: the disk or the database fails. The engine refuses new
// commands and says why. It never acts without writing first, so nothing
// happens that the log does not show. Criteria 8.3 to 8.5.
//
// The failure is a trigger planted in the event database that aborts the
// insert of one kind of event, which the engine meets as a failed write. A
// full disk and a busy database are reported by the same path with other
// reasons; their wording is checked by the log's own tests
// (test/log/disk-failure.test.ts), not here.
import { afterEach, expect } from "@effect/vitest";
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

scenario("8 disk: when the answer to a permission request cannot be written the answer does not reach the agent, and the request is still open in the log (breaks if the answer is sent to the agent before it is written, so the agent acts on a decision the log does not hold)", (w) => Effect.gen(function* () {
  const agent = yield* w.start(w.owner, {
    name: "Asker", permission: "ask", prompt: "Go.",
    script: { turns: [[{ step: "permission", toolCallId: "call-disk", title: "Write the file", options }, { step: "text", text: "after the answer" }]] },
  });
  const requested = yield* eventsUntil(w.owner, 0, "the request", isTag("PermissionRequested", agent.agentId));
  const id = (tagged(requested, "PermissionRequested", agent.agentId)[0]!.event as unknown as { permissionRequestId: string }).permissionRequestId;
  const mark = yield* w.watermark();

  plantDatabaseFault(w.root, abortInserts("planted_answer", "PermissionAnswered"), "SELECT 1");
  const failed = yield* refusal(w.owner.answer({ requestId: requestId(), kind: "permission", id, optionId: "allow-once" } as never));
  expect(failed, "an answer was accepted although it could not be written").toMatch(/^database write failed/);

  // Give the agent every chance to act on an answer it should not have: it would end its turn.
  const quiet = yield* since(w.owner, mark);
  expect(tagged(quiet, "PermissionAnswered")).toHaveLength(0);
  expect(tagged(quiet, "TurnEnded", agent.agentId), "the agent went on after an answer the log does not hold").toHaveLength(0);
  expect(threadText(quiet, agent.agentId)).not.toContain("permission:selected");
  const answerSeen = peekEcho(agent.echo)!.inbound.some((frame) => (frame as { result?: unknown }).result !== undefined && (frame as { id?: number }).id === 9001);
  expect(answerSeen, "the permission answer reached the agent").toBe(false);
}));
