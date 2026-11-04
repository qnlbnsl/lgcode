import { join } from "node:path";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { snapshot as clientSnapshot } from "../../src/api/snapshot.ts";
import { serve } from "../../src/api/server.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { Views } from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { call, freshRequest, makeRig, ownerCredential, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts";
import { connect } from "../support/socketClient.ts";
import { agent, boardState, change, encodedBytes, eventsOf, owner, postAs, provideBoard, seedBoard } from "./wakeFixtures.ts";
import { post } from "./fixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const unwrap = (reply: { data: string }) => {
  const lines = reply.data.split("\n");
  expect(lines).toHaveLength(3);
  const marker = /\[([^\]]+)\]/.exec(lines[0]!)![1]!;
  expect(lines[2]).toBe(`End data [${marker}]`);
  return JSON.parse(lines[1]!);
};

it.live("5.13 a single-post read preserves closed metadata and marks only that post for the caller", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  const c = yield* seedBoard();
  const first = yield* postAs(c.lead!, { reply: "none", to: [] });
  const second = yield* postAs(c.lead!, { reply: "none", to: [], replyTo: first, text: "/literal data" });
  success(yield* call(c.lead!, "board.close", { postId: second }));
  const result = unwrap(success(yield* call(c.worker!, "board.read", { post: second })));
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ postId: second, channelId: "room", author: agent("lead"), to: [], reply: "none", replyTo: first,
    status: "closed", outcome: "withdrawn", text: "\\/literal data" });
  const marks = eventsOf(yield* readLog, "board.Read");
  expect(marks).toHaveLength(1);
  expect(marks[0]).toMatchObject({ reader: agent("worker"), channelId: "room", postIds: [second] });
  expect((yield* call(c.worker!, "board.read", { post: "missing" }))._tag).toBe("Failure");
  success(yield* call(ownerCredential, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  expect((yield* call(c.worker!, "board.read", { post: second }))._tag).toBe("Failure");
  expect(success(yield* call(ownerCredential, "board.read", { post: second })).items[0].text).toBe("/literal data");
})).pipe(Effect.orDie));

it.live("5.16 real agent transport pages quotes by wrapped byte size with fresh markers and no lost incoming posts", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  const c = yield* seedBoard();
  const ids = Array.from({ length: 20 }, (_, index) => `escaped-${index}`);
  yield* change(...ids.map((id) => post(id, { text: '"'.repeat(16_384) })));
  const credential = c.worker!;
  if (credential._tag !== "agent") throw new Error("Expected an agent fixture");
  const socketPath = join(rig.stateFolder, "reads.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make("unused-owner-fixture"), debug: false });
  const client = yield* connect(socketPath, Redacted.value(credential.token));
  let after: string | undefined;
  const found: string[] = [];
  const markers = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const result = yield* client["board.read"]({ requestId: freshRequest(), incoming: true, limit: 200, ...(after === undefined ? {} : { after }) });
    expect(encodedBytes(result)).toBeLessThanOrEqual(512 * 1024);
    if (!("data" in result)) throw new Error("Expected the labelled agent reply");
    markers.add(result.data.split("\n")[0]!);
    const plain = unwrap(result);
    expect(plain.items.length).toBeGreaterThan(0);
    expect(plain.items.every((item: any) => item.text === '"'.repeat(16_384))).toBe(true);
    found.push(...plain.items.map((item: any) => item.postId));
    after = plain.next;
    if (after === undefined) break;
  }
  expect(found).toEqual(ids);
  expect(markers.size).toBeGreaterThan(1);
  expect((yield* boardState).readState.worker!.room!.above).toEqual([]);
})).pipe(Effect.orDie));

it.live("5.9 board status and snapshot use the published view during a held commit and status survives a failed section", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  yield* seedBoard();
  const views = yield* Views;
  const before = yield* views.snapshot;
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const apply = views.applyCommitted;
  const spy = vi.spyOn(views, "applyCommitted").mockImplementation((batch) => Deferred.succeed(entered, undefined)
    .pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(apply(batch))));
  yield* Effect.gen(function* () {
    const writing = yield* change(post("held-publication", { to: [owner] })).pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    const summary = success(yield* call(ownerCredential, "board.status", {}));
    const snapshot = yield* clientSnapshot(owner);
    expect(summary).toMatchObject({ sequence: before.sequence, ownerHeld: [] });
    expect((snapshot as any).board).toMatchObject({ sequence: before.sequence, ownerHeld: [] });
    yield* Deferred.succeed(release, undefined); yield* Fiber.join(writing);
    const current = success(yield* call(ownerCredential, "board.status", {}));
    expect(current).toMatchObject({ ownerHeld: ["lead"], sequence: before.sequence + 1 });
    const failing = { ...engineLists, snapshotSections: { ...engineLists.snapshotSections, board: () => { throw new Error("Private prose"); } } };
    const failed = yield* clientSnapshot(owner, failing);
    expect(failed).not.toHaveProperty("board");
    expect(failed.failedSections).toContain("board");
    expect(success(yield* call(ownerCredential, "board.status", { requestId: current.requestId }))).toEqual(current);
  }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.ensuring(Effect.sync(() => spy.mockRestore())));
})).pipe(Effect.orDie));
