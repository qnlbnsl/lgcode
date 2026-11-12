// L-1 probes, adversarial: each test hands the real live probe driver and the
// real outcome gate evidence that a real run could produce but that does not
// prove the criterion, and asserts the step fails. A control test per probe
// shows the same scripted boundary can produce a pass, so a failure below is
// the probe's decision and not a broken fixture.
//
// A test marked "issue 2xx" fails today: the probe passes on evidence that
// does not prove its criterion. It is kept failing on purpose; see
// docs/issues.md.
import { readFileSync, statSync, truncateSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { probeCommands } from "../../scripts/live/liveProbes.ts";
import { scanTokens } from "../../scripts/live/probeEvidence.ts";
import { SLASH_DOWN_PROMPT, SLASH_UP_PROMPT } from "../../scripts/live/prompts.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  ALWAYS, fakeEngine, harnessOf, LEAD, markerIn, ONCE, REJECT, runProbe, WORKER,
  type FakeEngine, type Option, type Prompted, type Script,
} from "./probe-fake-engine.ts";

vi.mock("@lgtm/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@lgtm/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...original, connect: (options: Parameters<typeof original.connect>[0]) => (fakeConnect(options) ?? original.connect(options)) as never };
});

registerRebuildCheck({ noLog: true });

const engines: FakeEngine[] = [];
const make = (setup?: Parameters<typeof fakeEngine>[0]) => { const engine = fakeEngine(setup); engines.push(engine); return engine; };
afterEach(() => { for (const engine of engines.splice(0)) engine.cleanup(); });

// One shell (or other tool) call per prompt, with an optional permission
// request; the tool finishes and the turn ends when the owner answers.
interface ShellPlan {
  readonly input: unknown;
  readonly title?: string;
  readonly options?: ReadonlyArray<Option>;
  readonly holder?: unknown;
  readonly result: (optionId: string) => { readonly status: string; readonly output: string; readonly after?: () => void };
}
const shell = (plan: (engine: FakeEngine, prompted: Prompted) => ShellPlan | undefined): Script => {
  const pending = new Map<string, { agentId: string; callId: string; plan: ShellPlan }>();
  let calls = 0;
  return {
    onPrompt: (engine, prompted) => {
      const chosen = plan(engine, prompted);
      if (chosen === undefined) { engine.turnEnded(prompted.agentId); return; }
      const callId = `call-${++calls}`;
      engine.tool(prompted.agentId, callId, chosen.input, chosen.title);
      if (chosen.options === undefined) {
        const result = chosen.result("");
        result.after?.();
        engine.finish(prompted.agentId, callId, result.status, result.output);
        engine.turnEnded(prompted.agentId);
        return;
      }
      pending.set(engine.permission(prompted.agentId, callId, chosen.options, chosen.holder), { agentId: prompted.agentId, callId, plan: chosen });
    },
    onAnswer: (engine, answered) => {
      const entry = pending.get(answered.id);
      if (entry === undefined) return;
      pending.delete(answered.id);
      const result = entry.plan.result(answered.optionId);
      result.after?.();
      engine.finish(entry.agentId, entry.callId, result.status, result.output);
      engine.turnEnded(entry.agentId);
    },
  };
};
const said = (engine: FakeEngine, agentId: string, text: string) =>
  engine.emit(agentId, { _tag: "ThreadItem", content: { _tag: "text", text } });

