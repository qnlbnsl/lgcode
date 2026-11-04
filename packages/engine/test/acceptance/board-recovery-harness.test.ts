import { it, expect } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { waitForBoardRecovery } from "../support/boardRecovery.ts";
import { agentIdOf } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const author = { agentId: agentIdOf("asker"), account: "primary" as never, state: { _tag: "idle" as const } };
const recipient = { ...author, agentId: agentIdOf("recipient"), state: { _tag: "interrupted" as const, previous: "working" as const }, reloadable: false };
const empty = { disabled: false, truncated: false, posts: [], completions: [], noAnswers: [] };
const completion = { ...empty, completions: [{ postId: "question", authorAgentId: author.agentId, returns: 0 }] };

it.live("boot waits through a non-reloadable recipient's resolution and the closed-but-unsent completion window", () => Effect.gen(function* () {
  const snapshots = [
    { agents: [author, recipient], board: { ...empty, posts: [{ reply: "all", to: [{ _tag: "agent", agentId: recipient.agentId }], dispositions: {} }] } },
    { agents: [author, recipient], board: completion },
    { agents: [{ ...author, state: { _tag: "working" as const } }, recipient], board: completion },
  ];
  let reads = 0;
  yield* waitForBoardRecovery(Effect.sync(() => snapshots[Math.min(reads++, snapshots.length - 1)]!));
  expect(reads).toBe(3);
}));

it.live("a completion that is never sent fails the boot wait instead of passing the frozen assertion on a partial log", () => Effect.gen(function* () {
  const result = yield* waitForBoardRecovery(Effect.succeed({ agents: [author], board: completion }), 25).pipe(Effect.exit);
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(Cause.pretty(result.cause)).toContain("Timed out waiting for board recovery resolutions and notifications");
}));

for (const obstacle of ["working", "paused", "held", "signed-out"] as const) {
  it.live(`boot does not wait for an intentionally blocked ${obstacle} completion`, () => Effect.gen(function* () {
    const agent = obstacle === "held" ? { ...author, capacityHeld: true }
      : obstacle === "paused" ? { ...author, state: { _tag: "paused" as const, reason: "limit" as const, midTurn: false } }
      : obstacle === "working" ? { ...author, state: { _tag: "working" as const } } : author;
    let reads = 0;
    yield* waitForBoardRecovery(Effect.sync(() => {
      reads++;
      return { agents: [agent], board: completion, ...(obstacle === "signed-out" ? { accounts: [{ id: author.account, status: "needs-sign-in", enabled: true, environment: [] }] } : {}) };
    }));
    expect(reads).toBe(1);
  }));
}

it.live("a failed or truncated board snapshot cannot silently declare recovery complete", () => Effect.gen(function* () {
  for (const snapshot of [
    { agents: [], failedSections: ["board"] },
    { agents: [], board: { ...empty, truncated: true } },
  ]) {
    expect((yield* waitForBoardRecovery(Effect.succeed(snapshot)).pipe(Effect.exit))._tag).toBe("Failure");
  }
}));
