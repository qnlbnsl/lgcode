import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { AgentId, EventEnvelope, RolesActionRecord } from "@shephrd/contracts";
import { connect, type Client } from "@shephrd/client";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { exportThread } from "../../../cli/src/commands/threadExport.ts";
import { serve } from "../../src/api/server.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { buildServices } from "../../src/service.ts";
import { unwrap } from "../client/support/readRig.ts";
import { incarnationOf, makeFakeRunner, type RunnerCall } from "./fakeRunner.ts";
import { harnessSettings, makeFakeSecrets, makeRig, removeRig } from "./handlerRig.ts";
import { registerRebuildCheck } from "./rebuildCheck.ts";
import { pause } from "./routingRig.ts";

// WS-8b uses the production composition, including every piece reactor and
// capacity policy. Only the Runner boundary and secret storage are doubles.
// The fake agents speak Runner events; they never append events or seed views.
// All service commands and observations go through authenticated socket clients.
// Each invocation owns a database, a socket, clients and fibers in one scope.
type Peer = { agentId: AgentId; name: string; client: Client; token: string; connection: Scope.Closeable };
const id = () => randomUUID();
const party = (peer: Peer) => ({ _tag: "agent" as const, agentId: peer.agentId });
const call = (client: Client, command: string, payload: Record<string, unknown> = {}): Effect.Effect<any, unknown> =>
  (client as unknown as Record<string, (input: unknown) => Effect.Effect<any, unknown>>)[command]!({ requestId: id(), ...payload }).pipe(Effect.mapError((error) => new Error(`Foundry command ${command} failed: ${JSON.stringify(error)}`)));

// Poll with real scheduling while leaving the service's TestClock unchanged.
// A missed observation fails here, with a label, rather than returning an
// invented successful result to the frozen assertions.
const until = <A, E, R>(label: string, read: Effect.Effect<A, E, R>, ready: (value: A) => boolean) => Effect.gen(function* () {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = yield* read;
    if (ready(value)) return value;
    yield* pause(10);
  }
  return yield* Effect.die(new Error(`Foundry run did not observe ${label}`));
});

