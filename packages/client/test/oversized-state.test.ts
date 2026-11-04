import "./support/unit3Group.ts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { afterEach, expect, it } from "vitest";
import { envelope, permission, question, queued, turnEnd, clientApiPeer, closeClientApiPeers, cleanupUnit7b, chunk, succeed, refuse, until } from "./support/unit3.ts";
import { harnessSettings } from "../../engine/test/support/handlerRig.ts";
afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

const huge = "界\\\"\n".repeat(70_000);
const started = (sequence: number) => envelope(sequence, { _tag: "AgentStarted", agentId: "child", name: "Child", role: "worker", groups: [], parent: { _tag: "agent", agentId: "parent" }, harness: "first", account: "primary", permission: "ask", folder: "/tmp/fixture-project", runMode: "acp", firstPromptDelivery: { id: "first", target: "child", sender: { _tag: "owner" }, content: { _tag: "prompt", text: huge } } });
const sources = [
  started(1),
  { ...permission(1), event: { ...permission(1).event, description: huge } },
  { ...question(1), event: { ...question(1).event, text: huge } },
  { ...queued(1), event: { _tag: "DeliveryQueued", delivery: { id: "d", target: "agent-a", sender: { _tag: "owner" }, content: { _tag: "prompt", text: huge } } } },
  envelope(1, { _tag: "HarnessChanged", harness: harnessSettings("first", { adapterArguments: [huge] }) }),
  envelope(1, { _tag: "AccountChanged", accountId: "primary", account: { id: "primary", harness: "first", enabled: true, environment: { COLOR: huge } } }),
  envelope(1, { _tag: "AgentGrouped", agentId: "agent-a", groups: [huge] }),
];
const marker = (source: any) => ({ _tag: "client.Oversized", sequence: source.sequence, tag: source.event._tag, ...(source.agentId === undefined ? {} : { agentId: source.agentId }), bytes: Buffer.byteLength(JSON.stringify(source)) });
for (const source of sources) {
  it(`3.8 ${source.event._tag} is recovered whole before later state, with the cursor advanced only after the read`, async () => {
    expect(Buffer.byteLength(JSON.stringify(source))).toBeGreaterThan(256 * 1024);
    let readConnection = 0; let streamConnection = 0;
    const peer = await clientApiPeer("node", (frame, socket, connection) => {
      if (frame.tag === "client.subscribe") { streamConnection = connection; chunk(socket, frame, [marker(source), turnEnd(2)]); }
      if (frame.tag === "client.event") { readConnection = connection; succeed(socket, frame, { requestId: frame.payload.requestId, envelope: source }); }
    });
    const connect = await peer.connect();
    const received = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const client = yield* connect;
      return yield* client["client.subscribe"]({ requestId: "recover-state", after: 0 }).pipe(Stream.take(2), Stream.runCollect, Effect.timeout(4_000));
    })));
    expect(received, "a marker for state must be replaced by its recovered envelope before later events").toEqual([source, turnEnd(2)]);
    expect(peer.requests.filter(({ frame }) => frame.tag === "client.event").map(({ frame }) => frame.payload.sequence)).toEqual([1]);
    expect(readConnection).not.toBe(streamConnection);
  });
}
it.each(["ThreadItem", "future.NewState"])("3.8 %s markers advance without an automatic read when content-only or unknown to this client", async (tag) => {
  let calls = 0;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.subscribe") chunk(socket, frame, ++calls === 1 ? [{ _tag: "client.Oversized", sequence: 1, tag, bytes: 300_000 }] : [turnEnd(2)]);
  }, (socket) => { if (calls === 1) socket.close(1012, "cursor fixture"); });
  const connect = await peer.connect();
  const received = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const client = yield* connect; return yield* client["client.subscribe"]({ requestId: "lazy", after: 0 }).pipe(Stream.take(2), Stream.runCollect, Effect.timeout(4_000)); })));
  expect(received.map((row: any) => row.sequence)).toEqual([1, 2]);
  expect(peer.requests.map(({ frame }) => frame.tag)).toEqual(["client.subscribe", "client.subscribe"]);
  expect(peer.requests[1]!.frame.payload.after).toBe(1);
});
it("3.8 a failed recovery reconnects from before the marker and retries it instead of losing the state event", async () => {
  const source = sources[1]!; let reads = 0;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.subscribe") chunk(socket, frame, [marker(source), turnEnd(2)]);
    if (frame.tag === "client.event") {
      if (++reads === 1) refuse(socket, frame, "database read failed");
      else succeed(socket, frame, { requestId: frame.payload.requestId, envelope: source });
    }
  });
  const connect = await peer.connect();
  const received = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const client = yield* connect; return yield* client["client.subscribe"]({ requestId: "retry-marker", after: 0 }).pipe(Stream.take(2), Stream.runCollect, Effect.timeout(4_000)); })));
  expect(received).toEqual([source, turnEnd(2)]);
  expect(peer.requests.filter(({ frame }) => frame.tag === "client.subscribe").map(({ frame }) => frame.payload.after)).toEqual([0, 0]);
  expect(reads).toBe(2);
});
it("3.8 an agent unwraps visible child start and permission envelopes in order during stream recovery", async () => {
  const start = started(1); const request = { ...permission(2, "child"), event: { ...permission(2, "child").event, description: huge } };
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.subscribe") chunk(socket, frame, [marker(start), marker(request), turnEnd(3, "child")]);
    if (frame.tag === "client.event") {
      const source = frame.payload.sequence === 1 ? start : request;
      succeed(socket, frame, { requestId: frame.payload.requestId, data: `Data from another agent [fixture-read-marker] (delivery read):\n${JSON.stringify({ requestId: frame.payload.requestId, envelope: source })}\nEnd data [fixture-read-marker]` });
    }
  });
  const connect = await peer.connect();
  const received = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const client = yield* connect; return yield* client["client.subscribe"]({ requestId: "agent-recovery", after: 0 }).pipe(Stream.take(3), Stream.runCollect, Effect.timeout(4_000)); })));
  expect(received).toEqual([start, request, turnEnd(3, "child")]);
  expect(peer.requests.filter(({ frame }) => frame.tag === "client.event").map(({ frame }) => frame.payload.sequence)).toEqual([1, 2]);
});
it("3.8 losing read rights during recovery reconnects once and accepts the stream's new visibility without a loop", async () => {
  let streams = 0; let reads = 0;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.subscribe") chunk(socket, frame, ++streams === 1 ? [marker(started(1))] : [turnEnd(2)]);
    if (frame.tag === "client.event") { reads++; refuse(socket, frame); }
  });
  const connect = await peer.connect();
  const received = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const client = yield* connect; return yield* client["client.subscribe"]({ requestId: "visibility-change", after: 0 }).pipe(Stream.take(1), Stream.runCollect, Effect.timeout(4_000)); })));
  expect(received).toEqual([turnEnd(2)]); expect(reads).toBe(1); expect(streams).toBe(2);
  expect(peer.requests.filter(({ frame }) => frame.tag === "client.subscribe").map(({ frame }) => frame.payload.after)).toEqual([0, 0]);
});
it("3.9 a delayed recovery survives a backlog beyond the RPC queue and a stream close after five seconds", async () => {
  const source = sources[1]!; let streams = 0; let reads = 0; let streamConnection = 0; let readConnection = 0;
  let pending: { frame: any; socket: any } | undefined;
  const peer = await clientApiPeer("node", (frame, socket, connection) => {
    if (frame.tag === "client.subscribe") {
      streamConnection = connection;
      if (++streams === 1) {
        chunk(socket, frame, [marker(source)]);
        for (let sequence = 2; sequence < 45; sequence++) chunk(socket, frame, [turnEnd(sequence)]);
        setTimeout(() => socket.close(1012, "five second stream deadline"), 5_050);
      } else chunk(socket, frame, Array.from({ length: 45 - frame.payload.after }, (_, i) => turnEnd(frame.payload.after + i + 1)));
    }
    if (frame.tag === "client.event") { reads++; readConnection = connection; pending = { frame, socket }; }
  });
  const connect = await peer.connect(); const received: any[] = [];
  const running = Effect.runPromise(Effect.scoped(Effect.gen(function* () { const client = yield* connect; return yield* client["client.subscribe"]({ requestId: "slow-recovery", after: 0 }).pipe(Stream.tap((row) => Effect.sync(() => { received.push(row); })), Stream.take(45), Stream.runCollect, Effect.timeout(12_000)); })));
  await until("recovery read issued before exposing a marker", () => pending || received.length > 0);
  expect(received).toEqual([]); expect(pending).toBeDefined(); expect(readConnection).not.toBe(streamConnection);
  await new Promise((resolve) => setTimeout(resolve, 5_200));
  succeed(pending!.socket, pending!.frame, { requestId: pending!.frame.payload.requestId, envelope: source });
  const result = await running;
  expect(result[0]).toEqual(source);
  expect(result.map((row: any) => row.sequence)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
  expect(reads).toBe(1);
  expect(streams).toBeGreaterThanOrEqual(2);
  // Already decoded tail events may drain before reconnect; otherwise recovery
  // resumes after the recovered marker and never reads that large state twice.
  for (const request of peer.requests.filter(({ frame }) => frame.tag === "client.subscribe").slice(1)) expect(request.frame.payload.after).toBeGreaterThanOrEqual(1);
});
it("3.9 cancelling an in-flight recovery exposes neither the marker nor later state and interrupts its read", async () => {
  let reading = false; let readConnection = 0; const received: any[] = [];
  const peer = await clientApiPeer("node", (frame, socket, connection) => {
    if (frame.tag === "client.subscribe") chunk(socket, frame, [marker(sources[1]), turnEnd(2)]);
    if (frame.tag === "client.event") { reading = true; readConnection = connection; }
  });
  const connect = await peer.connect();
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    const fiber = yield* client["client.subscribe"]({ requestId: "cancel-recovery", after: 0 }).pipe(Stream.tap((row) => Effect.sync(() => { received.push(row); })), Stream.runDrain, Effect.forkChild);
    yield* Effect.promise(() => until("pending recovery", () => reading || received.length > 0));
    expect(received).toEqual([]); expect(reading).toBe(true);
    yield* Fiber.interrupt(fiber);
  })));
  expect(received).toEqual([]);
  expect(peer.interrupted).toContain(readConnection);
});
