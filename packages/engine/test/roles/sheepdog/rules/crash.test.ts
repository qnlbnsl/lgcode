import { expect, it } from "vitest";
import { evaluateCrash } from "../../../../src/roles/sheepdog/rules/crash.ts";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const crash = { _tag: "AgentCrashed", agentId: "worker", sequence: 17, occurredAt: 1_900_000_000_000 };
const context = (options: Record<string, unknown> = {}) => ({
  event: crash,
  now: crash.occurredAt,
  agents: { worker: { agentId: "worker", role: "worker", parent: { _tag: "agent", agentId: "lead" }, state: { _tag: "crashed" }, crashSequence: 17 } },
  roles: { settings: {}, agents: {}, actions: [] },
  client: { alerts: [] },
  ...options,
});

it("CR01 admits the current first crash and records it before the resume step", () => {
  const actions = evaluateCrash(context() as any);

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ _tag: "roles.CrashAdmitted", agentId: "worker", triggerSequence: 17 });
});

it("CR02 skips a crash that is no longer current when the rule checks it", () => {
  const actions = evaluateCrash(context({
    agents: { worker: { agentId: "worker", state: { _tag: "idle" }, crashSequence: 17 } },
  }) as any);

  expect(actions).toEqual([]);
});

it("CR03 gives up immediately when automatic crash retries are disabled", () => {
  const actions = evaluateCrash(context({ roles: { settings: { crashRetries: 0 }, agents: {}, actions: [] } }) as any);

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    _tag: "roles.GaveUp", agentId: "worker", cause: "crash", noticeRecipient: "lead",
  });
});

it("CR04 does not admit a second crash within the retry window", () => {
  const actions = evaluateCrash(context({ roles: {
    settings: {},
    agents: { worker: { crashRetries: 1 } },
    actions: [{ _tag: "roles.CrashAdmitted", agentId: "worker", triggerSequence: 8, sourceSequence: 8, occurrence: 1 }],
  } }) as any);

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ _tag: "roles.GaveUp", cause: "crash", agentId: "worker" });
});

it("CR05 suppresses a duplicate owner alert while the engine failure alert remains open", () => {
  const actions = evaluateCrash(context({
    agents: { worker: { agentId: "worker", role: "worker", parent: { _tag: "owner" }, state: { _tag: "crashed" }, crashSequence: 17 } },
    client: { alerts: [{ kind: "failure", agentId: "worker", status: "open" }] },
    roles: { settings: { crashRetries: 0 }, agents: {}, actions: [] },
  }) as any);

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ _tag: "roles.GaveUp", noticeRecipient: "owner", engineAlertOpen: true });
});
