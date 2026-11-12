import { mkdtempSync, rmSync } from "node:fs";

import type { BoardView } from "@lgtm/contracts/board/view";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { project } from "../../src/routing/waits.ts";
import * as Views from "../../src/views/Views.ts";
import { compareViews } from "../../src/views/compare.ts";
import { rebuild } from "../../src/views/rebuild.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { append, sequence, withViews } from "../support/withViews.ts";
import { accept, agent, close, event, position, post, queue, read, resolve, returned, setup, wake } from "./fixtures.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/lgtm-board-view-");
  vi.stubEnv("LGTM_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it("rebuild: every committed board prefix equals the live snapshot, including a reminder accept and no-answer", async () => {
  await Effect.runPromise(withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const views = yield* Views.Views;
    const events = [...setup, post("question"), read(["question"]),
      event({ _tag: "board.PostAcknowledged", postId: "question", addressee: agent("worker") }),
      event({ _tag: "TurnEnded", agentId: "worker", compact: false }),
      wake("reminder", { reminders: ["question"] }), queue("reminder"), accept("reminder"),
      returned("reminder"), resolve("question", "no-answer"),
      post("reply", { author: agent("worker"), to: [], reply: "none", replyToPostId: "question" }),
      resolve("question", "replied", { decidingPostId: "reply" }), close("question"),
      wake("completion", { targetAgentId: "lead", completions: ["question"] }),
      queue("completion", "delivery-completion", "lead"), accept("completion", "lead"),
    ];
    const history = [structuredClone(yield* views.snapshot)];
    for (const [index, value] of events.entries()) {
      yield* append(`board-prefix-${index}`, [value]);
      const live = yield* views.snapshot;
      expect(yield* rebuild(live.sequence)).toEqual(live);
      history.push(structuredClone(live));
    }
    expect(history[13]?.board).toMatchObject({
      posts: { question: { status: "open", dispositions: { worker: "no-answer" }, takenAt: { worker: 6 }, reminderAcceptedAt: { worker: 11 } } },
      lastTurnEnd: { worker: 12 },
    });
    expect((yield* views.snapshot).board).toMatchObject({
      posts: { question: { status: "closed", outcome: "answered", decidingReplies: { worker: "reply" }, replies: ["reply"] } },
      completions: {}, noAnswers: {},
    });
    for (const [head, expected] of history.entries()) expect(yield* rebuild(sequence(head))).toEqual(expected);
    expect(yield* compareViews()).toEqual({ sequence: events.length, differences: [] });
  })));
});

it.each(["stop", "crash"] as const)("rebuild: %s and restart retain the correct completion debt after a fresh resume", async (kind) => {
  await Effect.runPromise(Effect.gen(function* () {
    const saved = yield* withViews(home, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* append("closed-and-failed", [...setup, post("done"), close("done"),
        ...["first", "second"].flatMap((id) => [
          wake(id, { targetAgentId: "lead", completions: ["done"] }), queue(id, `delivery-${id}`, "lead"), returned(id, "lead"),
        ]),
      ]);
      const views = yield* Views.Views;
      expect((yield* views.snapshot).board).toMatchObject({ completions: { done: { postId: "done", authorAgentId: "lead", returns: 2 } } });
      yield* append("lifecycle", [kind === "stop"
        ? event({ _tag: "AgentStopped", agentId: "lead" })
        : event({ _tag: "AgentCrashed", agentId: "lead", exitCode: 1, signal: null, stderr: "Test crash." })]);
      const live = yield* views.snapshot;
      expect(yield* rebuild(live.sequence)).toEqual(live);
      expect(Object.values((live.board as BoardView).completions)).toEqual(kind === "stop" ? [] : [{ postId: "done", authorAgentId: "lead", returns: 2 }]);
      return structuredClone(live);
    }));
    yield* withViews(home, Effect.gen(function* () {
      yield* registerRebuildCheck();
      const views = yield* Views.Views;
      expect(yield* views.snapshot).toEqual(saved);
      yield* append("fresh-resume", [event({ _tag: "StateChanged", agentId: "lead", state: { _tag: "starting" } })]);
      const live = yield* views.snapshot;
      expect(Object.values((live.board as BoardView).completions)).toEqual(kind === "stop" ? [] : [{ postId: "done", authorAgentId: "lead", returns: 2 }]);
      expect((live.board as BoardView).stopped).not.toContain("lead");
      expect(yield* rebuild(live.sequence)).toEqual(live);
    }));
  }));
});

