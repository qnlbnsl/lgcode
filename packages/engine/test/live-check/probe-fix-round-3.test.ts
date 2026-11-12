import { rmSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, expect, it, vi } from "vitest";
import { liveProbeDriver, probeCommands } from "../../scripts/live/liveProbes.ts";
import { main, dryRunText } from "../../scripts/live/run.ts";
import { SLASH_DOWN_PROMPT, SLASH_UP_PROMPT } from "../../scripts/live/prompts.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { fakeEngine, LEAD, WORKER, markerIn, ONCE, ALWAYS, REJECT, runProbe, type FakeEngine } from "./probe-fake-engine.ts";
import { scriptedApi } from "./scripted-api.ts";

vi.mock("@lgtm/client", async (original) => {
  const client = await original<typeof import("@lgtm/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...client, connect: (options: Parameters<typeof client.connect>[0]) => (fakeConnect(options) ?? client.connect(options)) as never };
});
registerRebuildCheck({ noLog: true });
const engines: FakeEngine[] = [];
const fixtures: ReturnType<typeof scriptedApi>[] = [];
const make = (setup: Parameters<typeof fakeEngine>[0] = {}) => { const e = fakeEngine(setup); engines.push(e); return e; };
const api = (fault: Parameters<typeof scriptedApi>[0] = {}) => { const a = scriptedApi(fault); fixtures.push(a); return a; };
afterEach(() => { for (const e of engines.splice(0)) e.cleanup(); for (const a of fixtures.splice(0)) a.dispose(); });

it("issue 238: a failed sandbox probe does not prevent later probes or final, but skips recording by dependency and exits 1", async () => {
  const a = api({ step: "sandbox-mcp" });
  expect(await main([], a.deps)).toBe(1);
  expect(a.lines.find((l) => l.startsWith("FAIL sandbox-mcp:"))).toBeDefined();
  for (const id of ["permission-kinds", "removed-variables", "state-read", "slash-up", "slash-down", "always-allow", "reload", "token-scan", "final"]) {
    expect(a.lines.find((l) => l.startsWith(`PASS ${id}:`)), id).toBeDefined();
  }
  expect(a.lines.find((l) => l.startsWith("SKIP recording:"))).toContain("sandbox-mcp");
  expect(a.calls).not.toContain("record");
  expect(a.stopCount).toBe(1);
});

it("issue 238: a probe with unavailable own preconditions is skipped by name, while an independent later probe still runs", async () => {
  const a = api({ step: "sandbox-mcp" });
  const probes = { ...a.deps.probes!, unavailable: (id: string) => Effect.succeed(id === "slash-up" ? "agent lead is working, not idle" : undefined) };
  expect(await main([], { ...a.deps, probes })).toBe(1);
  expect(a.lines.find((l) => l.startsWith("SKIP slash-up:"))).toContain("agent lead is working, not idle");
  expect(a.lines.find((l) => l.startsWith("SKIP slash-up:"))).toContain("sandbox-mcp");
  expect(a.lines.find((l) => l.startsWith("PASS slash-down:"))).toBeDefined();
  expect(a.lines.find((l) => l.startsWith("PASS final:"))).toBeDefined();
});

it("issue 238: final still detects a secret after a probe failed", async () => {
  const a = api({ step: "sandbox-mcp", leak: "output" });
  expect(await main([], a.deps)).toBe(1);
  expect(a.lines.find((l) => l.startsWith("FAIL final:"))).toContain("credential or secret was found");
  expect(a.lines.join("\n")).not.toContain(a.secret);
  expect(a.calls).not.toContain("record");
});

it("the dry run explains the startup hard stops, independent probes, final and recording dependency", () => {
  const text = dryRunText();
  expect(text).toContain("Only startup-hook, service, setup, lead and worker-start are hard stops");
  expect(text).toContain("Other journey failures are recorded and independent steps still run");
  expect(text).toContain("sandbox-mcp through token-scan continue after a journey or probe failure");
  expect(text).toContain("final still runs after a journey or probe failure");
  expect(text).toContain("recording requires every earlier step to pass");
});

it.each([false, true])("issue 239: an exact failed MCP call is an attempt; permission observed=%s; its error is bounded and redacted", async (permission) => {
  const e = make();
  const pending = new Map<string, { agent: string; call: string }>();
  const fail = (engine: FakeEngine, agent: string, call: string) => {
    engine.finish(agent, call, "failed", JSON.stringify({ result: null, error: { message: `user cancelled MCP tool call; ${engine.tokenOf.get(agent)}; api_key=synthetic-private-key-123456 ${"x".repeat(1000)}` } }));
    engine.turnEnded(agent);
  };
  e.script = { onPrompt: (engine, p) => {
    const call = `mcp-${p.deliveryId}`;
    engine.tool(p.agentId, call, { server: "lgtm", tool: "ask", arguments: { text: markerIn(p.text) } }, "mcp.lgtm.ask");
    if (permission) pending.set(engine.permission(p.agentId, call, [ONCE, REJECT]), { agent: p.agentId, call });
    else fail(engine, p.agentId, call);
  }, onAnswer: (engine, answer) => { const p = pending.get(answer.id)!; fail(engine, p.agent, p.call); } };
  const result = await runProbe(e, "sandbox-mcp");
  expect(result.passed).toBe(false);
  expect(result.rows).toHaveLength(2);
  for (const row of result.rows) {
    expect(row.outcome).toBe(permission ? "attempted; failed" : "attempted; the adapter cancelled the call before LGTM Studio saw a permission request (see issue 236)");
    expect(row.detail).toContain("user cancelled MCP tool call");
    expect(row.detail).not.toContain("synthetic-private-key-123456");
    for (const token of e.tokenOf.values()) expect(row.detail).not.toContain(token);
    expect(row.detail.length).toBeLessThan(1100);
  }
});

it.each(["removed-variables", "state-read"] as const)("issue 239: %s exact command failure is reported as attempted with its error", async (id) => {
  const e = make({ shellListing: false });
  e.script = { onPrompt: (engine, p) => {
    const call = `shell-${p.deliveryId}`;
    engine.tool(p.agentId, call, { command: id === "state-read" ? probeCommands(e.state).stateRead : probeCommands(e.state).removedVariables });
    engine.finish(p.agentId, call, "failed", id === "state-read" ? "cat: cannot execute: resource unavailable" : "the engine refused this identity (HTTP 403)\nLCP_EXIT=1\n");
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, id);
  expect(result.passed).toBe(false);
  expect(result.rows.find((r) => r.harness === "codex")?.outcome).toBe("attempted; failed");
  expect(result.rows.find((r) => r.harness === "codex")?.detail).toContain(id === "state-read" ? "resource unavailable" : "HTTP 403");
});

it.each([{ options: [] }, { options: [{ ...ONCE, level: "full" }] }])("issue 239: invalid observed permission metadata $options was attempted and failed", async ({ options }) => {
  const e = make();
  for (const agent of [LEAD, WORKER]) e.permission(agent, "call", options);
  const result = await runProbe(e, "permission-kinds");
  expect(result.passed).toBe(false);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every((r) => r.outcome === "attempted; failed")).toBe(true);
});

it("issue 239: an approved persistent command without a saved scope was attempted and failed", async () => {
  const e = make();
  let pending: { agent: string; call: string };
  e.script = { onPrompt: (engine, p) => {
    pending = { agent: p.agentId, call: `persistent-${p.deliveryId}` };
    engine.tool(p.agentId, pending.call, { command: probeCommands(e.state).alwaysAllow });
    engine.permission(p.agentId, pending.call, [ALWAYS, ONCE, REJECT]);
  }, onAnswer: (engine) => { engine.finish(pending.agent, pending.call, "failed", "settings write failed"); engine.turnEnded(pending.agent); } };
  const result = await runProbe(e, "always-allow");
  expect(result.passed).toBe(false);
  expect(result.rows[0]?.outcome).toBe("attempted; failed");
  expect(result.rows[0]?.detail).toContain("settings write failed");
});

it.each(["slash-up", "slash-down"] as const)("issue 239: %s sent the payload but did not observe its escaped receipt", async (id) => {
  const e = make();
  e.script = { onPrompt: (engine, p) => { expect([SLASH_UP_PROMPT, SLASH_DOWN_PROMPT].includes(p.text) || p.text.startsWith("The next prompt")).toBe(true); engine.turnEnded(p.agentId); } };
  const result = await runProbe(e, id);
  expect(result.passed).toBe(false);
  expect(result.rows.find((r) => r.harness === (id === "slash-up" ? "claude" : "codex"))?.outcome).toBe("attempted; failed");
});

it("issue 238: live readiness checks the service, real own processes and lifecycle, using only needed agents", async () => {
  const e = make();
  for (const agentId of [LEAD, WORKER]) {
    e.emit(agentId, { _tag: "AgentStarted", agentId, name: agentId, role: "worker", groups: [], parent: { _tag: "owner" }, harness: agentId === LEAD ? "claude" : "codex", account: "test", permission: "ask", folder: agentId === LEAD ? e.work : join(e.work, "project"), runMode: "acp" });
    e.emit(agentId, { _tag: "SessionOpened", agentId, session: { sessionId: "test" } });
  }
  const options = e.options();
  const driver = liveProbeDriver(options);
  expect(driver.unavailable).toBeTypeOf("function");
  const given = { lead: { agentId: LEAD }, worker: { agentId: WORKER } };
  const ready = (id: Parameters<typeof driver.observe>[0]) => Effect.runPromise(Effect.scoped(driver.unavailable!(id, given)));
  expect(await ready("sandbox-mcp")).toBeUndefined();
  e.emit(WORKER, { _tag: "StateChanged", agentId: WORKER, state: { _tag: "working" } });
  expect(await ready("state-read")).toContain("agent-worker is working, not idle");
  expect(await ready("always-allow")).toBeUndefined();
  expect(await ready("permission-kinds")).toBeUndefined();
  e.emit(WORKER, { _tag: "StateChanged", agentId: WORKER, state: { _tag: "idle" } });
  e.kill(WORKER);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await ready("sandbox-mcp")).toContain("no live process");
  const stopped = liveProbeDriver({ ...options, service: () => ({ ...options.service(), exited: () => true }) });
  expect(await Effect.runPromise(Effect.scoped(stopped.unavailable!("permission-kinds", given)))).toContain("service");
  const unreachable = liveProbeDriver({ ...options, openOwner: () => Effect.fail(new Error("credential=do-not-print-this")) });
  const reason = await Effect.runPromise(Effect.scoped(unreachable.unavailable!("permission-kinds", given)));
  expect(reason).toContain("service did not answer");
  expect(reason).not.toContain("do-not-print-this");
});


