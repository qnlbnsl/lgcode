import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import {
  accountFor, echoFile, harnessFor, makeRunnerRig, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter,
  type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { incarnationOf, type FakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, agentRow, call, failureOf, headSequence, logAfter, makeRig, ownerCredential, readLog,
  removeRig, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendWith, deliveryRow, eventually, pause, questionRow, requestPermission, requestRow, snapshot, tagged } from "../support/routingRig.ts";
import { accept, deliveryRig, promptsTo, send, spawn, waitFor, type Spawned } from "../support/deliveryRig.ts";
import { makeStderrTail, stderrTailLines } from "../../src/recovery/crash.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";

// Unit 6c, criterion 6.6 (task 6c.1), rows 25, 27, 32, 36, 50, 52, 57, 67, 68
// and 73, issues 74, 89 and 102. A crash records the exit code and the last
// error lines with secrets removed, cancels the dead agent's open requests,
// revokes its token, tells the waiter and the parent once, writes "owner
// needed" when no agent can act for it, and restarts nothing.
//
// The first block drives the real command handler, log, views and redactor
// with the fake runner, so the engine's reading of an `exited` event is what
// is tested. The second block drives the real ACP runner over the fake agent,
// so the stderr that reaches the event is what a real child wrote.

const secret = "sk-planted-crash-secret-0123456789abcdef";
const otherSecret = "sk-planted-second-secret-fedcba9876543210";
// Fixed text that must stay out of every notice: a stderr word and a path.
const stderrWord = "kaboom-from-stderr";

// ---------------------------------------------------------------------------
// The stderr tail, alone.
// ---------------------------------------------------------------------------

const tailRedactor = () => makeRedactor({
  secrets: () => [Redacted.make(secret), Redacted.make(otherSecret)],
  tokenHashes: () => new Set<string>(),
});
const tailFor = (maxLines: number, redactor = tailRedactor()) =>
  makeStderrTail({ redactChunk: (itemId, text, final) => Effect.sync(() => redactor.redactChunk(itemId, text, final)), maxLines });

describe("6.6 the stderr tail keeps the last lines and removes secrets across chunk boundaries (issue 102)", () => {
  it.effect("a secret split across two chunks is gone from the tail, with both halves, and the text around it stays (breaks if each chunk is redacted alone, or the carry is not used)", () => Effect.gen(function* () {
    const tail = yield* tailFor(5);
    const cut = 17;
    yield* tail.push(`error: bad key ${secret.slice(0, cut)}`);
    yield* tail.push(`${secret.slice(cut)} was refused\nsecond line\n`);
    const text = yield* tail.finish();
    expect(text).not.toContain(secret);
    expect(text).not.toContain(secret.slice(0, cut));
    expect(text).not.toContain(secret.slice(cut));
    expect(text).toBe("error: bad key [REDACTED] was refused\nsecond line");
  }));

  it.effect("a secret split across three chunks, with the last chunk holding one character, is also gone (breaks if the carry is flushed after a fixed number of chunks or a fixed size)", () => Effect.gen(function* () {
    const tail = yield* tailFor(5);
    yield* tail.push(`x ${secret.slice(0, 9)}`);
    yield* tail.push(secret.slice(9, secret.length - 1));
    yield* tail.push(`${secret.slice(-1)}\n`);
    expect(yield* tail.finish()).toBe("x [REDACTED]");
  }));

  it.effect("a secret at the very end of the output, with no line end, is redacted when the tail is finished (breaks if finish() drops the carry or releases it without the final flag)", () => Effect.gen(function* () {
    const tail = yield* tailFor(5);
    yield* tail.push(`first\nlast ${secret.slice(0, 20)}`);
    yield* tail.push(secret.slice(20));
    expect(yield* tail.finish()).toBe("first\nlast [REDACTED]");
  }));

  it.effect("only the last maxLines lines are kept, in order, and a line split across chunks counts once (breaks if the tail keeps every line, keeps the first lines, or counts each chunk as a line)", () => Effect.gen(function* () {
    const tail = yield* tailFor(3);
    yield* tail.push("line 1\nline 2\nlin");
    yield* tail.push("e 3\nline 4\nline 5\nline");
    yield* tail.push(" 6\n");
    expect(yield* tail.finish()).toBe("line 4\nline 5\nline 6");
  }));

  it.effect("an unterminated last line is kept, and no output gives an empty tail (breaks if finish() loses the last partial line, or invents text for silence)", () => Effect.gen(function* () {
    const silent = yield* tailFor(3);
    expect(yield* silent.finish()).toBe("");
    const partial = yield* tailFor(3);
    yield* partial.push("only a fragment");
    expect(yield* partial.finish()).toBe("only a fragment");
  }));

  it.effect("two tails on one redactor do not share a carry: each secret split is completed in its own tail (breaks if every tail uses the same item id, so one tail's half joins the other's text)", () => Effect.gen(function* () {
    const redactor = tailRedactor();
    const first = yield* tailFor(3, redactor);
    const second = yield* tailFor(3, redactor);
    yield* first.push(`one ${secret.slice(0, 12)}`);
    yield* second.push(`two ${otherSecret.slice(0, 12)}`);
    yield* first.push(`${secret.slice(12)} done\n`);
    yield* second.push(`${otherSecret.slice(12)} done\n`);
    expect(yield* first.finish()).toBe("one [REDACTED] done");
    expect(yield* second.finish()).toBe("two [REDACTED] done");
  }));

  it.effect("the number of lines kept is the exported limit, so the stored text stays small (breaks if the limit is zero, negative or unbounded)", () => Effect.gen(function* () {
    expect(Number.isInteger(stderrTailLines)).toBe(true);
    expect(stderrTailLines).toBeGreaterThanOrEqual(5);
    expect(stderrTailLines).toBeLessThanOrEqual(100);
  }));
});

// ---------------------------------------------------------------------------
// What the engine does with an exit, through the command handler.
// ---------------------------------------------------------------------------

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

// The redactor holds the planted secrets and, once the test names them, the
// hashes of the agents' raw tokens, as the service's registry does.
const tokenHashes = new Set<string>();
const run = <A, E, R>(body: (runner: FakeRunner) => Effect.Effect<A, E, R>) => {
  tokenHashes.clear();
  const redactor = makeRedactor({
    secrets: () => [Redacted.make(secret), Redacted.make(otherSecret)],
    tokenHashes: () => tokenHashes,
  });
  return deliveryRig(rig, (runner) => Effect.gen(function* () { yield* registerRebuildCheck(); return yield* body(runner); }), redactor.layer).pipe(Effect.orDie);
};
const known = (...agents: ReadonlyArray<Spawned>) => { for (const agent of agents) tokenHashes.add(incarnationOf(agent.token)); };

interface Exit { readonly exitCode?: number | null; readonly signal?: string | null; readonly stderr?: string }

// The runner reports an exit, and the test waits for the crashed state. The
// crash batch is the one append that holds the crash event.
const crashWith = (runner: FakeRunner, target: Spawned, exit: Exit = {}) => Effect.gen(function* () {
  const before = yield* headSequence;
  yield* runner.emit({
    _tag: "exited", agentId: target.agentId, incarnation: incarnationOf(target.token),
    exitCode: exit.exitCode === undefined ? 1 : exit.exitCode, signal: exit.signal ?? null, stderr: exit.stderr ?? "",
  });
  yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "crashed");
  const rows = yield* logAfter(before);
  const batch = appendWith(rows, (row) => row.event._tag === "AgentCrashed" && row.event.agentId === target.agentId);
  return { rows, batch, before };
});