describe("sandbox-mcp (PB-A3) never passes without the agent's own authenticated MCP call", () => {
  const mcpCall = (engine: FakeEngine, prompted: Prompted) => {
    const marker = markerIn(prompted.text);
    engine.tool(prompted.agentId, `mcp-${prompted.agentId}`, { server: "lgtm", tool: "ask", arguments: { text: marker } }, "mcp__lgtm__ask");
    engine.emit(prompted.agentId, { _tag: "QuestionAsked", questionId: `q-${prompted.agentId}`, holder: { _tag: "owner" }, deliveryId: `qd-${prompted.agentId}`, text: marker }, { caller: { _tag: "agent", agentId: prompted.agentId } });
    engine.finish(prompted.agentId, `mcp-${prompted.agentId}`, "completed", "{\"questionId\":\"q\"}");
    engine.turnEnded(prompted.agentId);
  };

  it("control: an authenticated QuestionAsked from each agent's MCP ask call passes", async () => {
    const engine = make();
    engine.script = { onPrompt: mcpCall };
    const run = await runProbe(engine, "sandbox-mcp");
    expect(run.reason).toBe("claude: succeeds | codex: succeeds");
    expect(run.passed).toBe(true);
  });

  it("fails when each model only claims, in prose, that the call succeeded", async () => {
    const engine = make();
    engine.script = { onPrompt: (e, p) => { said(e, p.agentId, `I called the LGTM Studio ask tool with ${markerIn(p.text)} and it succeeded.`); e.turnEnded(p.agentId); } };
    const run = await runProbe(engine, "sandbox-mcp");
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("not attempted");
  });

  it("fails when the marker reaches the engine from the other agent's identity, not the prompted one", async () => {
    const engine = make();
    engine.script = { onPrompt: (e, p) => {
      const other = p.agentId === LEAD ? WORKER : LEAD;
      e.emit(other, { _tag: "QuestionAsked", questionId: `q-${p.agentId}`, holder: { _tag: "owner" }, deliveryId: `qd-${p.agentId}`, text: markerIn(p.text) }, { caller: { _tag: "agent", agentId: other } });
      // And a row filed under the prompted agent but made with the owner's identity.
      e.emit(p.agentId, { _tag: "QuestionAsked", questionId: `q2-${p.agentId}`, holder: { _tag: "owner" }, deliveryId: `qd2-${p.agentId}`, text: markerIn(p.text) }, { caller: { _tag: "owner" } });
      e.turnEnded(p.agentId);
    } };
    const run = await runProbe(engine, "sandbox-mcp");
    expect(run.passed).toBe(false);
  });

  it("fails when the agent reaches the tool through a shell command instead of its MCP tool", async () => {
    const engine = make();
    engine.script = { onPrompt: (e, p) => {
      const marker = markerIn(p.text);
      e.tool(p.agentId, `sh-${p.agentId}`, { command: `lgtm ask --input '{"text":"${marker}"}'` });
      e.emit(p.agentId, { _tag: "QuestionAsked", questionId: `q-${p.agentId}`, holder: { _tag: "owner" }, deliveryId: `qd-${p.agentId}`, text: marker }, { caller: { _tag: "agent", agentId: p.agentId } });
      e.finish(p.agentId, `sh-${p.agentId}`, "completed", "ok");
      e.turnEnded(p.agentId);
    } };
    const run = await runProbe(engine, "sandbox-mcp");
    expect(run.passed).toBe(false);
  });
});

