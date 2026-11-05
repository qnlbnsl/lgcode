import "./support/unit3Group.ts";
import * as Effect from "effect/Effect";
import { afterEach, expect, it } from "vitest";
import { agentRow, snapshot, envelope, state, turnEnd, queued, permission, loadWait, clientApiPeer, closeClientApiPeers, cleanupUnit7b, chunk, succeed, refuse, until } from "./support/unit3.ts";
afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

for (const mode of ["any", "all"] as const) for (const delivery of ["live", "catch-up"] as const) for (const split of ["reload", "wait wake", "question answer"] as const) {
  it(`3.10 ${delivery}/${mode} ${split}: a split batch prefix cannot finish the wait before its queued work`, async () => {
    const initial = snapshot({
      agents: [agentRow("agent-a", split === "reload" ? "starting" : "idle"), agentRow("child", "working")],
      questions: split === "question answer" ? [{ id: "q", agentId: "child", holder: { _tag: "agent", agentId: "agent-a" }, sourceSequence: 9 }] : [],
      waitState: { deliveries: [], waits: split === "wait wake" ? [{ agentId: "agent-a", waitId: "w" }] : [] },
    });
    const prefix = split === "reload" ? envelope(11, { _tag: "SessionOpened", agentId: "agent-a", session: { _tag: "acp", sessionId: "reloaded" }, protocolVersion: 2, reloadable: true })
      : split === "wait wake" ? envelope(11, { _tag: "WaitSatisfied", agentId: "agent-a", waitId: "w", members: [{ agentId: "child", reason: "settled" }] })
      : envelope(11, { _tag: "QuestionAnswered", agentId: "child", questionId: "q", answeredBy: { _tag: "agent", agentId: "agent-a" }, text: "Continue.", deliveryId: "answer" });
    const waitForAgents = await loadWait();
    let subscription: { frame: any; socket: any } | undefined;
    let gate: { frame: any; socket: any } | undefined;
    let finished = false;
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
      if (frame.tag === "subscribe") { subscription = { frame, socket }; if (delivery === "catch-up") chunk(socket, frame, [prefix]); }
      if (frame.tag === "client.sequence") {
        if (gate === undefined) gate = { frame, socket };
        else succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 15 });
      }
    });
    const connect = await peer.connect();
    const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode }).pipe(Effect.timeout(5_000));
      finished = true; return result;
    })));
    await until("unfiltered subscribe", () => subscription);
    expect(subscription!.frame.payload).not.toHaveProperty("filter");
    if (delivery === "live") chunk(subscription!.socket, subscription!.frame, [prefix]);
    await until("candidate's sequence gate", () => gate || finished);
    expect(finished, "a candidate prefix must make a gate read before any exit").toBe(false);
    expect(gate).toBeDefined();
    succeed(gate!.socket, gate!.frame, { requestId: gate!.frame.payload.requestId, sequence: 13 });
    chunk(subscription!.socket, subscription!.frame, [queued(12, "agent-a", "work"), state(13, "working")]);
    // Let the real receive loop consume and acknowledge the suffix before
    // checking that work still prevents completion.
    await until("stream suffix acknowledged", () => peer.acks.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    chunk(subscription!.socket, subscription!.frame, [envelope(14, { _tag: "DeliveryAccepted", agentId: "agent-a", deliveryId: "work" }), turnEnd(15)]);
    expect(await running).toMatchObject({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
  });
}
it("3.10 a read below S is repeated and a read above S applies through L without consuming the later working state", async () => {
  const initial = snapshot({ agents: [agentRow("agent-a", "working")] });
  const waitForAgents = await loadWait(); let reads = 0;
  let subscription: { frame: any; socket: any } | undefined;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") { subscription = { frame, socket }; chunk(socket, frame, [turnEnd(11)]); }
    if (frame.tag === "client.sequence") {
      reads++;
      succeed(socket, frame, { requestId: frame.payload.requestId, sequence: reads === 1 ? 10 : 12 });
      if (reads === 2) chunk(subscription!.socket, subscription!.frame, [state(12, "idle"), state(13, "working")]);
    }
  });
  const connect = await peer.connect();
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(4_000)); })));
  expect(reads).toBe(2);
  expect(result).toMatchObject({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
});
it("3.10 a failed gate ends nothing and reconnects before deciding again", async () => {
  const initial = snapshot({ agents: [agentRow("agent-a", "working")] });
  const waitForAgents = await loadWait(); let reads = 0; let subscriptions = 0;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") { subscriptions++; chunk(socket, frame, [turnEnd(subscriptions === 1 ? 11 : 12)]); }
    if (frame.tag === "client.sequence") {
      if (++reads === 1) refuse(socket, frame, "database read failed");
      else succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 12 });
    }
  });
  const connect = await peer.connect();
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(4_000)); })));
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(subscriptions).toBeGreaterThanOrEqual(2);
  expect(result.outcome).toBe("satisfied");
});
it("3.9 the wait helper's nested piece read completes despite a stream queue backlog", async () => {
  const initial = snapshot({ agents: [agentRow("agent-a", "working")], board: { sequence: 10, holdsUnsettled: [], holdsIncoming: [], ownerHeld: [] } });
  const waitForAgents = await loadWait(); let pieceReads = 0; let streamConnection = 0; let readConnection = 0;
  let pending: { frame: any; socket: any } | undefined;
  const peer = await clientApiPeer("node", (frame, socket, connection) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "board.status") {
      pieceReads++; readConnection = connection;
      if (pieceReads === 1) succeed(socket, frame, { requestId: frame.payload.requestId, ...initial.board, disabled: false });
      else pending = { frame, socket };
    }
    if (frame.tag === "subscribe") {
      streamConnection = connection;
      chunk(socket, frame, [turnEnd(11)]);
      for (let sequence = 12; sequence <= 50; sequence++) chunk(socket, frame, [envelope(sequence, { _tag: "ThreadItem", agentId: "agent-a", itemId: `item-${sequence}`, content: { _tag: "text", text: "Backlog." }, replay: false })]);
    }
  });
  const connect = await peer.connect();
  const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(5_000)); })));
  await until("nested piece read", () => pending);
  expect(readConnection).not.toBe(streamConnection);
  succeed(pending!.socket, pending!.frame, { requestId: pending!.frame.payload.requestId, sequence: 11, holdsUnsettled: [], holdsIncoming: [], ownerHeld: [], disabled: false });
  expect((await running).outcome).toBe("satisfied");
});