const noticesTo = (batch: Parameters<typeof tagged>[0], target: Spawned) =>
  tagged(batch, "DeliveryQueued").filter((event) => event.delivery.target === target.agentId);
const textOf = (event: { readonly delivery: { readonly content: { readonly _tag: string; readonly text?: string } } }) => event.delivery.content.text ?? "";

const liveTokens = (agentId: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM agent_tokens WHERE agent_id = ${agentId} AND revoked_at IS NULL`;
  return rows[0]?.n ?? -1;
});
const allTokens = (agentId: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM agent_tokens WHERE agent_id = ${agentId}`;
  return rows[0]?.n ?? -1;
});

describe("6.6 the exit is recorded", () => {
  for (const exit of [
    { name: "an exit code", exit: { exitCode: 3, signal: null, stderr: "error: could not open the project\nsecond line" } },
    { name: "a signal, with no exit code", exit: { exitCode: null, signal: "SIGSEGV", stderr: "segmentation fault" } },
  ] as const) {
    it.live(`C01 ${exit.name} and the stderr tail the runner reports are written to the crash event, and the agent is crashed (breaks if the handler writes an empty stderr, drops the code or the signal, or swaps them)`, () => run((runner) => Effect.gen(function* () {
      const agent = yield* spawn(rig, runner);
      const { batch } = yield* crashWith(runner, agent, exit.exit);
      expect(tagged(batch, "AgentCrashed")).toEqual([{
        _tag: "AgentCrashed", agentId: agent.agentId, exitCode: exit.exit.exitCode, signal: exit.exit.signal, stderr: exit.exit.stderr,
      }]);
      expect((yield* agentRow(agent.agentId))?.state._tag).toBe("crashed");
    })));
  }

  it.live("C02 secrets in the reported stderr (a registered secret, the agent's own token and another agent's token) never reach the crash event, the views, the log, or a notice; the text around them stays (breaks if the handler bypasses the redactor for stderr, or copies stderr into a notice or a view field)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, lead);
    const other = yield* spawn(rig, runner, lead);
    known(lead, agent, other);
    const stderr = `auth failed for ${secret}\ntoken ${agent.token} was refused\nthe sibling used ${other.token}\n${stderrWord} second ${otherSecret}`;
    const { batch } = yield* crashWith(runner, agent, { exitCode: 2, stderr });
    const stored = tagged(batch, "AgentCrashed")[0]?.stderr ?? "";
    expect(stored).toBe(`auth failed for [REDACTED]\ntoken [REDACTED] was refused\nthe sibling used [REDACTED]\n${stderrWord} second [REDACTED]`);
    const everywhere = JSON.stringify([yield* readLog, yield* snapshot]);
    for (const value of [secret, otherSecret, agent.token, other.token, lead.token]) expect(everywhere).not.toContain(value);
    // Notices are fixed text: not one word of the child's stderr is in them.
    for (const event of tagged(batch, "DeliveryQueued")) expect(textOf(event)).not.toContain(stderrWord);
  })));
});

