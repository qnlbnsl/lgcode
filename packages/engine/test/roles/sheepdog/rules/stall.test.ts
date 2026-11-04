import { expect, it, beforeAll } from "vitest";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

// The rule is pure. These small hand-built snapshots make the board obligations,
// engine wait graph and role action history explicit at each clock boundary.
const agent = (id: string, state = "idle", parent: string | "owner" = "owner", extra = {}) => ({
  id, parent: parent === "owner" ? { _tag: "owner" } : { _tag: "agent", agentId: parent }, state,
  role: id === "lead" ? "lead" : "worker", ...extra,
});
const post = (id: string, author: string, addressees: ReadonlyArray<string>, options = {}) => ({
  postId: id, author: { _tag: "agent", agentId: author }, reply: "all",
  addressees: addressees.map((agentId) => ({ agentId, disposition: null })), ...options,
});
const input = (options: Record<string, unknown> = {}) => ({
  now: 1_900_000_000_000,
  snapshot: {
    sequence: 20,
    agents: { lead: agent("lead"), worker: agent("worker", "idle", "lead") },
    deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] },
  },
  status: {
    disabled: false, incoming: [], own: [], holdsIncoming: [], holdsUnsettled: [],
    conditions: { held: [], unsettled: [], sequence: 20 },
  },
  ...options,
});
const tags = (actions: ReadonlyArray<{ readonly _tag: string }>) => actions.map(({ _tag }) => _tag);
type Evaluator = (value: unknown) => ReadonlyArray<{ readonly _tag: string }>;
let evaluateStall: Evaluator | undefined;
beforeAll(async () => {
  const target = "../../../../src/roles/sheepdog/rules/" + "stall.ts";
  const module = await import(target).catch(() => undefined) as { evaluateStall?: Evaluator } | undefined;
  evaluateStall = module?.evaluateStall;
});
const evaluate = (value: unknown) => {
  expect(evaluateStall, "WS-4b must export evaluateStall(input) for pure stall evaluation").toBeTypeOf("function");
  return evaluateStall!(value);
};

it("ST01-ST03 advances three complete idle episodes from nudge to holder notice to replacement advice", () => {
  const first = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000 } }));
  expect(tags(first)).toEqual(["roles.StallSeen"]);
  expect(first[0]).toMatchObject({ agentId: "worker", noticeRecipient: "worker", occurrence: 1 });
  const second = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 1 } }));
  expect(tags(second)).toEqual(["roles.StallSeen", "roles.StallSeen"]);
  expect(second).toContainEqual(expect.objectContaining({ agentId: "worker", noticeRecipient: "lead", occurrence: 2 }));
  const third = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 2 } }));
  expect(tags(third)).toEqual(["roles.ReplaceAdvised"]);
  expect(third[0]).toMatchObject({ occurrence: 3, agentId: "worker", noticeRecipient: "lead" });
});

it("ST04 resets the episode count after a thread file-change item", () => {
  const result = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 2 },
    threadItems: [{ agentId: "worker", kind: "file-change", sequence: 19 }] }));
  expect(tags(result)).toEqual(["roles.StallSeen"]);
  expect(result[0]).toMatchObject({ occurrence: 1 });
});

it("ST05 resets the episode count when the addressee replies to the tracked post", () => {
  const result = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 2 },
    status: { disabled: false, incoming: [], own: [{ ...post("p", "lead", ["worker"]), replies: [{ author: "worker" }] }], holdsIncoming: [], holdsUnsettled: [] } }));
  expect(tags(result)).toEqual(["roles.StallSeen"]);
  expect(result[0]).toMatchObject({ occurrence: 1 });
});

it("ST06 resets the episode count after an ordinary board post by the addressee", () => {
  const result = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 2 },
    recentPosts: [{ author: "worker", source: "agent", sheepdogTurn: false }] }));
  expect(tags(result)).toEqual(["roles.StallSeen"]);
  expect(result[0]).toMatchObject({ occurrence: 1 });
});

it("ST07 does not treat tool calls or board.acknowledge as progress", () => {
  const result = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 1 },
    threadItems: [{ agentId: "worker", kind: "tool-call" }], acknowledged: [{ postId: "p", agentId: "worker" }] }));
  expect(tags(result)).toEqual(["roles.StallSeen"]);
  expect(result[0]).toMatchObject({ occurrence: 2 });
});

