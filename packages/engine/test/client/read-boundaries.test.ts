import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { Views } from "../../src/views/Views.ts";
import { subscribe } from "../../src/log/subscribe.ts";
import { agentCredential, appendSetup, headSequence, seedAgent } from "../support/handlerRig.ts";
import { ancestryHeaders, requestFrame, socketUrl } from "../support/socketClient.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { run as runReadRig, stream, read, unwrap, event, textItem, endpoint, bytes, owner } from "./support/readRig.ts";
const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it("current visibility includes an unavailable parent's worker and ends on recovery without an availability sentinel resuming it", async () => run(Effect.gen(function* () {
  const parent = yield* seedAgent({ id: "parent" });
  yield* seedAgent({ id: "lead", parent: "parent" });
  yield* seedAgent({ id: "worker", parent: "lead" });
  for (const state of ["paused", "idle"] as const) {
    yield* appendSetup([event({ _tag: "StateChanged", agentId: "lead", state: state === "paused" ? { _tag: "paused", reason: "limit", midTurn: false } : { _tag: "idle" } })]);
    const after = yield* headSequence;
    yield* appendSetup([textItem("worker", "Visible only during the parent's pause.", "worker"), textItem("end", "End.", "parent")]);
    const rows = yield* stream({ after }, { _tag: "agent", agentId: parent.agentId }).pipe(Stream.takeUntil((row) => row.event?.itemId === "end"), Stream.runCollect, Effect.timeout(2_000));
    expect(rows.some((row) => row.event?.itemId === "worker")).toBe(state === "paused");
  }
})));

it("thread pages preserve the dispatch event caused by a queued delivery", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" });
  const after = yield* headSequence;
  yield* appendSetup([
    ...Array.from({ length: 499 }, (_, i) => textItem(`item-${i}`, "Thread text.")),
    event({ _tag: "DeliveryQueued", delivery: { id: "boundary", target: "agent-a", sender: owner, content: { _tag: "prompt", text: "Dispatch me." } } }),
    textItem("tail", "Last text item."),
  ]);
  yield* subscribe(after).pipe(Stream.takeUntil((row) => row.event._tag === "DeliverySent"), Stream.runDrain, Effect.timeout(2_000));
  const first = yield* read("client.thread", { agentId: "agent-a", after, limit: 500 });
  const last = yield* read("client.thread", { agentId: "agent-a", after: first.next, limit: 500 });
  expect(first.items).toHaveLength(500);
  expect(last.items.map((row: any) => row.event._tag)).toEqual(["ThreadItem", "DeliverySent", "PromptSent"]);
  expect(last.items[2].event).toEqual({ _tag: "PromptSent", agentId: "agent-a", deliveryId: "boundary", sender: owner, text: "Dispatch me." });
  expect(last).not.toHaveProperty("next");
  expect([...first.items, ...last.items]).toEqual((yield* (yield* Views).snapshot).threads["agent-a"]!.filter((row) => row.sequence > after));
})));

it("an agent data envelope keeps metadata whole and request id newlines inside its JSON data", async () => run(Effect.gen(function* () {
  const a = yield* seedAgent({ id: "agent-a" });
  const reply = yield* read("client.thread", { requestId: "line-one\nline-two", agentId: "agent-a", after: 0, limit: 500 }, agentCredential(a.token));
  const page = unwrap(reply);
  expect(page.requestId).toBe("line-one\nline-two");
  const start = page.items.find((row: any) => row.event._tag === "AgentStarted");
  expect(start.event.folder.startsWith("/")).toBe(true);
  expect(start.event.folder.startsWith("\\/")).toBe(false);
})));

it("a singleton just below the item budget becomes a marker when its actual RPC frame exceeds 256 KiB", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" });
  const [small] = yield* appendSetup([textItem("edge", "")]);
  const after = yield* headSequence;
  const [edge] = yield* appendSetup([textItem("edge", "x".repeat(256 * 1024 - bytes(small) - 10))]);
  expect(bytes(edge)).toBeLessThan(256 * 1024);
  const [tail] = yield* appendSetup([textItem("boundary-tail", "After the marker.")]);
  const address = yield* endpoint;
  const socket = yield* Effect.acquireRelease(Effect.promise(() => new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(socketUrl(address.socket), { headers: { Authorization: `Bearer ${address.bearer}`, ...ancestryHeaders() } });
    socket.once("error", reject); socket.once("open", () => resolve(socket));
  })), (socket) => Effect.sync(() => socket.terminate()));
  const frames: any[] = [];
  let ready!: () => void;
  let complete!: () => void;
  const replayed = new Promise<void>((resolve) => { ready = resolve; });
  const continued = new Promise<void>((resolve) => { complete = resolve; });
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    for (const frame of Array.isArray(message) ? message : [message]) {
      if (frame._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
      if (frame._tag === "Chunk") {
        frames.push(frame);
        socket.send(JSON.stringify({ _tag: "Ack", requestId: frame.requestId }));
        if (frames.flatMap((f) => f.values).length >= 2) ready();
        if (frames.flatMap((f) => f.values).length >= 3) complete();
      }
    }
  });
  socket.send(requestFrame("boundary-frame", "client.subscribe", { requestId: "boundary-frame", after }));
  yield* Effect.promise(() => replayed).pipe(Effect.timeout(3_000));
  const [liveTail] = yield* appendSetup([textItem("live-boundary-tail", "Live after the marker.")]);
  yield* Effect.promise(() => continued).pipe(Effect.timeout(3_000));
  for (const frame of frames) expect(bytes(frame)).toBeLessThanOrEqual(256 * 1024);
  expect(frames.flatMap((frame) => frame.values)).toEqual([
    { _tag: "client.Oversized", sequence: edge!.sequence, tag: "ThreadItem", agentId: "agent-a", bytes: bytes(edge) },
    tail, liveTail,
  ]);
})));