describe("6.6 the dead agent's open requests are cancelled (issue 74, row 52)", () => {
  it.live("C03 every open permission request of the crashed agent is cancelled in the crash append, with a fixed reason; another agent's request stays open (breaks if the crash leaves requests open, cancels in a later append, or cancels a sibling's request)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, lead);
    const sibling = yield* spawn(rig, runner, lead);
    for (const worker of [agent, sibling]) { const id = yield* send(runner, worker, "Work."); yield* accept(runner, worker, id); }
    const first = yield* requestPermission(runner, agent);
    const second = yield* requestPermission(runner, agent);
    const siblings = yield* requestPermission(runner, sibling);
    const { batch } = yield* crashWith(runner, agent, { exitCode: 1, stderr: "gone" });
    const cancelled = tagged(batch, "PermissionCancelled");
    expect(cancelled.map((event) => event.permissionRequestId).sort()).toEqual([first.id, second.id].sort());
    expect(cancelled.every((event) => event.agentId === agent.agentId && event.reason === "agent crashed")).toBe(true);
    expect((yield* requestRow(first.id))?.status).toBe("cancelled");
    expect((yield* requestRow(second.id))?.status).toBe("cancelled");
    expect((yield* requestRow(siblings.id))?.status).toBe("open");
    expect(tagged(batch, "PermissionCancelled").some((event) => event.permissionRequestId === siblings.id)).toBe(false);
  })));

  it.live("C04 a question the crashed agent asked is not answered or invented a reply for: no answer event is written and the question row is unchanged (breaks if the crash closes questions with an invented answer; issue 74 says closure needs an agreed contract)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, lead);
    const id = yield* send(runner, agent, "Work.");
    yield* accept(runner, agent, id);
    const questionId: string = success(yield* call(agentCredential(agent.token), "ask", { text: "Which branch?" })).questionId;
    const before = yield* questionRow(questionId);
    const { batch } = yield* crashWith(runner, agent, { exitCode: 1 });
    expect(tagged(batch, "QuestionAnswered")).toEqual([]);
    expect(yield* questionRow(questionId)).toEqual(before);
  })));
});

