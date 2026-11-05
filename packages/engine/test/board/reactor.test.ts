import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { TestClock } from "effect/testing";
import { boardAlertSources } from "@shephrd/contracts/board/alerts";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, vi } from "vitest";

import { engineLists } from "../../src/pieces/lists.ts";
import { writePieceBatch } from "../../src/commands/pieceBatch.ts";
import { EventLog, LogWriteFailed } from "../../src/log/EventLog.ts";
import { decodeRow, type EventRow } from "../../src/log/subscribe.ts";
import { Restart } from "../../src/recovery/service.ts";
import { dispatchQueued, promptReply } from "../../src/routing/deliveries.ts";
import { agentIdOf, appendSetup, call, eventOf, failureOf, headSequence, logAfter, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { channel, close, post, read, resolve } from "./fixtures.ts";
import { agent, appendDelivery, boardState, change, deliveryText, eventsOf, owner, postAs, queued, serviceCall, snapshot, wakeFor } from "./wakeFixtures.ts";
import { currentIncarnation } from "../support/fakeRunner.ts";
import { acceptWake, catchUp, disposition, end, eventually, failWake, it, lifecycle, pause, pendingWake, reactorRig, registeredReactor, resumeHistory, startReactor, stopReactor } from "./reactorFixtures.ts";

const { run, reopen, service } = reactorRig(() => registerRebuildCheck());

// The literal outcome rows are independent of the production outcome helper.
const outcomes = [
  { left: "reply", right: "reply", outcome: "answered" },
  { left: "reply", right: "crash", outcome: "answered" },
  { left: "reply", right: "stop", outcome: "answered" },
  { left: "crash", right: "crash", outcome: "unanswerable" },
  { left: "crash", right: "stop", outcome: "unanswerable" },
  { left: "stop", right: "stop", outcome: "unanswerable" },
] as const;
for (const mode of ["any", "all"] as const) for (const row of outcomes) for (const reversed of [false, true]) {
  it.live(`4.1 outcome orders: ${mode} ${row.left}/${row.right}, reversed=${reversed}`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!, { reply: mode, to: [agent("worker"), agent("other")] });
    const actions = [["worker", row.left], ["other", row.right]] as const;
    for (const [target, action] of reversed ? [...actions].reverse() : actions) {
      if (action === "reply") yield* postAs(c[target]!, { replyTo: id, reply: "none", to: [], text: `${target} result.` });
      else yield* lifecycle(target, action);
      yield* catchUp;
    }
    const state = yield* boardState;
    expect(state.posts[id]).toMatchObject({ status: "closed", outcome: row.outcome });
    expect(eventsOf(yield* readLog, "board.PostClosed").filter((event) => event.postId === id)).toHaveLength(1);
    const completion = yield* pendingWake("lead");
    expect(deliveryText(completion)).toContain(id);
    expect(deliveryText(completion)).toContain(row.outcome);
  })));
}

for (const kind of ["stop", "crash", "reload-failed"] as const) {
  it.live(`4.1 undone before the reactor: ${kind} then resume still resolves gone, but a new post survives`, () => run((c) => Effect.gen(function* () {
    const old = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
    yield* lifecycle("worker", kind);
    yield* resumeHistory("worker");
    const fresh = yield* postAs(c.lead!);
    yield* catchUp;
    expect((yield* boardState).posts[old]?.dispositions.worker).toBe("gone");
    expect((yield* boardState).posts[fresh]?.dispositions.worker).toBeUndefined();
    yield* postAs(c.worker!, { replyTo: old, reply: "none", to: [] });
    expect((yield* boardState).posts[old]?.dispositions.worker).toBe("replied");
  })));
}

for (const reloadable of [false, true]) {
  it.live(`4.1 startup catch-up: interrupted reloadable=${reloadable} ${reloadable ? "keeps the question" : "is gone without a reload attempt"}`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
    yield* change({ _tag: "SessionOpened", agentId: "worker", session: { _tag: "acp", sessionId: "interrupt-session" }, protocolVersion: 2, reloadable });
    yield* change({ _tag: "AgentInterrupted", agentId: "worker", previous: "idle" });
    yield* catchUp;
    expect((yield* boardState).posts[id]?.dispositions.worker).toBe(reloadable ? undefined : "gone");
    expect(eventsOf(yield* readLog, "AgentReloadFailed")).toEqual([]);
  })));
}

it.live("4.1 a resumed interrupt counts for nothing", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  yield* change({ _tag: "AgentInterrupted", agentId: "worker", previous: "idle" });
  yield* resumeHistory("worker");
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions.worker).toBeUndefined();
})));

