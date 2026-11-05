import * as Effect from "effect/Effect";
import { expect } from "vitest";
import { Views } from "../../src/views/Views.ts";
import { compareViews } from "../../src/views/compare.ts";
import { currentIncarnation } from "../support/fakeRunner.ts";
import { agentIdOf, appendSetup, call, headSequence, logAfter, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { read } from "./fixtures.ts";
import { agent, boardState, change, eventsOf, postAs, queued, snapshot, wakeFor } from "./wakeFixtures.ts";
import { acceptWake, catchUp, end, eventually, it, lifecycle, pause, pendingWake, reactorRig, registeredReactor, stopReactor } from "./reactorFixtures.ts";

const { run, reopen } = reactorRig(() => registerRebuildCheck());
const checkpoints = ["trigger", "reminder-queued", "reminder-accepted", "answer-turn-end", "answer-turn-error", "notice-queued", "notice-accepted"] as const;

for (const checkpoint of checkpoints) for (const terminal of ["reply", "stop", "crash", "departure"] as const) {
  it.live(`restart from complete ${checkpoint} batch retains one duty, then ${terminal} supersedes it`, () => Effect.gen(function* () {
    const saved = yield* run((c, runner) => Effect.gen(function* () {
      const postId = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
      yield* acceptWake((yield* pendingWake()).id);
      yield* end();
      if (checkpoint !== "trigger") {
        yield* catchUp;
        const reminder = yield* pendingWake();
        expect((yield* wakeFor(reminder.id)).reminders).toEqual([postId]);
        if (checkpoint !== "reminder-queued") {
          yield* acceptWake(reminder.id);
          if (checkpoint === "answer-turn-error") {
            yield* runner.subscribed;
            yield* runner.emit({ _tag: "promptReply", agentId: agentIdOf("worker"), incarnation: yield* currentIncarnation("worker"), deliveryId: reminder.id,
              outcome: { _tag: "error", error: "Checkpoint ordinary failure." } });
            expect((yield* eventually(snapshot, (state) => state.deliveries[reminder.id]?.status === "returned")).deliveries[reminder.id]?.status).toBe("returned");
          } else if (checkpoint !== "reminder-accepted") yield* end();
          if (checkpoint === "notice-queued" || checkpoint === "notice-accepted") {
            yield* catchUp;
            const notice = yield* pendingWake("lead");
            expect((yield* wakeFor(notice.id)).noAnswers).toEqual([{ postId, addressee: agent("worker") }]);
            if (checkpoint === "notice-accepted") { yield* acceptWake(notice.id, "lead"); yield* end("lead"); }
          }
        }
      }
      expect((yield* compareViews()).differences).toEqual([]);
      return { postId, worker: c.worker! };
    }));
    yield* reopen(Effect.gen(function* () {
      yield* catchUp;
      const state = yield* boardState;
      const noAnswer = ["answer-turn-end", "answer-turn-error", "notice-queued", "notice-accepted"].includes(checkpoint);
      expect(state.posts[saved.postId]?.dispositions.worker).toBe(noAnswer ? "no-answer" : undefined);
      const history = yield* readLog;
      expect(eventsOf(history, "board.WakeBuilt").filter((wake) => wake.reminders.includes(saved.postId as never))).toHaveLength(1);
      expect(eventsOf(history, "board.AddresseeResolved").filter((event) => event.postId === saved.postId && event.disposition === "no-answer")).toHaveLength(noAnswer ? 1 : 0);
      const notices = Object.values(state.noAnswers).filter((notice) => notice.postId === saved.postId);
      expect(notices).toHaveLength(noAnswer && checkpoint !== "notice-accepted" ? 1 : 0);
      const status = success(yield* call(ownerCredential, "board.status", { agentId: "worker" }));
      expect(status.sequence).toBe((yield* snapshot).sequence);
      expect(status.holdsUnsettled).toBe(!noAnswer);
      const stable = yield* headSequence;
      yield* catchUp; yield* catchUp;
      expect(yield* logAfter(stable)).toEqual([]);
      if (terminal === "reply") yield* postAs(saved.worker, { replyTo: saved.postId, reply: "none", to: [] });
      else if (terminal === "departure") success(yield* call(ownerCredential, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
      else yield* lifecycle("worker", terminal);
      yield* catchUp;
      expect((yield* boardState).posts[saved.postId]?.dispositions.worker).toBe(terminal === "reply" ? "replied" : terminal === "departure" ? "removed" : "gone");
      expect((yield* compareViews()).differences).toEqual([]);
      const final = yield* headSequence;
      yield* catchUp;
      expect(yield* logAfter(final)).toEqual([]);
      // These are logical duties and accepted manifests. Physical replays of
      // an unproven sent wake belong to the real process restart acceptance.
      const rows = yield* readLog;
      const reminderIds = new Set(eventsOf(rows, "board.WakeBuilt").filter((wake) => wake.reminders.includes(saved.postId as never)).map((wake) => wake.wakeId));
      const reminderDeliveries = eventsOf(rows, "DeliveryQueued").filter((event) => event.delivery.source?._tag === "piece" && reminderIds.has(event.delivery.source.id as never)).map((event) => event.delivery.id);
      expect(eventsOf(rows, "DeliveryAccepted").filter((event) => reminderDeliveries.includes(event.deliveryId)).length).toBeLessThanOrEqual(1);
    }));
  }));
}

it.live("E17 rejects the whole reactor batch and a later touch retries the owed replacement once", () => run((c) => Effect.gen(function* () {
  const first = yield* postAs(c.lead!);
  const second = yield* postAs(c.lead!);
  const old = yield* pendingWake();
  yield* change({ _tag: "board.PostAcknowledged", postId: first, addressee: agent("worker") });
  const views = yield* Views;
  let refuse = true;
  // Inject only the inconsistent read that E17 must reject. The durable log
  // and live views stay real and unchanged; the later read is authentic.
  const observed = { ...views, snapshot: views.snapshot.pipe(Effect.map((state) => refuse ? { ...state,
    deliveries: { ...state.deliveries, [old.id]: { ...state.deliveries[old.id]!, source: { _tag: "question" as const, id: "foreign-source" } } },
  } : state)) };
  const targetCount = Object.keys((yield* snapshot).agents).length;
  const before = yield* headSequence;
  const fiber = yield* registeredReactor().pipe(Effect.provideService(Views, observed), Effect.forkScoped);
  const refused = yield* eventually(logAfter(before), (rows) => eventsOf(rows, "CommandRefused").filter((event) => event.command === "board.reactor").length === targetCount);
  // Each startup target gets one scan. The injected globally invalid cleanup
  // is refused once per target, and must not feed another retry loop.
  expect(eventsOf(refused, "CommandRefused").filter((event) => event.command === "board.reactor")).toHaveLength(targetCount);
  expect(eventsOf(refused, "DeliveryWithdrawn")).toEqual([]);
  expect((yield* queued()).map((row) => row.id)).toEqual([old.id]);
  const stable = yield* headSequence;
  yield* pause(100);
  expect(yield* headSequence).toBe(stable);
  refuse = false;
  yield* appendSetup([read([second], "lead")]);
  const replaced = yield* eventually(queued(), (rows) => rows.length === 1 && rows[0]!.id !== old.id);
  expect(replaced).toHaveLength(1);
  expect(replaced[0]!.id).not.toBe(old.id);
  expect((yield* wakeFor(replaced[0]!.id)).mustReply).toEqual([second]);
  yield* pause(50);
  expect(eventsOf(yield* logAfter(stable), "DeliveryWithdrawn").filter((event) => event.deliveryId === old.id)).toHaveLength(1);
  yield* stopReactor(fiber);
})));