describe("removed-variables (SEC-PB-5, SEC-PB-8) passes only on the exact command's own 403 refusal", () => {
  const refused = (engine: FakeEngine, input: (command: string) => unknown, options: ReadonlyArray<Option> = [ALWAYS, ONCE, REJECT]) => shell((_e, p) => {
    if (!p.text.includes("env -u LGTM_SOCKET")) return undefined;
    return { input: input(probeCommands(engine.state).removedVariables), options,
      result: (optionId) => optionId === ONCE.id
        ? { status: "failed", output: "lgtm: the engine refused this identity (HTTP 403)\n\nLCP_EXIT=1\n" }
        : { status: "failed", output: "The user rejected this tool call." } };
  });

  it("control: the exact command, refused with HTTP 403 and a nonzero exit, passes; no persistent option is ever chosen", async () => {
    const engine = make();
    engine.script = refused(engine, (command) => ({ command }));
    const run = await runProbe(engine, "removed-variables");
    expect(run.reason).toBe("claude: refused by ancestry check | codex: refused by ancestry check");
    expect(engine.answers.map((answer) => answer.optionId)).toEqual([ONCE.id, ONCE.id]);
  });

  it("fails when the right command is wrapped in a different shell command", async () => {
    const engine = make();
    engine.script = refused(engine, (command) => ({ command: `bash -c ${JSON.stringify(command)} || true` }));
    const run = await runProbe(engine, "removed-variables");
    expect(run.passed).toBe(false);
    expect(engine.answers.every((answer) => answer.optionId === REJECT.id)).toBe(true);
  });

  it("fails when the same command runs with an extra command appended inside the exact shell wrapper", async () => {
    const engine = make();
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    engine.script = refused(engine, (command) => ({ command: `/bin/bash -lc ${quote(`${command}; id`)}` }));
    expect((await runProbe(engine, "removed-variables")).passed).toBe(false);
  });

  it("fails when the agent only reports the refusal in prose", async () => {
    const engine = make();
    engine.script = { onPrompt: (e, p) => { said(e, p.agentId, "lgtm: the engine refused this identity (HTTP 403)\nLCP_EXIT=1"); e.turnEnded(p.agentId); } };
    const run = await runProbe(engine, "removed-variables");
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("not attempted");
  });

  it("fails when lgtm acts as the owner (exit 0)", async () => {
    const engine = make();
    engine.script = shell((e, p) => ({ input: { command: probeCommands(e.state).removedVariables }, options: [ONCE, REJECT],
      result: () => ({ status: "completed", output: "{\"accounts\":[]}\n\nLCP_EXIT=0\n" }) }));
    const run = await runProbe(engine, "removed-variables");
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("acts as owner");
  });

  it("fails on Codex when the worker's process does not carry shell_environment_policy.inherit=core (SEC-PB-8 not exercised)", async () => {
    const engine = make({ codexCore: false });
    engine.script = refused(engine, (command) => ({ command }));
    const run = await runProbe(engine, "removed-variables");
    expect(run.passed).toBe(false);
    expect(run.rows.find((row) => row.harness === "codex")?.outcome).toBe("attempted; failed");
  });
});

describe("state-read (SEC-PB-6) records a deny rule or no mechanism only from the exact canary read", () => {
  const canary = (engine: FakeEngine) => readFileSync(join(engine.state, "live-canary"), "utf8");

  it("control: the canary's own text in the exact command's output records no mechanism and passes", async () => {
    const engine = make();
    engine.script = shell((e) => ({ input: { command: probeCommands(e.state).stateRead }, options: [ONCE, REJECT],
      result: () => ({ status: "completed", output: `${canary(e)}\nLCP_EXIT=0\n` }) }));
    const run = await runProbe(engine, "state-read");
    expect(run.reason).toBe("claude: no mechanism: the agent read the canary file | codex: no mechanism: the agent read the canary file");
  });

  it("control: a harness deny rule on the allowed exact command records refused and passes", async () => {
    const engine = make();
    engine.script = shell((e) => ({ input: { command: probeCommands(e.state).stateRead }, options: [ONCE, REJECT],
      result: () => ({ status: "failed", output: "Permission to read /tmp/state/live-canary has been denied by a deny rule." }) }));
    expect((await runProbe(engine, "state-read")).reason).toBe("claude: refused | codex: refused");
  });

  it("issue 218: the owner's own rejection of the exact command is not a deny rule and must not record refused", async () => {
    // Only a persistent allow and a reject are offered. The probe correctly
    // will not answer "always" outside its step, so it rejects; the harness
    // then reports the owner's rejection, and the probe records it as the
    // harness refusing the read.
    const engine = make();
    engine.script = shell((e) => ({ input: { command: probeCommands(e.state).stateRead }, options: [ALWAYS, REJECT],
      result: (optionId) => optionId === REJECT.id
        ? { status: "failed", output: "The user denied permission for this tool use." }
        : { status: "completed", output: `${canary(e)}\nLCP_EXIT=0\n` } }));
    const run = await runProbe(engine, "state-read");
    expect(engine.answers.map((answer) => answer.optionId)).toEqual([REJECT.id, REJECT.id]);
    expect(run.passed).toBe(false);
  });

  it("fails when the agent reads a different file that holds the same text", async () => {
    const engine = make();
    engine.script = shell((e) => ({ input: { command: `cat '${join(e.work, "copy-of-canary")}'` }, options: [ONCE, REJECT],
      result: () => ({ status: "completed", output: canary(e) }) }));
    const run = await runProbe(engine, "state-read");
    expect(run.passed).toBe(false);
    expect(engine.answers.every((answer) => answer.optionId === REJECT.id)).toBe(true);
  });

  it("fails when the agent declines and runs nothing", async () => {
    const engine = make();
    engine.script = { onPrompt: (e, p) => { said(e, p.agentId, "I will not read files in the state folder; refused."); e.turnEnded(p.agentId); } };
    const run = await runProbe(engine, "state-read");
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("not attempted");
  });

  it("safety: the canary is random, non-secret, owner-only, and inside the run's own /tmp state folder", async () => {
    const engine = make();
    engine.script = shell((e) => ({ input: { command: probeCommands(e.state).stateRead }, options: [ONCE, REJECT],
      result: () => ({ status: "completed", output: canary(e) }) }));
    await runProbe(engine, "state-read");
    const path = join(engine.state, "live-canary");
    const text = readFileSync(path, "utf8");
    expect(path.startsWith("/tmp/")).toBe(true);
    expect(text).toMatch(/^[0-9a-f]{48}$/);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    for (const token of engine.valid.keys()) expect(text).not.toContain(token);
    expect(probeCommands(engine.state).stateRead).toContain(path);
  });
});