for (const replyFirst of [false, true]) {
  it.live(`4.1 stopped author resumed: withdrawal owes no completion, replyFirst=${replyFirst}`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    yield* lifecycle("lead", "stop");
    yield* resumeHistory("lead");
    if (replyFirst) yield* postAs(c.worker!, { replyTo: id, reply: "none", to: [] });
    yield* catchUp;
    const state = yield* boardState;
    expect(state.posts[id]?.status).toBe("closed");
    if (!replyFirst) expect(state.posts[id]?.outcome).toBe("withdrawn");
    expect(state.completions[id]).toBeUndefined();
    expect(yield* queued("lead")).toEqual([]);
  })));
}

it.live("4.1 group lifecycle: a labelled crash is gone, never removed, and a late reply upgrades it", () => run((c) => Effect.gen(function* () {
  yield* appendSetup([channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead", members: [agent("lead")] })]);
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: ["review"] }, { _tag: "AgentGrouped", agentId: "other", groups: ["review"] });
  const id = yield* postAs(c.lead!, { channelId: "group", to: [agent("worker"), agent("other")] });
  yield* lifecycle("worker", "crash");
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("gone");
  yield* resumeHistory("worker");
  yield* postAs(c.worker!, { channelId: "group", replyTo: id, reply: "none", to: [] });
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("replied");
})));

for (const author of ["lead", "worker"]) {
  it.live(`4.1 group author ${author} crashes: the question and manager seat remain, completion waits for resume`, () => run((c) => Effect.gen(function* () {
    yield* appendSetup([channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead", members: [agent("lead")] })]);
    yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: ["review"] }, { _tag: "AgentGrouped", agentId: "other", groups: ["review"] });
    const id = yield* postAs(c[author]!, { channelId: "group", to: [agent("other")] });
    yield* lifecycle(author, "crash");
    yield* catchUp;
    expect((yield* boardState).posts[id]?.status).toBe("open");
    expect((yield* boardState).channels.group?.manager).toEqual(agent("lead"));
    yield* postAs(c.other!, { channelId: "group", replyTo: id, reply: "none", to: [] });
    expect(yield* queued(author)).toEqual([]);
    yield* resumeHistory(author);
    yield* catchUp;
    expect((yield* wakeFor((yield* pendingWake(author)).id)).completions).toEqual([id]);
  })));
}

for (const kind of ["plain", "group"]) for (const ancestor of ["idle", "paused", "stopped", "crashed", "interrupted"] as const) {
  it.live(`4.5 manager succession: ${kind}, nearest ancestor ${ancestor}`, () => run((c) => Effect.gen(function* () {
    yield* appendSetup([channel({ channelId: "managed", kind, manager: agent("worker"), ...(kind === "group" ? { group: "review", anchorAgentId: "lead" } : { members: [owner, agent("lead"), agent("worker")] }) })]);
    yield* lifecycle("worker", "stop");
    yield* resumeHistory("worker");
    yield* catchUp;
    expect((yield* boardState).channels.managed?.manager).toEqual(ancestor === "idle" || ancestor === "paused" ? agent("lead") : owner);
    const before = yield* headSequence;
    yield* catchUp;
    expect(eventsOf(yield* logAfter(before), "board.ManagerChanged")).toEqual([]);
  }), { lead: ancestor }));
}

it.live("4.5 a stop older than a new manager seat does not evict its new holder", () => run(() => Effect.gen(function* () {
  yield* lifecycle("worker", "stop");
  yield* resumeHistory("worker");
  yield* change({ _tag: "board.ManagerChanged", channelId: "room", manager: agent("worker") });
  yield* catchUp;
  expect((yield* boardState).channels.room?.manager).toEqual(agent("worker"));
})));

for (const order of ["close-while-crashed", "queued-then-crash", "merged-question-withdrawn"] as const) {
  it.live(`4.2 owed completion: ${order} reaches its author once`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    if (order === "close-while-crashed") yield* lifecycle("lead", "crash");
    yield* postAs(c.worker!, { replyTo: id, reply: "none", to: [], text: "Worker result." });
    if (order === "queued-then-crash") yield* lifecycle("lead", "crash");
    if (order === "merged-question-withdrawn") {
      const question = yield* postAs(c.other!, { to: [agent("lead")] });
      success(yield* call(c.other!, "board.close", { postId: question }));
    } else {
      yield* catchUp;
      expect(yield* queued("lead")).toEqual([]);
      expect((yield* boardState).completions[id]).toBeDefined();
      yield* resumeHistory("lead");
    }
    yield* catchUp;
    const delivery = yield* pendingWake("lead");
    expect((yield* wakeFor(delivery.id)).completions).toContain(id);
    expect(deliveryText(delivery)).toContain("Worker result.");
    yield* acceptWake(delivery.id, "lead");
    yield* end("lead");
    yield* catchUp;
    expect((yield* boardState).completions[id]).toBeUndefined();
    expect(yield* queued("lead")).toEqual([]);
  })));
}

