import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { drainAgent, eventsUntil, isTag, requestId, scenario, stopAllServices, tagged, type Started } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("6.2 an all-mode hand-off to three workers wakes its lead once after all replies, even when one worker crashes and resumes (breaks if one reply closes the collection or the final completion is lost or duplicated)", (w) => Effect.gen(function* () {
  // This journey owns the resume and counts only the collection's lead wake.
  yield* w.owner["roles.settings.set"]({ requestId: requestId(), settings: { stallWatch: false } } as never);
  const lead = yield* w.start(w.owner, { name: "Lead", role: "lead", prompt: "Ready." });
  const leadClient = yield* w.asAgent((yield* w.token(lead)).token);
  const workers: Started[] = [];
  for (const [index, name] of ["Worker A", "Worker B", "Worker C"].entries()) {
    workers.push(yield* w.start(leadClient, { name, prompt: "Ready.", ...(index === 1 ? { script: { turns: [[], [{ step: "crash", exitCode: 17 }]] } } : {}) }));
  }
  const ids = [lead.agentId, ...workers.map((worker) => worker.agentId)];
  for (const agentId of ids) {
    yield* eventsUntil(w.owner, 0, `agent ${agentId} to finish its startup turn`, (row) => row.event._tag === "TurnEnded" && row.agentId === agentId);
  }
  const channel = yield* w.owner["board.open"]({ requestId: requestId(), name: "worker-collection" } as never);
  const channelId = (channel as { channelId: string }).channelId;
  yield* w.owner["board.members"]({ requestId: requestId(), channelId, add: ids, remove: [] } as never);

  const beforePost = yield* w.watermark();
  const post = yield* leadClient["board.post"]({ requestId: requestId(), channelId, text: "Complete this hand-off.",
    to: workers.map((worker) => ({ _tag: "agent", agentId: worker.agentId })), reply: "all" } as never);
  const postId = (post as { postId: string }).postId;
  const deliveries = yield* eventsUntil(w.owner, beforePost, "all three workers to receive the hand-off", (row) =>
    row.event._tag === "DeliverySent" && row.agentId === workers.at(-1)!.agentId, 20_000);
  for (const worker of workers) expect(tagged(deliveries, "DeliverySent", worker.agentId)).toHaveLength(1);

  const restarting = workers[1]!;
  const prior = yield* w.token(restarting);
  yield* eventsUntil(w.owner, beforePost, "the interrupted worker to be recorded crashed", isTag("AgentCrashed", restarting.agentId), 15_000);
  const resumeMark = yield* w.watermark();
  yield* w.owner.resume({ requestId: requestId(), agentId: restarting.agentId } as never);
  yield* eventsUntil(w.owner, resumeMark, "the crashed worker's session to reopen", isTag("SessionOpened", restarting.agentId), 15_000);
  const resumed = yield* w.token(restarting, prior.pid);

  for (const worker of workers) {
    const client = worker.agentId === restarting.agentId ? yield* w.asAgent(resumed.token) : yield* w.asAgent((yield* w.token(worker)).token);
    yield* client["board.post"]({ requestId: requestId(), channelId, text: `${worker.agentId} completed.`, to: [], reply: "none", replyTo: postId } as never);
  }

  const wakeIds = new Set<string>();
  const deliveriesForCompletion = new Set<string>();
  yield* eventsUntil(w.owner, beforePost, "the collection completion to be accepted by its lead", (row) => {
    if (row.event._tag === "board.WakeBuilt" && row.event.targetAgentId === lead.agentId && row.event.completions.includes(postId as never)) wakeIds.add(row.event.wakeId);
    if (row.event._tag === "DeliveryQueued" && row.event.delivery.source?._tag === "piece"
      && row.event.delivery.source.namespace === "board" && wakeIds.has(row.event.delivery.source.id)) deliveriesForCompletion.add(row.event.delivery.id);
    return row.event._tag === "DeliveryAccepted" && deliveriesForCompletion.has(row.event.deliveryId);
  }, 15_000);
  const completion = yield* drainAgent(w.owner, lead.agentId, beforePost);
  const wakes = completion.filter((row) => row.event._tag === "board.WakeBuilt"
    && row.event.targetAgentId === lead.agentId && row.event.completions.includes(postId as never));
  expect(wakes, "exactly one logical completion for this collection, excluding the engine crash notice").toHaveLength(1);
  const wakeId = (wakes[0]!.event as { wakeId: string }).wakeId;
  const queued = completion.filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.source?._tag === "piece"
    && row.event.delivery.source.namespace === "board" && row.event.delivery.source.id === wakeId);
  expect(queued).toHaveLength(1);
  const deliveryId = (queued[0]!.event as { delivery: { id: string } }).delivery.id;
  for (const tag of ["DeliverySent", "DeliveryAccepted"] as const) {
    expect(completion.filter((row) => row.event._tag === tag && row.event.deliveryId === deliveryId)).toHaveLength(1);
  }
  const acceptedCompletion = completion.find((row) => row.event._tag === "DeliveryAccepted" && row.event.deliveryId === deliveryId)!;
  const drainQueued = completion.find((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.target === lead.agentId
    && row.event.delivery.content._tag === "prompt" && row.event.delivery.content.text === "Finish the acceptance drain boundary.")!;
  expect(acceptedCompletion.sequence, "the completion must be accepted before the independent terminal drain boundary").toBeLessThan(drainQueued.sequence);
  const own = yield* w.owner["board.status"]({ requestId: requestId(), agentId: lead.agentId, detail: "own" } as never);
  expect((own as { readonly items: ReadonlyArray<unknown> }).items).toHaveLength(0);
}));
