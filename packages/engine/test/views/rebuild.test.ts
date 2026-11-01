import { mkdtempSync, rmSync } from "node:fs";

import { it } from "@effect/vitest";
import { Actor } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as Views from "../../src/views/Views.ts";
import { emptyViews } from "../../src/views/apply.ts";
import { rebuild } from "../../src/views/rebuild.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { event, journey, question, queued, ready, sent } from "../support/viewFixtures.ts";
import { append, sequence, withViews } from "../support/withViews.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/shepherd-rebuild-");
  vi.stubEnv("SHEPHERD_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it.effect("4.4 empty rebuild: catches inventing sequence one or retaining state before the first event", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const views = yield* Views.Views;
    expect(yield* rebuild(sequence(0))).toEqual(emptyViews());
    expect(yield* views.snapshot).toEqual(emptyViews());
  })),
);

it.effect("4.4 live parity: catches missing committed batches, skipping sequence one or rebuilding only the last batch", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const views = yield* Views.Views;
    for (const [index, batch] of [journey.slice(0, 3), journey.slice(3, 10), journey.slice(10)].entries()) {
      const committed = yield* append(`batch-${index}`, batch);
      const head = committed.at(-1)!.sequence;
      const live = yield* views.snapshot;
      expect(live.sequence).toBe(head);
      expect(yield* rebuild(head)).toEqual(live);
    }
    // Literal checks keep an empty or jointly broken live/rebuild pair from
    // satisfying the equality assertion by making the same mistake twice.
    expect(yield* views.snapshot).toMatchObject({
      sequence: journey.length,
      agents: { "agent-a": { state: { _tag: "idle" } } },
      requests: { "permission-a": { status: "answered" } },
      questions: { "question-a": { status: "answered", answer: "events.ts" } },
      waits: { "wait-a": { status: "open", resolved: [{ agentId: "agent-b", reason: "settled" }] } },
      deliveries: { "delivery-a": { status: "accepted" } },
      accounts: { primary: { status: "available" } },
      devices: { phone: { name: "Phone", revoked: true } },
    });
  })),
);

it.effect("4.4 historical prefix: catches ignoring upTo, reading past N, or using the current live snapshot as a rebuild", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const views = yield* Views.Views;
    const history = [yield* views.snapshot];
    // Save independently observed live snapshots after every real append,
    // including cuts while requests, waits and deliveries are still open.
    for (const [index, value] of journey.entries()) {
      yield* append(`prefix-${index}`, [value]);
      history.push(structuredClone(yield* views.snapshot));
    }
    const current = yield* views.snapshot;
    for (const [index, expected] of history.entries()) {
      expect(yield* rebuild(sequence(index))).toEqual(expected);
    }
    expect(yield* views.snapshot).toEqual(current);
    expect(history[4]?.deliveries["delivery-a"]).toMatchObject({ status: "queued" });
    expect(history[5]?.deliveries["delivery-a"]).toMatchObject({ status: "sent" });
  })),
);

it.effect("4.4 restart: catches rebuilding from an in-memory append cache or leaving a reopened live service empty", () =>
  Effect.gen(function* () {
    const first = yield* withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
      yield* append("before-restart", [...ready, queued, sent,
        event({ _tag: "AgentInterrupted", agentId: "agent-a", previous: "working" }),
        event({ _tag: "StateChanged", agentId: "agent-a", state: { _tag: "working" } }),
      ]);
      return structuredClone(yield* (yield* Views.Views).snapshot);
    }));
    yield* withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
      const views = yield* Views.Views;
      expect(yield* rebuild(first.sequence)).toEqual(first);
      expect(yield* views.snapshot).toEqual(first);
      expect(yield* views.snapshot).toMatchObject({
        agents: { "agent-a": { state: { _tag: "working" } } },
        deliveries: { "delivery-a": { status: "sent" } },
      });
    }));
  }),
);

it.effect("4.4 receipt replay: catches applying a deduplicated append twice to the live thread", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const views = yield* Views.Views;
    const first = yield* append("repeat", journey);
    const before = structuredClone(yield* views.snapshot);
    expect(yield* append("repeat", journey)).toEqual(first);
    expect(yield* views.snapshot).toEqual(before);
    expect(yield* rebuild(before.sequence)).toEqual(before);
  })),
);

it.effect("4.4 envelopes: catches decoding canonical agent callers as JSON or losing envelope identities during rebuild", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* append("ready", ready);
    const caller = Schema.decodeUnknownSync(Actor)({ _tag: "agent", agentId: "agent:with:colons" });
    const [written] = yield* append("agent-envelope", [question], caller);
    const views = yield* Views.Views;
    const rebuilt = yield* rebuild(sequence(4));
    expect(rebuilt).toEqual(yield* views.snapshot);
    expect(rebuilt.threads["agent-a"]?.at(-1)).toEqual(written);
    expect(rebuilt.threads["agent-a"]?.at(-1)).toMatchObject({ caller, requestId: "agent-envelope" });
  })),
);

it.effect("4.4 rollback: catches projecting uncommitted events from a batch that fails after its first insert", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const views = yield* Views.Views;
    const sql = yield* SqlClient.SqlClient;
    yield* append("ready", ready);
    const before = structuredClone(yield* views.snapshot);
    yield* sql`CREATE TRIGGER fail_second_projection_event BEFORE INSERT ON events
      WHEN NEW.event_type = 'DeliverySent'
      BEGIN SELECT RAISE(ABORT, 'injected second event failure'); END`;
    const failed = yield* append("rollback", [queued, sent]).pipe(Effect.result);
    expect(failed._tag).toBe("Failure");
    expect(yield* views.snapshot).toEqual(before);
    expect(yield* rebuild(before.sequence)).toEqual(before);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 3 }]);
  })),
);