for (const duty of ["question", "completion"] as const) {
  it.live(`4.3 returned wake: ${duty} retries once, stops after two failures${duty === "completion" ? ", and flush retries the completion" : ""}`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    const target = duty === "question" ? "worker" : "lead";
    if (duty === "completion") yield* postAs(c.worker!, { replyTo: id, reply: "none", to: [] });
    const first = yield* pendingWake(target);
    yield* appendDelivery("DeliverySent", first.id, target);
    yield* failWake(first.id, target);
    const returned = eventsOf(yield* readLog, "DeliveryReturned").find((event) => event.deliveryId === first.id);
    expect(returned?.sender).toEqual({ _tag: "piece", namespace: "board" });
    yield* catchUp;
    const retry = yield* pendingWake(target);
    expect(retry.id).not.toBe(first.id);
    const wake = yield* wakeFor(retry.id);
    expect(duty === "question" ? wake.mustReply : wake.completions).toEqual([id]);
    yield* appendDelivery("DeliverySent", retry.id, target);
    yield* failWake(retry.id, target);
    yield* catchUp;
    expect(yield* queued(target)).toEqual([]);
    expect((yield* snapshot).agents[target]?.state._tag).toBe("idle");
    if (duty === "question") expect((yield* boardState).posts[id]?.dispositions.worker).toBe("undeliverable");
    else expect((yield* boardState).completions[id]?.returns).toBe(2);
    if (duty === "completion") {
      success(yield* call(ownerCredential, "board.flush", { agentId: target }));
      expect((yield* wakeFor((yield* pendingWake(target)).id)).completions).toContain(id);
    }
  })));
}

it.live("4.3 an accepted completion returned by an error is never retried or counted", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  yield* postAs(c.worker!, { replyTo: id, reply: "none", to: [] });
  const delivery = yield* pendingWake("lead");
  yield* acceptWake(delivery.id, "lead");
  yield* failWake(delivery.id, "lead");
  yield* catchUp;
  expect((yield* boardState).completions[id]).toBeUndefined();
  expect(yield* queued("lead")).toEqual([]);
})));

for (const trigger of ["return", "send-withdrawal", "manager-stop"] as const) {
  it.live(`4.5 restart at every step: ${trigger} is caught once from the persisted log`, () => Effect.gen(function* () {
    const id = yield* run((c) => Effect.gen(function* () {
      const id = yield* postAs(c.lead!);
      if (trigger === "manager-stop") { yield* lifecycle("lead", "stop"); yield* resumeHistory("lead"); }
      else {
        const delivery = yield* pendingWake();
        if (trigger === "return") { yield* appendDelivery("DeliverySent", delivery.id, "worker"); yield* failWake(delivery.id); }
        else yield* change({ _tag: "DeliveryWithdrawn", agentId: "worker", deliveryId: delivery.id, reason: "reach lost at send" });
      }
      return id;
    }));
    yield* reopen(Effect.gen(function* () {
      yield* catchUp;
      if (trigger === "manager-stop") {
        expect((yield* boardState).channels.room?.manager).toEqual(owner);
        expect((yield* boardState).posts[id]?.outcome).toBe("withdrawn");
      } else expect((yield* wakeFor((yield* pendingWake()).id)).mustReply).toEqual([id]);
      const before = yield* headSequence;
      yield* catchUp;
      expect(yield* logAfter(before)).toEqual([]);
    }));
  }));
}

it.live("4.5 racing reply: a committed answer supersedes an earlier crash duty", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
  yield* lifecycle("worker", "crash");
  yield* resumeHistory("worker");
  yield* postAs(c.worker!, { replyTo: id, reply: "none", to: [] });
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("replied");
  expect(eventsOf(yield* readLog, "board.AddresseeResolved").filter((row) => row.postId === id && row.disposition === "gone")).toEqual([]);
})));

it.live("4.10 write path: all reactor resolutions, closes and withdrawals use the board piece caller", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  yield* postAs(c.other!, { to: [agent("fourth")] });
  yield* lifecycle("worker", "stop");
  yield* lifecycle("other", "stop");
  const before = yield* headSequence;
  yield* catchUp;
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ caller: string; event_type: string }>`SELECT caller, event_type FROM events WHERE sequence > ${before}`;
  expect(rows.some((row) => row.event_type === "board.AddresseeResolved")).toBe(true);
  expect(rows.some((row) => row.event_type === "board.PostClosed")).toBe(true);
  expect(rows.some((row) => row.event_type === "DeliveryWithdrawn")).toBe(true);
  expect(rows.every((row) => row.caller === "piece:board")).toBe(true);
  expect((yield* boardState).posts[id]?.outcome).toBe("unanswerable");
})));

