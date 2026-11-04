import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  call, freshRequest, headSequence, logAfter, makeRig, ownerCredential, readLog, removeRig,
  success, type Credential, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agent, boardState, eventsOf, owner, postAs, provideBoard, seedBoard, snapshot } from "./wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const run = <A, E, R>(body: (credentials: Record<string, Credential>) => Effect.Effect<A, E, R>) => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  return yield* body(yield* seedBoard());
})).pipe(Effect.orDie);

it.live("3.14 planner replies: open and post return their own committed ids; receipts contain no post text in reply", () => run(() => Effect.gen(function* () {
  const openRequest = freshRequest();
  const opened = success(yield* call(ownerCredential, "board.open", { requestId: openRequest, name: "Review" }));
  const channel = eventsOf(yield* readLog, "board.ChannelOpened").find((row) => row.channelId === opened.channelId);
  expect(channel).toMatchObject({ channelId: opened.channelId, name: "Review", opener: owner });
  expect(opened).toEqual({ requestId: openRequest, channelId: channel!.channelId });
  const postRequest = freshRequest();
  const text = "Unique post text that must not be in a planner reply.";
  const written = success(yield* call(ownerCredential, "board.post", { requestId: postRequest, channelId: opened.channelId, text, reply: "none", to: [] }));
  const event = eventsOf(yield* readLog, "board.PostWritten").find((row) => row.postId === written.postId);
  expect(event).toMatchObject({ channelId: opened.channelId, text });
  expect(written).toEqual({ requestId: postRequest, postId: event!.postId });
  const sql = yield* SqlClient.SqlClient;
  const stored = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${postRequest}`;
  expect(JSON.parse(stored[0]!.result_json).reply).toEqual(written);
  expect(JSON.stringify(written)).not.toContain(text);
  const before = yield* headSequence;
  expect(success(yield* call(ownerCredential, "board.open", { requestId: openRequest, name: "Review" }))).toEqual(opened);
  expect(success(yield* call(ownerCredential, "board.post", { requestId: postRequest, channelId: opened.channelId, text, reply: "none", to: [] }))).toEqual(written);
  expect(yield* logAfter(before)).toEqual([]);
})));

for (const command of ["board.members", "board.close", "board.acknowledge", "board.flush"] as const) {
  it.live(`3.14 planner replies: ${command} replays its receipt without another event or runner action`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    const payload = { requestId: freshRequest(), ...(command === "board.members"
      ? { channelId: "room", add: [], remove: ["fourth"] }
      : command === "board.flush" ? { agentId: "worker" } : { postId: id }) };
    const credential = command === "board.acknowledge" ? c.worker! : ownerCredential;
    const first = success(yield* call(credential, command, payload));
    const before = yield* headSequence;
    const state = yield* snapshot;
    expect(success(yield* call(credential, command, payload))).toEqual(first);
    expect(yield* logAfter(before)).toEqual([]);
    expect(yield* snapshot).toEqual(state);
    expect(JSON.stringify(first)).not.toContain("Please report your result.");
  })));
}

it.live("3.14 planner replies: a direct post creates one channel and returns one stable post id after retry", () => run((c) => Effect.gen(function* () {
  const requestId = freshRequest();
  const payload = { requestId, direct: agent("worker"), text: "Private request.", reply: "all", to: [agent("worker")] };
  const first = success(yield* call(c.lead!, "board.post", payload));
  const state = yield* boardState;
  const posted = state.posts[first.postId]!;
  expect(state.channels[posted.channelId]).toMatchObject({ kind: "direct", members: [agent("lead"), agent("worker")] });
  const before = yield* headSequence;
  expect(success(yield* call(c.lead!, "board.post", payload))).toEqual(first);
  expect(yield* logAfter(before)).toEqual([]);
})));

it.live("3a.1 board.channels reads current membership and board.status returns counts without names or post text", () => run((c) => Effect.gen(function* () {
  yield* postAs(c.lead!);
  const channels = success(yield* call(c.worker!, "board.channels", {}));
  expect(channels.items.map((item: { channelId: string }) => item.channelId)).toEqual(["room"]);
  const status = success(yield* call(c.worker!, "board.status", { agentId: "worker" }));
  expect(status).toMatchObject({ agentId: "worker", incomingOpen: 1, wakeQueued: true, wakeSent: false, disabled: false });
  expect(JSON.stringify(status)).not.toContain("Please report your result.");
  expect(JSON.stringify(status)).not.toContain("Room");
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  const again = success(yield* call(c.worker!, "board.channels", {}));
  expect(again.items).toEqual([]);
})));
