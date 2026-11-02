// Unit 8c: `pnpm live-check --dry-run` and `--help`. The dry run prints every
// prompt in full, in send order, and starts and reads nothing. It is proved two
// ways: `main` with dependencies that count every call (all must stay at zero),
// and the real entry file run as a child process with an empty home and an
// empty PATH, where a start of any adapter or service could not succeed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { leadPromptFor, liveConfig, liveFolders, REPRESENTATIVE_ROOT } from "../../scripts/live/driver.ts";
import * as prompts from "../../scripts/live/prompts.ts";
import { dryRunText, HELP, main, parseArguments, type RunDeps } from "../../scripts/live/run.ts";
import { ALL_STEPS } from "../../scripts/live/steps.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const entry = fileURLToPath(new URL("../../scripts/live-check.ts", import.meta.url));
const observer = fileURLToPath(new URL("./observe-process.mjs", import.meta.url));

const promptConstants: ReadonlyArray<readonly [string, string]> = Object.entries(prompts as Record<string, unknown>)
  .flatMap(([name, value]) => typeof value === "string" ? [[name, value] as const] : []);

// What the dry run shows for a prompt constant: the lead's prompt is shown
// filled in (fix round 1, F8), the others as written.
const shownFor = (name: string, text: string, config = liveConfig({})): string =>
  name === "LEAD_PROMPT" ? leadPromptFor(config, liveFolders(`${REPRESENTATIVE_ROOT}/work`).worker) : text;

// Every dependency that would start, connect or read something counts its calls.
const counting = (): { readonly deps: RunDeps; readonly calls: Array<string>; readonly lines: Array<string> } => {
  const calls: Array<string> = [];
  const lines: Array<string> = [];
  const touch = (name: string) => () => { calls.push(name); throw new Error(`${name} was called`); };
  const deps: RunDeps = {
    write: (line) => { lines.push(line); },
    environment: new Proxy({}, { get: (_target, key) => { calls.push(`environment.${String(key)}`); return undefined; } }),
    hook: { environment: {}, listServices: touch("listServices"), lockExists: touch("lockExists"), answers: touch("answers"), sleep: touch("sleep") },
    startService: touch("startService"), connectOwner: touch("connectOwner"), harnessSettings: touch("harnessSettings"),
    record: touch("record"), outputDirectory: "/nonexistent", clock: touch("clock"),
    config: { leadHarness: "claude", leadAccount: "claude", leadModel: "m", leadEffort: "e", workerHarness: "codex", workerAccount: "codex", workerModel: "m", workerEffort: "e", agentTimeout: 1, totalTimeout: 1 },
    engineTimeout: 1, settle: 1, serveTimeout: 1,
  };
  return { deps, calls, lines };
};

const folders: Array<string> = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe("pnpm live-check --dry-run", () => {
  it("prints every exported prompt constant in full and exits 0, calling nothing (breaks if a prompt is left out, or the dry run starts or reads anything)", async () => {
    const { deps, calls, lines } = counting();
    const code = await main(["--dry-run"], deps);
    const output = lines.join("\n");
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(promptConstants.map(([name]) => name).sort()).toEqual(["LEAD_PROMPT", "RECORDER_PROMPT", "WORKER_PROMPT"]);
    for (const [name, text] of promptConstants) {
      expect(output, `the dry run does not show ${name} in full`).toContain(shownFor(name, text, deps.config));
      expect(output).toContain(name);
    }
  });

  it("prints the prompts in send order and names the harness that receives each (breaks if the order or the receiver is wrong)", () => {
    const output = dryRunText();
    const at = (name: string) => output.indexOf(`: ${name}\n`);
    expect(at("LEAD_PROMPT")).toBeGreaterThan(-1);
    expect(at("LEAD_PROMPT")).toBeLessThan(at("WORKER_PROMPT"));
    expect(at("WORKER_PROMPT")).toBeLessThan(at("RECORDER_PROMPT"));
    expect(output).toContain("Sent to: Claude Code (the lead)");
    expect(output).toContain("Sent to: Codex (the worker)");
    expect(output).toContain("Sent to: Claude Code and Codex");
    expect(prompts.PROMPTS.map((entry) => entry.name)).toEqual(["LEAD_PROMPT", "WORKER_PROMPT", "RECORDER_PROMPT"]);
  });

  it("lists every step the run would take (breaks if the dry run and the run disagree about the steps)", () => {
    const output = dryRunText();
    for (const step of ALL_STEPS) expect(output).toContain(`${step.id}: ${step.title}`);
  });

  it("is what --help names, and an unknown argument is refused with exit 2 (breaks if --dry-run is undocumented, or a typo starts a live run)", async () => {
    expect(HELP).toContain("--dry-run");
    expect(parseArguments(["--help"])).toEqual({ kind: "help" });
    expect(parseArguments([])).toEqual({ kind: "run" });
    expect(parseArguments(["--dry-run"])).toEqual({ kind: "dry-run" });
    expect(parseArguments(["--dryrun"])).toEqual({ kind: "error", message: "Unknown argument: --dryrun" });
    const { deps, calls, lines } = counting();
    expect(await main(["--dryrun"], deps)).toBe(2);
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toContain("--dry-run");
    const help = counting();
    expect(await main(["--help"], help.deps)).toBe(0);
    expect(help.calls).toEqual([]);
  });

  it("run as the real entry file, with an empty home and no PATH, prints every prompt, exits 0, and itself creates no folder in /tmp and starts no process (breaks if the entry starts a service or adapter, or reads the home)", () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "sh8c-dry-")));
    const observed = realpathSync(mkdtempSync(join(tmpdir(), "sh8c-dry-observed-")));
    folders.push(home, observed);
    const log = join(observed, "calls.log");
    // Fix round 1, finding F4: this used to compare the whole of /tmp before
    // and after, which fails when another run (or another test file) creates
    // or removes a `shephrd-live-` folder meanwhile. The observer records what
    // this one process asks the system to do, so only its own actions count.
    const run = spawnSync(process.execPath, ["--import", observer, entry, "--dry-run"], { env: { HOME: home, PATH: "", OBSERVE_LOG: log }, encoding: "utf8", timeout: 60_000 });
    expect(run.status, run.stderr).toBe(0);
    for (const [name, text] of promptConstants) {
      expect(run.stdout).toContain(shownFor(name, text));
      expect(run.stdout).toContain(name);
    }
    expect(run.stderr).toBe("");
    expect(readdirSync(home)).toEqual([]);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls[0], "the observer did not run, so nothing below proves anything").toBe("observer started");
    expect(calls.filter((call) => /^(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork) /.test(call)), "the dry run started a process").toEqual([]);
    expect(calls.filter((call) => /^(mkdtempSync|mkdirSync|mkdir|mkdtemp|createWriteStream) /.test(call) && call.includes("/tmp/shephrd-live-")), "the dry run made a run folder").toEqual([]);
  });
});