it.live("4.10 one refused target does not abort a whole scan, and CommandRefused cannot make a retry loop", () => run((c) => Effect.gen(function* () {
  const first = yield* postAs(c.lead!);
  const second = yield* postAs(c.lead!, { to: [agent("other")] });
  for (const target of ["worker", "other"]) {
    const delivery = yield* pendingWake(target);
    yield* change({ _tag: "DeliveryWithdrawn", agentId: target, deliveryId: delivery.id, reason: "send-time withdrawal" });
  }
  const realReach = engineLists.reach.board;
  vi.spyOn(engineLists.reach, "board").mockImplementation((input) => input.target !== "worker" && realReach(input));
  const before = yield* headSequence;
  const fiber = yield* startReactor;
  yield* pendingWake("other");
  yield* pause(100);
  const refusals = eventsOf(yield* logAfter(before), "CommandRefused").filter((row) => row.command === "board.reactor");
  expect(refusals).toHaveLength(1);
  expect(refusals[0]?.sourceSequence).toBe(before);
  expect(yield* queued("worker")).toEqual([]);
  const stable = yield* headSequence;
  yield* pause(150);
  expect(yield* headSequence).toBe(stable);
  vi.restoreAllMocks();
  yield* appendSetup([read([first], "lead")]);
  expect((yield* wakeFor((yield* pendingWake()).id)).mustReply).toContain(first);
  expect((yield* wakeFor((yield* pendingWake("other")).id)).mustReply).toContain(second);
  yield* stopReactor(fiber);
})));

it.live("4.10 write-path control: withdrawing an engine delivery refuses the whole reactor batch", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
  success(yield* call(ownerCredential, "prompt", { agentId: "fourth", text: "Engine-owned prompt." }));
  const delivery = Object.values((yield* snapshot).deliveries).find((row) => row.target === "fourth" && row.status === "queued");
  expect(delivery).toBeDefined();
  const before = yield* headSequence;
  yield* writePieceBatch({ namespace: "board", kind: "reactor", sourceSequence: before, build: () => ({ events: [
    resolve(id, "gone"), eventOf({ _tag: "DeliveryWithdrawn", agentId: "fourth", deliveryId: delivery!.id, reason: "invalid fixture withdrawal" }),
  ] }) });
  const rows = yield* logAfter(before);
  expect(rows.map((row) => row.event)).toEqual([expect.objectContaining({ _tag: "CommandRefused", command: "board.reactor", sourceSequence: before })]);
  expect((yield* boardState).posts[id]?.dispositions.worker).toBeUndefined();
  expect((yield* snapshot).deliveries[delivery!.id]?.status).toBe("queued");
})));

it.live("4.11 start and failure: recovery gates the first whole-state scan and successful reload prevents gone", () => Effect.gen(function* () {
  const id = yield* run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    yield* change({ _tag: "AgentInterrupted", agentId: "worker", previous: "idle" });
    return id;
  }));
  const ready = yield* Deferred.make<void>();
  const recovery = Layer.succeed(Restart, { ready: Deferred.isDone(ready), whenReady: Deferred.await(ready), recover: Effect.void, returnAccount: () => Effect.void });
  yield* service(Effect.gen(function* () {
    const before = yield* headSequence;
    yield* pause(100);
    expect(yield* headSequence).toBe(before);
    yield* resumeHistory("worker");
    yield* Deferred.succeed(ready, undefined);
    yield* pause(100);
    expect((yield* boardState).posts[id]?.dispositions.worker).toBeUndefined();
    expect(eventsOf(yield* readLog, "board.AddresseeResolved")).toEqual([]);
    expect(eventsOf(yield* readLog, "CommandRefused")).toEqual([]);
  }), { recovery });
}));

it.live("4.11 LogWriteFailed stops the reactor; reopening discovers the unwritten duty once", () => Effect.gen(function* () {
  const id = yield* run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    yield* lifecycle("worker", "stop");
    return id;
  }));
  let attempts = 0;
  const reactor = Effect.gen(function* () {
    const log = yield* EventLog;
    const broken = { ...log, transact: (() => { attempts++; return Effect.fail(new LogWriteFailed({ reason: "fixture write failure" })); }) as typeof log.transact };
    return yield* registeredReactor().pipe(Effect.provideService(EventLog, broken));
  });
  yield* service(Effect.gen(function* () {
    yield* eventually(Effect.sync(() => attempts), (n) => n > 0);
    expect(attempts).toBe(1);
    const before = yield* headSequence;
    yield* pause(1_150);
    expect(attempts).toBe(1);
    expect(yield* headSequence).toBe(before);
  }), { reactor });
  yield* reopen(Effect.gen(function* () {
    yield* catchUp;
    expect((yield* boardState).posts[id]?.outcome).toBe("unanswerable");
    expect(eventsOf(yield* readLog, "board.PostClosed").filter((row) => row.postId === id)).toHaveLength(1);
  }));
}));