it("issue 238: each probe closes its acquired resources before the next probe runs, including on failure", async () => {
  const a = api({ step: "sandbox-mcp" });
  const active = new Set<string>();
  const seen: string[] = [];
  const original = a.deps.probes!;
  const probes = { observe: (id: Parameters<typeof original.observe>[0], given: Parameters<typeof original.observe>[1]) => Effect.gen(function* () {
    expect([...active]).toEqual([]);
    yield* Effect.acquireRelease(Effect.sync(() => { active.add(id); seen.push(id); }), () => Effect.sync(() => { active.delete(id); }));
    return yield* original.observe(id, given);
  }) };
  expect(await main([], { ...a.deps, probes })).toBe(1);
  expect(seen).toEqual(["sandbox-mcp", "removed-variables", "state-read", "slash-up", "slash-down", "always-allow", "permission-kinds", "reload", "token-scan"]);
  expect([...active]).toEqual([]);
});

it("issue 238: a final reconnect failure after a probe failure is recorded as final, with recording skipped", async () => {
  const a = api({ step: "sandbox-mcp" });
  let connections = 0;
  const connectOwner: typeof a.deps.connectOwner = (state) => ++connections > 4
    ? Effect.fail(new Error("service unavailable for final")) : a.deps.connectOwner(state);
  expect(await main([], { ...a.deps, connectOwner })).toBe(1);
  expect(a.lines.find((l) => l.startsWith("FAIL final:"))).toContain("service unavailable for final");
  expect(a.lines.some((l) => l.startsWith("FAIL journey:"))).toBe(false);
  expect(a.lines.find((l) => l.startsWith("SKIP recording:"))).toContain("final");
});