describe("6.6 the token is revoked and nothing restarts the agent (rows 32 and 68)", () => {
  it.live("C05 after a crash the agent's token is revoked in the same append, a call with it is refused, and no new token is minted (breaks if the crash leaves a live token, revokes late, or mints a fresh one)", () => run((runner) => Effect.gen(function* () {
    const agent = yield* spawn(rig, runner);
    const tokens = yield* allTokens(agent.agentId);
    expect(yield* liveTokens(agent.agentId)).toBe(1);
    yield* crashWith(runner, agent);
    expect(yield* liveTokens(agent.agentId)).toBe(0);
    expect(yield* allTokens(agent.agentId)).toBe(tokens);
    const refused = failureOf(yield* call(agentCredential(agent.token), "ask", { text: "Anyone there?" }));
    expect(refused?.reason).toBe("invalid credential");
  })));

  it.live("C06 a crashed agent is not started, loaded, prompted or resumed again: the runner gets no new call for it and its state stays crashed (breaks if the engine restarts a crashed adapter, re-sends a delivery, or treats the exit as a pause)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, lead);
    const callsFor = (method: "start" | "load" | "prompt" | "compact" | "setMode") =>
      runner.callsOf(method).filter((entry) => (entry.input as { agentId: string }).agentId === agent.agentId).length;
    const methods = ["start", "load", "prompt", "compact", "setMode"] as const;
    const beforeCalls = methods.map(callsFor);
    const beforeEvents = yield* readLog;
    const { batch } = yield* crashWith(runner, agent);
    yield* pause(150);
    expect(methods.map(callsFor)).toEqual(beforeCalls);
    expect((yield* agentRow(agent.agentId))?.state._tag).toBe("crashed");
    const after = (yield* readLog).slice(beforeEvents.length).filter((row) => !batch.includes(row));
    expect(after.filter((row) => ["AgentStarted", "SessionOpened", "StateChanged", "AgentInterrupted"].includes(row.event._tag)
      && (row.event as { agentId?: string }).agentId === agent.agentId)).toEqual([]);
  })));
});

