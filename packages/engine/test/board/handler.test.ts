import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  call, freshRequest, headSequence, logAfter, makeRig, ownerCredential, readLog, removeRig,
  success, type Credential, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agent, boardState, change, encodedBytes, eventsOf, owner, postAs, provideBoard, seedBoard, serviceCall, snapshot } from "./wakeFixtures.ts";
import { channel as channelEvent, post as postEvent } from "./fixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPRD_HOME", rig.stateFolder); });
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

it.live("5.11 board.read checks current access on every request, stores no receipt, and writes idempotent caller marks", () => run((c) => Effect.gen(function* () {
  const postId = yield* postAs(c.lead!);
  const requestId = freshRequest();
  const first = success(yield* call(c.worker!, "board.read", { requestId, channelId: "room" }));
  expect(first).toMatchObject({ requestId });
  expect(first.data).toContain(postId);
  const unwrap = (data: string) => JSON.parse(data.split("\n").find((line) => line.startsWith("{"))!);
  const marks = eventsOf(yield* readLog, "board.Read");
  expect(marks).toHaveLength(1);
  expect(marks[0]).toMatchObject({ channelId: "room", reader: agent("worker"), postIds: [postId] });
  const sql = yield* SqlClient.SqlClient;
  expect(yield* sql<{ count: number }>`SELECT count(*) AS count FROM receipts WHERE request_id = ${requestId}`).toEqual([{ count: 0 }]);

  const retry = success(yield* call(c.worker!, "board.read", { requestId, channelId: "room" }));
  expect(unwrap(retry.data)).toEqual(unwrap(first.data));
  expect(eventsOf(yield* readLog, "board.Read")).toHaveLength(1);
  success(yield* call(ownerCredential, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  expect((yield* call(c.worker!, "board.read", { requestId, channelId: "room" }))._tag).toBe("Failure");
})));

it.live("5.8 board.read pages close at 512 KiB and limit one returns an ordinary item", () => run(() => Effect.gen(function* () {
  const rows = Array.from({ length: 40 }, (_, index) => postEvent(`large-${index}`, { text: "\\\"界".repeat(4_000) }));
  yield* change(...rows);
  const first = success(yield* call(ownerCredential, "board.read", { channelId: "room", limit: 200 }));
  expect(first.items.length).toBeGreaterThan(0);
  expect(encodedBytes(first)).toBeLessThanOrEqual(512 * 1024);
  const oversized = success(yield* call(ownerCredential, "board.read", { channelId: "room", limit: 1, after: first.items[0].postId }));
  expect(oversized.items).toHaveLength(1);
  expect(oversized.items[0].text).toHaveLength(12_000);
})));

it.live("5.12 board.channels pages 2,000 channels and repliesTo requires current membership", () => run((c) => Effect.gen(function* () {
  const channels = Array.from({ length: 2_000 }, (_, index) => channelEvent({
    channelId: `room-${index}`, name: `Room-${index}`, members: [owner, agent("lead"), ...(index === 0 ? [agent("worker")] : [])],
  }));
  const privateChannel = channelEvent({ channelId: "private-room", name: "Private", members: [owner, agent("lead"), agent("worker")] });
  const rootPost = postEvent("root-post", { channelId: "private-room", text: "Root.", to: [agent("worker")] });
  yield* change(...channels, privateChannel, rootPost);
  const ids: string[] = [];
  let after: string | undefined;
  for (let index = 0; index < 20; index++) {
    const page = success(yield* call(ownerCredential, "board.channels", { limit: 200, ...(after === undefined ? {} : { after }) }));
    expect(encodedBytes(page)).toBeLessThanOrEqual(512 * 1024);
    ids.push(...page.items.map((item: { channelId: string }) => item.channelId));
    after = page.next;
    if (after === undefined) break;
  }
  expect(ids).toHaveLength(2_002);
  expect(new Set(ids).size).toBe(2_002);
  expect((yield* call(c.other!, "board.read", { repliesTo: "root-post" }))._tag).toBe("Failure");
})));

it.live("5.6 board.status exposes only bounded ids and counts to owner, service, holder and self", () => run((c) => Effect.gen(function* () {
  const postId = yield* postAs(c.lead!);
  yield* change(
    channelEvent({ channelId: "status-private", name: "Private-Title", opener: owner, manager: owner, members: [owner, agent("worker")] }),
    postEvent("private-status-post", { channelId: "status-private", author: owner, text: "Private post body.", to: [agent("worker")] }),
  );
  for (const credential of [ownerCredential, c.lead!, c.worker!]) {
    const result = success(yield* call(credential, "board.status", { agentId: "worker" }));
    expect(result).toMatchObject({ agentId: "worker", incomingOpen: 2, disabled: false, sequence: expect.any(Number) });
    expect(JSON.stringify(result)).not.toContain("Please report your result.");
    expect(JSON.stringify(result)).not.toContain("Room");
    expect(JSON.stringify(result)).not.toContain("Private-Title");
    expect(JSON.stringify(result)).not.toContain("Private post body.");
    expect(JSON.stringify(result)).not.toContain(postId);
  }
  expect((yield* call(c.other!, "board.status", { agentId: "worker" }))._tag).toBe("Failure");
  expect((yield* serviceCall("board.status", { agentId: "worker" }))._tag).toBe("Success");

  const incoming = Array.from({ length: 3_072 }, (_, index) => postEvent(`status-${index}`, {
    text: "question", to: [agent("worker")], reply: "all",
  }));
  yield* change(...incoming);
  const ids: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = success(yield* call(c.lead!, "board.status", {
      agentId: "worker", detail: "incoming", limit: 200, ...(after === undefined ? {} : { after }),
    }));
    expect(encodedBytes(result)).toBeLessThanOrEqual(512 * 1024);
    ids.push(...result.items.map((item: { postId: string }) => item.postId));
    after = result.next;
    if (after === undefined) break;
  }
  expect(ids).toHaveLength(3_074);
  expect(new Set(ids).size).toBe(3_074);
})));

for (const group of [false, true]) {
  it.live(`FR-034 ${group ? "group" : "plain"} names are unique per manager across fresh requests and exact replay`, () => run((c) => Effect.gen(function* () {
    yield* change({ _tag: "AgentGrouped", agentId: "lead", groups: ["review"] });
    const payload = { requestId: freshRequest(), name: "Review", ...(group ? { group: "review", anchorAgentId: "lead" } : {}) };
    const first = success(yield* call(c.lead!, "board.open", payload));
    const before = yield* headSequence;
    expect(success(yield* call(c.lead!, "board.open", payload))).toEqual(first);
    expect(yield* logAfter(before)).toEqual([]);
    const duplicate = yield* call(c.lead!, "board.open", { ...payload, requestId: freshRequest() });
    expect(duplicate._tag).toBe("Failure");
    expect(eventsOf(yield* logAfter(before), "board.ChannelOpened")).toEqual([]);
    const other = success(yield* call(ownerCredential, "board.open", { ...payload, requestId: freshRequest() }));
    expect(other.channelId).not.toBe(first.channelId);
    // Plain and group channels share their manager's namespace.
    expect((yield* call(c.lead!, "board.open", { name: "Review", ...(group ? {} : { group: "review" }) }))._tag).toBe("Failure");
    const racing = yield* Effect.all([1, 2].map(() => call(c.lead!, "board.open", { ...payload, name: "Concurrent", requestId: freshRequest() })), { concurrency: 2 });
    expect(racing.map((result) => result._tag).sort()).toEqual(["Failure", "Success"]);
  })));
}

for (const changeKind of ["closed", "resolved", "hidden"] as const) {
  it.live(`FR-035 incoming and status cursors advance when their anchor becomes ${changeKind}`, () => run((c) => Effect.gen(function* () {
    yield* change(channelEvent({ channelId: "anchor-room", name: "Anchor", members: [agent("lead"), agent("worker")] }));
    const first = yield* postAs(c.lead!);
    const anchor = yield* postAs(c.lead!, { channelId: "anchor-room" });
    const last = yield* postAs(c.lead!);
    const requestId = freshRequest();
    const unwrap = (reply: Record<string, any>) => reply.data === undefined ? reply : JSON.parse(reply.data.split("\n").find((line: string) => line.startsWith("{"))!);
    const page = unwrap(success(yield* call(c.worker!, "board.read", { requestId, incoming: true, limit: 2 })));
    expect(page.items.map((row: { postId: string }) => row.postId)).toEqual([first, anchor]);
    expect(page.next).toBe(anchor);
    const status = success(yield* call(c.worker!, "board.status", { agentId: "worker", detail: "incoming", limit: 2 }));
    expect(status.next).toBe(anchor);
    if (changeKind === "closed") success(yield* call(c.lead!, "board.close", { postId: anchor }));
    else if (changeKind === "resolved") yield* change({ _tag: "board.AddresseeResolved", postId: anchor, addressee: agent("worker"), disposition: "removed", authorIsOwner: false });
    else success(yield* call(c.lead!, "board.members", { channelId: "anchor-room", add: [], remove: ["worker"] }));
    const beforeRead = yield* headSequence;
    const next = unwrap(success(yield* call(c.worker!, "board.read", { requestId, incoming: true, after: page.next, limit: 2 })));
    expect(next.items.map((row: { postId: string }) => row.postId)).toEqual([last]);
    expect(next.next).toBeUndefined();
    expect(eventsOf(yield* logAfter(beforeRead), "board.Read").flatMap((row) => row.postIds)).toEqual([last]);
    const detail = success(yield* call(c.worker!, "board.status", { agentId: "worker", detail: "incoming", after: status.next, limit: 2 }));
    expect(detail.items.map((row: { postId: string }) => row.postId)).toEqual([last]);
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql<{ count: number }>`SELECT count(*) AS count FROM receipts WHERE request_id = ${requestId}`).toEqual([{ count: 0 }]);
  })));
}

