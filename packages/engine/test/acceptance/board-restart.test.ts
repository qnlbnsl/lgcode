import { rmSync, writeFileSync } from "node:fs";

import { afterEach, expect } from "@effect/vitest";
import type { Event } from "@lgtm/contracts";
import * as Effect from "effect/Effect";

import { drainAgent, eventsUntil, isTag, peekEcho, requestId, scenario, since, stopAllServices, tagged, waitFor } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("6.5 a queued board wake that was not sent before a service restart is sent once afterwards (breaks if the wake is lost or sent twice)", (w) => Effect.gen(function* () {
  const gate = `${w.root.root}/board-startup-gate`;
  const target = yield* w.start(w.owner, { name: "Busy target", prompt: "Hold this turn.", script: { turns: [[{ step: "wait_for_file", path: gate }], []] } });
  yield* eventsUntil(w.owner, 0, "the target's startup prompt to be sent", isTag("DeliverySent", target.agentId));
  const prior = yield* w.token(target);
  const channel = yield* w.owner["board.open"]({ requestId: requestId(), name: "queued-before-restart" } as never);
  const channelId = (channel as { channelId: string }).channelId;
  yield* w.owner["board.members"]({ requestId: requestId(), channelId, add: [target.agentId], remove: [] } as never);
  const before = yield* w.watermark();
  yield* w.owner["board.post"]({ requestId: requestId(), channelId, text: "Queued while busy.", to: [{ _tag: "agent", agentId: target.agentId }], reply: "all" } as never);
  const queuedEvents = yield* since(w.owner, before);
  const boardQueued = queuedEvents.filter((row) => row.event._tag === "DeliveryQueued"
    && row.event.delivery.source?._tag === "piece" && row.event.delivery.source.namespace === "board");
  expect(boardQueued).toHaveLength(1);
  const queuedEvent = boardQueued[0]!.event as Extract<Event, { _tag: "DeliveryQueued" }>;
  const deliveryId = queuedEvent.delivery.id;
  expect(queuedEvents.filter((row) => row.event._tag === "DeliverySent"
    && (row.event as unknown as { deliveryId: string }).deliveryId === deliveryId)).toHaveLength(0);

  yield* w.kill("SIGKILL");
  yield* w.boot();
  yield* w.token(target, prior.pid);
  writeFileSync(gate, "go");
  yield* eventsUntil(w.owner, before, "the queued board wake to be accepted after restart", (row) =>
    row.event._tag === "DeliveryAccepted" && row.event.deliveryId === deliveryId, 20_000);
  const sent = yield* drainAgent(w.owner, target.agentId, before);
  expect(tagged(sent, "DeliverySent").filter((row) => (row.event as unknown as { deliveryId: string }).deliveryId === deliveryId)).toHaveLength(1);
}));

