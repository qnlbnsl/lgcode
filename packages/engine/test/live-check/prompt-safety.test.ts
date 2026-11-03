import { afterEach, describe, expect, it } from "vitest";

import { fill, PROMPTS } from "../../scripts/live/prompts.ts";
import { main } from "../../scripts/live/run.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: Array<ReturnType<typeof scriptedApi>> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); });

describe("prompt placeholders at the send boundary", () => {
  it.each(PROMPTS)("fills every placeholder of $name and rejects each missing value (catches a newly added constant bypassing runtime filling)", (prompt) => {
    const names = [...new Set([...prompt.text.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]!))];
    const values = Object.fromEntries(names.map((name) => [name, `value-for-${name}`]));
    const filled = fill(prompt.text, values);
    expect(filled).not.toMatch(/\{\{[^{}]+\}\}/);
    for (const name of names) {
      expect(filled).toContain(`value-for-${name}`);
      const missing = { ...values };
      delete missing[name];
      expect(() => fill(prompt.text, missing)).toThrow(`{{${name}}}`);
    }
  });

  it("rejects a replacement that leaves another placeholder unresolved (catches one-pass substitution sending raw placeholders; issue 201)", () => {
    expect(() => fill("Use {{MODEL}}", { MODEL: "{{UNRESOLVED}}" })).toThrow(/placeholder|UNRESOLVED/);
  });

  it("never sends an unresolved configured model to the lead (catches checking the template but not the final prompt; issue 201)", async () => {
    const fixture = scriptedApi();
    fixtures.push(fixture);
    const code = await main([], { ...fixture.deps, config: { ...fixture.deps.config, workerModel: "{{UNRESOLVED_MODEL}}" } });
    expect(fixture.calls.filter((call) => call === "start"), "the API must never receive the unresolved prompt").toEqual([]);
    expect(code).toBe(1);
    expect(fixture.lines.some((line) => line.startsWith("FAIL lead:"))).toBe(true);
  });
});
