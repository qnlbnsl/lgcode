import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agentCredential, call, seedAgent, success } from "../support/handlerRig.ts";
import { requestPermission, eventually } from "../support/routingRig.ts";
import { crash, notice } from "../support/deliveryRig.ts";
import { append, awaitRaised, barrier, eventsOf, raised, withAlerts } from "../support/alertsRig.ts";

it.each(["permission", "question"] as const)("6.1 holder producer: %s reaches the owner and raises the right kind", async (kind) => {
  await withAlerts((runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const worker = yield* seedAgent({ id: "worker", state: "working" });
    const id = kind === "permission" ? (yield* requestPermission(runner, worker)).id
      : success(yield* call(agentCredential(worker.token), "ask", { text: "Which branch?" })).questionId as string;
    const source = (yield* eventsOf("OwnerNeeded")).find((row) => row.event.subject?.id === id)!;
    expect(source.event.reason).toBe("request needs the owner");
    const rows = yield* awaitRaised(`${kind}:${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toMatchObject({ kind: kind === "permission" ? "approval" : "question",
      agentId: "worker", subject: { _tag: kind, id }, sourceSequence: source.sequence });
    expect(rows[0]!.caller).toEqual({ _tag: "piece", namespace: "client" });
  }));
});

it("6.1 crash producer: a real runner exit for an owner-held agent raises failure", async () => {
  await withAlerts((runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const worker = yield* seedAgent({ id: "worker", state: "working" });
    yield* crash(runner, worker);
    const source = (yield* eventsOf("OwnerNeeded")).find((row) => row.event.reason === "agent crashed")!;
    expect(source).toBeDefined();
    const rows = yield* awaitRaised(`crash:worker:${source.sequence}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toMatchObject({ kind: "failure", agentId: "worker", sourceSequence: source.sequence });
  }));
});

it.each([
  ["signed-out", "account needs sign-in", "AccountNeedsSignIn", "account:primary:sign-in"],
  ["out-of-usage", "account is out of usage, no reset time known", "AccountOutOfUsage", "account:primary:usage"],
] as const)("6.1 delivery producer: %s uses the account event and does not double-alert OwnerNeeded", async (reason, text, tag, key) => {
  await withAlerts((runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const worker = yield* seedAgent({ id: "worker", state: "working" });
    yield* notice(runner, worker, { _tag: "promptReply", deliveryId: "seed-turn-worker", outcome: { _tag: "pause", reason, error: "Fixture provider pause." } });
    const needed = yield* eventually(eventsOf("OwnerNeeded"), (rows) => rows.some((row) => row.event.reason === text));
    expect(needed.map((row) => row.event.reason)).toContain(text);
    const source = (yield* eventsOf(tag))[0]!;
    expect(source).toBeDefined();
    const rows = yield* awaitRaised(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toMatchObject({ kind: "account", subject: { _tag: "account", id: "primary" }, sourceSequence: source.sequence });
    expect(yield* barrier()).toHaveLength(1);
    expect((yield* raised()).filter((row) => row.event.kind === "account")).toHaveLength(1);
  }));
});

it.each(["account needs sign-in", "account is out of usage, no reset time known"])(
  "6.1 missing account row: %s falls back to the agent-account remedy", async (reason) => {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "paused" });
      yield* append({ _tag: "AccountChanged", accountId: "primary" });
      yield* append({ _tag: "OwnerNeeded", agentId: "worker", reason });
      const rows = yield* awaitRaised("agent-account:worker");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event).toMatchObject({ kind: "account", agentId: "worker", subject: { _tag: "agent", id: "worker" } });
    }));
  },
);

it("6.1 an unknown reason still raises other with a fixed title", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker" });
    yield* append({ _tag: "OwnerNeeded", agentId: "worker", reason: "A newly added reason." });
    const rows = yield* eventually(raised(), (rows) => rows.some((row) => row.event.kind === "other"));
    expect(rows.map((row) => row.event)).toContainEqual(expect.objectContaining({ kind: "other", title: "Your attention is needed" }));
  }));
});

it("6.1 a usage limit with a known reset time raises no account alert", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working" });
    yield* append({ _tag: "AccountOutOfUsage", accountId: "primary", resetAt: Date.now() + 3_600_000 });
    expect(yield* barrier()).toHaveLength(1);
    expect((yield* raised()).filter((row) => row.event.kind === "account")).toEqual([]);
  }));
});