it("issue 239: declining the persistent command still records not attempted", async () => {
  const e = make();
  const result = await runProbe(e, "always-allow");
  expect(result.passed).toBe(false);
  expect(result.rows[0]?.outcome).toBe("not attempted");
});


it("issue 239: a different failed MCP error without permission evidence does not claim adapter cancellation", async () => {
  const e = make();
  e.script = { onPrompt: (engine, p) => {
    const call = `mcp-${p.deliveryId}`;
    engine.tool(p.agentId, call, { server: "lgtm", tool: "ask", arguments: { text: markerIn(p.text) } }, "mcp.lgtm.ask");
    engine.finish(p.agentId, call, "failed", "adapter connection unavailable");
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, "sandbox-mcp");
  expect(result.passed).toBe(false);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every((r) => r.outcome === "attempted; failed" && r.detail.includes("adapter connection unavailable"))).toBe(true);
});

it("issue 239: a missing session file after the slash was sent fails as attempted", async () => {
  const e = make();
  e.script = { onPrompt: (engine, p) => {
    if (p.text === SLASH_DOWN_PROMPT) rmSync(engine.sessionFile("codex"));
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, "slash-down");
  expect(result.passed).toBe(false);
  expect(result.reason).toContain("attempted; failed: no codex session file");
});
