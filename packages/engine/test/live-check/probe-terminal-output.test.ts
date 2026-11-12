import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { probeCommands } from "../../scripts/live/liveProbes.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { fakeEngine, LEAD, runProbe, type FakeEngine } from "./probe-fake-engine.ts";

vi.mock("@lgtm/client", async (original) => {
  const client = await original<typeof import("@lgtm/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...client, connect: (options: Parameters<typeof client.connect>[0]) => (fakeConnect(options) ?? client.connect(options)) as never };
});
registerRebuildCheck({ noLog: true });
const engines: FakeEngine[] = [];
const make = () => { const engine = fakeEngine({ shellListing: false }); engines.push(engine); return engine; };
afterEach(() => { for (const engine of engines.splice(0)) engine.cleanup(); });
const output = (text: string, exitCode?: number) => JSON.stringify({ terminalId: "terminal", output: text, truncated: false, ...(exitCode === undefined ? {} : { exitCode }) });

it("issue 242: state-read uses the final terminal snapshot from the tool update, not a session or model claim", async () => {
  const engine = make();
  engine.script = { onPrompt: (e, p) => {
    const canary = readFileSync(join(e.state, "live-canary"), "utf8");
    e.tool(p.agentId, "read", { command: probeCommands(e.state).stateRead });
    e.finish(p.agentId, "read", "in_progress", output(canary.slice(0, 10)));
    e.finish(p.agentId, "read", "completed", output(canary + "\n", 0));
    e.turnEnded(p.agentId);
  } };
  const result = await runProbe(engine, "state-read");
  expect(result.passed).toBe(true);
  expect(result.rows.map((row) => row.outcome)).toEqual(["no mechanism: the agent read the canary file", "no mechanism: the agent read the canary file"]);
});

it("issue 242: a complete terminal snapshot replaces partial listings and carries its numeric exit code", async () => {
  const engine = make();
  engine.script = { onPrompt: (e, p) => {
    e.tool(p.agentId, "env", { command: probeCommands(e.state).removedVariables });
    e.finish(p.agentId, "env", "in_progress", output("LCP_ENV_BEGIN\nPA"));
    e.finish(p.agentId, "env", "failed", output("LCP_ENV_BEGIN\nPATH\nLCP_ENV_END\nthe engine refused this identity (HTTP 403)\n", 1));
    e.turnEnded(p.agentId);
  } };
  const result = await runProbe(engine, "removed-variables");
  expect(result.passed).toBe(true);
  expect(result.rows.every((row) => row.outcome === "refused by ancestry check")).toBe(true);
  expect(result.rows[1]?.detail).toContain("shell identity variable names=absent");
});

it("issue 243: an observed socket ownership rejection is not observable and remains a failed ancestry probe", async () => {
  const engine = make();
  engine.script = { onPrompt: (e, p) => {
    e.tool(p.agentId, "env", { command: probeCommands(e.state).removedVariables });
    const result = p.agentId === LEAD ? "the engine refused this identity (HTTP 403)"
      : "lgtm: the folder /tmp above the socket is owned by another user";
    e.finish(p.agentId, "env", "failed", output("LCP_ENV_BEGIN\nPATH\nLCP_ENV_END\n" + result + "\n", 1));
    e.turnEnded(p.agentId);
  } };
  const result = await runProbe(engine, "removed-variables");
  expect(result.passed).toBe(false);
  expect(result.rows[0]?.outcome).toBe("refused by ancestry check");
  expect(result.rows[1]?.outcome).toBe("not observable (issue 243)");
});