it.live("4.11 a defect logs no event text and restarts a whole-state scan after a pause", () => Effect.gen(function* () {
  const id = yield* run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    yield* lifecycle("worker", "stop");
    return id;
  }));
  const logs: string[] = [];
  const logger = Logger.layer([Logger.make((entry) => { logs.push(Logger.formatJson.log(entry)); })]);
  let attempts = 0;
  let failedAt = 0;
  let retriedAt = 0;
  const reactor = Effect.gen(function* () {
    const log = yield* EventLog;
    const broken = { ...log, transact: ((use: Parameters<typeof log.transact>[0]) => Effect.suspend(() => {
      attempts++;
      if (attempts === 1) { failedAt = Date.now(); return Effect.die(new Error("PRIVATE REACTOR EVENT TEXT")); }
      if (retriedAt === 0) retriedAt = Date.now();
      return log.transact(use);
    })) as typeof log.transact };
    return yield* registeredReactor().pipe(Effect.provideService(EventLog, broken));
  });
  yield* service(Effect.gen(function* () {
    yield* disposition(id, "worker", "gone");
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(retriedAt).toBeGreaterThan(failedAt);
    expect(logs.some((line) => /error/i.test(line))).toBe(true);
    expect(logs.join("\n")).not.toContain("PRIVATE REACTOR EVENT TEXT");
    expect(logs.join("\n")).not.toContain("Please report your result.");
  }), { reactor, logger });
}));

for (const targetState of ["stopped", "crashed"] as const) {
  it.live(`4.12 state table: completion to ${targetState} queues nothing and creates no reactor refusal`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    yield* lifecycle("lead", targetState === "stopped" ? "stop" : "crash");
    yield* postAs(c.worker!, { replyTo: id, reply: "none", to: [] });
    const before = yield* headSequence;
    yield* catchUp;
    expect(yield* queued("lead")).toEqual([]);
    expect(eventsOf(yield* logAfter(before), "CommandRefused")).toEqual([]);
    const reply = yield* call(ownerCredential, "board.flush", { agentId: "lead" });
    expect(failureOf(reply)?.reason).toBe("agent is unavailable");
    expect(yield* queued("lead")).toEqual([]);
  })));
}

for (const acknowledged of [false, true]) for (const ending of ["turn", "error", "capacity"] as const) {
  it.live(`4.13 no answer: acknowledged=${acknowledged}, ending=${ending}, one reminder and one notice across restart`, () => Effect.gen(function* () {
    const id = yield* run((c) => Effect.gen(function* () {
      const id = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
      const first = yield* pendingWake();
      yield* acceptWake(first.id);
      if (acknowledged) success(yield* call(c.worker!, "board.acknowledge", { postId: id }));
      if (ending === "turn") yield* end(); else yield* failWake(first.id, "worker", ending === "capacity");
      yield* catchUp;
      const reminder = yield* pendingWake();
      const wake = yield* wakeFor(reminder.id);
      expect(wake.reminders).toEqual([id]);
      expect(wake.mustReply).toEqual([]);
      expect(deliveryText(reminder)).toContain(id);
      expect(deliveryText(reminder)).not.toContain("Please report your result.");
      // Acknowledgement after a reminder was queued does not withdraw it.
      success(yield* call(c.worker!, "board.acknowledge", { postId: id }));
      expect((yield* queued()).some((row) => row.id === reminder.id)).toBe(true);
      yield* acceptWake(reminder.id);
      if (ending === "turn") yield* end(); else yield* failWake(reminder.id, "worker", ending === "capacity");
      return id;
    }));
    yield* reopen(Effect.gen(function* () {
      yield* catchUp;
      expect((yield* boardState).posts[id]).toMatchObject({ status: "open", dispositions: { worker: "no-answer" } });
      const notice = yield* pendingWake("lead");
      expect((yield* wakeFor(notice.id)).noAnswers).toEqual([{ postId: id, addressee: agent("worker") }]);
      expect(deliveryText(notice)).toContain("no answer");
      yield* acceptWake(notice.id, "lead");
      yield* end("lead");
      const before = yield* headSequence;
      yield* catchUp;
      expect(yield* logAfter(before)).toEqual([]);
      expect(eventsOf(yield* readLog, "board.AddresseeResolved").filter((row) => row.postId === id && row.disposition === "no-answer")).toHaveLength(1);
      expect(eventsOf(yield* readLog, "board.WakeBuilt").filter((row) => row.targetAgentId === "worker" && row.reminders.includes(id as never))).toHaveLength(1);
    }));
  }));
}

for (const terminal of ["reply", "stop", "crash"] as const) {
  it.live(`4.13 no-answer is provisional: a later ${terminal} replaces it`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
    yield* appendSetup([resolve(id, "no-answer")]);
    if (terminal === "reply") yield* postAs(c.worker!, { replyTo: id, reply: "none", to: [] });
    else yield* lifecycle("worker", terminal);
    yield* catchUp;
    expect((yield* boardState).posts[id]?.dispositions.worker).toBe(terminal === "reply" ? "replied" : "gone");
  })));
}

