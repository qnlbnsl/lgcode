// Capability 12: use several accounts for each harness, named by the caller or
// picked by the engine. Criteria 8.3 to 8.5.
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  eventsUntil, isTag, peekEcho, redacted, refusal, requestId, scenario, secretValue, stopAllServices, tagged, waitFor, type World,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

type Account = { id: string; enabled?: boolean; environment?: Record<string, string> };

const listAccounts = (w: World) => (w.owner.accounts({ requestId: requestId(), operation: "list" } as never) as unknown as Effect.Effect<{ accounts: ReadonlyArray<Account> }>)
  .pipe(Effect.map((reply) => reply.accounts));

// An agent started with the engine choosing the account.
const startAny = (w: World, name: string) => w.owner.start({
  requestId: requestId(), name, role: "worker", harness: "fake", account: { _tag: "any" },
  permission: "ask", folder: w.root.work, runMode: "acp", groups: [],
} as never) as Effect.Effect<{ agentId: string }, unknown>;

const accountOf = (events: ReadonlyArray<{ agentId?: string; event: { _tag: string } }>, agentId: string): string =>
  (tagged(events as never, "AgentStarted", agentId)[0]!.event as unknown as { account: string }).account;

scenario("12 accounts: an agent named for an account uses it, and an engine-picked agent goes to the account with the fewest agents, ties to the lowest id, and never to a disabled one (breaks if the pick ignores load, the tie rule or the disabled flag)", (w) => Effect.gen(function* () {
  const a = yield* w.start(w.owner, { name: "On A", accountId: "acct-a", prompt: "Go." });
  const b = yield* w.start(w.owner, { name: "On B", accountId: "acct-b", prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "both turns", (e) => e.event._tag === "TurnEnded" && e.agentId === b.agentId);
  const all = yield* eventsUntil(w.owner, 0, "the first agent", isTag("TurnEnded", a.agentId));
  expect(accountOf(all, a.agentId)).toBe("acct-a");

  // a and b each hold one agent: the tie goes to the lowest id.
  const tied = yield* startAny(w, "Tie");
  // a now holds two, b one: the next goes to b.
  const lighter = yield* startAny(w, "Lighter");
  const events = yield* eventsUntil(w.owner, 0, "the picked agents", (e) => e.event._tag === "AgentStarted" && e.agentId === lighter.agentId);
  expect(accountOf(events, tied.agentId)).toBe("acct-a");
  expect(accountOf(events, lighter.agentId)).toBe("acct-b");

  // A disabled account is never picked, even when it holds the fewest agents.
  yield* w.owner.accounts({ requestId: requestId(), operation: "disable", accountId: "acct-b" } as never);
  const skipped = yield* startAny(w, "Skips B");
  const afterDisable = yield* eventsUntil(w.owner, 0, "the third pick", (e) => e.event._tag === "AgentStarted" && e.agentId === skipped.agentId);
  expect(accountOf(afterDisable, skipped.agentId)).toBe("acct-a");

  // With every account disabled, a start has no account to use.
  yield* w.owner.accounts({ requestId: requestId(), operation: "disable", accountId: "acct-a" } as never);
  expect(yield* refusal(startAny(w, "Nowhere"))).toBe("no usable account");
  expect(yield* refusal(w.start(w.owner, { name: "Named but disabled", accountId: "acct-a" }))).toBeDefined();
}));

scenario("12 accounts: a stored secret reaches the agent's environment as its value and never reaches an event, the account list or the service output (breaks if the secret is written to the log or the list, or the agent receives the reference instead of the value)", (w) => Effect.gen(function* () {
  const first = yield* w.start(w.owner, { name: "Before secret", accountId: "acct-s", prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", first.agentId));
  const value = secretValue("api-key-value");
  w.secrets.add(value);
  yield* w.owner["accounts set-secret"]({ requestId: requestId(), accountId: "acct-s", name: "FAKE_API_KEY", nonce: "nonce-1", value: redacted(value) } as never);

  const listed = yield* listAccounts(w);
  const account = listed.find((row) => row.id === "acct-s")!;
  expect(account.environment?.FAKE_API_KEY).toMatch(/^secret:[A-Za-z0-9_-]+$/);
  expect(JSON.stringify(listed)).not.toContain(value);

  // A second agent on the account starts after the secret exists and sees the value.
  yield* w.owner.start({
    requestId: requestId(), name: "After secret", role: "worker", harness: "fake", account: { _tag: "named", accountId: "acct-s" },
    permission: "ask", folder: w.root.work, runMode: "acp", groups: [], prompt: "Go.",
  } as never);
  const env = yield* waitFor("the second agent to record its environment", () => {
    const echo = peekEcho(first.echo);
    return echo?.env.FAKE_API_KEY === undefined ? undefined : echo.env.FAKE_API_KEY;
  });
  expect(env).toBe(value);
}));

scenario("12 accounts: the account list shows additions, changes and removals (breaks if an add, set or remove does not show in the list)", (w) => Effect.gen(function* () {
  const first = yield* w.start(w.owner, { name: "Seed", accountId: "acct-l", prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", first.agentId));
  const base = (yield* listAccounts(w)).find((row) => row.id === "acct-l")!;
  expect(base.enabled).toBe(true);

  yield* w.owner.accounts({ requestId: requestId(), operation: "set", account: { ...base, displayName: "Renamed", enabled: false } } as never);
  const changed = (yield* listAccounts(w)).find((row) => row.id === "acct-l") as Account & { displayName?: string };
  expect(changed).toMatchObject({ displayName: "Renamed", enabled: false });
  expect(yield* refusal(w.owner.accounts({ requestId: requestId(), operation: "add", account: { ...base } } as never)), "adding an existing account was accepted").toBeDefined();

  yield* w.owner.accounts({ requestId: requestId(), operation: "remove", accountId: "acct-l" } as never);
  expect((yield* listAccounts(w)).some((row) => row.id === "acct-l")).toBe(false);
}));