it("rebuild: read holes and the original taken sequence survive closing and reopening the database", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    yield* withViews(home, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* append("read-above-hole", [...setup, post("one"), post("two"), post("three"), read(["three"])]);
      const live = yield* (yield* Views.Views).snapshot;
      expect(live.board).toMatchObject({ readState: { worker: { room: { watermark: 0, above: ["three"] } } } });
    }));
    yield* withViews(home, Effect.gen(function* () {
      yield* registerRebuildCheck();
      const views = yield* Views.Views;
      expect(position((yield* views.snapshot).board as BoardView)).toEqual({ watermark: 0, above: ["three"] });
      yield* append("read-hole-and-old-page", [read(["one", "two"]), read(["three"])]);
      const live = yield* views.snapshot;
      expect(position(live.board as BoardView)).toEqual({ watermark: 7, above: [] });
      expect((live.board as BoardView).posts["three"]?.takenAt["worker"]).toBe(8);
      expect(yield* rebuild(live.sequence)).toEqual(live);
    }));
  }));
});

it("rebuild: debug comparison reports a board-only divergence even when the engine head is correct", async () => {
  await Effect.runPromise(withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck({ expectDifference: true });
    yield* append("board-only-divergence", [...setup, post("question"), resolve("question", "gone"), close("question", { outcome: "unanswerable" })]);
    const views = yield* Views.Views;
    expect((yield* rebuild(sequence(7))).board).toMatchObject({ posts: { question: { outcome: "unanswerable" } } });
    expect((yield* views.snapshot).sequence).toBe(7);
    const compared = yield* compareViews();
    expect(compared).toEqual({ sequence: 7, differences: [{ path: ["board", "posts", "question", "outcome"], live: "answered", rebuilt: "unanswerable" }] });
  }), {
    replace: (real) => ({
      ...real,
      applyCommitted: (batch) => real.applyCommitted(batch.map((row) => row.event._tag === "board.PostClosed"
        ? { ...row, event: { ...row.event, outcome: "answered" as const } } : row)),
    }),
  }));
});

for (const stopFirst of [true, false]) {
  it(`FR-113 a complete ${stopFirst ? "stop/post/read" : "post/read/stop"} batch matches projection, live and reopened rebuild`, async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const saved = yield* withViews(home, Effect.gen(function* () {
        yield* registerRebuildCheck();
        yield* append("same-batch-setup", setup);
        const views = yield* Views.Views;
        const before = yield* views.snapshot;
        const stopped = event({ _tag: "AgentStopped", agentId: "worker" });
        const addressed = [post("same-batch"), read(["same-batch"])];
        const events = stopFirst ? [stopped, ...addressed] : [...addressed, stopped];
        const projected = project(before, events);
        const batch = yield* append("complete-stop-post", events);
        expect(batch).toHaveLength(3);
        expect(new Set(batch.map((row) => row.requestId))).toEqual(new Set(["complete-stop-post"]));
        const live = yield* views.snapshot;
        expect(live.sequence).toBe(7);
        // The reducer records the batch. A later reactor decides gone/close.
        expect(live.agents.worker?.state._tag).toBe("stopped");
        expect(live.board).toMatchObject({
          stopped: ["worker"], lastStopped: { worker: stopFirst ? 5 : 7 },
          posts: { "same-batch": { sequence: stopFirst ? 6 : 5, status: "open", to: [agent("worker")], dispositions: {}, takenAt: { worker: stopFirst ? 7 : 6 } } },
          readState: { worker: { room: { watermark: stopFirst ? 6 : 5, above: [] } } },
        });
        expect((live.board as BoardView).posts["same-batch"]?.dispositions).toEqual({});
        expect(projected.board).toEqual(live.board);
        expect(projected.agents).toEqual(live.agents);
        expect(yield* rebuild(live.sequence)).toEqual(live);
        return structuredClone(live);
      }));
      yield* withViews(home, Effect.gen(function* () {
        yield* registerRebuildCheck();
        expect(yield* (yield* Views.Views).snapshot).toEqual(saved);
        expect(yield* rebuild(saved.sequence)).toEqual(saved);
      }));
    }));
  });
}
