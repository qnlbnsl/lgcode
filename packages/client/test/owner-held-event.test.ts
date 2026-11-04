import "./support/unit3Group.ts";
import * as Effect from "effect/Effect";
import { afterEach, expect, it } from "vitest";
import { agentRow, snapshot, question, permission, state, turnEnd, loadWait, clientApiPeer, closeClientApiPeers, cleanupUnit7b, chunk, succeed, until } from "./support/unit3.ts";
afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

for (const subject of ["request", "question"] as const) for (const tag of ["starting", "working", "idle", "paused", "interrupted", "stopped", "crashed"] as const) {
  it(`3.6 an owner-held ${subject} on a ${tag} member follows the held-rule table`, async () => {
    const initial = snapshot({ agents: [agentRow("agent-a", tag)],
      [subject === "request" ? "requests" : "questions"]: [{ id: "open", agentId: "agent-a", holder: { _tag: "owner" }, sourceSequence: 9 }],
    });
    const waitForAgents = await loadWait();
    const peer = await clientApiPeer("node", (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    });
    const connect = await peer.connect();
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(3_000)); })));
    expect(result).toMatchObject(tag === "stopped" || tag === "crashed"
      ? { outcome: "satisfied", members: [{ agentId: "agent-a", reason: tag }] }
      : { outcome: "request-held" });
  });
}
it.each(["request", "question"] as const)("3.6 a live owner-held %s passes the sequence gate before returning request-held", async (subject) => {
  const initial = snapshot({ agents: [agentRow("agent-a", "working")] });
  const waitForAgents = await loadWait();
  let gate: { frame: any; socket: any } | undefined; let finished = false;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") chunk(socket, frame, [subject === "request" ? permission(11) : question(11)]);
    if (frame.tag === "client.sequence") gate = { frame, socket };
  });
  const connect = await peer.connect();
  const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(4_000)); finished = true; return result;
  })));
  await until("held-result gate", () => gate || finished);
  expect(finished).toBe(false); expect(gate).toBeDefined();
  succeed(gate!.socket, gate!.frame, { requestId: gate!.frame.payload.requestId, sequence: 11 });
  expect((await running).outcome).toBe("request-held");
});
it("3.6 a descendant's owner-held question does not end the wait on its working parent", async () => {
  const initial = snapshot({ agents: [agentRow("agent-a", "working"), { ...agentRow("child", "working"), parent: { _tag: "agent", agentId: "agent-a" } }] });
  const waitForAgents = await loadWait(); let subscription: { frame: any; socket: any } | undefined;
  let finished = false;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") { subscription = { frame, socket }; chunk(socket, frame, [question(11, "child")]); }
    if (frame.tag === "client.sequence") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 12 });
  });
  const connect = await peer.connect();
  const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const result = yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(4_000)); finished = true; return result;
  })));
  await until("descendant stream event", () => peer.acks.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 20)); expect(finished).toBe(false);
  chunk(subscription!.socket, subscription!.frame, [turnEnd(12)]);
  expect((await running).outcome).toBe("satisfied");
});
it("3.6 a board post to the owner ends a working member's wait after fresh ownerHeld lists, without an idle transition", async () => {
  const initial = snapshot({ agents: [agentRow("agent-a", "working")], board: { sequence: 10, holdsUnsettled: [], holdsIncoming: [], ownerHeld: [] } });
  const waitForAgents = await loadWait(); let reads = 0;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "board.status") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: ++reads === 1 ? 10 : 11, holdsUnsettled: [], holdsIncoming: [], ownerHeld: reads === 1 ? [] : ["agent-a"], disabled: false });
    if (frame.tag === "subscribe") chunk(socket, frame, [{ ...state(11, "working"), event: { _tag: "board.PostWritten", postId: "post-to-owner", channelId: "channel", author: { _tag: "agent", agentId: "agent-a" }, text: "Please review this post.", to: [{ _tag: "owner" }], reply: "all" } }]);
  });
  const connect = await peer.connect();
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(4_000)); })));
  expect(reads).toBeGreaterThanOrEqual(2); expect(result.outcome).toBe("request-held");
  expect(peer.requests.some(({ frame }) => frame.tag === "client.sequence")).toBe(false);
});
