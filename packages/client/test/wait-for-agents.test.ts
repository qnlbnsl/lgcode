import "./support/unit3Group.ts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { afterEach, expect, it } from "vitest";
import { apply, emptyViews } from "../../engine/src/views/apply.ts";
import { withWaitChecks } from "../../engine/src/routing/waits.ts";
import { agentRow, snapshot, envelope, state, turnEnd, loadWait, clientApiPeer, closeClientApiPeers, cleanupUnit7b, chunk, succeed, until } from "./support/unit3.ts";
afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

const members = ["agent-a"];
for (const mode of ["any", "all"] as const) for (const [tag, reloadable, reason] of [
  ["idle", true, "settled"], ["starting", true, undefined], ["working", true, undefined],
  ["crashed", true, "crashed"], ["stopped", true, "stopped"], ["paused", true, "paused"],
  ["interrupted", false, "interrupted"], ["interrupted", true, undefined],
] as const) {
  it(`3.5 ${mode} ${tag}/${reloadable} follows the engine member table`, async () => {
    const initial = snapshot({ agents: [agentRow("agent-a", tag, reloadable)] });
    let engine = emptyViews();
    let sequence = 0;
    for (const id of ["agent-a", "waiter"]) {
      engine = apply(engine, envelope(++sequence, { _tag: "AgentStarted", agentId: id, name: id, role: "worker", groups: [], parent: { _tag: "owner" }, harness: "first", account: "primary", permission: "ask", folder: "/tmp/fixture-project", runMode: "acp" }));
      engine = apply(engine, envelope(++sequence, { _tag: "SessionOpened", agentId: id, session: { _tag: "acp", sessionId: id }, protocolVersion: 2, reloadable }));
    }
    engine = apply(engine, envelope(++sequence, { _tag: "StateChanged", agentId: "agent-a", state: initial.agents[0].state }));
    const checked = withWaitChecks(engine, [envelope(++sequence, { _tag: "WaitOpened", agentId: "waiter", waitId: "engine-check", members, mode, blocking: true }).event]);
    const engineResult = checked.find((event) => event._tag === "WaitSatisfied");
    if (reason === undefined) expect(engineResult).toBeUndefined();
    else expect(engineResult).toMatchObject({ members: [{ agentId: "agent-a", reason }] });
    const waitForAgents = await loadWait();
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
      else if (frame.tag === "client.sequence") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 13 });
      else if (frame.tag === "subscribe") chunk(socket, frame, [
        envelope(11, { _tag: "StateChanged", agentId: "agent-a", state: { _tag: "starting" } }),
        envelope(12, { _tag: "SessionOpened", agentId: "agent-a", session: { _tag: "acp", sessionId: "recovered" }, protocolVersion: 2, reloadable: true }), turnEnd(13),
      ]);
    });
    const connect = await peer.connect();
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members, mode }).pipe(Effect.timeout(4_000)); })));
    expect(result).toMatchObject({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: reason ?? "settled" }] });
    if (reason === undefined) expect(peer.requests.some(({ frame }) => frame.tag === "subscribe")).toBe(true);
  });
}
for (const mode of ["any", "all"] as const) for (const obstacle of ["queued", "sent", "request", "question", "held request", "held question", "nonblocking wait"] as const) {
  it(`3.5 ${mode} a ${obstacle} predating the snapshot keeps an idle member unresolved until the matching close`, async () => {
    const row = { id: "open-row", agentId: obstacle.startsWith("held") ? "child" : "agent-a", holder: { _tag: "agent", agentId: obstacle.startsWith("held") ? "agent-a" : "parent" }, sourceSequence: 9 };
    const initial = snapshot({
      agents: [agentRow(), agentRow("child", "working")],
      requests: obstacle.includes("request") ? [row] : [], questions: obstacle.includes("question") ? [row] : [],
      waitState: { deliveries: obstacle === "queued" || obstacle === "sent" ? [{ id: "d", target: "agent-a", status: obstacle }] : [], waits: obstacle === "nonblocking wait" ? [{ agentId: "agent-a", waitId: "w" }] : [] },
    });
    const close = obstacle.includes("request") ? { _tag: "PermissionAnswered", agentId: row.agentId, permissionRequestId: "open-row", answeredBy: { _tag: "agent", agentId: "parent" }, answer: { _tag: "cancelled" } }
      : obstacle.includes("question") ? { _tag: "QuestionAnswered", agentId: row.agentId, questionId: "open-row", answeredBy: { _tag: "agent", agentId: "parent" }, text: "Answered.", deliveryId: "answer" }
      : obstacle === "nonblocking wait" ? { _tag: "WaitSatisfied", agentId: "agent-a", waitId: "w", members: [{ agentId: "child", reason: "settled" }] }
      : { _tag: "DeliveryWithdrawn", agentId: "agent-a", deliveryId: "d", reason: "source closed" };
    const released = envelope(11, close);
    const waitForAgents = await loadWait();
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
      else if (frame.tag === "client.sequence") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 11 });
      else if (frame.tag === "subscribe") chunk(socket, frame, [released]);
    });
    const connect = await peer.connect();
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members, mode }).pipe(Effect.timeout(4_000)); })));
    expect(peer.requests.some(({ frame }) => frame.tag === "subscribe")).toBe(true);
    expect(result).toMatchObject({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
  });
}
it("3.5 all discards an earlier resolution when that member goes back to working", async () => {
  const initial = snapshot({ agents: [agentRow(), agentRow("agent-b", "working")] });
  const waitForAgents = await loadWait();
  let subscription: { frame: any; socket: any } | undefined;
  let boundary = 12;
  let consumed = 10;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") { subscription = { frame, socket }; chunk(socket, frame, [state(11, "working"), turnEnd(12, "agent-b")]); }
    if (frame.tag === "client.sequence") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: boundary });
  });
  const connect = await peer.connect(); let finished = false;
  const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    const observed = { ...client, subscribe: (payload: any) => client.subscribe(payload).pipe(Stream.tap((row: any) => Effect.sync(() => { consumed = row.sequence; }))) };
    const result = yield* waitForAgents(observed, { members: ["agent-a", "agent-b"], mode: "all" }).pipe(Effect.timeout(4_000));
    finished = true; return result;
  })));
  await until("complete boundary 12 consumed", () => consumed === 12 || finished);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(consumed).toBe(12);
  expect(finished, "A is working at the complete boundary even though A settled earlier").toBe(false);
  boundary = 13;
  chunk(subscription!.socket, subscription!.frame, [turnEnd(13)]);
  expect(await running).toMatchObject({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }, { agentId: "agent-b", reason: "settled" }] });
});

