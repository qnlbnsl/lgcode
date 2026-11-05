import "./support/unit3Group.ts";
import * as Effect from "effect/Effect";
import { afterEach, expect, it } from "vitest";
import { agentRow, snapshot, envelope, state, turnEnd, queued, loadWait, clientApiPeer, closeClientApiPeers, cleanupUnit7b, chunk, succeed, refuse, until } from "./support/unit3.ts";

afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

const lists = (sequence: number, holdsUnsettled: string[] = []) => ({
  sequence, holdsUnsettled, holdsIncoming: [], ownerHeld: [], disabled: false,
});
// The permission case models a permitted piece mirroring an engine duty.
// The current board supplies the concrete completion case, not permission mirroring.
const initialWithHold = (duty: "permission" | "completion" = "completion") => snapshot({
  agents: [agentRow("agent-a", "working")],
  requests: duty === "permission" ? [{ id: "permission", agentId: "agent-a", holder: { _tag: "agent", agentId: "holder" }, sourceSequence: 9 }] : [],
  waitState: { deliveries: duty === "completion" ? [{ id: "completion", target: "agent-a", status: "sent" }] : [], waits: [] },
  board: lists(10, ["agent-a"]),
});
const release = (duty: "permission" | "completion") => duty === "permission"
  ? envelope(11, { _tag: "PermissionAnswered", agentId: "agent-a", permissionRequestId: "permission", answeredBy: { _tag: "owner" }, answer: { _tag: "selected", optionId: "once" } })
  : envelope(11, { _tag: "DeliveryAccepted", agentId: "agent-a", deliveryId: "completion" });

for (const mode of ["any", "all"] as const) for (const duty of ["permission", "completion"] as const) {
  it(`FR-009 ${mode}: ${duty} release refreshes a cached hold with no later piece event`, async () => {
    const waitForAgents = await loadWait();
    let reads = 0;
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initialWithHold(duty) });
      if (frame.tag === "board.status") succeed(socket, frame, { requestId: frame.payload.requestId, ...(++reads === 1 ? lists(10, ["agent-a"]) : lists(12)) });
      // The stream stays open and quiet after these engine events.
      if (frame.tag === "subscribe") chunk(socket, frame, [release(duty), turnEnd(12)]);
    });
    const connect = await peer.connect();
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      return yield* waitForAgents(yield* connect, { members: ["agent-a"], mode }).pipe(Effect.timeout(2_000));
    })));
    expect(result).toEqual({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
  });

  it(`FR-009 ${mode}: a piece hold remaining after ${duty} release keeps waiting without polling`, async () => {
    const waitForAgents = await loadWait();
    let reads = 0;
    let subscription: { frame: any; socket: any } | undefined;
    let finished = false;
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initialWithHold(duty) });
      if (frame.tag === "board.status") {
        reads++;
        succeed(socket, frame, { requestId: frame.payload.requestId, ...(reads === 1 ? lists(10, ["agent-a"]) : reads === 2 ? lists(12, ["agent-a"]) : lists(13)) });
      }
      if (frame.tag === "subscribe") { subscription = { frame, socket }; chunk(socket, frame, [release(duty), turnEnd(12)]); }
    });
    const connect = await peer.connect();
    const controller = new AbortController();
    const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode }).pipe(Effect.timeout(5_000));
      finished = true;
      return result;
    })), { signal: controller.signal });
    try {
      await until("fresh piece hold after engine release", () => reads >= 2, 3_000);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(finished, "an actual current piece hold must still prevent completion").toBe(false);
      expect(reads, "a quiet stream must not poll the held member").toBe(2);
      chunk(subscription!.socket, subscription!.frame, [{ ...turnEnd(13), event: { _tag: "board.PostClosed", postId: "post", outcome: "answered", closer: { _tag: "owner" }, completionOwed: false } }]);
      expect(await running).toEqual({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
    } finally { controller.abort(); await running.catch(() => {}); }
  });

  it(`FR-009 ${mode}: ${duty} release applies the complete piece-read batch and retains queued duty`, async () => {
    const waitForAgents = await loadWait();
    let reads = 0;
    let subscription: { frame: any; socket: any } | undefined;
    let gate: { frame: any; socket: any } | undefined;
    let finished = false;
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initialWithHold(duty) });
      if (frame.tag === "board.status") {
        if (++reads === 1) succeed(socket, frame, { requestId: frame.payload.requestId, ...lists(10, ["agent-a"]) });
        else if (reads === 2) gate = { frame, socket };
        else succeed(socket, frame, { requestId: frame.payload.requestId, ...lists(16) });
      }
      if (frame.tag === "subscribe") { subscription = { frame, socket }; chunk(socket, frame, [release(duty), turnEnd(12)]); }
    });
    const connect = await peer.connect();
    const controller = new AbortController();
    const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode }).pipe(Effect.timeout(5_000));
      finished = true;
      return result;
    })), { signal: controller.signal });
    try {
      await until("engine-only candidate's piece gate", () => gate, 3_000);
      expect(finished).toBe(false);
      succeed(gate!.socket, gate!.frame, { requestId: gate!.frame.payload.requestId, ...lists(14) });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(finished, "the stream prefix is earlier than the published piece lists").toBe(false);
      chunk(subscription!.socket, subscription!.frame, [queued(13, "agent-a", "next-duty"), state(14, "idle")]);
      await until("batch suffix acknowledged", () => peer.acks.length >= 2, 3_000);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(finished, "a queued delivery still blocks an idle member at the gate").toBe(false);
      expect(reads).toBe(2);
      chunk(subscription!.socket, subscription!.frame, [envelope(15, { _tag: "DeliveryAccepted", agentId: "agent-a", deliveryId: "next-duty" }), turnEnd(16)]);
      expect(await running).toEqual({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
    } finally { controller.abort(); await running.catch(() => {}); }
  });

  it(`FR-009 ${mode}: a failed refresh after ${duty} release retries on a quiet reconnect`, async () => {
    const waitForAgents = await loadWait();
    let reads = 0;
    let subscriptions = 0;
    let finished = false;
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initialWithHold(duty) });
      if (frame.tag === "board.status") {
        if (++reads === 1) succeed(socket, frame, { requestId: frame.payload.requestId, ...lists(10, ["agent-a"]) });
        else if (reads === 2) { expect(finished).toBe(false); refuse(socket, frame, "piece read failed"); }
        else succeed(socket, frame, { requestId: frame.payload.requestId, ...lists(12) });
      }
      if (frame.tag === "subscribe" && ++subscriptions === 1) chunk(socket, frame, [release(duty), turnEnd(12)]);
      // No events are sent after reconnect. Retrying must not need a new event.
    });
    const connect = await peer.connect();
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode }).pipe(Effect.timeout(5_000));
      finished = true;
      return result;
    })));
    expect(reads).toBe(3);
    expect(result).toEqual({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
  });
}