describe("6.6 who is told: one notice for the parent, whether or not it waits (issue 89, rows 25, 27, 50 and 67)", () => {
  // Reading of issue 89 and row 67, "merged with the parent notice when the
  // waiter is also the parent": the agent that can act for the dead one
  // (the nearest ancestor that is idle or working, row 27) gets exactly one
  // delivery in the crash append. When it has an open non-blocking wait on
  // the dead agent, that wait's notice is the one; when it has none, the
  // parent notice is the one. Never both.
  it.live("C07 the parent with no wait gets exactly one notice in the crash append, naming the dead agent and the word crashed, from the owner, with no stderr text; the owner is not asked (breaks if the parent is not told, told twice, told with stderr text, or the owner is needed although an agent can act)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, lead);
    const before = promptsTo(runner, lead).length;
    const { batch, rows } = yield* crashWith(runner, agent, { exitCode: 4, stderr: stderrWord });
    const notices = noticesTo(batch, lead);
    expect(notices).toHaveLength(1);
    expect(noticesTo(rows, lead)).toHaveLength(1);
    const notice = notices[0]!;
    expect(notice.delivery.sender).toEqual({ _tag: "owner" });
    expect(notice.delivery.source).toBeUndefined();
    expect(textOf(notice)).toContain(agent.agentId);
    expect(textOf(notice)).toContain("crashed");
    expect(textOf(notice)).not.toContain(stderrWord);
    expect(tagged(batch, "OwnerNeeded")).toEqual([]);
    // The idle parent is sent it.
    const sent = yield* eventually(Effect.sync(() => promptsTo(runner, lead)), (calls) => calls.length > before);
    expect(sent.slice(before).map((entry) => entry.input.delivery.id)).toContain(notice.delivery.id);
  })));

  it.live("C08 a parent whose non-blocking wait on the dead agent stays open gets exactly one delivery in the crash append, and it is the wait's notice (breaks if a separate parent notice is written next to the wait's notice: two notices for one crash)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, lead);
    const other = yield* spawn(rig, runner, lead);
    // Members must be working, or the wait is satisfied the moment it opens.
    for (const member of [agent, other]) yield* send(runner, member, "Work.");
    const waitId: string = success(yield* waitFor(lead, [agent, other], "all")).waitId;
    const { batch, rows } = yield* crashWith(runner, agent, { exitCode: 4, stderr: stderrWord });
    expect((yield* snapshot).waits[waitId]?.status).toBe("open");
    const notices = noticesTo(batch, lead);
    expect(notices).toHaveLength(1);
    expect(noticesTo(rows, lead)).toHaveLength(1);
    expect(notices[0]?.delivery.source).toEqual({ _tag: "wait", id: waitId });
    expect(textOf(notices[0]!)).toContain(agent.agentId);
    expect(textOf(notices[0]!)).toContain("crashed");
    expect(textOf(notices[0]!)).not.toContain(stderrWord);
    expect(tagged(batch, "OwnerNeeded")).toEqual([]);
  })));

  it.live("C09 a parent whose wait on the dead agent is satisfied by the crash gets exactly one delivery in the crash append, the wait's final wake, listing the crash (breaks if the parent gets the wake and a separate crash notice, or no notice at all)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, lead);
    yield* send(runner, agent, "Work.");
    const waitId: string = success(yield* waitFor(lead, [agent], "all")).waitId;
    const { batch, rows } = yield* crashWith(runner, agent, { exitCode: 4 });
    expect((yield* snapshot).waits[waitId]?.status).toBe("satisfied");
    const notices = noticesTo(batch, lead);
    expect(notices).toHaveLength(1);
    expect(noticesTo(rows, lead)).toHaveLength(1);
    expect(notices[0]?.delivery.source).toEqual({ _tag: "wait", id: waitId });
    expect(textOf(notices[0]!)).toContain(agent.agentId);
    expect(textOf(notices[0]!)).toContain("crashed");
  })));

  it.live("C10 when the parent cannot act, the nearest ancestor that can is told once and the stopped parent gets nothing (breaks if the notice goes to the parent by name, or to every ancestor)", () => run((runner) => Effect.gen(function* () {
    const grand = yield* spawn(rig, runner);
    const parent = yield* spawn(rig, runner, grand);
    const agent = yield* spawn(rig, runner, parent);
    success(yield* call(ownerCredential, "stop", { agentId: parent.agentId }));
    const { batch, rows } = yield* crashWith(runner, agent, { exitCode: 4 });
    expect(noticesTo(batch, grand)).toHaveLength(1);
    expect(noticesTo(rows, grand)).toHaveLength(1);
    expect(textOf(noticesTo(batch, grand)[0]!)).toContain(agent.agentId);
    expect(noticesTo(rows, parent)).toEqual([]);
    expect(tagged(batch, "OwnerNeeded")).toEqual([]);
  })));

  it.live("C11 an agent the owner started has nobody above it: the crash append holds one 'owner needed' for it, with the fixed reason 'agent crashed', and no delivery to any agent (breaks if the owner is never told, told with stderr text or a changing reason, or an agent is woken for it)", () => run((runner) => Effect.gen(function* () {
    const agent = yield* spawn(rig, runner);
    const { batch } = yield* crashWith(runner, agent, { exitCode: 4, stderr: stderrWord });
    expect(tagged(batch, "OwnerNeeded")).toEqual([{ _tag: "OwnerNeeded", agentId: agent.agentId, reason: "agent crashed" }]);
    expect(tagged(batch, "DeliveryQueued")).toEqual([]);
  })));

  it.live("C12 the same when the only parent is stopped: the owner is needed and the stopped parent is not woken (breaks if the notice goes to a parent that cannot act)", () => run((runner) => Effect.gen(function* () {
    const parent = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, parent);
    success(yield* call(ownerCredential, "stop", { agentId: parent.agentId }));
    const { batch } = yield* crashWith(runner, agent);
    expect(tagged(batch, "OwnerNeeded")).toEqual([{ _tag: "OwnerNeeded", agentId: agent.agentId, reason: "agent crashed" }]);
    expect(noticesTo(batch, parent)).toEqual([]);
  })));

  it.live("C13 the notice text is fixed: two crashes with different stderr give notices that differ only by agent id and delivery id (breaks if any part of the stderr, the exit code or the signal is copied into the notice)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const first = yield* spawn(rig, runner, lead);
    const second = yield* spawn(rig, runner, lead);
    const a = yield* crashWith(runner, first, { exitCode: 3, stderr: "alpha problem" });
    const b = yield* crashWith(runner, second, { exitCode: null, signal: "SIGKILL", stderr: "beta problem" });
    const normal = (event: Parameters<typeof textOf>[0] & { readonly delivery: { readonly id: string } }, agentId: string) =>
      textOf(event).replaceAll(event.delivery.id, "<delivery>").replaceAll(agentId, "<agent>");
    const one = noticesTo(a.batch, lead)[0]!;
    const two = noticesTo(b.batch, lead)[0]!;
    expect(normal(one, first.agentId)).toBe(normal(two, second.agentId));
    expect(textOf(one) + textOf(two)).not.toMatch(/alpha|beta|SIGKILL/);
  })));
});

