import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { probePromptFor } from "../../scripts/live/driver.ts";
import { ALWAYS_ALLOW_PROMPT } from "../../scripts/live/prompts.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ALWAYS, ONCE, REJECT, fakeEngine, runProbe, type FakeEngine, type Option } from "./probe-fake-engine.ts";

vi.mock("@lgcode/client", async (original) => {
  const client = await original<typeof import("@lgcode/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...client, connect: (options: Parameters<typeof client.connect>[0]) => (fakeConnect(options) ?? client.connect(options)) as never };
});
registerRebuildCheck({ noLog: true });
const engines: FakeEngine[] = [];
afterEach(() => { for (const engine of engines.splice(0)) engine.cleanup(); });
// Independent literal: the permitted action creates one non-secret file in
// this run's work folder, exclusively, using the absolute Node.js executable.
const writeCommand = (work: string) => `'${process.execPath}' -e 'require("node:fs").writeFileSync(process.argv[1], "lcp-persistent-permission-probe\\n", { flag: "wx" })' '${work}/lcp-persistent-permission-probe.txt'`;
const oldPrint = "printf 'lcp-persistent-permission-probe\\n'";
const make = (command: (work: string) => string = writeCommand, option: Option | null = ALWAYS) => {
  const engine = fakeEngine(); engines.push(engine);
  const input = command(engine.work);
  let pending: { agentId: string; callId: string };
  const finish = (agentId: string, callId: string, allowed: boolean) => {
    if (allowed) execFileSync("/bin/sh", ["-c", input], { cwd: engine.work, env: { PATH: process.env.PATH }, stdio: "pipe" });
    engine.finish(agentId, callId, allowed ? "completed" : "failed", allowed ? "" : "rejected");
    engine.turnEnded(agentId);
  };
  engine.script = {
    onPrompt: (e, prompt) => {
      const callId = "persistent-write";
      e.tool(prompt.agentId, callId, { command: input, cwd: e.work });
      if (option === null) finish(prompt.agentId, callId, true);
      else { pending = { agentId: prompt.agentId, callId }; e.permission(prompt.agentId, callId, [ONCE, option, REJECT]); }
    },
    onAnswer: (_e, answer) => {
      const allowed = answer.optionId === ALWAYS.id;
      if (allowed) {
        mkdirSync(join(engine.work, ".claude"), { recursive: true });
        writeFileSync(join(engine.work, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: [`Bash(${input})`] } }));
      }
      finish(pending.agentId, pending.callId, allowed);
    },
  };
  return engine;
};
const checkPrompt = (engine: FakeEngine) => {
  expect(engine.prompts).toHaveLength(1);
  expect(engine.prompts[0]!.text).toContain(writeCommand(engine.work));
  expect(engine.prompts[0]!.text).toBe(probePromptFor("ALWAYS_ALLOW_PROMPT", ALWAYS_ALLOW_PROMPT, join(engine.work, "project")));
};

it("issue 212: the sent and approved exact command writes only its run-local marker and records the offered safe scope", async () => {
  const engine = make();
  const result = await runProbe(engine, "always-allow");
  expect(result.passed).toBe(true);
  expect(engine.answers.map((answer) => answer.optionId)).toEqual([ALWAYS.id]);
  expect(readFileSync(join(engine.work, "lcp-persistent-permission-probe.txt"), "utf8")).toBe("lcp-persistent-permission-probe\n");
  expect(result.rows[0]!.detail).toContain(`saved scopes=${JSON.stringify([`Bash(${writeCommand(engine.work)})`])}`);
  expect(existsSync(join(engine.home, ".claude", "settings.json"))).toBe(false);
  checkPrompt(engine);
});

it.each([
  { name: "the former read-only printf", command: () => oldPrint },
  { name: "a different command", command: (work: string) => writeCommand(work) + "; printf changed" },
])("issue 212: $name is rejected instead of receiving always allow", async ({ command }) => {
  const engine = make(command);
  const result = await runProbe(engine, "always-allow");
  expect(result.passed).toBe(false);
  expect(engine.answers.map((answer) => answer.optionId)).toEqual([REJECT.id]);
  expect(existsSync(join(engine.work, "lcp-persistent-permission-probe.txt"))).toBe(false);
  expect(existsSync(join(engine.work, ".claude", "settings.local.json"))).toBe(false);
  checkPrompt(engine);
});

it("issue 212: even the new write completing without a request still fails with the existing no-request outcome", async () => {
  const engine = make(writeCommand, null);
  const result = await runProbe(engine, "always-allow");
  expect(result.passed).toBe(false);
  expect(result.rows[0]?.outcome).toBe("no persistent permission request observed");
  expect(engine.answers).toEqual([]);
  expect(readFileSync(join(engine.work, "lcp-persistent-permission-probe.txt"), "utf8")).toBe("lcp-persistent-permission-probe\n");
  checkPrompt(engine);
});

it.each([undefined, "userSettings"])("m-3: the new write still denies an unverifiable or unsafe persistent destination (%s)", async (destination) => {
  const { destination: _destination, ...option } = ALWAYS;
  const engine = make(writeCommand, { ...option, ...(destination === undefined ? {} : { destination }) });
  const result = await runProbe(engine, "always-allow");
  expect(result.passed).toBe(false);
  expect(result.rows[0]?.outcome).toBe("no safe persistent option offered");
  expect(engine.answers.map((answer) => answer.optionId)).toEqual([REJECT.id]);
  expect(existsSync(join(engine.work, "lcp-persistent-permission-probe.txt"))).toBe(false);
  expect(existsSync(join(engine.work, ".claude", "settings.local.json"))).toBe(false);
  checkPrompt(engine);
});
