import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { runProbes, type ProbeDriver } from "../../scripts/live/probes.ts";
import { makeStepRunner } from "../../scripts/live/flow.ts";
import { createReporter } from "../../scripts/live/reporter.ts";
import { PROBE_STEPS } from "../../scripts/live/steps.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

const good: Record<string, string> = {
  "sandbox-mcp": "succeeds", "permission-kinds": "recorded",
  "removed-variables": "refused by ancestry check", "state-read": "no mechanism: the agent read the canary file",
  "slash-up": "escaped; no command", "slash-down": "escaped; no command", "always-allow": "scopes recorded; persistent options routed to owner",
  "reload": "old token refused; tool succeeds; found", "token-scan": "not found",
};
const run = async (bad?: { id: string; outcome: string }) => {
  const lines: string[] = [];
  const reporter = createReporter((line) => lines.push(line));
  const driver: ProbeDriver = { observe: (id) => Effect.succeed([
    { harness: "claude", outcome: bad?.id === id ? bad.outcome : good[id]!, detail: "observed boundary" },
    { harness: "codex", outcome: good[id]!, detail: "observed boundary" },
  ]) };
  const exit = await Effect.runPromiseExit(Effect.scoped(runProbes(driver, makeStepRunner(reporter), { lead: { agentId: "l" }, worker: { agentId: "w" } })));
  return { exit, reporter, lines };
};

describe("live probe outcome gates", () => {
  it("does not add a probe for PB-A10, which already has real fixture evidence", () => {
    expect(PROBE_STEPS.map((step) => step.id)).not.toContain("fixture-evidence");
  });
  it("prints each shared fake/live probe step once with both harness outcomes", async () => {
    const { reporter, exit, lines } = await run();
    expect(exit._tag).toBe("Success");
    expect(reporter.results().map((row) => row.id)).toEqual([
      "sandbox-mcp", "permission-kinds", "removed-variables", "state-read",
      "slash-up", "slash-down", "always-allow", "reload", "token-scan",
    ]);
    expect(lines.every((line) => line.includes("claude:") && line.includes("codex:"))).toBe(true);
  });
  it.each(PROBE_STEPS)("fails $id when the adapter did not attempt it", async ({ id }) => {
    const { exit, reporter } = await run({ id, outcome: "not attempted" });
    expect(exit._tag).toBe("Failure");
    expect(reporter.results()).toHaveLength(9);
    expect(reporter.results().find((row) => row.id === id)).toMatchObject({ id, passed: false, reason: expect.stringContaining("not attempted") });
  });
  it.each([
    ["sandbox-mcp", "tool failed"], ["permission-kinds", "missing options"], ["removed-variables", "acts as owner"],
    ["state-read", "declined"], ["slash-up", "unescaped"], ["slash-down", "command ran"],
    ["always-allow", "persistent option held by agent"], ["reload", "old token accepted"],
    ["token-scan", "token found"],
  ])("fails %s on %s", async (id, outcome) => {
    expect((await run({ id, outcome })).reporter.results().find((row) => row.id === id)).toMatchObject({ id, passed: false });
  });
  it("accepts an observed deny rule and a recorded re-send instead of pretending history was found", async () => {
    expect((await run({ id: "state-read", outcome: "refused" })).exit._tag).toBe("Success");
    expect((await run({ id: "reload", outcome: "old token refused; tool succeeds; re-send on restart" })).exit._tag).toBe("Success");
  });
});

it.each([
  { rows: [] },
  { rows: [{ harness: 'claude', outcome: 'succeeds', detail: 'one harness only' }] },
  { rows: [{ harness: 'claude', outcome: 'succeeds', detail: 'first' }, { harness: 'claude', outcome: 'succeeds', detail: 'duplicate' }] },
])('fails closed when per-harness observations are absent or duplicated', async ({ rows }) => {
  const reporter = createReporter(() => undefined);
  const result = await Effect.runPromiseExit(Effect.scoped(runProbes({ observe: () => Effect.succeed(rows) }, makeStepRunner(reporter), { lead: { agentId: 'l' }, worker: { agentId: 'w' } })));
  expect(result._tag).toBe('Failure');
  expect(reporter.results()[0]).toMatchObject({ id: 'sandbox-mcp', passed: false, reason: expect.stringContaining('both harnesses') });
});
