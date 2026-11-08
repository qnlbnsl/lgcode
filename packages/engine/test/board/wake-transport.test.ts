import { join } from "node:path";
import type { ClientStreamItem, EventEnvelope } from "@lgcode/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { serve } from "../../src/api/server.ts";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { agentIdOf, freshRequest, makeRig, readLog, removeRig, seedAgent, type Rig } from "../support/handlerRig.ts";
import { connect } from "../support/socketClient.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { encodedBytes, provideBoard, queued, seedBoard } from "./wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const unwrap = (reply: any) => {
  const lines = reply.data.split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[2]).toBe(`End data [${/\[([^\]]+)\]/.exec(lines[0])![1]}]`);
  return JSON.parse(lines[1]);
};

it.live("5.14 production near-limit board wakes remain whole through both subscriptions, event reads and thread reads", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  yield* seedBoard();
  // The identity schema accepts nonempty strings. A large valid target gives
  // the production event metadata enough overhead to cross the stream cap,
  // even though the wake builder reserves space in its own body budget.
  const targetId = agentIdOf(`wire-target-${"t".repeat(32 * 1024)}`);
  const seeded = yield* seedAgent({ id: targetId, parent: "lead" });
  const socket = join(rig.stateFolder, "wake-wire.sock");
  const bearer = "wake-transport-owner-fixture";
  yield* serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false });
  const frames: string[] = [];
  const owner = yield* connect(socket, bearer, { frames });
  const target = yield* connect(socket, seeded.token, { frames });
  yield* owner["board.members"]({ requestId: freshRequest(), channelId: "room" as never, add: [targetId], remove: [] });
  const after = (yield* readLog).at(-1)!.sequence;
  // Notices accumulate without waking. The production flush selects the
  // bounded digest, labels every post and wraps the final engine delivery.
  const text = '"\\\n\t🐑'.repeat(1365);
  const posts: string[] = [];
  for (let index = 0; index < 24; index++) {
    const reply = yield* owner["board.post"]({ requestId: freshRequest(), channelId: "room" as never, to: [], reply: "none", text });
    posts.push(reply.postId);
  }
  yield* owner["board.flush"]({ requestId: freshRequest(), agentId: targetId });
  const [wake] = yield* queued(targetId);
  expect(wake).toBeDefined();
  const body = (wake!.content as { text: string }).text;
  expect(encodedBytes(body)).toBeGreaterThan(230 * 1024);
  expect(encodedBytes(body)).toBeLessThanOrEqual(256 * 1024);
  yield* dispatchQueued(targetId);
  expect(runner.callsOf("prompt").map((row) => row.input.delivery.id)).toEqual([wake!.id]);
  expect((runner.callsOf("prompt")[0]!.input.delivery.content as { text: string }).text).toBe(body);
  const log = (yield* readLog).filter((row) => row.sequence > after);
  const sent = log.find((row) => row.event._tag === "PromptSent");
  expect(sent, "the production dispatcher must publish the sent wake text for its target").toBeDefined();
  const history = yield* owner.subscribe({ requestId: freshRequest(), after: after as never }).pipe(
    Stream.takeUntil((row) => row.sequence >= sent!.sequence), Stream.runCollect);
  const queuedEvent = history.find((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.id === wake!.id)!;
  const built = log.find((row) => row.event._tag === "board.WakeBuilt")!;
  const threadEvent = history.find((row) => row.event._tag === "PromptSent")!;
  expect(encodedBytes(threadEvent)).toBeGreaterThan(256 * 1024);
  const sequences: number[] = [];
  for (const client of [owner, target]) for (const command of ["subscribe", "client.subscribe"] as const) {
    const stream: Stream.Stream<ClientStreamItem, unknown> = client[command]({ requestId: freshRequest(), after: after as never });
    const rows = yield* stream.pipe(
      Stream.takeUntil((row) => row.sequence >= sent!.sequence), Stream.runCollect, Effect.timeout(10_000));
    expect(rows.some((row) => row.sequence === queuedEvent.sequence)).toBe(client === owner);
    const delivered = rows.find((row) => row.sequence === threadEvent.sequence)!;
    if (command === "subscribe") expect(delivered).toEqual(threadEvent);
    else expect(delivered).toMatchObject({ _tag: "client.Oversized", sequence: threadEvent.sequence, tag: "PromptSent" });
    expect(rows.some((row) => row.sequence === built.sequence)).toBe(client === owner);
    if (client === owner) expect(rows.filter((row) => "event" in row && row.event._tag.startsWith("board.")))
      .toEqual(history.filter((row) => row.event._tag.startsWith("board.")));
    sequences.push(delivered.sequence);
  }
  expect(sequences).toEqual(Array(4).fill(threadEvent.sequence));
  for (const client of [owner, target]) {
    const result = yield* client["client.event"]({ requestId: freshRequest(), sequence: threadEvent.sequence });
    const event = "data" in result ? unwrap(result).envelope : result.envelope;
    expect(event).toEqual(threadEvent);
    expect(event.event.text).toBe(body);
    const thread = yield* client["client.thread"]({ requestId: freshRequest(), agentId: targetId, after: after as never, limit: 200 });
    const plain = "data" in thread ? unwrap(thread) : thread;
    expect(plain.items.find((row: EventEnvelope) => row.sequence === threadEvent.sequence)).toEqual(threadEvent);
    if (client === owner) expect(plain.items.find((row: EventEnvelope) => row.sequence === queuedEvent.sequence)).toEqual(queuedEvent);
    else expect(plain.items.some((row: EventEnvelope) => row.sequence === queuedEvent.sequence)).toBe(false);
  }
  // Every carried post retains its own balanced, independent data boundary.
  const carried = (built.event as Extract<EventEnvelope["event"], { _tag: "board.WakeBuilt" }>).carried;
  expect(carried.length).toBeGreaterThan(1);
  expect(carried.length).toBeLessThan(posts.length);
  expect(carried).toEqual(posts.slice(0, carried.length));
  const blocks = [...body.matchAll(/Data \[([^\]]+)\]\n([\s\S]*?)\nEnd data \[\1\]/g)];
  expect(blocks).toHaveLength(carried.length);
  expect(new Set(blocks.map((match) => match[1])).size).toBe(carried.length);
  for (const block of blocks) expect(block[2]).toBe(text);
  for (const frame of frames) expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(900 * 1024);
})).pipe(Effect.orDie));