export const runFoundryRun = (options: { scenario?: "capacity" } = {}) => Effect.scoped(Effect.gen(function* () {
  const rig = yield* Effect.acquireRelease(Effect.sync(makeRig), (rig) => Effect.sync(() => removeRig(rig)));
  const runner = yield* makeFakeRunner();
  const secrets = [randomBytes(32).toString("base64url")];
  const redactor = makeRedactor({ secrets: () => secrets.map((value) => Redacted.make(value)), tokenHashes: () => new Set() });
  const services = buildServices(rig).pipe(Layer.provide(Layer.mergeAll(runner.layer, makeFakeSecrets().layer, redactor.layer)));
  return yield* Effect.scoped(Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* runner.subscribed;
    const scope = yield* Scope.Scope;
    chmodSync(rig.stateFolder, 0o700);
    const socket = join(rig.stateFolder, "foundry.sock");
    yield* serve({ socketPath: socket, ownerCredential: Redacted.make(secrets[0]!), debug: false });
    const open = (token: string) => connect({ environment: { SHEPHRD_SOCKET: socket, SHEPHRD_TOKEN: token }, attempts: 1 });
    const owner = yield* open(secrets[0]!);
    const peerConnection = (token: string) => Effect.gen(function* () {
      const connection = yield* Scope.fork(scope);
      const client = yield* open(token).pipe(Effect.provideService(Scope.Scope, connection));
      return { client, connection };
    });
    yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings() });
    yield* call(owner, "accounts", { operation: "add", account: { id: "primary", harness: "first", displayName: "Foundry", enabled: true } });
    expect((yield* call(owner, "roles.settings.get")).settings).toEqual({});

    const peers: Peer[] = [];
    const manual = new Set<string>();
    const pending = new Map<string, RunnerCall<"prompt">["input"]>();
    const complete = (input: NonNullable<ReturnType<typeof pending.get>>, text = "The fake agent completed its turn.") => Effect.gen(function* () {
      yield* runner.emitRaw({ _tag: "deliveryUpdate", agentId: input.agentId, incarnation: input.incarnation,
        deliveryId: input.delivery.id, kind: "message", replay: false, role: "agent", text, content: { _tag: "text", text } });
      yield* runner.emitRaw({ _tag: "turnEnded", agentId: input.agentId, incarnation: input.incarnation, deliveryId: input.delivery.id, sentSequence: input.sentSequence });
    });
    runner.script("prompt", (input) => Effect.gen(function* () {
      pending.set(input.agentId, input);
      if (!manual.has(input.agentId)) yield* pause(5).pipe(Effect.andThen(complete(input)), Effect.forkIn(scope));
    }));
    const snapshot = () => call(owner, "client.snapshot");
    const state = (peer: Peer) => snapshot().pipe(Effect.map((snapshot) => snapshot.agents.find((row: any) => row.agentId === peer.agentId)));
    const idle = (peer: Peer) => until(`${peer.name} idle`, state(peer), (row) => row?.state._tag === "idle");
    const working = (peer: Peer) => until(`${peer.name} working`, state(peer), (row) => row?.state._tag === "working");
    const finish = (peer: Peer) => Effect.gen(function* () {
      yield* working(peer);
      const input = yield* until(`${peer.name} runner delivery`, Effect.sync(() => pending.get(peer.agentId)), (value) => value !== undefined);
      yield* complete(input!);
      yield* idle(peer);
    });
    const start = (name: string, role: string, parent?: Peer, groups: string[] = [], firstPrompt?: string) => Effect.gen(function* () {
      const reply = yield* call(parent?.client ?? owner, "start", { name, role, harness: "first", account: { _tag: "named", accountId: "primary" },
        permission: "ask", folder: rig.work, runMode: "acp", groups, prompt: firstPrompt ?? `Begin the Foundry work as ${name}.` });
      const spawned = runner.callsOf("start").find((row) => row.input.agentId === reply.agentId);
      expect(spawned).toBeDefined();
      const token = Redacted.value(spawned!.input.token);
      secrets.push(token);
      const peer: Peer = { agentId: reply.agentId, name, token, ...(yield* peerConnection(token)) };
      peers.push(peer);
      yield* idle(peer);
      return peer;
    });
    const actions = (peer?: Peer) => call(owner, "roles.actions.list", peer === undefined ? {} : { agentId: peer.agentId }).pipe(
      Effect.map((reply) => reply.items as RolesActionRecord[]));
    const taggedActions = <T extends RolesActionRecord["_tag"]>(peer: Peer, tag: T) => actions(peer).pipe(Effect.map((rows) => rows.filter((row): row is Extract<RolesActionRecord, { _tag: T }> => row._tag === tag)));
    const waitAction = <T extends RolesActionRecord["_tag"]>(peer: Peer, tag: T, count = 1) => until(`${peer.name} ${tag}`, taggedActions(peer, tag), (rows) => rows.length >= count);
    // Subscribe only to a durable head, then close the stream. Nothing reads
    // the database or internal views to produce an acceptance observation.
    const events = (after = 0) => Effect.gen(function* () {
      const head = (yield* call(owner, "client.sequence")).sequence as number;
      if (head <= after) return [] as EventEnvelope[];
      return yield* owner.subscribe({ requestId: id() as never, after: after as never }).pipe(
        Stream.takeUntil((row) => row.sequence >= head), Stream.runCollect, Effect.map((rows) => [...rows] as EventEnvelope[]));
    });
    const mark = () => call(owner, "client.sequence").pipe(Effect.map((reply) => reply.sequence as number));
    // Quiet agent tools disconnect while the test clock advances. This avoids
    // replaying their 100 ms credential polling for every virtual hour. The
    // production transport and all timers remain unchanged. A blocking wait
    // retains its connection during the capacity step.
    const advance = (minutes: number, disconnect = true) => Effect.gen(function* () {
      if (disconnect) for (const peer of peers) yield* Scope.close(peer.connection, Exit.succeed(undefined));
      yield* pause(30);
      yield* TestClock.adjust(minutes * 60_000);
      yield* pause(30);
      if (disconnect) for (const peer of peers) {
        const row = yield* state(peer);
        if (row?.state._tag === "crashed" || row?.state._tag === "stopped") continue;
        Object.assign(peer, yield* peerConnection(peer.token));
        yield* call(peer.client, "client.thread", { agentId: peer.agentId, after: 0, limit: 1 });
      }
    });
    const post = (from: Client, to: Peer, text: string, reply = "all") => call(from, "board.post", { direct: party(to), to: [party(to)], text, reply });
    const wakeCount = (rows: EventEnvelope[], peer: Peer) => rows.filter((row) => row.event._tag === "board.WakeBuilt" && row.event.targetAgentId === peer.agentId).length;

    const orchestrator = yield* start("orchestrator", "orchestrator");
    const leadA = yield* start("lead-a", "lead", orchestrator, ["team-a"]);
    const a1 = yield* start("worker-a1", "worker", leadA, ["team-a"]);
    const a2 = yield* start("worker-a2", "worker", leadA, ["team-a"]);
    const leadB = yield* start("lead-b", "lead", orchestrator, ["team-b"]);
    const b1 = yield* start("worker-b1", "worker", leadB, ["team-b"]);
    const b2 = yield* start("worker-b2", "worker", leadB, ["team-b"]);
    const originals = [...peers];
    const names = new Map(peers.map((peer) => [peer.agentId, peer.name]));
    const initialRoster = yield* call(owner, "client.roster");
    const roster = originals.map((peer) => {
      const row = initialRoster.agents.find((row: any) => row.agentId === peer.agentId);
      return { name: row?.name, role: row?.role, parent: row?.parent._tag === "owner" ? null : names.get(row?.parent.agentId) };
    });
    const orientations: Record<string, string[]> = {};
    for (const peer of peers) {
      const reply = unwrap(yield* call(peer.client, "roles.orient"));
      expect(reply.agentId).toBe(peer.agentId);
      expect(reply.advice.length).toBeGreaterThan(0);
      orientations[peer.name] = reply.agents.map((row: any) => row.name);
    }
    const channels = new Map<string, string>();
    const teamChannels: Record<string, string[]> = {};
    for (const [lead, workers, group] of [[leadA, [a1, a2], "team-a"], [leadB, [b1, b2], "team-b"]] as const) {
      const opened = yield* call(lead.client, "board.open", { name: group, group });
      channels.set(lead.name, opened.channelId);
      for (const worker of workers) yield* call(worker.client, "board.post", { channelId: opened.channelId, to: [], reply: "none", text: `Ready: ${worker.name}` });
      const posts = yield* call(owner, "board.read", { channelId: opened.channelId });
      teamChannels[lead.name] = posts.items.map((post: any) => names.get(post.author.agentId));
      const listing = yield* call(lead.client, "board.channels");
      expect(listing.items.find((row: any) => row.channelId === opened.channelId)?.kind).toBe("group");
    }

    // FR07 and FR13: keep the worker's turn and the lead's blocking wait open
    // across a production five-minute backoff. Retry carries the same delivery.
    manual.add(a1.agentId);
    const delivery = yield* call(leadA.client, "prompt", { agentId: a1.agentId, text: "Continue after the capacity outage." });
    yield* working(a1);
    const capacityMark = yield* mark();
    let blockingWaitReturns = 0;
    const waiting = yield* call(leadA.client, "wait", { members: [a1.agentId], mode: "all", block: true }).pipe(
      Effect.tap(() => Effect.sync(() => { blockingWaitReturns++; })), Effect.forkIn(scope));
    yield* until("the blocking wait opening", events(capacityMark), (rows) => rows.some((row) => row.event._tag === "WaitOpened" && row.agentId === leadA.agentId));
    yield* runner.emitRaw({ _tag: "promptReply", agentId: a1.agentId, incarnation: incarnationOf(a1.token), deliveryId: delivery.deliveryId,
      outcome: { _tag: "capacity", error: "The provider is at capacity." } });
    const heldRow = yield* until("the capacity hold", state(a1), (row) => row?.capacityHeld === true);
    yield* advance(4, false);
    expect((yield* state(a1)).capacityHeld).toBe(true);
    yield* advance(1, false);
    const releasedRow = yield* until("the capacity retry", state(a1), (row) => row?.capacityHeld === false && row.state._tag === "working");
    const capacityRows = yield* events(capacityMark);
    expect(capacityRows.filter((row) => row.event._tag === "DeliveryReleased")).toHaveLength(1);
    const capacityRetry = { leadWakeCount: wakeCount(capacityRows, leadA), blockingWaitReturns };
    yield* complete(pending.get(a1.agentId)!, "The worker continued after capacity returned.");
    yield* idle(a1);
    const waited = yield* Fiber.join(waiting);
    expect(waited.outcome).toBe("satisfied");
    const capacity = { held: heldRow.capacityHeld === true, released: releasedRow.capacityHeld === false,
      workerContinued: (yield* events(capacityMark)).some((row) => row.event._tag === "ThreadItem" && row.agentId === a1.agentId) };
    manual.delete(a1.agentId);
    if (options.scenario === "capacity") {
      for (const peer of [...peers].reverse()) yield* call(owner, "stop", { agentId: peer.agentId });
      return { capacityRetry, roster, orientations, teamChannels };
    }

    // FR04: an upstream obligation makes false lead-stall detection observable.
    const upstream = yield* post(owner, leadA, "Hand off this batch and collect both workers.");
    yield* idle(leadA);
    manual.add(a1.agentId); manual.add(a2.agentId);
    const batchMark = yield* mark();
    const batch = yield* call(leadA.client, "board.post", { channelId: channels.get(leadA.name), to: [party(a1), party(a2)], reply: "all", text: "Finish both parts of the batch." });
    yield* working(a1); yield* working(a2);
    yield* advance(21);
    const leadReportedStalledWhileWorking = (yield* taggedActions(leadA, "roles.StallSeen")).length > 0;
    const answer = (peer: Peer, replyTo: string, channelId: string) => call(peer.client, "board.post", {
      channelId, to: [], reply: "none", replyTo, text: `Completed: ${peer.name}`,
    });
    yield* answer(a1, batch.postId, channels.get(leadA.name)!);
    yield* finish(a1);
    expect(wakeCount(yield* events(batchMark), leadA)).toBe(0);
    yield* answer(a2, batch.postId, channels.get(leadA.name)!);
    yield* finish(a2);
    const completedRows = yield* until("one all-mode completion wake", events(batchMark), (rows) => wakeCount(rows, leadA) === 1);
    const completionWake = completedRows.find((row) => row.event._tag === "board.WakeBuilt" && row.event.targetAgentId === leadA.agentId)!;
    const deliveredCompletion = yield* until("the lead receiving both completion replies", Effect.sync(() => runner.callsOf("prompt").find((row) =>
      row.input.agentId === leadA.agentId && row.input.delivery.source?._tag === "piece"
      && row.input.delivery.source.id === (completionWake.event as { wakeId: string }).wakeId)), (row) => row !== undefined);
    expect(JSON.stringify(deliveredCompletion!.input.delivery.content)).toContain("Completed: worker-a1");
    expect(JSON.stringify(deliveredCompletion!.input.delivery.content)).toContain("Completed: worker-a2");
    yield* idle(leadA);
    const replies = yield* call(owner, "board.read", { repliesTo: batch.postId });
    const closed = completedRows.find((row) => row.event._tag === "board.PostClosed" && row.event.postId === batch.postId);
    expect(closed?.event).toMatchObject({ outcome: "answered" });
    const allModeWait = { outcome: closed?.event._tag === "board.PostClosed" && closed.event.outcome === "answered" ? "satisfied" : "open", replies: replies.items.map((post: any) => names.get(post.author.agentId)),
      leadReportedStalledWhileWorking, wakeCount: wakeCount(completedRows, leadA) };
    yield* call(owner, "board.close", { postId: upstream.postId });
    manual.clear();

    // FR05: a question on the board leaves both obligations idle. Its lead
    // has no busy child that could justify suppressing either stall clock.
    const assignment = yield* post(leadA.client, a1, "Complete the task, or ask me for the missing decision.");
    yield* idle(a1);
    const question = yield* post(a1.client, leadA, "Which option should I use?");
    yield* idle(leadA);
    yield* advance(10);
    yield* waitAction(a1, "roles.StallSeen");
    // The worker's nudge is real work at the transport boundary until it
    // ends. Let its three episodes finish before the lead gets a whole
    // uninterrupted twenty-minute idle episode.
    yield* advance(10); yield* idle(a1); yield* idle(leadA);
    yield* advance(10); yield* idle(a1); yield* idle(leadA);
    yield* advance(20);
    const leadStalls = yield* waitAction(leadA, "roles.StallSeen");
    const questionStall = { workerStalled: (yield* taggedActions(a1, "roles.StallSeen")).some((row) => row.stalledPostId === assignment.postId),
      leadStalled: leadStalls.some((row) => row.stalledPostId === question.postId) };
    yield* call(owner, "board.close", { postId: assignment.postId });
    yield* call(owner, "board.close", { postId: question.postId });
    yield* idle(leadA); yield* idle(a1);

    // FR06: actual nudge turns end between episodes, so the same open task
    // can cross its next threshold without treating a working turn as idle.
    const repeated = yield* post(leadB.client, b1, "This task still needs a reply.");
    yield* idle(b1);
    for (let episode = 1; episode <= 3; episode++) {
      yield* advance(10);
      yield* until(`stall episode ${episode}`, actions(b1), (rows) => rows.some((row) => "stalledPostId" in row && row.stalledPostId === repeated.postId && row.occurrence === episode));
      yield* idle(b1); yield* idle(leadB);
    }
    const reports = (yield* taggedActions(b1, "roles.ReplaceAdvised")).filter((row) => row.stalledPostId === repeated.postId);
    const repeatedStall = { episodes: Math.max(...reports.map((row) => row.occurrence)), reportCount: reports.length,
      reportedAgent: names.get(reports[0]?.agentId as AgentId) };
    yield* call(owner, "board.close", { postId: repeated.postId });

    // FR08-FR09: faults enter through the Runner boundary, with the live
    // incarnation. The public log must show one retry and a new working turn.
    const crashMark = yield* mark();
    const loadsBefore = runner.callsOf("load").length;
    yield* runner.emitRaw({ _tag: "exited", agentId: b2.agentId, incarnation: incarnationOf(b2.token), exitCode: 1, signal: null, stderr: "A simulated adapter crash." });
    yield* waitAction(b2, "roles.CrashRetried");
    const resumed = runner.callsOf("load").findLast((row) => row.input.agentId === b2.agentId);
    expect(resumed).toBeDefined();
    const crashRows = yield* until("the resumed working turn", events(crashMark), (rows) => rows.some((row) => row.event._tag === "DeliverySent" && row.agentId === b2.agentId));
    yield* idle(b2);
    const secondMark = yield* mark();
    const resumedToken = Redacted.value(resumed!.input.token);
    secrets.push(resumedToken);
    b2.token = resumedToken;
    yield* runner.emitRaw({ _tag: "exited", agentId: b2.agentId, incarnation: incarnationOf(resumedToken), exitCode: 1, signal: null, stderr: "A second simulated adapter crash." });
    const gaveUp = yield* waitAction(b2, "roles.GaveUp");
    const crashes = { first: { resumed: runner.callsOf("load").length === loadsBefore + 1,
      newWorkingTurn: crashRows.some((row) => row.event._tag === "DeliverySent" && row.agentId === b2.agentId) },
      second: { resumed: (yield* events(secondMark)).some((row) => row.event._tag === "SessionOpened" && row.agentId === b2.agentId),
        reportCount: gaveUp.filter((row) => row._tag === "roles.GaveUp" && row.cause === "crash").length } };

    // FR10: observe a new idle hour for team B, then inspect its routed post.
    yield* call(leadB.client, "prompt", { agentId: b1.agentId, text: "Close the remaining team work." });
    yield* idle(b1); yield* idle(leadB);
    const idleMark = yield* mark();
    yield* advance(60);
    const idleReports = yield* waitAction(leadB, "roles.TeamIdleReported");
    const newIdle = idleReports.filter((row) => row.sequence > idleMark && row.group === "team-b");
    expect(newIdle).toHaveLength(1);
    const noticeRows = yield* events(idleMark);
    const idlePost = noticeRows.find((row) => row.event._tag === "board.PostWritten" && row.event.postId === newIdle[0]!.postId);
    expect(idlePost?.event).toMatchObject({ to: [party(orchestrator)], reply: "none", text: expect.stringContaining("team has no running work") });
    const teamIdle = { lead: names.get(newIdle[0]!.agentId), holder: names.get(newIdle[0]!.noticeRecipient as AgentId), noticeCount: newIdle.length };

    // FR11: a real oversized tool result makes a cut hand-off. The lead
    // reads the full source page and answers the replacement through the board.
    manual.add(a2.agentId);
    yield* call(leadA.client, "prompt", { agentId: a2.agentId, text: "Prepare a detailed hand-off." });
    yield* working(a2);
    const input = pending.get(a2.agentId)!;
    const cutEvidence = "The omitted decision is use option violet.";
    const omittedText = "Detailed tool evidence. ".repeat(3000) + cutEvidence;
    yield* runner.emitRaw({ _tag: "deliveryUpdate", agentId: a2.agentId, incarnation: input.incarnation, deliveryId: input.delivery.id,
      kind: "tool-call", replay: false, role: "agent", text: "A detailed tool result.",
      content: { _tag: "tool-call", callId: "handoff-evidence", title: "Read the decision", status: "completed", output: omittedText } });
    yield* finish(a2);
    const handoff = unwrap(yield* call(leadA.client, "roles.handoff", { agentId: a2.agentId }));
    expect(JSON.stringify(handoff)).toMatch(/Cut at sequence/);
    expect(JSON.stringify(handoff)).not.toContain(cutEvidence);
    yield* call(leadA.client, "stop", { agentId: a2.agentId });
    const replacement = yield* start("replacement-a2", "worker", leadA, ["team-a"], JSON.stringify(handoff));
    const request = yield* post(replacement.client, leadA, "Please send the cut tool result from the hand-off.");
    yield* idle(leadA);
    const source = yield* call(leadA.client, "client.thread", { agentId: a2.agentId, after: 0, limit: 500 });
    const evidence = unwrap(source).items.find((row: EventEnvelope) => row.event._tag === "ThreadItem" && row.event.content._tag === "tool-call");
    expect(evidence?.event.content.output).toBe(omittedText);
    yield* call(leadA.client, "board.post", { direct: party(replacement), to: [], reply: "none", replyTo: request.postId,
      text: evidence.event.content.output.slice(-1000) });
    const received = unwrap(yield* call(replacement.client, "board.read", { repliesTo: request.postId }));
    const reply = received.items.find((post: any) => post.replyTo === request.postId);
    const replacementResult = { cutPartRequested: (yield* call(owner, "board.read", { post: request.postId })).items.some((post: any) => post.author.agentId === replacement.agentId),
      cutPartReceived: reply?.text.includes("use option violet") === true, receivedFrom: names.get(reply?.author.agentId) };

    // FR12: the production export follows every owner thread page and writes
    // real files. Verify both attribution and exported event content.
    const attribution = yield* call(owner, "client.roster");
    const exported = new Map<string, EventEnvelope[]>();
    for (const peer of peers) {
      const path = join(rig.root, `${peer.name}.jsonl`);
      yield* exportThread(owner, peer.agentId, path);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as EventEnvelope);
      expect(rows.some((row) => row.event._tag === "AgentStarted" && row.agentId === peer.agentId)).toBe(true);
      exported.set(peer.agentId, rows);
    }
    const wrapUp = { attributionRows: attribution.agents.filter((row: any) => originals.some((peer) => peer.agentId === row.agentId)).length,
      exportedThreads: originals.filter((peer) => exported.has(peer.agentId)).length,
      allThreadsNonEmpty: [...exported.values()].every((rows) => rows.some((row) => row.event._tag === "ThreadItem")) };
    const visible = JSON.stringify([yield* events(), [...exported.values()]]);
    for (const secret of secrets) expect(visible).not.toContain(secret);
    for (const peer of [...peers].reverse()) if ((yield* state(peer)).state._tag !== "stopped") yield* call(owner, "stop", { agentId: peer.agentId });
    return { roster, orientations, teamChannels, allModeWait, questionStall, repeatedStall, capacity, crashes, teamIdle,
      replacement: replacementResult, wrapUp, capacityRetry };
  })).pipe(Effect.provide(services), Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })));
}));
