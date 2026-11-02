// Capability 8: reach the owner. A request passed up to the owner, or a
// question for the owner, produces an "owner needed" event, which the client
// API turns into a phone alert. Criteria 8.3 to 8.5.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import type { EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";

import { eventsUntil, isTag, next, peekEcho, promptsOf, requestId, scenario, stopAllServices, tagged, waitFor } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const options = [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }];

scenario("8 owner: an agent the owner started that asks a question produces one OwnerNeeded event naming the question, and the owner's answer comes back to the asker (breaks if the question never raises OwnerNeeded or the answer is lost)", (w) => Effect.gen(function* () {
  const agent = yield* w.start(w.owner, { name: "Curious", permission: "ask", prompt: "Hello." });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", agent.agentId));
  const client = yield* w.asAgent((yield* w.token(agent)).token);
  const mark = yield* w.watermark();
  const asked = yield* client.ask({ requestId: requestId(), text: "Which database should I use?" } as never) as unknown as Effect.Effect<{ questionId: string }>;
  const events = yield* eventsUntil(w.owner, mark, "the owner to be told", isTag("OwnerNeeded", agent.agentId));
  expect(tagged(events, "QuestionAsked")[0]!.event).toMatchObject({
    questionId: asked.questionId, holder: { _tag: "owner" }, text: "Which database should I use?",
  });
  const needed = tagged(events, "OwnerNeeded", agent.agentId);
  expect(needed).toHaveLength(1);
  expect(needed[0]!.event).toMatchObject({ subject: { _tag: "question", id: asked.questionId } });

  const answerMark = yield* w.watermark();
  yield* w.owner.answer({ requestId: requestId(), kind: "question", id: asked.questionId, text: "Use SQLite." } as never);
  const answered = yield* eventsUntil(w.owner, answerMark, "the answer to be accepted", isTag("DeliveryAccepted", agent.agentId));
  expect(tagged(answered, "QuestionAnswered")[0]!.event).toMatchObject({ questionId: asked.questionId, answeredBy: { _tag: "owner" }, text: "Use SQLite." });
  const received = yield* waitFor("the asker to receive the answer", () => {
    const text = promptsOf(peekEcho(agent.echo)!).join("\n");
    return text.includes("Use SQLite.") ? text : undefined;
  });
  expect(received).toContain("Use SQLite.");
  // Once answered, a later pass raises nothing more for the same question.
  expect(tagged(yield* eventsUntil(w.owner, answerMark, "the turn end", isTag("TurnEnded", agent.agentId)), "OwnerNeeded")).toHaveLength(0);
}));

scenario("8 owner: a permission request from an agent the owner started goes straight to the owner with one OwnerNeeded event (breaks if no alert event is raised for a permission request)", (w) => Effect.gen(function* () {
  const before = yield* w.watermark();
  const agent = yield* w.start(w.owner, {
    name: "Asker", permission: "ask", prompt: "Go.",
    script: { turns: [[{ step: "permission", toolCallId: "call-1", title: "Write file", options }]] },
  });
  const events = yield* eventsUntil(w.owner, before, "the owner to be told", isTag("OwnerNeeded", agent.agentId));
  const requested = tagged(events, "PermissionRequested", agent.agentId);
  expect(requested).toHaveLength(1);
  const id = (requested[0]!.event as unknown as { permissionRequestId: string }).permissionRequestId;
  expect(requested[0]!.event).toMatchObject({ holder: { _tag: "owner" } });
  expect(tagged(events, "OwnerNeeded", agent.agentId)).toHaveLength(1);
  expect(tagged(events, "OwnerNeeded", agent.agentId)[0]!.event).toMatchObject({ subject: { _tag: "permission", id } });
  yield* w.owner.answer({ requestId: requestId(), kind: "permission", id, optionId: "allow-once" } as never);
  yield* eventsUntil(w.owner, before, "the turn end", isTag("TurnEnded", agent.agentId));
}));

scenario("8 owner: a question a boss passes up to the owner produces OwnerNeeded for that question (breaks if pass-up of a question raises no alert)", (w) => Effect.gen(function* () {
  const gate = join(w.root.root, "gate-boss");
  const boss = yield* w.start(w.owner, {
    name: "Boss", role: "lead", permission: "edit", prompt: "Start.",
    script: { turns: [[], [{ step: "wait_for_file", path: gate }]] },
  });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const child = yield* w.start(bossClient, { name: "Child", permission: "ask", prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "the child's first turn", isTag("TurnEnded", child.agentId));
  const childClient = yield* w.asAgent((yield* w.token(child)).token);
  const mark = yield* w.watermark();
  const asked = yield* childClient.ask({ requestId: requestId(), text: "May I delete the folder?" } as never) as unknown as Effect.Effect<{ questionId: string }>;
  const held = yield* next(w.owner, mark, "the question", (e: EventEnvelope) => e.event._tag === "QuestionAsked");
  expect(held.event).toMatchObject({ questionId: asked.questionId, holder: { _tag: "agent", agentId: boss.agentId } });
  const passMark = yield* w.watermark();
  yield* bossClient["pass-up"]({ requestId: requestId(), subject: { _tag: "question", id: asked.questionId } } as never);
  const events = yield* eventsUntil(w.owner, passMark, "the owner to be told", isTag("OwnerNeeded", child.agentId));
  expect(tagged(events, "QuestionMoved")[0]!.event).toMatchObject({ questionId: asked.questionId, from: { _tag: "agent", agentId: boss.agentId }, to: { _tag: "owner" } });
  expect(tagged(events, "OwnerNeeded", child.agentId)[0]!.event).toMatchObject({ subject: { _tag: "question", id: asked.questionId } });
  writeFileSync(gate, "go");
}));
