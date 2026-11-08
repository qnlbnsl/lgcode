// Failure rule 1: an agent crashes. The engine records "agent crashed" with the
// exit code and the last lines of the agent's error output, secrets removed;
// the agent's open permission requests close as cancelled; whoever waits on it
// is woken once; the parent is told (the owner, for an owner-started agent,
// by an "owner needed" event); and nothing restarts it. Criteria 8.3 to 8.5.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  alive, eventsUntil, isTag, peekEcho, promptsOf, refusal, requestId, scenario, since, stopAllServices, tagged, waitFor,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

// A permission request written straight to the engine without waiting for its
// answer, so the agent can die with the request still open (the fake agent's
// `permission` step blocks until it is answered). The frame is the wire shape
// of `session/request_permission`.
const openRequest = (toolCallId: string) => ({
  step: "raw_frame",
  frame: JSON.stringify({
    jsonrpc: "2.0", id: 9001, method: "session/request_permission",
    params: {
      sessionId: "${session}", title: "Write the file",
      subject: { type: "tool_call", toolCall: { toolCallId, title: "Write the file" } },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    },
  }),
});

scenario("1 crash: the crash is written with the exit code and the error output's last lines without the agent's token, its open permission request is cancelled, the owner is told once, its token stops working, and nothing starts the agent again (breaks if the code or output is lost, the output carries a secret, the request stays open, the owner is not told, or the engine restarts the agent)", (w) => Effect.gen(function* () {
  const mark = yield* w.watermark();
  const agent = yield* w.start(w.owner, {
    name: "Crasher", permission: "ask", prompt: "Go.",
    script: { turns: [[
      { step: "stderr", text: "first line of trouble" },
      { step: "stderr", text: "kaboom-from-stderr, token=${env:LGCODE_TOKEN}" },
      openRequest("call-crash"),
      { step: "slow", ms: 400 },
      { step: "crash", exitCode: 3 },
    ]] },
  });
  const events = yield* eventsUntil(w.owner, mark, "the crash", isTag("AgentCrashed", agent.agentId), 30_000);
  const crashed = tagged(events, "AgentCrashed", agent.agentId);
  expect(crashed).toHaveLength(1);
  const crash = crashed[0]!.event as unknown as { exitCode: number | null; stderr: string };
  expect(crash.exitCode).toBe(3);
  expect(crash.stderr).toContain("kaboom-from-stderr");
  expect(crash.stderr).toContain("first line of trouble");
  const { token, pid } = yield* w.token(agent);
  expect(crash.stderr, "the agent's token reached the crash record").not.toContain(token);

  // Everything the crash caused is in one place: read the log after it.
  const settled = yield* since(w.owner, mark);
  const requested = tagged(settled, "PermissionRequested", agent.agentId);
  expect(requested).toHaveLength(1);
  const requestIdValue = (requested[0]!.event as unknown as { permissionRequestId: string }).permissionRequestId;
  const cancelled = tagged(settled, "PermissionCancelled", agent.agentId);
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]!.event).toMatchObject({ permissionRequestId: requestIdValue });
  expect(cancelled[0]!.sequence).toBeGreaterThan(requested[0]!.sequence);
  expect(tagged(settled, "PermissionAnswered", agent.agentId), "a crash answered the request").toHaveLength(0);
  const needed = tagged(settled, "OwnerNeeded", agent.agentId).filter((envelope) => envelope.sequence > requested[0]!.sequence);
  const crashNotices = (events: typeof needed) => events.filter((envelope) => (envelope.event as unknown as { reason: string }).reason === "agent crashed");
  expect(crashNotices(needed), "the owner was not told about the crash exactly once").toHaveLength(1);

  // The engine does not restart it: the process is gone, the token is dead, and no start follows.
  yield* waitFor("the crashed process to be gone", () => (alive(pid) ? undefined : true));
  const client = yield* w.asAgent(token).pipe(Effect.orElseSucceed(() => undefined));
  if (client !== undefined) expect(yield* refusal(client.ask({ requestId: requestId(), text: "Still here?" } as never)), "a crashed agent's token still works").toBeDefined();
  expect(tagged(yield* since(w.owner, crashed[0]!.sequence), "SessionOpened", agent.agentId), "the engine opened a new session for a crashed agent").toHaveLength(0);
  expect(tagged(yield* since(w.owner, crashed[0]!.sequence), "AgentStarted", agent.agentId)).toHaveLength(0);
  expect(peekEcho(agent.echo)!.pid, "a second process wrote the echo file").toBe(pid);
  // Late duplicates: the owner is still told once after everything above settled.
  yield* Effect.sleep(1_000);
  const lastLook = tagged(yield* since(w.owner, mark), "OwnerNeeded", agent.agentId).filter((envelope) => envelope.sequence > requested[0]!.sequence);
  expect(crashNotices(lastLook), "the owner was told about the crash more than once").toHaveLength(1);
}));

scenario("1 crash: a parent that waits on the crashing child is woken once and the owner is not bothered (breaks if the waiter is never woken, woken twice, or the owner is called although a parent can act)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const gate = join(w.root.root, "gate-crash");
  const child = yield* w.start(bossClient, {
    name: "Doomed", permission: "ask", prompt: "Work.",
    script: { turns: [[{ step: "wait_for_file", path: gate }, { step: "crash", exitCode: 7 }]] },
  });
  yield* eventsUntil(w.owner, 0, "the child to start work", isTag("DeliverySent", child.agentId));
  const mark = yield* w.watermark();
  const opened = yield* bossClient.wait({ requestId: requestId(), members: [child.agentId], mode: "all", block: false } as never) as unknown as Effect.Effect<{ outcome: string }>;
  expect(opened.outcome).toBe("opened");

  writeFileSync(gate, "go");
  yield* eventsUntil(w.owner, mark, "the boss to take the wake", isTag("DeliveryAccepted", boss.agentId), 30_000);
  const settled = yield* since(w.owner, mark);
  expect(tagged(settled, "AgentCrashed", child.agentId)).toHaveLength(1);
  const wakes = tagged(settled, "DeliveryQueued").filter((envelope) => {
    const delivery = (envelope.event as unknown as { delivery: { target: string; source?: { _tag: string } } }).delivery;
    return delivery.target === boss.agentId && delivery.source?._tag === "wait";
  });
  expect(wakes, "the waiter was not woken exactly once").toHaveLength(1);
  expect(tagged(settled, "WaitSatisfied")).toHaveLength(1);
  expect(promptsOf(peekEcho(boss.echo)!).join("\n")).toMatch(/crashed/i);
  expect(tagged(settled, "OwnerNeeded", child.agentId), "the owner was called although the parent can act").toHaveLength(0);
}));
