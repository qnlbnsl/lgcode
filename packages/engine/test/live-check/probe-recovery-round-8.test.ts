import { join } from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, expect, it, vi } from "vitest";
import { liveProbeDriver } from "../../scripts/live/liveProbes.ts";
import { main } from "../../scripts/live/run.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { fakeEngine, LEAD, WORKER, ONCE, REJECT, type FakeEngine } from "./probe-fake-engine.ts";
import { scriptedApi } from "./scripted-api.ts";

vi.mock("@shephrd/client", async (original) => {
  const client = await original<typeof import("@shephrd/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...client, connect: (options: Parameters<typeof client.connect>[0]) => (fakeConnect(options) ?? client.connect(options)) as never };
});
registerRebuildCheck({ noLog: true });
const engines: FakeEngine[] = [];
const fixtures: ReturnType<typeof scriptedApi>[] = [];
afterEach(() => { for (const e of engines.splice(0)) e.cleanup(); for (const a of fixtures.splice(0)) a.dispose(); });
const given = { lead: { agentId: LEAD }, worker: { agentId: WORKER } };
const make = () => {
  const e = fakeEngine(); engines.push(e);
  for (const agentId of [LEAD, WORKER]) {
    e.emit(agentId, { _tag: "AgentStarted", agentId, name: agentId, role: "worker", groups: [], parent: { _tag: "owner" }, harness: agentId === LEAD ? "claude" : "codex", account: "test", permission: "ask", folder: agentId === LEAD ? e.work : join(e.work, "project"), runMode: "acp" });
    e.emit(agentId, { _tag: "SessionOpened", agentId, session: { sessionId: "test" } });
  }
  return e;
};

it("failed-journey preparation denies a leftover permission, lets its wait settle, and makes both agents ready", async () => {
  const e = make();
  e.emit(WORKER, { _tag: "StateChanged", agentId: WORKER, state: { _tag: "working" } });
  const id = "old-permission";
  e.emit(WORKER, { _tag: "PermissionRequested", agentId: WORKER, permissionRequestId: id, toolCallId: "old-write", deliveryId: "old-delivery", holder: { _tag: "owner" }, description: "old write", options: [ONCE, REJECT], settingsWrite: false });
  e.emit(LEAD, { _tag: "WaitOpened", agentId: LEAD, waitId: "old-wait", members: [WORKER], mode: "all", blocking: false });
  e.script = { onAnswer: (engine, answer) => {
    expect(answer).toEqual({ id, optionId: REJECT.id });
    engine.emit(WORKER, { _tag: "PermissionAnswered", agentId: WORKER, permissionRequestId: id, answeredBy: { _tag: "owner" }, answer: { _tag: "selected", optionId: answer.optionId } });
    engine.emit(WORKER, { _tag: "StateChanged", agentId: WORKER, state: { _tag: "idle" } });
    engine.emit(LEAD, { _tag: "WaitSatisfied", agentId: LEAD, waitId: "old-wait", members: [{ agentId: WORKER, reason: "settled" }] });
  } };
  const driver = liveProbeDriver(e.options());
  expect(driver.prepare).toBeTypeOf("function");
  await Effect.runPromise(Effect.scoped(driver.prepare!(given)));
  expect(e.answers).toEqual([{ id, optionId: REJECT.id }]);
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("sandbox-mcp", given)))).toBeUndefined();
});

it("preparation never approves an old request that offers no rejection choice and remains bounded", async () => {
  const e = make();
  e.emit(WORKER, { _tag: "PermissionRequested", agentId: WORKER, permissionRequestId: "old-permission", toolCallId: "old-write", deliveryId: "old-delivery", holder: { _tag: "owner" }, description: "old write", options: [ONCE], settingsWrite: false });
  const driver = liveProbeDriver({ ...e.options(), engineTimeout: 100 });
  expect(driver.prepare).toBeTypeOf("function");
  const exit = await Effect.runPromiseExit(Effect.scoped(driver.prepare!(given)));
  expect(exit._tag).toBe("Failure");
  expect(e.answers).toEqual([]);
});

it("preparation runs after a failed journey, and its own failure still leaves probes and final to report", async () => {
  const a = scriptedApi({ workerEndsWithoutPermission: true }); fixtures.push(a);
  let preparations = 0;
  const probes = { ...a.deps.probes!, prepare: () => Effect.sync(() => { preparations++; }).pipe(Effect.andThen(Effect.fail(new Error("agents not settled")))) };
  expect(await main([], { ...a.deps, probes })).toBe(1);
  expect(preparations).toBe(1);
  expect(a.lines.some((line) => line.includes("probe preparation failed: agents not settled"))).toBe(true);
  expect(a.lines.some((line) => line.startsWith("PASS sandbox-mcp:"))).toBe(true);
  expect(a.lines.some((line) => line.startsWith("PASS final:"))).toBe(true);
});


it("a leftover wait is bounded and cannot let a new prompt-producing probe claim readiness", async () => {
  const e = make();
  e.emit(LEAD, { _tag: "WaitOpened", agentId: LEAD, waitId: "old-wait", members: [WORKER], mode: "all", blocking: false });
  const driver = liveProbeDriver({ ...e.options(), engineTimeout: 100 });
  expect((await Effect.runPromiseExit(Effect.scoped(driver.prepare!(given))))._tag).toBe("Failure");
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("sandbox-mcp", given)))).toContain("unresolved journey hold or wait");
  expect(e.answers).toEqual([]);
  expect(e.prompts).toEqual([]);
});

it("read-only evidence probes still run while a journey agent is working or no longer alive", async () => {
  const e = make();
  const driver = liveProbeDriver(e.options());
  e.emit(WORKER, { _tag: "StateChanged", agentId: WORKER, state: { _tag: "working" } });
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("token-scan", given)))).toBeUndefined();
  e.kill(WORKER);
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("token-scan", given)))).toBeUndefined();
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("permission-kinds", given)))).toBeUndefined();
});

it("a passing journey never invokes failed-journey preparation", async () => {
  const a = scriptedApi(); fixtures.push(a);
  let preparations = 0;
  const probes = { ...a.deps.probes!, prepare: () => Effect.sync(() => { preparations++; }) };
  expect(await main([], { ...a.deps, probes })).toBe(0);
  expect(preparations).toBe(0);
});


it("an idle lifecycle with a queued wake is not ready for another probe prompt", async () => {
  const e = make();
  e.emit(LEAD, { _tag: "DeliveryQueued", delivery: { id: "queued-wake", target: LEAD, sender: { _tag: "owner" }, text: "wake", source: { _tag: "wait", waitId: "old-wait" } } });
  const driver = liveProbeDriver(e.options());
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("sandbox-mcp", given)))).toContain("queued journey delivery");
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("permission-kinds", given)))).toBeUndefined();
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("token-scan", given)))).toBeUndefined();
});


it("a completed MCP ask leaves an open question but does not prevent the next probe's prompts", async () => {
  const e = make();
  e.emit(WORKER, { _tag: "QuestionAsked", agentId: WORKER, questionId: "mcp-question", holder: { _tag: "agent", agentId: LEAD }, deliveryId: "mcp-delivery", text: "probe marker" });
  const driver = liveProbeDriver(e.options());
  expect(await Effect.runPromise(Effect.scoped(driver.unavailable!("removed-variables", given)))).toBeUndefined();
});
