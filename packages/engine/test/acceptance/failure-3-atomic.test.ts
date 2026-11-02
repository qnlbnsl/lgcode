// Failure rule 3: nothing is half-written. A command's events are written in
// one transaction, and a resent request id acts once. Criteria 8.3 to 8.5.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  eventsUntil, isTag, peekEcho, plantDatabaseFault, promptsOf, refusal, requestId, scenario, since, stopAllServices, tagged,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const options = [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }];

scenario("3 atomic: a prompt sent twice with the same request id queues one message, sends it once, and both calls get the same delivery id (breaks if a resent request acts twice or answers differently)", (w) => Effect.gen(function* () {
  const agent = yield* w.start(w.owner, { name: "Listener", permission: "ask", prompt: "Hello." });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", agent.agentId));
  const mark = yield* w.watermark();
  const same = requestId();
  const send = () => w.owner.prompt({ requestId: same, agentId: agent.agentId, text: "Only once." } as never) as unknown as Effect.Effect<{ deliveryId: string }>;
  const first = yield* send();
  const second = yield* send();
  expect(second.deliveryId, "the resent request got a different delivery").toBe(first.deliveryId);
  const events = yield* eventsUntil(w.owner, mark, "the message to be taken", isTag("DeliveryAccepted", agent.agentId));
  const settled = yield* since(w.owner, mark);
  expect(tagged(settled, "DeliveryQueued"), "the resent request queued a second message").toHaveLength(1);
  expect(tagged(settled, "DeliverySent")).toHaveLength(1);
  expect(promptsOf(peekEcho(agent.echo)!).filter((text) => text === "Only once.")).toHaveLength(1);
  void events;
}));

scenario("3 atomic: a start sent twice with the same request id creates one agent, and the same id with a different request is refused while another caller's identical id is a separate request (breaks if a resent start makes two agents, a reused id with different content is accepted, or ids are shared across callers)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const mark = yield* w.watermark();
  const same = requestId();
  const begin = (name: string, client = w.owner) => client.start({
    requestId: same, name, role: "worker", harness: "fake", account: { _tag: "named", accountId: boss.accountId },
    permission: "ask", folder: w.root.work, runMode: "acp", groups: [],
  } as never) as Effect.Effect<{ agentId: string }, unknown>;

  const first = yield* begin("Twin");
  const second = yield* begin("Twin");
  expect(second.agentId, "the resent start made another agent").toBe(first.agentId);
  expect(yield* refusal(begin("Different"))).toBe("request id reused");
  // The boss reuses the owner's id for its own request: a different request, so it acts.
  const mine = yield* begin("Boss's child", bossClient);
  expect(mine.agentId).not.toBe(first.agentId);

  yield* eventsUntil(w.owner, mark, "the second agent to open its session", isTag("SessionOpened", mine.agentId));
  const settled = yield* since(w.owner, mark);
  expect(tagged(settled, "AgentStarted").map((envelope) => envelope.agentId).sort()).toEqual([first.agentId, mine.agentId].sort());
}));

scenario("3 atomic: when a command's last event cannot be written, none of its earlier events are in the log either and the call reports the database failure (breaks if events are written one at a time, so a failed command leaves part of itself in the log, or the failure is reported as success)", (w) => Effect.gen(function* () {
  const gate = join(w.root.root, "gate-atomic");
  const boss = yield* w.start(w.owner, {
    name: "Boss", role: "lead", permission: "edit", prompt: "Start.",
    script: { turns: [[], [{ step: "wait_for_file", path: gate }]] },
  });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const child = yield* w.start(bossClient, {
    name: "Child", permission: "ask", prompt: "Go.",
    script: { turns: [[{ step: "permission", toolCallId: "call-atomic", title: "Write the file", options }]] },
  });
  const requested = yield* eventsUntil(w.owner, 0, "the request to reach the boss", isTag("PermissionRequested", child.agentId));
  const id = (requested.at(-1)!.event as unknown as { permissionRequestId: string }).permissionRequestId;
  expect(requested.at(-1)!.event).toMatchObject({ holder: { _tag: "agent", agentId: boss.agentId } });

  // Passing a request up writes "moved" and then "owner needed" in one command.
  plantDatabaseFault(w.root, "CREATE TRIGGER planted_atomic BEFORE INSERT ON events WHEN NEW.event_type = 'OwnerNeeded' BEGIN SELECT RAISE(ABORT, 'planted failure'); END", "SELECT 1");
  const mark = yield* w.watermark();
  const failed = yield* refusal(bossClient["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id } } as never));
  expect(failed, "the command succeeded although its last event could not be written").toMatch(/^database write failed/);
  const after = yield* since(w.owner, mark);
  expect(tagged(after, "PermissionMoved"), "part of the failed command is in the log").toHaveLength(0);
  expect(tagged(after, "OwnerNeeded")).toHaveLength(0);

  // The final comparison of the views with a rebuild from the log shows the failed command left nothing in either.
  writeFileSync(gate, "go");
}));
