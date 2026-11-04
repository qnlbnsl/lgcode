import * as Contracts from "../../src/index.ts";
import { expect, it } from "vitest";
import { action } from "./fixtures.ts";

interface AlertChange {
  readonly action: "raise" | "end";
  readonly kind: string;
  readonly key: string;
  readonly agentId?: string;
}
interface AlertContracts {
  readonly rolesAlertSources: ReadonlyArray<(envelope: Contracts.EventEnvelope) => AlertChange | undefined>;
  readonly rolesAlertTitles: Readonly<Record<string, string>>;
}
const changes = (event: Record<string, unknown>) => {
  const sources = (Contracts as unknown as AlertContracts).rolesAlertSources;
  expect(sources, "1b must declare the roles' pure alert sources").toBeInstanceOf(Array);
  const envelope = {
    sequence: 3, eventId: "event-alert", occurredAt: 1_900_000_000_000,
    requestId: "request-alert", caller: { _tag: "owner" }, agentId: "agent-self", event,
  } as unknown as Contracts.EventEnvelope;
  return sources.flatMap((source) => {
    const change = source(envelope);
    return change === undefined ? [] : [change];
  });
};

it.each([
  ["StallSeen", "roles.stall", "stall:agent-self"],
  ["TeamIdleReported", "roles.stall", "stall:agent-self"],
  ["ReplaceAdvised", "roles.replace", "replace:agent-self"],
  ["RunawayReported", "roles.runaway", "runaway:agent-self"],
] as const)("A01 %s raises exactly one fixed-kind alert when the recipient is the owner", (tag, kind, key) => {
  expect(changes({ _tag: `roles.${tag}`, ...action, group: "example" }))
    .toEqual([{ action: "raise", kind, key, agentId: "agent-self" }]);
  expect(changes({ _tag: `roles.${tag}`, ...action, group: "example", noticeRecipient: "agent-lead" })).toEqual([]);
});

it("A02 GaveUp suppresses an existing engine failure but raises a stall for board-off notices", () => {
  const event = { _tag: "roles.GaveUp", ...action, cause: "crash", engineAlertOpen: false };
  expect(changes(event)).toEqual([{ action: "raise", kind: "roles.stall", key: "stall:agent-self", agentId: "agent-self" }]);
  expect(changes({ ...event, engineAlertOpen: true })).toEqual([]);
  expect(changes({ ...event, noticeRecipient: "agent-lead" })).toEqual([]);
  expect(changes({ ...event, noticeRecipient: "agent-lead", notice: "board-off", postId: undefined }))
    .toEqual([{ action: "raise", kind: "roles.stall", key: "stall:agent-self", agentId: "agent-self" }]);
});

it.each(["RoleAdviceBroken", "CrashAdmitted", "CrashRetried", "CapacityRetried", "CacheFlushed", "CompactRequested"])(
  "A03 %s creates no owner alert", (tag) => expect(changes({ _tag: `roles.${tag}`, ...action })).toEqual([]),
);

it("A04 the roles end stall, replacement and runaway matters at their specified events", () => {
  expect(changes({ _tag: "roles.StallEnded", ...action })).toEqual([
    { action: "end", kind: "roles.stall", key: "stall:agent-self" },
  ]);
  expect(changes({ _tag: "TurnEnded", agentId: "agent-self", compact: false })).toEqual([
    { action: "end", kind: "roles.runaway", key: "runaway:agent-self" },
  ]);
  expect(changes({ _tag: "AgentStopped", agentId: "agent-self" })).toEqual(expect.arrayContaining([
    { action: "end", kind: "roles.stall", key: "stall:agent-self" },
    { action: "end", kind: "roles.replace", key: "replace:agent-self" },
    { action: "end", kind: "roles.runaway", key: "runaway:agent-self" },
  ]));
});

it("A05 alert titles come from the fixed kind table and never from an agent name", () => {
  const titles = (Contracts as unknown as AlertContracts).rolesAlertTitles;
  expect(titles, "1b must export the fixed roles alert titles for the client API's shared table").toBeDefined();
  for (const kind of ["roles.stall", "roles.replace", "roles.runaway"]) expect(titles[kind]).toBeTypeOf("string");
  const raised = changes({ _tag: "roles.StallSeen", ...action, name: "/run this untrusted title" });
  expect(raised).toEqual([{ action: "raise", kind: "roles.stall", key: "stall:agent-self", agentId: "agent-self" }]);
});