it.live("4.13 compact turns consume no reminder; two failed reminder sends resolve undeliverable", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
  yield* acceptWake((yield* pendingWake()).id);
  yield* end("worker", true);
  yield* catchUp;
  expect(yield* queued("worker")).toEqual([]);
  yield* end();
  yield* catchUp;
  for (let n = 0; n < 2; n++) {
    const reminder = yield* pendingWake();
    expect((yield* wakeFor(reminder.id)).reminders).toEqual([id]);
    yield* appendDelivery("DeliverySent", reminder.id, "worker");
    yield* failWake(reminder.id);
    yield* catchUp;
  }
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("undeliverable");
  expect(yield* queued("worker")).toEqual([]);
})));

for (const mode of ["any", "all"] as const) {
  it.live(`4.13 ${mode}: another answer ${mode === "any" ? "closes and withdraws" : "preserves"} an outstanding reminder`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!, { reply: mode, to: [agent("worker"), agent("other")] });
    yield* acceptWake((yield* pendingWake()).id);
    yield* end();
    yield* catchUp;
    const reminder = yield* pendingWake();
    yield* postAs(c.other!, { replyTo: id, reply: "none", to: [] });
    yield* catchUp;
    expect((yield* snapshot).deliveries[reminder.id]?.status).toBe(mode === "any" ? "withdrawn" : "queued");
    expect((yield* boardState).posts[id]?.status).toBe(mode === "any" ? "closed" : "open");
  })));
}

for (const stage of ["reminder", "no-answer"] as const) for (const obstacle of ["own-post", "completion", "nonblocking-wait", "paused", "interrupted"] as const) {
  it.live(`4.14 ${stage} bound: ${obstacle} defers until the obstacle clears and a further turn ends`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!);
    yield* acceptWake((yield* pendingWake()).id);
    if (stage === "no-answer") {
      yield* end(); yield* catchUp;
      const reminder = yield* pendingWake();
      expect((yield* wakeFor(reminder.id)).reminders).toEqual([id]);
      yield* acceptWake(reminder.id);
    }
    let ownPost: string | undefined;
    if (obstacle === "own-post") ownPost = yield* postAs(c.worker!, { to: [agent("other")] });
    if (obstacle === "completion") {
      ownPost = yield* postAs(c.worker!, { to: [agent("other")] });
      yield* appendSetup([close(ownPost, { closer: owner, outcome: "withdrawn" })]);
    }
    if (obstacle === "nonblocking-wait") yield* change({ _tag: "WaitOpened", agentId: "worker", waitId: "nested-wait", members: ["other"], mode: "all", blocking: false });
    if (obstacle !== "interrupted") yield* end();
    if (obstacle === "paused") yield* change({ _tag: "StateChanged", agentId: "worker", state: { _tag: "paused", reason: "limit", midTurn: false } });
    if (obstacle === "interrupted") yield* change({ _tag: "AgentInterrupted", agentId: "worker", previous: "working" });
    yield* catchUp;
    const assertDeferred = Effect.gen(function* () {
      const state = yield* boardState;
      expect(state.posts[id]?.dispositions.worker).toBeUndefined();
      expect(Object.values(state.noAnswers).filter((notice) => notice.postId === id)).toEqual([]);
      expect(eventsOf(yield* readLog, "board.WakeBuilt").filter((row) => row.reminders.includes(id as never))).toHaveLength(stage === "reminder" ? 0 : 1);
    });
    yield* assertDeferred;
    if (obstacle === "own-post" || obstacle === "completion") {
      if (obstacle === "own-post") success(yield* call(c.worker!, "board.close", { postId: ownPost! }));
      else { yield* catchUp; const completion = yield* pendingWake(); yield* acceptWake(completion.id); }
    } else if (obstacle === "nonblocking-wait") yield* change({ _tag: "WaitCancelled", agentId: "worker", waitId: "nested-wait", reason: "fixture work finished" });
    else yield* resumeHistory("worker");
    yield* catchUp;
    yield* assertDeferred;
    yield* end();
    yield* catchUp;
    if (stage === "reminder") expect((yield* wakeFor((yield* pendingWake()).id)).reminders).toContain(id);
    else {
      expect((yield* boardState).posts[id]?.dispositions.worker).toBe("no-answer");
      expect((yield* wakeFor((yield* pendingWake("lead")).id)).noAnswers).toEqual([{ postId: id, addressee: agent("worker") }]);
    }
  })));
}