for (const mode of ["any", "all"] as const) for (const delivery of ["live", "catch-up"] as const) for (const answered of [true, false]) {
  it(`3.10 ${delivery}/${mode} owner-held permission ${answered ? "answered in committed suffix" : "genuinely held control"}`, async () => {
    const initial = snapshot({ agents: [agentRow("agent-a", "working")] });
    const waitForAgents = await loadWait();
    const prefix = permission(11);
    let subscription: { frame: any; socket: any } | undefined;
    let gate: { frame: any; socket: any } | undefined;
    let finished = false;
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
      if (frame.tag === "subscribe") { subscription = { frame, socket }; if (delivery === "catch-up") chunk(socket, frame, [prefix]); }
      if (frame.tag === "client.sequence") {
        if (!gate) gate = { frame, socket };
        else succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 14 });
      }
    });
    const connect = await peer.connect();
    const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode }).pipe(Effect.timeout(5_000));
      finished = true; return result;
    })));
    await until("permission subscription", () => subscription);
    if (delivery === "live") chunk(subscription!.socket, subscription!.frame, [prefix]);
    await until("owner-held candidate gate", () => gate || finished);
    expect(finished).toBe(false);
    expect(gate).toBeDefined();
    succeed(gate!.socket, gate!.frame, { requestId: gate!.frame.payload.requestId, sequence: answered ? 13 : 11 });
    if (answered) {
      chunk(subscription!.socket, subscription!.frame, [
        envelope(12, { _tag: "PermissionAnswered", agentId: "agent-a", permissionRequestId: "permission-11", answeredBy: { _tag: "owner" }, answer: { _tag: "selected", optionId: "once" } }),
        state(13, "working"),
      ]);
      await until("answered suffix acknowledged", () => peer.acks.length >= 2 || finished);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(finished, "the committed answer cancels the owner-held candidate while work continues").toBe(false);
      chunk(subscription!.socket, subscription!.frame, [turnEnd(14)]);
    }
    expect(await running).toEqual(answered
      ? { outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] }
      : { outcome: "request-held", members: [] });
  });
}
