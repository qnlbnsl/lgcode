import { afterEach, expect, it, vi } from "vitest";
import { probeCommands } from "../../scripts/live/liveProbes.ts";
import { PROBE_MCP_PROMPT, RESTART_ACTIVE_PROMPT, RESTART_PREPARE_PROMPT } from "../../scripts/live/prompts.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { fakeEngine, LEAD, markerIn, runProbe, type FakeEngine } from "./probe-fake-engine.ts";

vi.mock("@lgcode/client", async (original) => {
  const client = await original<typeof import("@lgcode/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...client, connect: (options: Parameters<typeof client.connect>[0]) => (fakeConnect(options) ?? client.connect(options)) as never };
});
registerRebuildCheck({ noLog: true });
const engines: FakeEngine[] = [];
const make = () => { const e = fakeEngine(); engines.push(e); return e; };
afterEach(() => { for (const e of engines.splice(0)) e.cleanup(); });

const ask = (e: FakeEngine, agentId: string, text: string) => {
  e.tool(agentId, "ask-" + agentId, { text: markerIn(text) }, "mcp__lgcode__ask");
  e.emit(agentId, { _tag: "QuestionAsked", text: markerIn(text) }, { caller: { _tag: "agent", agentId } });
  e.finish(agentId, "ask-" + agentId, "completed", "question recorded");
};

it("issue 244: exact ask discovery followed by each authenticated ask passes, including streamed lookup input", async () => {
  const e = make();
  e.script = { onPrompt: (engine, p) => {
    if (p.agentId === LEAD) {
      engine.tool(p.agentId, "lookup", {}, "ToolSearch");
      engine.tool(p.agentId, "lookup", { query: "select:mcp__lgcode__ask", max_results: 1 }, "");
      engine.finish(p.agentId, "lookup", "completed", '[{"type":"tool_reference","tool_name":"mcp__lgcode__ask"}]');
    }
    ask(engine, p.agentId, p.text);
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, "sandbox-mcp");
  expect(result.passed).toBe(true);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every((row) => row.outcome === "succeeds")).toBe(true);
});

it.each([
  { query: "lgcode", reference: "mcp__lgcode__ask", status: "completed", title: "ToolSearch" },
  { query: "select:mcp__lgcode__ask", reference: "mcp__lgcode__start", status: "completed", title: "ToolSearch" },
  { query: "select:mcp__lgcode__ask", reference: "mcp__lgcode__ask", status: "failed", title: "ToolSearch" },
  { query: "select:mcp__lgcode__ask", reference: "mcp__lgcode__ask", status: "completed", title: "Bash" },
])("issue 244: a different discovery or failure still fails ($query, $reference, $status, $title)", async (lookup) => {
  const e = make();
  e.script = { onPrompt: (engine, p) => {
    engine.tool(p.agentId, "lookup", { query: lookup.query, max_results: 1 }, lookup.title);
    engine.finish(p.agentId, "lookup", lookup.status, JSON.stringify([{ type: "tool_reference", tool_name: lookup.reference }]));
    ask(engine, p.agentId, p.text);
    engine.turnEnded(p.agentId);
  } };
  expect((await runProbe(e, "sandbox-mcp")).passed).toBe(false);
});

it("issue 244: discovery alone cannot prove PB-A3", async () => {
  const e = make();
  e.script = { onPrompt: (engine, p) => {
    if (p.agentId === LEAD) {
      engine.tool(p.agentId, "lookup", { query: "select:mcp__lgcode__ask", max_results: 1 }, "ToolSearch");
      engine.finish(p.agentId, "lookup", "completed", '[{"type":"tool_reference","tool_name":"mcp__lgcode__ask"}]');
    }
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, "sandbox-mcp");
  expect(result.passed).toBe(false);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every((row) => row.outcome === "not attempted")).toBe(true);
});

it("issue 212: a command that runs without a permission request cannot claim always allow or a missing write after it", async () => {
  const e = make();
  e.script = { onPrompt: (engine, p) => {
    engine.tool(p.agentId, "print", { command: probeCommands(e.state).alwaysAllow });
    engine.finish(p.agentId, "print", "completed", "lcp-persistent-permission-probe");
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, "always-allow");
  expect(result.passed).toBe(false);
  expect(result.rows[0]?.outcome).toBe("no persistent permission request observed");
  expect(result.rows[0]?.detail).toContain("permission requests=0; chosen options=0");
  expect(e.answers).toEqual([]);
});

it("issue 245: an ended hold turn without its exact shell tool reports the missing attempt immediately", async () => {
  const e = make();
  const result = await runProbe(e, "reload");
  expect(result.passed).toBe(false);
  expect(result.reason).toContain("not attempted: claude ended its hold turn without the exact restart command");
});

it.each([
  { listing: "", status: "not observed", passes: false },
  { listing: "LCP_ENV_BEGIN\nPATH\nLGCODE_TOKEN\nLCP_ENV_END\n", status: "present", passes: false },
  { listing: "LCP_ENV_BEGIN\nPATH\nLCP_ENV_END\n", status: "absent", passes: true },
])("identity listing reports $status separately from missing output", async ({ listing, status, passes }) => {
  const e = fakeEngine({ shellListing: false }); engines.push(e);
  e.script = { onPrompt: (engine, p) => {
    engine.tool(p.agentId, "shell", { command: probeCommands(e.state).removedVariables });
    engine.finish(p.agentId, "shell", "failed", `${listing}the engine refused this identity (HTTP 403)\nLCP_EXIT=1\n`);
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, "removed-variables");
  expect(result.passed).toBe(passes);
  expect(result.rows.find((row) => row.harness === "codex")?.detail).toContain(`shell identity variable names=${status}`);
});

it("the printed prompts allow exact discovery and distinguish a shell hold from a clock sleep", () => {
  expect(PROBE_MCP_PROMPT).toContain('select:mcp__lgcode__ask');
  expect(RESTART_PREPARE_PROMPT).toContain("Follow later test prompts exactly");
  expect(RESTART_ACTIVE_PROMPT).toContain("Do not substitute a clock or timer tool");
});
