import { join } from "node:path";
import type { EventEnvelope } from "@shephrd/contracts";
import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { serve } from "../../src/api/server.ts";
import { lifecycleBatch } from "../../src/board/reactor.ts";
import { writePieceBatch } from "../../src/commands/pieceBatch.ts";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { agentIdOf, freshRequest, makeRig, removeRig } from "../support/handlerRig.ts";
import { eventually } from "../support/routingRig.ts";
import { connect } from "../support/socketClient.ts";
import { agent, provideBoard, seedBoard, snapshot } from "../board/wakeFixtures.ts";

import { eventsUntil, isTag, requestId, scenario, stopAllServices, tagged } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("6.1 a question in a four-member channel wakes only its addressee, then its reply wakes only the asker (breaks if either wake reaches another member)", (w) => Effect.gen(function* () {
  const asker = yield* w.start(w.owner, { name: "Asker", role: "lead", prompt: "Ready." });
  const addressed = yield* w.start(w.owner, { name: "Addressed", prompt: "Ready." });
  const third = yield* w.start(w.owner, { name: "Third", prompt: "Ready." });
  const fourth = yield* w.start(w.owner, { name: "Fourth", prompt: "Ready." });
  const ids = [asker.agentId, addressed.agentId, third.agentId, fourth.agentId];
  for (const agentId of ids) {
    yield* eventsUntil(w.owner, 0, `agent ${agentId} to finish its startup turn`, (row) => row.event._tag === "TurnEnded" && row.agentId === agentId);
  }
  const channel = yield* w.owner["board.open"]({ requestId: requestId(), name: "four-members" } as never);
  const channelId = (channel as { channelId: string }).channelId;
  yield* w.owner["board.members"]({ requestId: requestId(), channelId, add: ids, remove: [] } as never);
  const askerClient = yield* w.asAgent((yield* w.token(asker)).token);
  const addressedClient = yield* w.asAgent((yield* w.token(addressed)).token);

  const beforeQuestion = yield* w.watermark();
  const question = yield* askerClient["board.post"]({ requestId: requestId(), channelId, text: "Address this one.", to: [{ _tag: "agent", agentId: addressed.agentId }], reply: "all" } as never);
  const postId = (question as { postId: string }).postId;
  const toAddressed = yield* eventsUntil(w.owner, beforeQuestion, "the addressed wake", isTag("DeliverySent", addressed.agentId), 15_000);
  expect(tagged(toAddressed, "DeliverySent", third.agentId)).toHaveLength(0);
  expect(tagged(toAddressed, "DeliverySent", fourth.agentId)).toHaveLength(0);
  expect(tagged(toAddressed, "DeliverySent", asker.agentId)).toHaveLength(0);

  const beforeReply = yield* w.watermark();
  yield* addressedClient["board.post"]({ requestId: requestId(), channelId, text: "I handled it.", to: [], reply: "none", replyTo: postId } as never);
  const toAsker = yield* eventsUntil(w.owner, beforeReply, "the completion wake to the asker", isTag("DeliverySent", asker.agentId), 15_000);
  expect(tagged(toAsker, "DeliverySent", addressed.agentId)).toHaveLength(0);
  expect(tagged(toAsker, "DeliverySent", third.agentId)).toHaveLength(0);
  expect(tagged(toAsker, "DeliverySent", fourth.agentId)).toHaveLength(0);
}));

// The process scenario above checks the public service. This controlled
// companion drains every board scan and dispatcher to a fixed point, so a
// correct first send cannot hide a later send to an excluded member.
it.live("6.1 complete public-socket question and completion intervals exclude every other member", () => Effect.scoped(Effect.gen(function* () {
  const rig = yield* Effect.acquireRelease(Effect.sync(makeRig), (rig) => Effect.sync(() => removeRig(rig)));
  return yield* provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const credentials = yield* seedBoard();
    const bearer = "addressee-boundary-owner-fixture";
    const socket = join(rig.stateFolder, "addressee.sock");
    yield* serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false });
    const owner = yield* connect(socket, bearer);
    const clients = new Map<string, Effect.Success<ReturnType<typeof connect>>>();
    const ids = ["lead", "worker", "other", "fourth"];
    for (const id of ids) {
      const credential = credentials[id]!;
      if (credential._tag !== "agent") throw new Error("Expected an agent credential");
      clients.set(id, yield* connect(socket, Redacted.value(credential.token)));
    }
    const mark = () => owner["client.sequence"]({ requestId: freshRequest() }).pipe(Effect.map((reply) => reply.sequence));
    const collect = (after: number, head: number) => owner.subscribe({ requestId: freshRequest(), after: after as never }).pipe(
      Stream.takeUntil((row) => row.sequence >= head), Stream.runCollect);
    const drain = () => Effect.gen(function* () {
      for (let round = 0; round < 12; round++) {
        const before = yield* mark();
        for (const id of ids) {
          yield* writePieceBatch({ namespace: "board", kind: "reactor", sourceSequence: before,
            build: (state) => lifecycleBatch(state, agentIdOf(id)) });
          yield* dispatchQueued(agentIdOf(id));
        }
        const after = yield* mark();
        if (after === before) return after;
      }
      return yield* Effect.die(new Error("The board and dispatcher did not drain"));
    });
    const recipients = (rows: ReadonlyArray<EventEnvelope>) => {
      const boardIds = new Set(rows.flatMap((row) => row.event._tag === "DeliveryQueued"
        && row.event.delivery.source?._tag === "piece" && row.event.delivery.source.namespace === "board" ? [row.event.delivery.id] : []));
      return rows.flatMap((row) => row.event._tag === "DeliverySent" && boardIds.has(row.event.deliveryId) ? [row.agentId] : []).sort();
    };
    const before = yield* mark();
    const question = yield* clients.get("lead")!["board.post"]({ requestId: freshRequest(), channelId: "room" as never,
      text: "One addressed question.", to: [agent("worker")] as never, reply: "all" });
    const questionHead = yield* drain();
    expect(recipients(yield* collect(before, questionHead))).toEqual(["worker"]);
    expect(runner.callsOf("prompt").map((row) => row.input.agentId)).toEqual(["worker"]);

    // No new watermark: the completion interval starts at the exact end of
    // the question collection, including any event committed between phases.
    yield* clients.get("worker")!["board.post"]({ requestId: freshRequest(), channelId: "room" as never,
      text: "The requested answer.", to: [], reply: "none", replyTo: question.postId });
    const replyHead = yield* drain();
    expect(recipients(yield* collect(questionHead, replyHead))).toEqual(["lead"]);
    expect(runner.callsOf("prompt").map((row) => row.input.agentId)).toEqual(["worker", "lead"]);
    // Both expected turns are held until their obligations are closed, so
    // the barrier itself cannot manufacture reminder or no-answer traffic.
    for (const sent of runner.callsOf("prompt")) yield* runner.emit({ _tag: "turnEnded", agentId: sent.input.agentId,
      incarnation: sent.input.incarnation, deliveryId: sent.input.delivery.id, sentSequence: sent.input.sentSequence });
    yield* eventually(snapshot, (state) => ["lead", "worker"].every((id) => state.agents[id]?.state._tag === "idle"));
    const finalHead = yield* drain();
    expect(recipients(yield* collect(before, finalHead))).toEqual(["lead", "worker"]);
    expect(runner.callsOf("prompt").map((row) => row.input.agentId)).toEqual(["worker", "lead"]);
  }));
})).pipe(Effect.orDie));