scenario("6.5 a sent board wake without replay proof may be delivered again after restart but remains one logical wake (breaks if restart builds duplicate board work)", (w) => Effect.gen(function* () {
  const gate = `${w.root.root}/board-sent-gate`;
  const recoveredTurn = `${w.root.root}/board-recovered-turn`;
  writeFileSync(recoveredTurn, "go");
  const target = yield* w.start(w.owner, { name: "Sent target", prompt: "Ready.", script: { turns: [[{ step: "wait_for_file", path: recoveredTurn }], [{ step: "wait_for_file", path: gate }]] } });
  yield* eventsUntil(w.owner, 0, "the target's startup turn", (row) => row.event._tag === "TurnEnded" && row.agentId === target.agentId);
  // The fake starts its turn script again when reloaded. Hold that turn so
  // socket readiness cannot accidentally stand in for reminder readiness.
  rmSync(recoveredTurn);
  const prior = yield* w.token(target);
  const channel = yield* w.owner["board.open"]({ requestId: requestId(), name: "sent-before-restart" } as never);
  const channelId = (channel as { channelId: string }).channelId;
  yield* w.owner["board.members"]({ requestId: requestId(), channelId, add: [target.agentId], remove: [] } as never);
  const before = yield* w.watermark();
  yield* w.owner["board.post"]({ requestId: requestId(), channelId, text: "Sent without proof.", to: [{ _tag: "agent", agentId: target.agentId }], reply: "all" } as never);
  const sent = yield* eventsUntil(w.owner, before, "the board wake to be sent", isTag("DeliverySent", target.agentId));
  const delivery = sent.find((row) => row.event._tag === "DeliverySent")!.event as unknown as { deliveryId: string };

  const beforeRestart = yield* w.watermark();
  yield* w.kill("SIGKILL");
  yield* w.boot();
  const reloaded = yield* w.token(target, prior.pid);
  const owner = yield* w.reopenOwner();
  // Boot may finish while the re-sent original or carry-on is still working.
  // A reminder is due only after that response turn ends.
  yield* waitFor("the recovered prompt to reach the restarted adapter", () => {
    const echo = peekEcho(target.echo);
    return echo?.pid === reloaded.pid && echo.inbound.some((frame) => frame.method === "session/prompt");
  });
  yield* eventsUntil(owner, beforeRestart, "the recovered response turn to be sent", isTag("DeliverySent", target.agentId));
  const recovering = yield* since(owner, before);
  expect(recovering.some((row) => row.sequence > beforeRestart && row.agentId === target.agentId && row.event._tag === "TurnEnded")).toBe(false);
  expect(recovering.some((row) => row.event._tag === "board.WakeBuilt" && row.event.targetAgentId === target.agentId && row.event.reminders.length > 0)).toBe(false);
  writeFileSync(recoveredTurn, "go");
  yield* eventsUntil(owner, before, "the post-restart response turn to produce its reminder", (row) =>
    row.event._tag === "board.WakeBuilt" && row.event.targetAgentId === target.agentId && row.event.reminders.length > 0);
  const history = yield* since(owner, before);
  const wakes = history.flatMap((row) => row.event._tag === "board.WakeBuilt"
    && (row.event as unknown as { targetAgentId: string }).targetAgentId === target.agentId
    ? [row.event as unknown as { carried: string[]; reminders: string[] }]
    : []);
  expect(wakes.filter((wake) => wake.carried.includes((history.find((row) => row.event._tag === "board.PostWritten")!.event as unknown as { postId: string }).postId))).toHaveLength(1);
  expect(wakes.filter((wake) => wake.reminders.length > 0)).toHaveLength(1);
  const status = yield* owner["board.status"]({ requestId: requestId(), agentId: target.agentId } as never);
  expect(status).toMatchObject({ incomingOpen: 1 });
  expect((status as { wakeQueued: boolean; wakeSent: boolean }).wakeQueued || (status as { wakeQueued: boolean; wakeSent: boolean }).wakeSent).toBe(true);
  expect(history.filter((row) => row.event._tag === "DeliverySent"
    && (row.event as unknown as { deliveryId: string }).deliveryId === delivery.deliveryId).length).toBeGreaterThanOrEqual(1);
}));

scenario("6.5 a sent board question to a non-reloadable addressee is resolved as gone after restart and remains one logical open matter (breaks if restart loses the question or leaves an impossible recipient pending)", (w) => Effect.gen(function* () {
  const asker = yield* w.start(w.owner, { name: "Asker", prompt: "Ready." });
  const gate = `${w.root.root}/non-reloadable-held-turn`;
  const recipient = yield* w.start(w.owner, {
    name: "Non-reloadable", prompt: "Ready.",
    script: { reloadable: false, turns: [[], [{ step: "wait_for_file", path: gate }]] },
  });
  for (const agentId of [asker.agentId, recipient.agentId]) {
    yield* eventsUntil(w.owner, 0, `agent ${agentId} to be ready`, (row) => row.event._tag === "TurnEnded" && row.agentId === agentId);
  }
  const channel = yield* w.owner["board.open"]({ requestId: requestId(), name: "restart-questions" } as never);
  const channelId = (channel as { channelId: string }).channelId;
  yield* w.owner["board.members"]({ requestId: requestId(), channelId, add: [asker.agentId, recipient.agentId], remove: [] } as never);
  const askerClient = yield* w.asAgent((yield* w.token(asker)).token);
  const before = yield* w.watermark();
  const post = yield* askerClient["board.post"]({ requestId: requestId(), channelId, text: "Please decide.", to: [{ _tag: "agent", agentId: recipient.agentId }], reply: "all" } as never);
  const postId = (post as { postId: string }).postId;
  const sent = yield* eventsUntil(w.owner, before, "the question wake to be sent", isTag("DeliverySent", recipient.agentId));
  expect(tagged(sent, "DeliverySent", recipient.agentId)).toHaveLength(1);

  const killed = yield* w.kill("SIGKILL");
  expect(killed.signal).toBe("SIGKILL");
  yield* w.boot();
  const owner = yield* w.reopenOwner();
  const afterRestart = yield* since(owner, before);
  const resolved = afterRestart.filter((row) => row.event._tag === "board.AddresseeResolved"
    && (row.event as unknown as { postId: string; disposition: string }).postId === postId);
  const gone = resolved.filter((row) => (row.event as unknown as { disposition: string }).disposition === "gone");
  expect(gone).toHaveLength(1);
  expect(gone[0]!.event).toMatchObject({ addressee: { _tag: "agent", agentId: recipient.agentId } });
  expect(tagged(afterRestart, "board.PostClosed").filter((row) => (row.event as unknown as { postId: string }).postId === postId)).toHaveLength(1);
  expect(tagged(afterRestart, "DeliverySent", asker.agentId).length).toBeGreaterThan(0);
}));