it.live("FR-035 own-open pagination keeps a closed anchor's sequence", () => run((c) => Effect.gen(function* () {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push(yield* postAs(c.lead!));
  const first = success(yield* call(ownerCredential, "board.status", { agentId: "lead", detail: "own", limit: 2 }));
  const open = success(yield* call(c.lead!, "board.read", { open: true, limit: 2 }));
  const parsed = JSON.parse(open.data.split("\n").find((line: string) => line.startsWith("{"))!);
  expect(parsed.next).toBe(ids[1]);
  success(yield* call(c.lead!, "board.close", { postId: ids[1] }));
  const next = success(yield* call(ownerCredential, "board.status", { agentId: "lead", detail: "own", after: first.next }));
  expect(next.items.map((row: { postId: string }) => row.postId)).toEqual([ids[2]]);
  const continued = success(yield* call(c.lead!, "board.read", { open: true, after: parsed.next }));
  expect(JSON.parse(continued.data.split("\n").find((line: string) => line.startsWith("{"))!).items.map((row: { postId: string }) => row.postId)).toEqual([ids[2]]);
})));

it.live("FR-096 a schema-valid replay singleton exceeds 512 KiB and advances to the following post", () => run(() => Effect.gen(function* () {
  // Branded legacy identities have no length bound. The text stays schema-valid.
  const legacy = postEvent("legacy-large", { author: { _tag: "service", service: "x".repeat(530_000) }, reply: "none", to: [], text: "Legacy notice." });
  yield* change(legacy, postEvent("following", { reply: "none", to: [] }));
  const page = success(yield* call(ownerCredential, "board.read", { channelId: "room" }));
  expect(page.items.map((row: { postId: string }) => row.postId)).toEqual(["legacy-large"]);
  expect(encodedBytes(page)).toBeGreaterThan(512 * 1024);
  expect(page.next).toBe("legacy-large");
  const next = success(yield* call(ownerCredential, "board.read", { channelId: "room", after: page.next }));
  expect(next.items.map((row: { postId: string }) => row.postId)).toEqual(["following"]);
  expect(next.next).toBeUndefined();
})));
