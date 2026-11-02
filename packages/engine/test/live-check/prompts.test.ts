// Unit 8c: the prompt constants of `pnpm live-check`. The lead's prompt is the
// whole script for a real agent, so its two literal `start` inputs must be
// valid JSON after the run-time values are filled in.
import { describe, expect, it } from "vitest";

import { leadPromptFor, liveConfig } from "../../scripts/live/driver.ts";
import { fill, LEAD_PROMPT, placeholdersOf, PROMPTS, WORKER_PROMPT } from "../../scripts/live/prompts.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const inputsOf = (text: string): ReadonlyArray<Record<string, unknown>> =>
  [...text.matchAll(/with exactly this input: (\{.*\})$/gm)].map((match) => JSON.parse(match[1]!) as Record<string, unknown>);

describe("the live-check prompts", () => {
  it("fills the four placeholders of the lead prompt into two valid start inputs for a Codex worker (breaks if a placeholder is renamed, or a folder or prompt breaks the JSON)", () => {
    expect([...placeholdersOf(LEAD_PROMPT)].sort()).toEqual(["WORKER_EFFORT", "WORKER_FOLDER", "WORKER_MODEL", "WORKER_PROMPT_JSON"]);
    const filled = leadPromptFor(liveConfig({}), "/tmp/shephrd-live-x/work/project");
    expect(filled).not.toContain("{{");
    const [wide, real] = inputsOf(filled);
    expect(wide).toMatchObject({ harness: "codex", permission: "full", account: { _tag: "any" }, groups: ["auth"], runMode: "acp", folder: "/tmp/shephrd-live-x/work/project" });
    expect(real).toMatchObject({
      harness: "codex", permission: "ask", account: { _tag: "any" }, groups: ["auth"], runMode: "acp",
      folder: "/tmp/shephrd-live-x/work/project", model: "gpt-6-luna", effort: "low", prompt: WORKER_PROMPT,
    });
  });

  it("fills a folder with a quote in it without breaking the JSON (breaks if the folder is not escaped)", () => {
    const [, real] = inputsOf(leadPromptFor(liveConfig({}), '/tmp/a"b\\c'));
    expect(real!.folder).toBe('/tmp/a"b\\c');
  });

  it("refuses a missing or an unused value (breaks if a typo in a placeholder name sends the agent a raw {{NAME}})", () => {
    expect(() => fill("a {{ONE}} b {{TWO}}", { ONE: "1" })).toThrow("{{TWO}}");
    expect(() => fill("a {{ONE}}", { ONE: "1", EXTRA: "2" })).toThrow("EXTRA");
    expect(fill("a {{ONE}} {{ONE}}", { ONE: "1" })).toBe("a 1 1");
  });

  it("lists each prompt once, with a receiver, a step and its text (breaks if a prompt is added to the file but not to the list the dry run prints)", () => {
    expect(new Set(PROMPTS.map((entry) => entry.name)).size).toBe(PROMPTS.length);
    for (const entry of PROMPTS) {
      expect(entry.receiver).not.toBe("");
      expect(entry.step).not.toBe("");
      expect(entry.text.length).toBeGreaterThan(20);
    }
  });

  it("takes the model and effort from the variables when they are set (breaks if the owner cannot change the cheapest pick)", () => {
    const config = liveConfig({ SHEPHRD_LIVE_WORKER_MODEL: "other", SHEPHRD_LIVE_AGENT_TIMEOUT_SECONDS: "12", SHEPHRD_LIVE_TOTAL_TIMEOUT_SECONDS: "nonsense" });
    expect(config).toMatchObject({ workerModel: "other", leadModel: "haiku", leadEffort: "low", workerEffort: "low", agentTimeout: 12_000, totalTimeout: 1_800_000 });
  });
});