describe("slash-up and slash-down (SEC-PB-2, SEC-PB-7) pass only on an escaped receipt with no command", () => {
  const envelope = (deliveryId: string, body: string) => `Data from another agent [M1] (delivery ${deliveryId}):\n${body}\nEnd data [M1]`;
  const userRecord = (harness: "claude" | "codex", text: string) => harness === "claude"
    ? { type: "user", message: { role: "user", content: [{ type: "text", text }] } }
    : { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } };
  // The receiver's session file gets what the test says it received.
  const receive = (records: (prompted: Prompted, harness: "claude" | "codex") => ReadonlyArray<unknown>, compact = false): Script => ({
    onPrompt: (e, p) => {
      if (p.text === SLASH_UP_PROMPT || p.text === SLASH_DOWN_PROMPT) {
        for (const record of records(p, harnessOf(p.agentId))) e.session(harnessOf(p.agentId), record);
      }
      e.turnEnded(p.agentId, compact && (p.text === SLASH_UP_PROMPT || p.text === SLASH_DOWN_PROMPT));
    },
  });
  const escaped = (p: Prompted, harness: "claude" | "codex") => [userRecord(harness, envelope(p.deliveryId, `\\${p.text}`))];

  it.each(["slash-up", "slash-down"] as const)("control: %s passes when the receiver's own user text holds the escaped payload", async (probe) => {
    const engine = make();
    engine.script = receive(escaped);
    const run = await runProbe(engine, probe);
    expect(run.reason).toBe(probe === "slash-up"
      ? "claude: escaped; no command | codex: not applicable (no codex parent receiver in this team)"
      : "claude: not applicable (no claude child receiver in this team) | codex: escaped; no command");
  });

  it.each(["slash-up", "slash-down"] as const)("issue 219: %s fails when the raw /compact also arrives as its own user message", async (probe) => {
    const engine = make();
    engine.script = receive((p, harness) => [...escaped(p, harness), userRecord(harness, p.text)]);
    const run = await runProbe(engine, probe);
    expect(run.passed).toBe(false);
  });

  it.each(["slash-up", "slash-down"] as const)("%s fails when the receiver's session gains a compaction boundary", async (probe) => {
    const engine = make();
    engine.script = receive((p, harness) => [...escaped(p, harness), harness === "claude" ? { type: "system", subtype: "compact_boundary" } : { type: "compacted", payload: {} }]);
    const run = await runProbe(engine, probe);
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("command ran");
  });

  it.each(["slash-up", "slash-down"] as const)("%s fails when the receiver's turn ends as a compact turn", async (probe) => {
    const engine = make();
    engine.script = receive(escaped, true);
    expect((await runProbe(engine, probe)).passed).toBe(false);
  });

  it.each(["slash-up", "slash-down"] as const)("%s fails when the escaped text appears only in the receiver's own reply", async (probe) => {
    const engine = make();
    engine.script = receive((p, harness) => [harness === "claude"
      ? { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: envelope(p.deliveryId, `\\${p.text}`) }] } }
      : { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: envelope(p.deliveryId, `\\${p.text}`) }] } }]);
    const run = await runProbe(engine, probe);
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("attempted; failed");
  });

  it.each(["slash-up", "slash-down"] as const)("%s fails when the payload arrives unescaped inside the envelope", async (probe) => {
    const engine = make();
    engine.script = receive((p, harness) => [userRecord(harness, envelope(p.deliveryId, p.text))]);
    const run = await runProbe(engine, probe);
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("unescaped");
  });
});

