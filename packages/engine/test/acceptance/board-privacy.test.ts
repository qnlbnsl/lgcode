import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { eventsUntil, isTag, requestId, scenario, since, stopAllServices, tagged } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("6.3 board events and snapshot data stay out of every agent read, and a non-member cannot read a channel post or a sibling thread (breaks if an agent API exposes board state)", (w) => Effect.gen(function* () {
  const parent = yield* w.start(w.owner, { name: "Parent", role: "lead", prompt: "Ready." });
  const member = yield* w.start(yield* w.asAgent((yield* w.token(parent)).token), { name: "Member", prompt: "Ready.", script: { turns: [[], [{ step: "text", text: "Received the private question." }]] } });
  const outsider = yield* w.start(w.owner, { name: "Outsider", prompt: "Ready." });
  for (const agentId of [parent.agentId, member.agentId, outsider.agentId]) {
    yield* eventsUntil(w.owner, 0, `agent ${agentId} to finish its startup turn`, (row) => row.event._tag === "TurnEnded" && row.agentId === agentId);
  }
  const channel = yield* w.owner["board.open"]({ requestId: requestId(), name: "private-channel" } as never);
  const channelId = (channel as { channelId: string }).channelId;
  yield* w.owner["board.members"]({ requestId: requestId(), channelId, add: [member.agentId], remove: [] } as never);
  const before = yield* w.watermark();
  const post = yield* w.owner["board.post"]({ requestId: requestId(), channelId, text: "private marker text", to: [{ _tag: "agent", agentId: member.agentId }], reply: "all" } as never);
  const postId = (post as { postId: string }).postId;
  const ownerEvents = yield* since(w.owner, before);
  const boardSequence = ownerEvents.find((row) => row.event._tag === "board.PostWritten")!.sequence;

  const memberClient = yield* w.asAgent((yield* w.token(member)).token);
  const outsiderClient = yield* w.asAgent((yield* w.token(outsider)).token);
  const memberEvents = yield* eventsUntil(memberClient, before, "the member's own thread item", isTag("ThreadItem", member.agentId));
  expect(memberEvents.some((row) => row.event._tag.startsWith("board."))).toBe(false);
  const memberSnapshot = yield* memberClient["client.snapshot"]({ requestId: requestId() } as never);
  expect(memberSnapshot).not.toHaveProperty("board");
  const eventReply = yield* memberClient["client.event"]({ requestId: requestId(), sequence: boardSequence } as never).pipe(Effect.exit);
  expect(JSON.stringify(eventReply)).not.toContain("board.PostWritten");

  const outsiderSnapshot = yield* outsiderClient["client.snapshot"]({ requestId: requestId() } as never);
  expect(outsiderSnapshot).not.toHaveProperty("board");
  const outsiderRead = yield* outsiderClient["board.read"]({ requestId: requestId(), post: postId } as never).pipe(Effect.exit);
  expect(outsiderRead._tag).toBe("Failure");
  const outsiderStatus = yield* outsiderClient["board.status"]({ requestId: requestId(), agentId: member.agentId, detail: "incoming" } as never).pipe(Effect.exit);
  expect(outsiderStatus._tag).toBe("Failure");
  const outsiderChannels = yield* outsiderClient["board.channels"]({ requestId: requestId() } as never);
  expect(JSON.stringify(outsiderChannels)).not.toContain("private marker text");
  const siblingThread = yield* outsiderClient["client.thread"]({ requestId: requestId(), agentId: member.agentId, after: 0 } as never).pipe(Effect.exit);
  expect(siblingThread._tag).toBe("Failure");
  expect(tagged(ownerEvents, "DeliverySent", member.agentId)).toHaveLength(1);
}));