describe("6.6 a crash of one agent changes nothing for another", () => {
  it.live("C14 a sibling's state, requests, questions, deliveries, token and runner calls are the same after the crash, and its own wait is untouched (breaks if the crash handling reaches every agent, revokes every token, or cancels every request)", () => run((runner) => Effect.gen(function* () {
    const lead = yield* spawn(rig, runner);
    const agent = yield* spawn(rig, runner, lead);
    const sibling = yield* spawn(rig, runner, lead);
    const id = yield* send(runner, sibling, "Work.");
    yield* accept(runner, sibling, id);
    const request = yield* requestPermission(runner, sibling);
    const questionId: string = success(yield* call(agentCredential(sibling.token), "ask", { text: "Which branch?" })).questionId;
    const waitId: string = success(yield* waitFor(lead, [sibling], "all")).waitId;
    yield* pause(60);
    const view = yield* snapshot;
    const mine = (state: typeof view) => ({
      agent: state.agents[sibling.agentId],
      request: state.requests[request.id],
      question: state.questions[questionId],
      delivery: state.deliveries[id],
      wait: state.waits[waitId],
      deliveries: Object.values(state.deliveries).filter((row) => row.target === sibling.agentId),
    });
    const callsBefore = runner.calls.filter((entry) => (entry.input as { agentId?: string }).agentId === sibling.agentId).length;
    const tokensBefore = yield* liveTokens(sibling.agentId);
    yield* crashWith(runner, agent, { exitCode: 1, stderr: "gone" });
    yield* pause(100);
    expect(mine(yield* snapshot)).toEqual(mine(view));
    expect(yield* liveTokens(sibling.agentId)).toBe(tokensBefore);
    expect(runner.calls.filter((entry) => (entry.input as { agentId?: string }).agentId === sibling.agentId).length).toBe(callsBefore);
    expect((yield* deliveryRow(id))?.status).toBe("accepted");
  })));
});

// ---------------------------------------------------------------------------
// What a real child leaves behind: the real runner over the fake agent.
// ---------------------------------------------------------------------------