describe("always-allow (SEC-PB-4) answers always only for the owner-held exact command in the run's work folder", () => {
  const settings = (engine: FakeEngine) => join(engine.work, ".claude", "settings.local.json");
  const persist = (engine: FakeEngine) => () => {
    mkdirSync(join(engine.work, ".claude"), { recursive: true });
    writeFileSync(settings(engine), JSON.stringify({ permissions: { allow: ["Bash(printf 'lcp-persistent-permission-probe\\n')"] } }));
  };
  const plan = (input: (command: string) => unknown, holder?: unknown) => shell((e) => ({ input: input(probeCommands(e.state).alwaysAllow), options: [ONCE, ALWAYS, REJECT], holder,
    result: (optionId) => optionId === ALWAYS.id ? { status: "completed", output: "lcp-persistent-permission-probe", after: persist(e) }
      : { status: optionId === ONCE.id ? "completed" : "failed", output: optionId === ONCE.id ? "lcp-persistent-permission-probe" : "rejected" } }));

  it("control: an owner-held request for the exact command in the work folder is answered always and its saved scope is recorded", async () => {
    const engine = make();
    engine.script = plan((command) => ({ command }));
    const run = await runProbe(engine, "always-allow");
    expect(run.passed).toBe(true);
    expect(engine.answers.map((answer) => answer.optionId)).toEqual([ALWAYS.id]);
    expect(run.rows[0]!.detail).toContain("lcp-persistent-permission-probe");
  });

  it("approval-free MCP calls leave no Claude options until the native command probe, whose options still satisfy permission-kinds", async () => {
    const engine = make();
    engine.permission(WORKER, "journey-command", [ONCE, REJECT]);
    expect((await runProbe(engine, "permission-kinds")).passed).toBe(false);
    engine.script = plan((command) => ({ command }));
    expect((await runProbe(engine, "always-allow")).passed).toBe(true);
    expect((await runProbe(engine, "permission-kinds")).passed).toBe(true);
  });

  it("does not answer always for the exact command when it runs outside the run's work folder", async () => {
    const engine = make();
    engine.script = plan((command) => ({ command, cwd: "/home" }));
    const run = await runProbe(engine, "always-allow");
    expect(engine.answers.map((answer) => answer.optionId)).not.toContain(ALWAYS.id);
    expect(run.passed).toBe(false);
  });

  it("does not answer always for a different command in the work folder", async () => {
    const engine = make();
    engine.script = plan(() => ({ command: "printf 'lcp-persistent-permission-probe\\n'; touch x" }));
    const run = await runProbe(engine, "always-allow");
    expect(engine.answers.map((answer) => answer.optionId)).not.toContain(ALWAYS.id);
    expect(run.passed).toBe(false);
  });

  it("issue 220: does not send an always answer for a request an agent holds (persistent option not routed to the owner)", async () => {
    const engine = make();
    engine.script = plan((command) => ({ command }), { _tag: "agent", agentId: WORKER });
    const run = await runProbe(engine, "always-allow");
    expect(run.passed).toBe(false);
    expect(engine.answers.map((answer) => answer.optionId)).not.toContain(ALWAYS.id);
  });

  it("fails when always is answered but no settings file is written", async () => {
    const engine = make();
    engine.script = shell((e) => ({ input: { command: probeCommands(e.state).alwaysAllow }, options: [ONCE, ALWAYS, REJECT],
      result: () => ({ status: "completed", output: "lcp-persistent-permission-probe" }) }));
    const run = await runProbe(engine, "always-allow");
    expect(run.passed).toBe(false);
  });
});