it.each(["any", "all"] as const)("3.5 %s closes on current resolved membership rather than always using the all rule", async (mode) => {
  const initial = snapshot({ agents: [agentRow("agent-a", "stopped"), agentRow("agent-b", "working")] });
  const waitForAgents = await loadWait();
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") chunk(socket, frame, [turnEnd(11, "agent-b")]);
    if (frame.tag === "client.sequence") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 11 });
  });
  const connect = await peer.connect();
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members: ["agent-a", "agent-b"], mode }).pipe(Effect.timeout(4_000)); })));
  expect(result).toMatchObject({ outcome: "satisfied", members: mode === "any" ? [{ agentId: "agent-a", reason: "stopped" }] : [{ agentId: "agent-a", reason: "stopped" }, { agentId: "agent-b", reason: "settled" }] });
  expect(peer.requests.some(({ frame }) => frame.tag === "subscribe")).toBe(mode === "all");
});
it("3.5 a piece hold predating the snapshot is checked by fresh lists before an idle agent counts as settled", async () => {
  const initial = snapshot({ board: { sequence: 10, holdsUnsettled: ["agent-a"], holdsIncoming: [], ownerHeld: [] } });
  const waitForAgents = await loadWait(); let reads = 0;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    else if (frame.tag === "board.status") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: ++reads === 1 ? 10 : 11, holdsUnsettled: reads === 1 ? ["agent-a"] : [], holdsIncoming: [], ownerHeld: [], disabled: false });
    else if (frame.tag === "subscribe") chunk(socket, frame, [{ ...turnEnd(11), event: { _tag: "board.PostClosed", postId: "p", outcome: "answered", closer: { _tag: "owner" }, completionOwed: false } }]);
  });
  const connect = await peer.connect();
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members, mode: "all" }).pipe(Effect.timeout(4_000)); })));
  expect(reads).toBeGreaterThanOrEqual(2); expect(result.outcome).toBe("satisfied");
  expect(peer.requests.find(({ frame }) => frame.tag === "subscribe")!.frame.payload).not.toHaveProperty("filter");
});

for (const mode of ["any", "all"] as const) it(`3.5 ${mode} an empty capacity hold predating the snapshot waits until released`, async () => {
  const initial = snapshot({ agents: [{ ...agentRow(), capacityHeld: true }] });
  const waitForAgents = await loadWait();
  let subscription: { frame: any; socket: any } | undefined;
  let consumed = false;
  let finished = false;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") { subscription = { frame, socket }; chunk(socket, frame, [state(11, "idle")]); }
    if (frame.tag === "client.sequence") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 12 });
  });
  const connect = await peer.connect();
  const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    const observed = { ...client, subscribe: (payload: any) => client.subscribe(payload).pipe(Stream.tap(() => Effect.sync(() => { consumed = true; }))) };
    const result = yield* waitForAgents(observed, { members, mode }).pipe(Effect.timeout(4_000));
    finished = true; return result;
  })));
  await until("held idle boundary consumed", () => consumed || finished);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(finished, "an empty queue does not clear the pre-snapshot capacity hold").toBe(false);
  chunk(subscription!.socket, subscription!.frame, [envelope(12, { _tag: "DeliveryReleased", agentId: "agent-a" })]);
  expect(await running).toEqual({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
});