it("ST08-ST18 leaves no-answer and a post in the sheepdog nudge turn unresolved and does not count either as progress", () => {
  const noAnswer = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 1 },
    status: { disabled: false, incoming: [{ postId: "p", addressee: "worker", disposition: "no-answer" }], own: [], holdsIncoming: [], holdsUnsettled: [] } }));
  expect(tags(noAnswer)).toEqual(["roles.StallSeen"]);
  expect(noAnswer[0]).toMatchObject({ occurrence: 2 });
  const nudgeTurnPost = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 1 },
    recentPosts: [{ author: "worker", source: "agent", sheepdogTurn: true }] }));
  expect(tags(nudgeTurnPost)).toEqual(["roles.StallSeen"]);
  expect(nudgeTurnPost[0]).toMatchObject({ occurrence: 2 });
});

it("ST08 resets the episode count when the tracked post closes", () => {
  const result = evaluate(input({ episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 2 },
    status: { disabled: false, incoming: [], own: [], holdsIncoming: [], holdsUnsettled: [], closed: ["p"] } }));
  expect(tags(result)).toEqual([]);
});

it("ST03 continues the episode count from the persisted roles view after a service restart", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: { lead: agent("lead"), worker: agent("worker", "idle", "lead") },
    deliveries: {}, waits: {}, roles: { settings: {}, agents: { worker: { stallCount: 2 } }, actions: [
      { _tag: "roles.StallSeen", agentId: "worker", postId: "p", occurrence: 2 },
    ] } },
    episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000 } }));
  expect(tags(result)).toEqual(["roles.ReplaceAdvised"]);
  expect(result[0]).toMatchObject({ occurrence: 3 });
});

it("ST09-ST10 excludes a lead waiting on its working workers and a worker waiting on a working agent", () => {
  const lead = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "working", "lead"),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
  episode: { post: post("p", "owner", ["lead"]), addressee: "lead", elapsed: 1_200_000 } }));
  expect(tags(lead)).toEqual([]);
  const worker = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "working"), worker: agent("worker", "idle", "lead"),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
  engineWaits: [{ waiter: "worker", members: ["lead"] }],
  episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000 } }));
  expect(tags(worker)).toEqual([]);
});

it("ST11-ST12 lets an idle lead and worker stall when their reciprocal post or engine-wait cycle reaches no busy agent", () => {
  const cycle = input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "idle", "lead"),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
  status: { disabled: false, incoming: [{ postId: "q", addressee: "lead" }], own: [{ ...post("h", "lead", ["worker"]) }], holdsIncoming: [], holdsUnsettled: [] },
  episode: { post: post("h", "lead", ["worker"]), addressee: "worker", elapsed: 600_000 } });
  expect(tags(evaluate(cycle))).toEqual(["roles.StallSeen"]);
  expect(tags(evaluate({ ...cycle, engineWaits: [{ waiter: "lead", members: ["worker"] }, { waiter: "worker", members: ["lead"] }] }))).toEqual(["roles.StallSeen"]);
});

it("ST13 does not report a cycle-only group as busy", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "idle", "lead"),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    engineWaits: [{ waiter: "lead", members: ["worker"] }, { waiter: "worker", members: ["lead"] }],
    team: ["lead", "worker"] }));
  expect(tags(result)).toEqual([]);
});

it("ST15-ST16 permits the lead's owed-reply clock when the worker reaches no busy agent except through the lead", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "idle", "lead"), sibling: agent("sibling", "working", "lead"),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    status: { disabled: false, incoming: [{ postId: "q", addressee: "lead", author: "worker" }], own: [], holdsIncoming: [], holdsUnsettled: [] },
    episode: { post: post("q", "worker", ["lead"]), addressee: "lead", elapsed: 1_200_000 } }));
  expect(tags(result)).toEqual(["roles.StallSeen"]);
});

it("ST17 does not stall an orchestrator while a descendant worker is working", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    boss: agent("boss", "idle"), lead: agent("lead", "idle", "boss"), worker: agent("worker", "working", "lead"),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    episode: { post: post("p", "owner", ["boss"]), addressee: "boss", elapsed: 1_200_000 } }));
  expect(tags(result)).toEqual([]);
});