describe("permission-kinds (SEC-PB-3) needs observed options on both harnesses with the contract's mapping", () => {
  const request = (engine: FakeEngine, agentId: string, options: ReadonlyArray<Option>) =>
    engine.emit(agentId, { _tag: "PermissionRequested", permissionRequestId: `p-${agentId}`, toolCallId: `c-${agentId}`, holder: { _tag: "owner" }, description: "x", options });

  it("control: mapped options observed on both harnesses pass", async () => {
    const engine = make();
    request(engine, LEAD, [ONCE, ALWAYS, REJECT]); request(engine, WORKER, [ONCE, REJECT]);
    expect((await runProbe(engine, "permission-kinds")).passed).toBe(true);
  });

  it("fails when one harness never showed a permission request", async () => {
    const engine = make();
    request(engine, LEAD, [ONCE, ALWAYS, REJECT]);
    expect((await runProbe(engine, "permission-kinds")).passed).toBe(false);
  });

  it("fails when an option's recorded persistence differs from the contract", async () => {
    const engine = make();
    request(engine, LEAD, [ONCE, { ...ALWAYS, persistent: false }]); request(engine, WORKER, [ONCE]);
    expect((await runProbe(engine, "permission-kinds")).passed).toBe(false);
  });
});

describe("token-scan (PB-A4, SEC-PB-1) needs real evidence for each harness and never prints a token", () => {
  it("control: captured tokens, nonempty session files and argument snapshots, and no match, pass", async () => {
    const engine = make();
    const run = await runProbe(engine, "token-scan");
    expect(run.reason).toBe("claude: not found | codex: not found");
  });

  it("fails on a planted agent token in a session file, and neither the step nor its log line prints the token", async () => {
    const engine = make();
    const token = engine.tokenOf.get(WORKER)!;
    engine.session("codex", { type: "response_item", payload: { role: "assistant", content: [{ type: "output_text", text: `env: LGTM_TOKEN=${token}` }] } });
    const run = await runProbe(engine, "token-scan");
    expect(run.passed).toBe(false);
    expect(run.reason).toContain(engine.sessionFile("codex"));
    for (const text of [run.reason, ...run.lines, ...run.rows.map((row) => row.detail)]) expect(text).not.toContain(token);
  });

  it("issue 221: an empty (unflushed) session file is not evidence that the token is absent", async () => {
    const engine = make();
    truncateSync(engine.sessionFile("codex"), 0);
    const run = await runProbe(engine, "token-scan");
    expect(run.passed).toBe(false);
  });

  it("issue 221: unit: scanTokens refuses a session file with no content", () => {
    const engine = make();
    truncateSync(engine.sessionFile("claude"), 0);
    expect(() => scanTokens(["shp_a_0123456789abcdef0123"], [engine.sessionFile("claude")], [{ label: "arguments", text: "node" }])).toThrow(/not attempted/);
  });

  it("issue 221: the Codex row cannot pass when the Codex agent's own token was never captured", async () => {
    // The worker's process is gone, so its token was never read. Its session
    // file holds that token, yet only the lead's token is searched for.
    const engine = make({ agents: [LEAD] });
    engine.session("codex", { type: "response_item", payload: { role: "assistant", content: [{ type: "output_text", text: "LGTM_TOKEN=shp_a_workertokenneverseenbytheprobe0" }] } });
    const run = await runProbe(engine, "token-scan");
    expect(run.passed).toBe(false);
  });

  it("fails closed with zero session files", () => {
    expect(() => scanTokens(["shp_a_0123456789abcdef0123"], [], [{ label: "arguments", text: "node" }])).toThrow(/not attempted/);
  });

  it("reports zero argument snapshots, which the driver records as not attempted", async () => {
    const engine = make();
    const result = scanTokens(["shp_a_0123456789abcdef0123"], [engine.sessionFile("claude")], []);
    expect(result.arguments).toBe(0);
  });
});
