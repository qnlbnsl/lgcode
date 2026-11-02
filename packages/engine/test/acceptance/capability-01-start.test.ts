// Capability 1 (spec "How the engine is judged finished"): the caller chooses
// the harness, account, model, effort, permission mode, folder, name, role and
// group, and gets back the agent's id. Criteria 8.3 to 8.5.
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { eventsUntil, isTag, peekEcho, promptsOf, refusal, requestId, scenario, stopAllServices, tagged } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("1 start: every choice the owner makes is recorded and reaches the harness, and the id returned names the agent (breaks if start drops or renames a choice, or returns another id)", (w) => Effect.gen(function* () {
  const before = yield* w.watermark();
  const agent = yield* w.start(w.owner, {
    name: "Builder One", role: "builder", groups: ["alpha", "beta"], model: "model-large", effort: "high",
    permission: "edit", prompt: "Build the thing.",
  });
  const events = yield* eventsUntil(w.owner, before, "the first turn to end", isTag("TurnEnded", agent.agentId));
  const started = tagged(events, "AgentStarted");
  expect(started).toHaveLength(1);
  expect(started[0]!.agentId).toBe(agent.agentId);
  expect(started[0]!.event).toMatchObject({
    name: "Builder One", role: "builder", groups: ["alpha", "beta"], harness: "fake",
    account: agent.accountId, model: "model-large", effort: "high", permission: "edit",
    folder: w.root.work, runMode: "acp", parent: { _tag: "owner" },
  });
  expect(tagged(events, "SessionOpened", agent.agentId)).toHaveLength(1);

  // The harness received the choices, in the order the spec's start sequence
  // gives them, and the prompt as the owner wrote it.
  const echo = peekEcho(agent.echo)!;
  const methods = echo.inbound.map((frame) => frame.method);
  expect(methods.indexOf("session/new")).toBeGreaterThan(methods.indexOf("initialize"));
  expect(methods.indexOf("session/prompt")).toBeGreaterThan(methods.indexOf("session/new"));
  const configured = echo.inbound.filter((frame) => frame.method === "session/set_config_option").map((frame) => frame.params);
  expect(configured).toEqual(expect.arrayContaining([
    expect.objectContaining({ configId: "model", value: "model-large" }),
    expect.objectContaining({ configId: "effort", value: "high" }),
    expect.objectContaining({ configId: "mode", value: "accept-edits" }),
  ]));
  expect((echo.inbound.find((frame) => frame.method === "session/new")!.params as { cwd: string }).cwd).toBe(w.root.work);
  expect(promptsOf(echo)).toEqual(["Build the thing."]);
}));

scenario("1 start: a start the engine cannot honour is refused with a reason and starts nothing (breaks if an unknown model, harness or account still creates an agent)", (w) => Effect.gen(function* () {
  const good = yield* w.start(w.owner, { name: "Good", prompt: "Hello." });
  yield* eventsUntil(w.owner, 0, "the first agent's turn", isTag("TurnEnded", good.agentId));
  const before = yield* w.watermark();

  const unknownModel = yield* refusal(w.start(w.owner, { name: "Bad model", model: "no-such-model" }));
  expect(unknownModel).toBe("command refused");
  // Started directly: the harness's start helper would register the unknown harness itself.
  const unknownHarness = yield* refusal(w.owner.start({
    requestId: requestId(), name: "Bad harness", role: "worker", harness: "no-such-harness", account: { _tag: "any" },
    permission: "ask", folder: w.root.work, runMode: "acp", groups: [],
  } as never));
  expect(unknownHarness).toBeDefined();
  expect(unknownHarness).not.toMatch(/^not a refusal/);
  const unknownAccount = yield* refusal(w.owner.start({
    requestId: requestId(), name: "Bad account", role: "worker", harness: "fake", account: { _tag: "named", accountId: "nobody" },
    permission: "ask", folder: w.root.work, runMode: "acp", groups: [],
  } as never));
  expect(unknownAccount).toBeDefined();
  const relative = yield* refusal(w.start(w.owner, { name: "Relative", folder: "relative/folder" }));
  expect(relative).toBeDefined();

  // None of the refused starts opened an agent (counted after the watermark).
  const after = yield* w.watermark();
  const events = after > before ? yield* eventsUntil(w.owner, before, "the refusals", (e) => e.sequence >= after) : [];
  expect(tagged(events, "AgentStarted")).toHaveLength(0);
}));