describe("6.6 a real crash, through the real runner, the log and the views", () => {
  let runnerRig: RunnerRig;
  beforeEach(() => { runnerRig = makeRunnerRig(); });
  afterEach(() => { removeRunnerRig(runnerRig); });
  const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
    it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 30_000);

  // Starts one agent whose script is `steps`, waits for the engine's crash
  // event and returns the runner's exit event with the logged crash.
  const crashedWith = (steps: ReadonlyArray<Record<string, unknown>>, secrets: Record<string, string> = {}) => {
    const harness = harnessFor("first", writeFakeAdapter(runnerRig));
    const account = accountFor("first", { turns: [steps] }, echoFile(runnerRig), { PLANTED_API_KEY: "secret:crash" });
    return withEngine(runnerRig, { harness, accounts: [account], secrets: { "secret:crash": secret, ...secrets } }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, runnerRig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (current) => tagged(current, "AgentCrashed").length === 1);
      const exited = context.events.find((event) => event._tag === "exited" && event.agentId === reply.agentId);
      return {
        agentId: reply.agentId as string, exited, crash: tagged(rows, "AgentCrashed")[0]!, rows,
        // The account's script is logged as configuration and holds the two
        // halves of the secret as text the test chose, so the scan leaves out
        // the account and harness rows and the account view. The whole secret
        // is checked everywhere in `whole`.
        everywhere: JSON.stringify([
          rows.filter((row) => row.event._tag !== "AccountChanged" && row.event._tag !== "HarnessChanged"),
          { ...(yield* snapshot), accounts: undefined },
          context.logLines,
        ]),
        whole: JSON.stringify([rows, yield* snapshot, context.logLines]),
        logLines: context.logLines,
      };
    }));
  };

  live("C15 the exit code and the last stderr lines the child wrote reach the runner's exit event and the logged crash (breaks if the runner drains stderr and discards it, emits an empty tail, or the exit code is lost)", () =>
    Effect.gen(function* () {
      const result = yield* crashedWith([
        { step: "stderr", text: "fatal: lost the project" }, { step: "stderr", text: `${stderrWord} second line` }, { step: "crash", exitCode: 3 },
      ]);
      expect(result.exited).toMatchObject({ exitCode: 3, stderr: `fatal: lost the project\n${stderrWord} second line` });
      expect(result.crash).toMatchObject({ exitCode: 3, signal: null, stderr: `fatal: lost the project\n${stderrWord} second line` });
    }));

  live("C16 only the last stderrTailLines lines are stored, oldest dropped (breaks if the tail grows without a bound, or keeps the first lines instead of the last)", () =>
    Effect.gen(function* () {
      const total = stderrTailLines + 12;
      const steps = [...Array.from({ length: total }, (_, index) => ({ step: "stderr", text: `diagnostic line ${index + 1}` })), { step: "crash", exitCode: 2 }];
      const result = yield* crashedWith(steps);
      const lines = result.crash.stderr.split("\n");
      expect(lines).toHaveLength(stderrTailLines);
      expect(lines[0]).toBe(`diagnostic line ${total - stderrTailLines + 1}`);
      expect(lines.at(-1)).toBe(`diagnostic line ${total}`);
    }));

  live("C17 issue 102: a secret the child wrote in two stderr chunks, a pause apart, is in neither the exit event, the crash event, the views, the log nor a log line, in whole or in half (breaks if the runner redacts each chunk alone, or skips the carry for stderr)", () =>
    Effect.gen(function* () {
      const cut = 19;
      const result = yield* crashedWith([
        { step: "stderr_part", text: `fatal: rejected key ${secret.slice(0, cut)}` },
        { step: "slow", ms: 150 },
        { step: "stderr_part", text: `${secret.slice(cut)} for this account\nlast words\n` },
        { step: "crash", exitCode: 1 },
      ]);
      expect(result.exited).toBeDefined();
      expect(result.whole).not.toContain(secret);
      for (const text of [JSON.stringify(result.exited), result.crash.stderr, result.everywhere]) {
        expect(text).not.toContain(secret);
        expect(text).not.toContain(secret.slice(0, cut));
        expect(text).not.toContain(secret.slice(cut));
      }
      expect(result.crash.stderr).toBe("fatal: rejected key [REDACTED] for this account\nlast words");
    }));

  live("C18 a secret that ends the output with no line end is redacted and the last fragment is kept (breaks if the exit is reported before the carry is flushed, or the unterminated text is dropped)", () =>
    Effect.gen(function* () {
      const cut = 11;
      const result = yield* crashedWith([
        { step: "stderr_part", text: `first line\nlast ${secret.slice(0, cut)}` },
        { step: "slow", ms: 100 },
        { step: "stderr_part", text: secret.slice(cut) },
        { step: "crash", exitCode: 1 },
      ]);
      expect(result.crash.stderr).toBe("first line\nlast [REDACTED]");
      expect(result.whole).not.toContain(secret);
    }));

  live("C19 a child that is killed by a signal is recorded with the signal and no exit code (breaks if a signal death is recorded as exit code 0 or null with no signal)", () =>
    Effect.gen(function* () {
      const result = yield* crashedWith([{ step: "stderr", text: "about to die" }, { step: "kill_self", signal: "SIGKILL" }]);
      expect(result.crash).toMatchObject({ exitCode: null, signal: "SIGKILL", stderr: "about to die" });
    }));
});
