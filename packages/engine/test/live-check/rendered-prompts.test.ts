// Unit 8c, fix round 1, findings F6 to F9: what the owner reads in `--dry-run`
// is what the script sends, the lead's prompt says where the engine's notices
// arrive, an unresolved placeholder never leaves the script, and a bad
// argument is refused before help is chosen.
import { afterEach, describe, expect, it } from "vitest";

import { leadPromptFor, liveConfig, liveFolders, renderedPrompts, REPRESENTATIVE_ROOT } from "../../scripts/live/driver.ts";
import { fill, LEAD_PROMPT, PROMPTS, WORKER_PROMPT } from "../../scripts/live/prompts.ts";
import { dryRunText, main, parseArguments } from "../../scripts/live/run.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: Array<ReturnType<typeof scriptedApi>> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); });

describe("--dry-run shows the prompts as they are sent (F8)", () => {
  it("equals the lead prompt the driver sends for the same configuration, apart from the labelled example folder (breaks if the dry run prints the template, or renders with another function)", async () => {
    const fixture = scriptedApi();
    fixtures.push(fixture);
    const config = fixture.deps.config;
    expect(await main([], fixture.deps)).toBe(0);
    const sent = fixture.starts[0]!;
    const exampleWorker = liveFolders(REPRESENTATIVE_ROOT + "/work").worker;
    const shown = dryRunText(config);
    expect(shown.replaceAll(exampleWorker, liveFolders(fixture.work).worker)).toContain(sent.prompt);
    expect(shown).toContain(leadPromptFor(config, exampleWorker));
    expect(shown).not.toContain("{{");
    expect(sent.model).toBe(config.leadModel);
    expect(sent.effort).toBe(config.leadEffort);
    expect(renderedPrompts(config, exampleWorker).map((entry) => entry.text)).toContain(WORKER_PROMPT);
  });

  it("uses the models and efforts the environment sets, in the lead prompt and in the setup list (breaks if the dry run shows the defaults while the run uses the owner's choice)", () => {
    const config = liveConfig({ LGTM_LIVE_WORKER_MODEL: "my-worker-model", LGTM_LIVE_WORKER_EFFORT: "high", LGTM_LIVE_LEAD_MODEL: "my-lead-model" });
    const shown = dryRunText(config);
    expect(shown).toContain('"model":"my-worker-model","effort":"high"');
    expect(shown).toContain("my-lead-model");
    expect(shown).not.toContain("gpt-6-luna");
  });

  it("labels the example folder as an example under /tmp (breaks if the owner could take the example for the real folder)", () => {
    expect(REPRESENTATIVE_ROOT.startsWith("/tmp/")).toBe(true);
    expect(dryRunText(liveConfig({}))).toMatch(/example folder.*\/tmp\//i);
  });

  it("lists what the engine adds: the envelope around the worker's first prompt, the permission notice, the wait notice, and the recorder's sessions (breaks if the owner is not told what else the agents receive)", () => {
    const shown = dryRunText(liveConfig({}));
    expect(shown).toMatch(/Data from another agent \[[^\]]+\] \(delivery [^)]+\):\n/);
    expect(shown).toContain(`${WORKER_PROMPT}\nEnd data [`);
    expect(shown).toMatch(/Permission request \S+ from agent \S+:/);
    expect(shown).toMatch(/Wait \S+ finished\.\n- agent \S+: settled/);
    expect(shown).toContain("src/routing/holders.ts");
    expect(shown).toContain("src/routing/waits.ts");
    expect(shown).toMatch(/Claude Code[^\n]*recording/i);
    expect(shown).toMatch(/Codex[^\n]*recording/i);
    expect(shown).toMatch(/signed-out/i);
  });
});

describe("the lead prompt names the envelope (F9)", () => {
  it("tells the lead that the permission and wait notices arrive inside the engine's data envelope, with a representative notice for each (breaks if the lead is told to look for a message that starts with the notice text)", () => {
    expect(LEAD_PROMPT).toContain("Data from another agent [");
    expect(LEAD_PROMPT).toContain("End data [");
    expect(LEAD_PROMPT).toMatch(/Permission request \S+ from agent \S+:/);
    expect(LEAD_PROMPT).toMatch(/Wait \S+ finished\./);
    expect(LEAD_PROMPT).not.toMatch(/message that starts with "(Permission request|Wait)"/);
    expect(LEAD_PROMPT.length).toBeLessThan(4_000);
  });
});

describe("a placeholder never leaves the script unresolved (F7)", () => {
  it("rejects a value that carries a placeholder, naming it (breaks if only the template is checked)", () => {
    expect(() => fill("Use {{MODEL}}", { MODEL: "{{OTHER}}" })).toThrow("{{OTHER}}");
    expect(() => leadPromptFor({ ...liveConfig({}), workerEffort: "{{EFFORT}}" }, "/tmp/x")).toThrow("{{EFFORT}}");
  });

  it("still accepts a value with single braces", () => {
    expect(fill("Use {{MODEL}}", { MODEL: "a{b}c" })).toBe("Use a{b}c");
  });

  it("lists every prompt by name in the rendered list (breaks if a prompt is added to the file but not rendered)", () => {
    expect(renderedPrompts(liveConfig({}), "/tmp/x").map((entry) => entry.name)).toEqual(PROMPTS.map((entry) => entry.name));
  });
});

describe("every argument is checked before help is chosen (F6)", () => {
  it.each([["--help", "--bogus"], ["-h", "--bogus"], ["--bogus", "--help"], ["--dry-run", "--bogus", "-h"]])("%j is an error naming the first unknown argument", (...argv) => {
    expect(parseArguments(argv)).toEqual({ kind: "error", message: "Unknown argument: --bogus" });
  });

  it("still gives help for help alone and for help beside the dry run", () => {
    expect(parseArguments(["--help"])).toEqual({ kind: "help" });
    expect(parseArguments(["-h", "--dry-run"])).toEqual({ kind: "help" });
  });
});
