import "./support/unit3Group.ts";
import * as Effect from "effect/Effect";
import { afterEach, expect, it } from "vitest";
import { agentRow, snapshot, envelope, state, turnEnd, loadWait, clientApiPeer, closeClientApiPeers, cleanupUnit7b, chunk, succeed, refuse, until } from "./support/unit3.ts";
afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

it("a failed candidate gate is retried on a quiet log without inventing another event", async () => {
  const initial = snapshot({ agents: [agentRow("agent-a", "working")] });
  const waitForAgents = await loadWait();
  let reads = 0;
  let payloads = 0;
  const cursors: number[] = [];
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe" && frame.payload.after < 11) { payloads++; chunk(socket, frame, [turnEnd(11)]); }
    if (frame.tag === "client.sequence") {
      if (++reads === 1) refuse(socket, frame, "database read failed");
      else succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 11 });
    }
  });
  const connect = await peer.connect();
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    const observed = { ...client, subscribe: (payload: any) => { cursors.push(payload.after); return client.subscribe(payload); } };
    return yield* waitForAgents(observed, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(3_000));
  })));
  expect(reads).toBe(2);
  expect(payloads).toBe(1);
  expect(cursors).toEqual([10, 11]);
  // RPC streams are lazy: the quiet retry can finish at its gate before the
  // next network pull. Any opened subscription must still respect its cursor.
  expect(peer.requests.filter(({ frame }) => frame.tag === "subscribe").every(({ frame }) => [10, 11].includes(frame.payload.after))).toBe(true);
  expect(result).toEqual({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
});

for (const mode of ["any", "all"] as const) for (const condition of ["held", "owner-held", "released"] as const) {
  it(`a failed board snapshot recovers ${condition} status for an owner ${mode} wait at its published sequence`, async () => {
    const initial = snapshot({ failedSections: ["board"], agents: [agentRow("agent-a", condition === "owner-held" ? "working" : "idle")] });
    const waitForAgents = await loadWait();
    const reads: Array<{ frame: any; socket: any }> = [];
    let subscription: { frame: any; socket: any } | undefined;
    let finished = false;
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
      if (frame.tag === "subscribe") subscription = { frame, socket };
      if (frame.tag === "board.status") reads.push({ frame, socket });
    });
    const connect = await peer.connect();
    const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode }).pipe(Effect.timeout(4_000), Effect.result);
      finished = true;
      return result;
    })));
    await until("independent board status read", () => reads.length > 0 || finished);
    expect(finished, "a failed snapshot must reach status recovery before ending").toBe(false);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.frame.payload).not.toHaveProperty("agentId");
    if (condition === "held") {
      succeed(reads[0]!.socket, reads[0]!.frame, { requestId: reads[0]!.frame.payload.requestId, sequence: 10, holdsUnsettled: ["agent-a"], holdsIncoming: [], ownerHeld: [], disabled: false });
      await until("held owner subscription", () => subscription || finished);
      // Give the initial candidate time to run while the board still holds it.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(finished, "an idle member with a recovered board hold must keep waiting").toBe(false);
      chunk(subscription!.socket, subscription!.frame, [envelope(11, { _tag: "board.PostClosed", postId: "p", outcome: "answered", closer: { _tag: "owner" }, completionOwed: false })]);
      await until("release status gate", () => reads.length > 1 || finished);
      expect(finished).toBe(false);
      expect(reads).toHaveLength(2);
    }
    const gate = reads.at(-1)!;
    succeed(gate.socket, gate.frame, { requestId: gate.frame.payload.requestId, sequence: 12,
      holdsUnsettled: condition === "owner-held" ? ["agent-a"] : [], holdsIncoming: [],
      ownerHeld: condition === "owner-held" ? ["agent-a"] : [], disabled: false });
    await until("unfiltered owner subscription", () => subscription || finished);
    expect(subscription!.frame.payload).not.toHaveProperty("filter");
    // The status lists are ahead of the applied stream. No result is valid yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished, "status cannot end a wait before the stream reaches its sequence").toBe(false);
    chunk(subscription!.socket, subscription!.frame, [
      ...(condition === "held" ? [] : [state(11, "working")]),
      condition === "owner-held" ? state(12, "working") : turnEnd(12), state(13, "working"),
    ]);
    const result = await running;
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") expect(result.success).toEqual(condition === "owner-held"
      ? { outcome: "request-held", members: [] }
      : { outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
  });
}

it("a failed board status after a failed snapshot retries on a quiet log before reporting owner-held", async () => {
  const initial = snapshot({ failedSections: ["board"], agents: [agentRow("agent-a", "working")] });
  const waitForAgents = await loadWait();
  let reads = 0;
  let retry: { frame: any; socket: any } | undefined;
  let finished = false;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "board.status") {
      if (++reads === 1) refuse(socket, frame, "board status temporarily unavailable");
      else retry = { frame, socket };
    }
  });
  const connect = await peer.connect();
  const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(3_000), Effect.result);
    finished = true;
    return result;
  })));
  await until("quiet-log status retry", () => retry || finished);
  expect(finished, "a failed status read cannot end an unverified wait").toBe(false);
  expect(retry).toBeDefined();
  succeed(retry!.socket, retry!.frame, { requestId: retry!.frame.payload.requestId, sequence: 10, holdsUnsettled: ["agent-a"], holdsIncoming: [], ownerHeld: ["agent-a"], disabled: false });
  const result = await running;
  expect(result._tag).toBe("Success");
  if (result._tag === "Success") expect(result.success).toEqual({ outcome: "request-held", members: [] });
  expect(reads).toBe(2);
});
