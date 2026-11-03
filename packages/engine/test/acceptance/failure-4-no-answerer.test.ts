// Failure rule 4: a permission request has nobody to answer it. When the agent
// it is routed to has stopped or crashed, it moves up to that agent's parent
// and finally to the owner, and nothing ever answers it by itself.
// Criteria 8.3 to 8.5.
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  alive, eventsUntil, isTag, requestId, scenario, since, stopAllServices, tagged, threadText, waitFor,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const options = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
];

type Moved = { permissionRequestId: string; from: { _tag: string; agentId?: string }; to: { _tag: string; agentId?: string } };

scenario("4 no answerer: when the holder is stopped the request moves to its parent, then to the owner when that parent stops too, and no timeout or stop answers it (breaks if the request stays with a stopped agent, skips a live ancestor, is closed or answered by the move, or the owner is not told)", (w) => Effect.gen(function* () {
  // Each holder's second turn stays open, so it still holds the request when it arrives
  // (a holder whose turn ends without answering passes the request up by itself).
  const gate = join(w.root.root, "gate-holders");
  const top = yield* w.start(w.owner, {
    name: "Top", role: "lead", permission: "edit", prompt: "Start.",
    script: { turns: [[], [{ step: "wait_for_file", path: gate }]] },
  });
  yield* eventsUntil(w.owner, 0, "the top agent's turn", isTag("TurnEnded", top.agentId));
  const topClient = yield* w.asAgent((yield* w.token(top)).token);
  const middle = yield* w.start(topClient, {
    name: "Middle", role: "lead", permission: "edit", prompt: "Start.",
    script: { turns: [[], [{ step: "wait_for_file", path: gate }]] },
  });
  yield* eventsUntil(w.owner, 0, "the middle agent's turn", isTag("TurnEnded", middle.agentId));
  const middleClient = yield* w.asAgent((yield* w.token(middle)).token);
  const child = yield* w.start(middleClient, {
    name: "Asker", permission: "ask", prompt: "Go.",
    script: { turns: [[{ step: "permission", toolCallId: "call-none", title: "Write the file", options }]] },
  });
  const requested = yield* eventsUntil(w.owner, 0, "the request", isTag("PermissionRequested", child.agentId));
  const id = (tagged(requested, "PermissionRequested", child.agentId)[0]!.event as unknown as { permissionRequestId: string }).permissionRequestId;
  expect(tagged(requested, "PermissionRequested", child.agentId)[0]!.event).toMatchObject({ holder: { _tag: "agent", agentId: middle.agentId } });

  // The holder stops: the request goes to the holder's parent, not to the owner.
  const firstMark = yield* w.watermark();
  yield* topClient.stop({ requestId: requestId(), agentId: middle.agentId } as never);
  const first = yield* since(w.owner, firstMark);
  const firstMove = tagged(first, "PermissionMoved", child.agentId);
  expect(firstMove, "the request did not leave the stopped holder").toHaveLength(1);
  expect(firstMove[0]!.event as unknown as Moved).toMatchObject({
    permissionRequestId: id, from: { _tag: "agent", agentId: middle.agentId }, to: { _tag: "agent", agentId: top.agentId },
  });
  expect(tagged(first, "OwnerNeeded", child.agentId), "the owner was called although a live parent can answer").toHaveLength(0);

  // The parent stops too: the request reaches the owner, who is told it is needed.
  const secondMark = yield* w.watermark();
  yield* w.owner.stop({ requestId: requestId(), agentId: top.agentId } as never);
  const second = yield* since(w.owner, secondMark);
  const secondMove = tagged(second, "PermissionMoved", child.agentId);
  expect(secondMove, "the request did not leave the second stopped holder").toHaveLength(1);
  expect(secondMove[0]!.event as unknown as Moved).toMatchObject({ from: { _tag: "agent", agentId: top.agentId }, to: { _tag: "owner" } });
  expect(tagged(second, "OwnerNeeded", child.agentId)[0]?.event).toMatchObject({ subject: { _tag: "permission", id } });

  // Nothing answered or closed it: it is still open until the owner decides.
  const all = yield* since(w.owner, 0);
  expect(tagged(all, "PermissionAnswered", child.agentId), "a stop answered the request").toHaveLength(0);
  expect(tagged(all, "PermissionCancelled", child.agentId), "a stop closed the request").toHaveLength(0);

  yield* w.owner.answer({ requestId: requestId(), kind: "permission", id, optionId: "allow-once" } as never);
  const finished = yield* eventsUntil(w.owner, 0, "the asker's turn", isTag("TurnEnded", child.agentId));
  expect(tagged(finished, "PermissionAnswered", child.agentId)[0]!.event).toMatchObject({ answeredBy: { _tag: "owner" }, answer: { optionId: "allow-once" } });
  expect(threadText(finished, child.agentId)).toContain("permission:selected:allow-once");
}));

scenario("4 no answerer: when the holder crashes the request moves up to the owner and stays open, and a late answer from the owner still reaches the asker (breaks if a crash leaves the request with the dead holder, cancels it, or answers it)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, {
    name: "Fragile boss", role: "lead", permission: "edit", prompt: "Start.",
    script: { turns: [[], [{ step: "plan", entries: [] }, { step: "crash", exitCode: 9 }]] },
  });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const { token, pid } = yield* w.token(boss);
  const bossClient = yield* w.asAgent(token);
  const child = yield* w.start(bossClient, {
    name: "Asker", permission: "ask", prompt: "Go.",
    script: { turns: [[{ step: "permission", toolCallId: "call-crash-holder", title: "Write the file", options }]] },
  });
  const requested = yield* eventsUntil(w.owner, 0, "the request", isTag("PermissionRequested", child.agentId));
  const id = (tagged(requested, "PermissionRequested", child.agentId)[0]!.event as unknown as { permissionRequestId: string }).permissionRequestId;

  // The request's own notice is a prompt to the idle boss: the engine delivers it as soon as the request is
  // routed, so the boss's second turn starts by itself and the scripted crash follows. A prompt from the owner
  // would race with that turn and be refused once the boss had crashed (issue 208). The mark is the request
  // itself, so the notice, the crash and the move all lie after it however fast they come.
  const mark = requested[requested.length - 1]!.sequence;
  const events = yield* eventsUntil(w.owner, mark, "the owner to be told", isTag("OwnerNeeded", child.agentId), 30_000);
  expect(tagged(events, "AgentCrashed", boss.agentId)).toHaveLength(1);
  const move = tagged(events, "PermissionMoved", child.agentId);
  expect(move).toHaveLength(1);
  expect(move[0]!.event as unknown as Moved).toMatchObject({ permissionRequestId: id, from: { _tag: "agent", agentId: boss.agentId }, to: { _tag: "owner" } });
  yield* waitFor("the boss process to be gone", () => (alive(pid) ? undefined : true));

  const settled = yield* since(w.owner, mark);
  expect(tagged(settled, "PermissionAnswered", child.agentId), "the crash answered the request").toHaveLength(0);
  expect(tagged(settled, "PermissionCancelled", child.agentId), "the crash closed the asker's request, but the asker is still alive").toHaveLength(0);

  yield* w.owner.answer({ requestId: requestId(), kind: "permission", id, optionId: "reject-once" } as never);
  const finished = yield* eventsUntil(w.owner, mark, "the asker's turn", isTag("TurnEnded", child.agentId));
  expect(tagged(finished, "PermissionAnswered", child.agentId)[0]!.event).toMatchObject({ answeredBy: { _tag: "owner" }, answer: { optionId: "reject-once" } });
  expect(threadText(finished, child.agentId)).toContain("permission:selected:reject-once");
}));
