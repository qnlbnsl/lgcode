import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import { probeCommands } from "../../scripts/live/liveProbes.ts";
import { slashReceipt } from "../../scripts/live/probeEvidence.ts";
import { probePromptFor } from "../../scripts/live/driver.ts";
import { RESTART_PENDING_PROMPT, SLASH_UP_PROMPT } from "../../scripts/live/prompts.ts";
import { runProbes, type ProbeDriver, type ProbeId } from "../../scripts/live/probes.ts";
import { makeStepRunner } from "../../scripts/live/flow.ts";
import { createReporter } from "../../scripts/live/reporter.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { fakeEngine, LEAD, WORKER, runProbe, type FakeEngine } from "./probe-fake-engine.ts";

vi.mock("@sheprd/client", async (original) => {
  const client = await original<typeof import("@sheprd/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...client, connect: (options: Parameters<typeof client.connect>[0]) => (fakeConnect(options) ?? client.connect(options)) as never };
});
registerRebuildCheck({ noLog: true });
const engines: FakeEngine[] = [];
const make = (setup: Parameters<typeof fakeEngine>[0] = {}) => { const e = fakeEngine(setup); engines.push(e); return e; };
afterEach(() => { for (const e of engines.splice(0)) e.cleanup(); vi.restoreAllMocks(); });

it("m-7: the rendered pending prompt forbids running the command again even when re-sent", () => {
  const text = probePromptFor("RESTART_PENDING_PROMPT", RESTART_PENDING_PROMPT, "/tmp/example/work/project");
  expect(text).toContain("After a restart, do not run this command again, including when this prompt is re-sent.");
});

it("m-8: Codex cannot claim core inheritance from a refusal without the shell's name-only listing", async () => {
  const e = make({ shellListing: false });
  e.script = { onPrompt: (engine, p) => {
    const call = `removed-${p.deliveryId}`;
    engine.tool(p.agentId, call, { command: probeCommands(e.state).removedVariables });
    engine.finish(p.agentId, call, "failed", "the engine refused this identity (HTTP 403)\nLCP_EXIT=1\n");
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, "removed-variables");
  expect(result.rows[0]?.outcome).toBe("refused by ancestry check");
  expect(result.rows[1]?.outcome).toBe("attempted; failed");
  expect(result.passed).toBe(false);
});

it.each([
  { target: "slash-up", observed: "claude", inapplicable: "not applicable (no codex parent receiver in this team)" },
  { target: "slash-down", observed: "codex", inapplicable: "not applicable (no claude child receiver in this team)" },
  { target: "always-allow", observed: "claude", inapplicable: "not applicable (criterion names Claude only)" },
] as const)("m-8: $target cannot accept its own inapplicable string for the observed $observed harness", async ({ target, observed, inapplicable }) => {
  const accepted: Record<ProbeId, string> = { "sandbox-mcp": "succeeds", "permission-kinds": "recorded", "removed-variables": "refused by ancestry check", "state-read": "refused", "slash-up": "escaped; no command", "slash-down": "escaped; no command", "always-allow": "scopes recorded; persistent options routed to owner", reload: "old token refused; tool succeeds; found", "token-scan": "not found" };
  const driver: ProbeDriver = { observe: (id) => Effect.succeed(["claude", "codex"].map((harness) => ({ harness,
    outcome: id === target && harness === observed ? inapplicable : accepted[id], detail: "test evidence" }))) };
  const reporter = createReporter(() => undefined);
  await Effect.runPromiseExit(Effect.scoped(runProbes(driver, makeStepRunner(reporter), { lead: { agentId: LEAD }, worker: { agentId: WORKER } })));
  expect(reporter.results().find((r) => r.id === target)).toMatchObject({ passed: false });
});

it("m-8: a token and arguments without that agent's environment names cannot pass the scan", async () => {
  const e = make();
  const keys = Object.keys;
  // Isolate missing environment coverage at the decoder boundary: token capture
  // and the real process's nonempty arguments remain present for both agents.
  vi.spyOn(Object, "keys").mockImplementation((value) => {
    const environment = value as Record<string, unknown>;
    return environment.SHEPRD_SOCKET === join(e.state, "engine.sock") && environment.SHEPRD_TOKEN === e.tokenOf.get(WORKER)
      ? [] : keys(value);
  });
  const result = await runProbe(e, "token-scan");
  expect(result.rows[0]?.outcome).toBe("not found");
  expect(result.rows[1]?.outcome).toBe("not attempted");
  expect(result.rows[1]?.detail).toMatch(/own agent tokens=[1-9]\d*, process argument snapshots=[1-9]\d*, environment snapshots=0/);
  expect(result.passed).toBe(false);
});

it.each(["\u200b", "\ufeff", " \u200b \ufeff\t"])("issue 219: raw slash text prefixed by format characters %j cannot pass alongside an escaped receipt", (prefix) => {
  const escaped = `Data from another agent [M] (delivery d-1):\n\\${SLASH_UP_PROMPT}\nEnd data [M]`;
  expect(slashReceipt([escaped], "d-1", SLASH_UP_PROMPT, false)).toBe("escaped; no command");
  expect(slashReceipt([escaped, prefix + SLASH_UP_PROMPT], "d-1", SLASH_UP_PROMPT, false)).toBe("unescaped");
});