it.effect("4.14 mutual questions remain free of reminder/no-answer traffic with the real sheepdog running across its timers", () => Effect.gen(function* () {
  const ids = yield* run((c) => Effect.gen(function* () {
    const a = yield* postAs(c.worker!, { to: [agent("other")] });
    const b = yield* postAs(c.other!, { to: [agent("worker")] });
    for (const id of ["worker", "other"]) {
      yield* acceptWake((yield* pendingWake(id)).id, id);
      yield* end(id);
    }
    return [a, b];
  }));
  yield* service(Effect.gen(function* () {
    expect((yield* eventually(snapshot, (state) => (state.roles as any).baseline?.on === true)).roles).toMatchObject({ baseline: { on: true } });
    yield* TestClock.adjust("30 minutes");
    // A settings transition is a positive follower barrier after the timer
    // interval. An absent/dead sheepdog cannot satisfy this assertion.
    success(yield* call(ownerCredential, "roles.settings.set", { settings: { sheepdog: false } }));
    expect((yield* eventually(snapshot, (state) => (state.roles as any).baseline?.on === false)).roles).toMatchObject({ baseline: { on: false } });
    const rows = yield* readLog;
    expect(eventsOf(rows, "board.WakeBuilt").filter((wake) => wake.reminders.some((id) => ids.includes(id)) || wake.noAnswers.some((notice) => ids.includes(notice.postId)))).toEqual([]);
    expect(eventsOf(rows, "board.AddresseeResolved").filter((event) => ids.includes(event.postId) && event.disposition === "no-answer")).toEqual([]);
    for (const id of ids) expect((yield* boardState).posts[id]?.status).toBe("open");
  }), { sheepdog: true });
}));

it.live("4.14 two agents waiting on each other's posts do not create reminder traffic", () => run((c) => Effect.gen(function* () {
  const a = yield* postAs(c.worker!, { to: [agent("other")] });
  const b = yield* postAs(c.other!, { to: [agent("worker")] });
  yield* acceptWake((yield* pendingWake("worker")).id, "worker");
  yield* acceptWake((yield* pendingWake("other")).id, "other");
  yield* end("worker"); yield* end("other");
  const before = yield* headSequence;
  yield* catchUp; yield* catchUp;
  expect(eventsOf(yield* logAfter(before), "board.WakeBuilt")).toEqual([]);
  expect((yield* boardState).posts[a]?.status).toBe("open");
  expect((yield* boardState).posts[b]?.status).toBe("open");
})));

for (const author of ["owner", "service"] as const) {
  it.live(`4.13 no answer for ${author}: one durable disposition and ${author === "owner" ? "one text-free alert source" : "no pushed notice"}`, () => run(() => Effect.gen(function* () {
    const payload = { channelId: "room", text: "Private asker text.", to: [agent("worker")], reply: "all" };
    const id = author === "owner" ? yield* postAs(ownerCredential, payload)
      : success(yield* serviceCall("board.post", payload)).postId as string;
    yield* acceptWake((yield* pendingWake()).id);
    yield* end(); yield* catchUp;
    yield* acceptWake((yield* pendingWake()).id);
    yield* end(); yield* catchUp;
    expect((yield* boardState).posts[id]?.dispositions.worker).toBe("no-answer");
    expect(Object.values((yield* boardState).noAnswers)).toEqual([]);
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* sql<EventRow>`SELECT * FROM events ORDER BY sequence`;
    const rows = yield* Effect.forEach(stored, decodeRow);
    const actions = rows.flatMap((row) => boardAlertSources.flatMap((source) => {
      const action = source(row);
      return action?._tag === "raise" && action.kind === "board.no-answer" ? [action] : [];
    }));
    expect(actions).toEqual(author === "owner" ? [{ _tag: "raise", key: `no-answer:${id}`, kind: "board.no-answer", agentId: "worker", subject: id }] : []);
    expect(JSON.stringify(actions)).not.toContain("Private asker text.");
    expect(yield* queued("lead")).toEqual([]);
    const before = yield* headSequence;
    yield* catchUp;
    expect(yield* logAfter(before)).toEqual([]);
  })));
}

it.live("4.13 an open capacity hold consumes neither reminder nor no-answer; the carry-on turn counts after release", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  const first = yield* pendingWake();
  yield* acceptWake(first.id);
  const held = yield* promptReply(yield* snapshot, {
    _tag: "promptReply", agentId: agentIdOf("worker"), incarnation: yield* currentIncarnation("worker"), deliveryId: first.id,
    outcome: { _tag: "capacity", error: "Fixture capacity error." },
  }, Effect.succeed, () => true);
  expect(held.some((event) => event._tag === "DeliveryHeld")).toBe(true);
  expect(held.some((event) => event._tag === "DeliveryReturned" || event._tag === "TurnEnded")).toBe(false);
  yield* appendSetup(held);
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions.worker).toBeUndefined();
  expect(eventsOf(yield* readLog, "board.WakeBuilt").filter((row) => row.reminders.includes(id as never))).toEqual([]);
  const carry = (yield* snapshot).deliveries;
  const carryOn = Object.values(carry).find((row) => row.target === "worker" && row.status === "queued" && row.content._tag === "carry-on");
  expect(carryOn).toBeDefined();
  yield* change({ _tag: "DeliveryReleased", agentId: "worker" });
  yield* appendDelivery("DeliverySent", carryOn!.id, "worker");
  yield* appendDelivery("DeliveryAccepted", carryOn!.id, "worker");
  yield* end(); yield* catchUp;
  expect((yield* wakeFor((yield* pendingWake()).id)).reminders).toEqual([id]);
})));

