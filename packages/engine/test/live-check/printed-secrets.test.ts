import { afterEach, describe, expect, it } from "vitest";

import { createReporter } from "../../scripts/live/reporter.ts";
import { main } from "../../scripts/live/run.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: Array<ReturnType<typeof scriptedApi>> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); });
const setup = () => { const fixture = scriptedApi(); fixtures.push(fixture); return fixture; };

describe("credentials in live-check diagnostics", () => {
  it("never prints the owner credential in a failing setup error (catches forwarding raw dependency errors to the terminal; issue 200)", async () => {
    const fixture = setup();
    expect(await main([], { ...fixture.deps, harnessSettings: async () => { throw new Error(`adapter error: ${fixture.secret}`); } })).toBe(1);
    expect(fixture.lines.join("\n")).not.toContain(fixture.secret);
  });

  it("never prints a token from a rejected step promise (catches the printer echoing an arbitrary error without redaction; issue 200)", async () => {
    const token = "agent-token-only-for-this-test-0123456789";
    const lines: string[] = [];
    const reporter = createReporter((line) => { lines.push(line); });
    await reporter.step({ id: "lead", title: "start the lead" }, async () => { throw new Error(`Authorization: Bearer ${token}`); });
    expect(lines.join("\n")).not.toContain(token);
    expect(reporter.failed()).toBe(true);
  });

  it("fails final when the printer received a credential (catches omitting printed diagnostics from the final scan; issue 200)", async () => {
    const fixture = setup();
    // A misconfigured model is printed by setup. It does not occur in any
    // event or API reply in this controlled response stream.
    const config = { ...fixture.deps.config, leadModel: fixture.secret };
    expect(await main([], { ...fixture.deps, config })).toBe(1);
    expect(fixture.lines.some((line) => line.startsWith("FAIL final:"))).toBe(true);
  });
});
