import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

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
