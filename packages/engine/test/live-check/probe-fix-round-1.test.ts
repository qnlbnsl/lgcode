import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import { probeCommands } from "../../scripts/live/liveProbes.ts";
import * as evidence from "../../scripts/live/probeEvidence.ts";
import { probePromptFor } from "../../scripts/live/driver.ts";
import { RESTART_PENDING_PROMPT, SLASH_UP_PROMPT, SLASH_DOWN_PROMPT } from "../../scripts/live/prompts.ts";
import { runProbes, type ProbeDriver } from "../../scripts/live/probes.ts";
import { makeStepRunner } from "../../scripts/live/flow.ts";
import { createReporter } from "../../scripts/live/reporter.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ALWAYS, ONCE, REJECT, fakeEngine, harnessOf, LEAD, WORKER, runProbe, type FakeEngine, type Option } from "./probe-fake-engine.ts";

vi.mock("@shephrd/client", async (original) => {
  const client = await original<typeof import("@shephrd/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...client, connect: (options: Parameters<typeof client.connect>[0]) => (fakeConnect(options) ?? client.connect(options)) as never };
});
registerRebuildCheck({ noLog: true });
const engines: FakeEngine[] = [];
const make = () => { const e = fakeEngine(); engines.push(e); return e; };
afterEach(() => { for (const e of engines.splice(0)) e.cleanup(); vi.restoreAllMocks(); });

const command = (e: FakeEngine, input: string, output: string, options?: ReadonlyArray<Option>) => {
  let pending: { agent: string; call: string } | undefined;
  e.script = {
    onPrompt: (engine, p) => {
      const call = `c-${p.deliveryId}`;
      engine.tool(p.agentId, call, { command: input });
      if (options) { pending = { agent: p.agentId, call }; engine.permission(p.agentId, call, options); }
      else { engine.finish(p.agentId, call, "failed", output); engine.turnEnded(p.agentId); }
    },
    onAnswer: (engine) => { engine.finish(pending!.agent, pending!.call, "failed", output); engine.turnEnded(pending!.agent); },
  };
};

it.each(["slash-up", "slash-down"] as const)("M-1: %s reports only its own receiver, with the other harness explicitly inapplicable", async (id) => {
  const e = make();
  e.script = { onPrompt: (engine, p) => {
    if ([SLASH_UP_PROMPT, SLASH_DOWN_PROMPT].includes(p.text)) {
      const text = `Data from another agent [M] (delivery ${p.deliveryId}):\n\\${p.text}\nEnd data [M]`;
      engine.session(harnessOf(p.agentId), p.agentId === LEAD ? { message: { role: "user", content: text } }
        : { type: "response_item", payload: { role: "user", content: [{ type: "input_text", text }] } });
    }
    engine.turnEnded(p.agentId);
  } };
  const result = await runProbe(e, id);
  expect(result.passed).toBe(true);
  expect(result.rows).toMatchObject(id === "slash-up" ? [
    { harness: "claude", outcome: "escaped; no command" },
    { harness: "codex", outcome: "not applicable (no codex parent receiver in this team)" },
  ] : [
    { harness: "claude", outcome: "not applicable (no claude child receiver in this team)" },
    { harness: "codex", outcome: "escaped; no command" },
  ]);
});

it.each(["claude", "codex"])("M-1: an inapplicable result on the observed %s receiver cannot pass", async (harness) => {
  const e = make();
  const target = harness === "claude" ? "slash-up" : "slash-down";
  const accepted = { "sandbox-mcp": "succeeds", "permission-kinds": "recorded", "removed-variables": "refused by ancestry check", "state-read": "refused", "slash-up": "escaped; no command", "slash-down": "escaped; no command", "always-allow": "scopes recorded; persistent options routed to owner", reload: "old token refused; tool succeeds; found", "token-scan": "not found" };
  const driver: ProbeDriver = { observe: (id) => Effect.succeed(["claude", "codex"].map((name) => ({ harness: name,
    outcome: id === target && name === harness ? `not applicable (no ${harness} ${harness === "claude" ? "child" : "parent"} receiver in this team)` : accepted[id], detail: "test evidence" }))) };
  const reporter = createReporter(() => undefined);
  await Effect.runPromiseExit(Effect.scoped(runProbes(driver, makeStepRunner(reporter), { lead: { agentId: LEAD }, worker: { agentId: WORKER } })));
  expect(reporter.results().find((row) => row.id === target)).toMatchObject({ id: target, passed: false });
});

it("m-1: the rendered pending replay prompt holds its turn with the named exact foreground Node command", () => {
  const shown = probePromptFor("RESTART_PENDING_PROMPT", RESTART_PENDING_PROMPT, "/tmp/example/work/project");
  expect(shown).toContain(`'${process.execPath}' -e 'setTimeout(() => console.log("LCP_HOLD_DONE"), 120000)'`);
  expect(shown).not.toContain('Before a restart, reply with received');
});

it("m-2: core inheritance cannot pass when the shell's name-only listing still contains identity variables", async () => {
  const e = make();
  command(e, probeCommands(e.state).removedVariables,
    "LCP_ENV_BEGIN\nPATH\nSHEPHRD_SOCKET\nSHEPHRD_TOKEN\nLCP_ENV_END\nthe engine refused this identity (HTTP 403)\nLCP_EXIT=1\n");
  expect((await runProbe(e, "removed-variables")).passed).toBe(false);
});

it.each([undefined, "userSettings", "projectSettings", "cliArg"])("m-3: a persistent destination %s is denied before any settings write", async (destination) => {
  const e = make();
  const { destination: _destination, ...base } = ALWAYS;
  const option = { ...base, ...(destination === undefined ? {} : { destination }) };
  let pending: { agent: string; call: string };
  e.script = {
    onPrompt: (engine, p) => { pending = { agent: p.agentId, call: `p-${p.deliveryId}` }; engine.tool(p.agentId, pending.call, { command: probeCommands(e.state).alwaysAllow }); engine.permission(p.agentId, pending.call, [ONCE, option, REJECT]); },
    onAnswer: (engine, a) => {
      // A dangerous answer would cause a write before the probe can inspect it.
      if (a.optionId === ALWAYS.id) { mkdirSync(join(e.work, ".claude"), { recursive: true }); writeFileSync(join(e.work, ".claude/settings.local.json"), JSON.stringify({ permissions: { allow: ["unsafe"] } })); }
      engine.finish(pending.agent, pending.call, "failed", "The user rejected this tool call."); engine.turnEnded(pending.agent);
    },
  };
  const result = await runProbe(e, "always-allow");
  expect(e.answers.map((a) => a.optionId)).toEqual([REJECT.id]);
  expect(result.rows[0]?.outcome).toBe("no safe persistent option offered");
  expect(result.passed).toBe(false);
});

it("m-4: each token-scan row records its own nonempty argument and environment snapshots", async () => {
  const e = make();
  const result = await runProbe(e, "token-scan");
  expect(result.passed).toBe(true);
  for (const row of result.rows) {
    expect(row.detail).toMatch(/process argument snapshots=[1-9]\d*/);
    expect(row.detail).toMatch(/environment snapshots=[1-9]\d*/);
  }
});

it("m-6a: fixture evidence rejects absent headers, missing adapter versions, wrong harnesses and incomplete config evidence", () => {
  const rows = readFileSync(new URL("../../../testing/fixtures/claude.ndjson", import.meta.url), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  for (const broken of [[], rows.slice(1), [{ ...rows[0], version: undefined }, ...rows.slice(1)], [{ ...rows[0], provider: "codex" }, ...rows.slice(1)], rows.slice(0, 1)]) {
    expect(() => evidence.fixtureEvidence(broken.map((row) => JSON.stringify(row)).join("\n"), "claude", "test fixture")).toThrow(/not attempted/);
  }
  expect(evidence.fixtureEvidence(rows.map((row) => JSON.stringify(row)).join("\n"), "claude", "test fixture")).toContain("0.99.1");
});

it("m-6b: permission words in unrelated output cannot prove a canary denial", async () => {
  const e = make();
  command(e, probeCommands(e.state).stateRead, "-rw-r--r-- 1 owner group 25 Nov 2 permission-denied-notes.txt\nLCP_EXIT=1\n", [ONCE, REJECT]);
  expect((await runProbe(e, "state-read")).passed).toBe(false);
});