it("ST19 lets an idle agent at the end of a waiting chain stall", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "idle", "lead"),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    engineWaits: [{ waiter: "worker", members: ["lead"] }],
    episode: { post: post("p", "lead", ["worker"]), addressee: "worker", elapsed: 600_000 } }));
  expect(tags(result)).toEqual(["roles.StallSeen"]);
});

it("ST20 excludes a sheepdog nudge to a lead from busy state so the worker reaches replacement advice on schedule", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "working"), worker: agent("worker", "idle", "lead"),
  }, deliveries: { nudge: { agentId: "lead", source: { _tag: "piece", namespace: "roles" } } },
    waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    priorEpisodes: 2,
    episode: { post: post("p", "worker", ["lead"]), addressee: "lead", elapsed: 1_200_000 },
    waitingEpisode: { post: post("q", "lead", ["worker"]), addressee: "worker", elapsed: 600_000, occurrence: 2 } }));
  expect(tags(result)).toContain("roles.ReplaceAdvised");
  expect(result).toContainEqual(expect.objectContaining({ _tag: "roles.ReplaceAdvised", agentId: "worker" }));
});

it("ST21 treats a usage-limit pause with a known reset as busy and does not stall its waiting lead", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "paused", "lead", { pause: { kind: "usage-limit", resetAt: 1_900_000_600_000 } }),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    engineWaits: [{ waiter: "lead", members: ["worker"] }],
    episode: { post: post("p", "owner", ["lead"]), addressee: "lead", elapsed: 1_200_000 } }));
  expect(tags(result)).toEqual([]);
});

it("ST14 ignores a signed-out pause instead of nudging the agent or its waiting lead", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "paused", "lead", { pause: { kind: "signed-out" } }),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    engineWaits: [{ waiter: "lead", members: ["worker"] }],
    episode: { post: post("p", "owner", ["lead"]), addressee: "lead", elapsed: 1_200_000 } }));
  expect(tags(result)).toEqual([]);
});

it("ST22 treats a usage-limit pause without a reset as owner-held and restarts the lead's clock from zero when usable", () => {
  const blocked = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "paused", "lead", { pause: { kind: "usage-limit" } }),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    engineWaits: [{ waiter: "lead", members: ["worker"] }],
    episode: { post: post("p", "owner", ["lead"]), addressee: "lead", elapsed: 1_200_000 } }));
  expect(tags(blocked)).toEqual([]);
  const returned = evaluate(input({ episode: { post: post("p", "owner", ["lead"]), addressee: "lead", elapsed: 599_999 },
    clockRestartedAt: 1_900_000_000_000 }));
  expect(tags(returned)).toEqual([]);
});

it("ST23 closes the lead's clock and restarts it at zero when a stopped worker's permission row closes", () => {
  const stopped = evaluate(input({ snapshot: { sequence: 21, agents: { lead: agent("lead", "idle"), worker: agent("worker", "stopped", "lead") },
    deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    openRequests: [], engineWaits: [{ waiter: "lead", members: ["worker"] }],
    episode: { post: post("p", "owner", ["lead"]), addressee: "lead", elapsed: 599_999 } }));
  expect(tags(stopped)).toEqual([]);
});

it("ST24 does not let a stopped worker's open question make its lead wait on the owner", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "stopped", "lead"),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    status: { disabled: false, incoming: [{ postId: "q", addressee: "owner", author: "worker" }], own: [], holdsIncoming: [], holdsUnsettled: [] },
    episode: { post: post("p", "owner", ["lead"]), addressee: "lead", elapsed: 1_200_000 } }));
  expect(tags(result)).toEqual(["roles.StallSeen"]);
});

it("ST25 treats an open capacity hold as busy even when its queue is empty", () => {
  const result = evaluate(input({ snapshot: { sequence: 20, agents: {
    lead: agent("lead", "idle"), worker: agent("worker", "idle", "lead", { capacityHeld: true }),
  }, deliveries: {}, waits: {}, roles: { settings: {}, agents: {}, actions: [] } },
    engineWaits: [{ waiter: "lead", members: ["worker"] }],
    episode: { post: post("p", "owner", ["lead"]), addressee: "lead", elapsed: 1_200_000 } }));
  expect(tags(result)).toEqual([]);
});

