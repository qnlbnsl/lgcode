import { expect } from "vitest";
import * as Effect from "effect/Effect";

import { reloadedEvents } from "../../src/recovery/reload.ts";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { agentCredential, agentIdOf, appendSetup, call, headSequence, logAfter, ownerCredential, seedAgent, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendWith } from "../support/routingRig.ts";
import { catchUp, it, reactorRig } from "./reactorFixtures.ts";
import { agent, appendDelivery, change, postAs, queued, snapshot } from "./wakeFixtures.ts";

const { run } = reactorRig(() => registerRebuildCheck());

for (const producer of ["answer", "reactor", "dispatcher"] as const) {
  for (const remaining of ["none", "queued", "sent"] as const) {
    it.live(`recovered ${producer} commits withdrawal before idle before wait resolution; remaining=${remaining}`, () => run((c) => Effect.gen(function* () {
      let original: string;
      let questionId = "";
      if (producer === "answer") {
        const child = yield* seedAgent({ id: "child", parent: "worker", state: "idle" });
        const reply = success(yield* call(agentCredential(child.token), "ask", { text: "Which branch?" }));
        questionId = reply.questionId;
        original = Object.values((yield* snapshot).deliveries).find((row) => row.source?._tag === "question" && row.source.id === questionId)!.id;
      } else {
        yield* postAs(ownerCredential, producer === "dispatcher" ? { reply: "none" } : {});
        if (producer === "dispatcher") success(yield* call(ownerCredential, "board.flush", { agentId: "worker" }));
        original = (yield* queued("worker"))[0]!.id;
      }
      yield* appendDelivery("DeliverySent", original, "worker");
      yield* change({ _tag: "AgentInterrupted", agentId: "worker", previous: "working" });
      yield* appendSetup(reloadedEvents(yield* snapshot, agentIdOf("worker"), {
        session: { _tag: "acp", sessionId: "recovered-withdrawal" }, protocolVersion: 2, reloadable: true,
      }, false, "Continue."));
      expect((yield* snapshot).agents.worker?.state._tag).toBe("working");
      if (remaining !== "none") {
        const extra = success(yield* call(ownerCredential, "prompt", { agentId: "worker", text: "Independent pending work." }));
        if (remaining === "sent") yield* appendDelivery("DeliverySent", extra.deliveryId, "worker");
      }
      const waitId = String(success(yield* call(c.lead!, "wait", { members: ["worker"], mode: "all", block: false })).waitId);
      expect((yield* snapshot).waits[waitId]?.status).toBe("open");
      const before = yield* headSequence;
      if (producer === "answer") success(yield* call(ownerCredential, "answer", { kind: "question", id: questionId, text: "Use main." }));
      else {
        yield* change({ _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [], membersRemoved: [agent("worker")] });
        if (producer === "reactor") yield* catchUp;
        else yield* dispatchQueued(agentIdOf("worker"), { recovered: true });
      }
      const written = yield* logAfter(before);
      if (producer === "dispatcher" && remaining === "sent") {
        expect(written.filter((row) => row.event._tag === "DeliveryWithdrawn")).toEqual([]);
        expect((yield* snapshot).deliveries[original]?.status).toBe("queued");
        expect((yield* snapshot).waits[waitId]?.status).toBe("open");
        return;
      }
      const batch = appendWith(written, (row) => row.event._tag === "DeliveryWithdrawn" && row.event.deliveryId === original);
      expect(batch.length).toBeGreaterThan(0);
      const tags = batch.map((row) => row.event._tag);
      const withdrawal = tags.indexOf("DeliveryWithdrawn");
      const idle = batch.findIndex((row) => row.event._tag === "StateChanged" && row.event.agentId === "worker" && row.event.state._tag === "idle");
      const satisfied = batch.findIndex((row) => row.event._tag === "WaitSatisfied" && row.event.waitId === waitId);
      const state = yield* snapshot;
      expect(state.deliveries[original]?.status).toBe("withdrawn");
      if (remaining === "none") {
        expect(idle).toBeGreaterThan(withdrawal);
        expect(satisfied).toBeGreaterThan(idle);
        expect(state.agents.worker?.state._tag).toBe("idle");
        expect(state.waits[waitId]).toMatchObject({ status: "satisfied", resolved: [{ agentId: "worker", reason: "settled" }] });
      } else {
        expect(idle).toBe(-1);
        expect(satisfied).toBe(-1);
        expect(state.waits[waitId]?.status).toBe("open");
      }
    })));
  }
}