it.live("4.11 an empty whole-state scan writes no first-start marker or replay work", () => run(() => Effect.gen(function* () {
  const before = yield* headSequence;
  yield* catchUp; yield* catchUp;
  expect(yield* logAfter(before)).toEqual([]);
})));

it.live("4.4 leaving a plain channel resolves the target and withdraws its queued post", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("removed");
  expect((yield* boardState).posts[id]?.outcome).toBe("unanswerable");
  expect(yield* queued("worker")).toEqual([]);
  expect((yield* boardState).completions[id]).toBeDefined();
})));

it.live("4.4 leaving and rejoining before the reactor still resolves the older question", () => run((c) => Effect.gen(function* () {
  const old = yield* postAs(c.lead!);
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: ["worker"], remove: [] }));
  yield* catchUp;
  expect((yield* boardState).posts[old]?.dispositions.worker).toBe("removed");
  const fresh = yield* postAs(c.lead!);
  expect((yield* boardState).posts[fresh]?.dispositions.worker).toBeUndefined();
})));

it.live("4.4 a plain-channel author who leaves has the post withdrawn with a completion", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.worker!, { to: [agent("other")] });
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  yield* catchUp;
  expect((yield* boardState).posts[id]?.outcome).toBe("withdrawn");
  expect((yield* boardState).completions[id]).toMatchObject({ authorAgentId: "worker" });
  const completions = yield* queued("worker");
  expect(completions).toHaveLength(1);
  const wake = yield* wakeFor(completions[0]!.id);
  expect(wake.completions).toEqual([id]);
  expect(wake.completionReplyText).toEqual([]);
})));

it.live("4.4 losing a group label resolves a question even when the agent remains online", () => run((c) => Effect.gen(function* () {
  yield* appendSetup([channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead", members: [agent("lead")] })]);
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: ["review"] });
  const id = yield* postAs(c.lead!, { channelId: "group" });
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: [] });
  yield* catchUp;
  expect((yield* snapshot).agents.worker?.state._tag).toBe("idle");
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("removed");
})));

it.live("4.4 a direct grant ends only after the last shared channel is lost", () => run((c) => Effect.gen(function* () {
  yield* appendSetup([channel({ channelId: "second", name: "Second" })]);
  const first = success(yield* call(c.other!, "board.post", { direct: agent("worker"), text: "First direct question.", to: [agent("worker")], reply: "all" })).postId as string;
  const second = success(yield* call(c.other!, "board.post", { direct: agent("worker"), text: "Second direct question.", to: [agent("worker")], reply: "all" })).postId as string;
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  yield* catchUp;
  expect((yield* boardState).posts[first]?.dispositions.worker).toBeUndefined();
  expect((yield* boardState).posts[second]?.dispositions.worker).toBeUndefined();
  success(yield* call(c.lead!, "board.members", { channelId: "second", add: [], remove: ["worker"] }));
  yield* catchUp;
  expect((yield* boardState).posts[second]?.dispositions.worker).toBe("removed");
  expect((yield* boardState).posts[second]?.outcome).toBe("unanswerable");
})));

// The dispatcher must skip a wake withdrawn by the send-time reach check.
it.live("4.9 send-time reach continuation: a removed group post is withdrawn while the next engine delivery is sent", () => run((c, runner) => Effect.gen(function* () {
  yield* appendSetup([channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead", members: [agent("lead")] })]);
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: ["review"] });
  const id = yield* postAs(c.lead!, { channelId: "group" });
  const before = yield* pendingWake();
  success(yield* call(ownerCredential, "prompt", { agentId: "worker", text: "Next engine delivery." }));
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: [] });
  yield* dispatchQueued(agentIdOf("worker"));
  expect((yield* snapshot).deliveries[before.id]?.status).toBe("withdrawn");
  expect(runner.callsOf("prompt").some((row) => row.input.delivery.id === before.id)).toBe(false);
  expect(runner.callsOf("prompt").some((row) => row.input.delivery.content._tag === "prompt" && row.input.delivery.content.text === "Next engine delivery.")).toBe(true);
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("removed");
})));

it.live("4.3 returned wake: a fake agent's send error runs the real dispatcher return path before one retry", () => run((c, runner) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  const first = yield* pendingWake();
  runner.rejectNext("prompt", "Fixture transport failure.");
  yield* dispatchQueued(agentIdOf("worker"));
  const state = yield* snapshot;
  expect(state.deliveries[first.id]?.status).toBe("returned");
  expect(state.agents.worker?.state._tag).toBe("idle");
  expect(eventsOf(yield* readLog, "DeliveryReturned").find((row) => row.deliveryId === first.id)?.sender).toEqual({ _tag: "piece", namespace: "board" });
  expect((state.board as import("@shephrd/contracts/board/view").BoardView).posts[id]?.returns?.worker).toBe(1);
  yield* catchUp;
  const retry = yield* pendingWake();
  expect(retry.id).not.toBe(first.id);
  expect((yield* wakeFor(retry.id)).mustReply).toEqual([id]);
})));
