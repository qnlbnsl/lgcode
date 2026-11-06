// Unit 8c: the step printer and the exit code of `pnpm live-check`.
import { describe, expect, it } from "vitest";

import { createReporter, oneLine } from "../../scripts/live/reporter.ts";
import { ALL_STEPS, FLOW_STEPS } from "../../scripts/live/steps.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const a = { id: "a", title: "the first step" };
const b = { id: "b", title: "the second step" };

const make = () => {
  const lines: Array<string> = [];
  let now = 1_000;
  return { lines, reporter: createReporter((line) => { lines.push(line); }, () => (now += 10)) };
};

describe("the reporter", () => {
  it("prints one PASS line for a step that passes and one FAIL line with its reason for a step that throws (breaks if a failure prints as a pass or its reason is lost)", async () => {
    const { lines, reporter } = make();
    const first = await reporter.step(a, async () => 5, (value) => `got ${value}`);
    const second = await reporter.step(b, async () => { throw new Error("the lead never started"); });
    expect(first).toEqual({ passed: true, value: 5 });
    expect(second).toEqual({ passed: false });
    expect(lines).toEqual(["PASS a: the first step (got 5)", "FAIL b: the second step (the lead never started)"]);
  });

  it("exits 0 only when every expected step ran and passed (breaks if a missing step or a failure still exits 0)", async () => {
    const all = make();
    await all.reporter.step(a, async () => 1);
    await all.reporter.step(b, async () => 1);
    expect(all.reporter.exitCode([a, b])).toBe(0);

    const missing = make();
    await missing.reporter.step(a, async () => 1);
    expect(missing.reporter.exitCode([a, b])).toBe(1);

    const failed = make();
    await failed.reporter.step(a, async () => 1);
    failed.reporter.fail(b, "boom");
    expect(failed.reporter.failed()).toBe(true);
    expect(failed.reporter.exitCode([a, b])).toBe(1);
  });

  it("counts a skipped step as not passed, so a run that stopped early exits 1 (breaks if skipped steps hide a failure)", () => {
    const { lines, reporter } = make();
    reporter.fail(a, "boom");
    reporter.skip(b, "an earlier step failed");
    expect(lines[1]).toBe("SKIP b: the second step (an earlier step failed)");
    expect(reporter.results().map((result) => result.passed)).toEqual([false, false]);
    expect(reporter.exitCode([a, b])).toBe(1);
  });

  it("allows an explicitly optional skip while preserving missing and failed step checks", () => {
    const { reporter } = make();
    reporter.skip(a, "the optional plugin is absent", true);
    reporter.pass(b, "the core check passed");
    expect(reporter.failed()).toBe(false);
    expect(reporter.exitCode([a, b])).toBe(0);
    expect(reporter.exitCode([a, b, { id: "missing", title: "missing" }])).toBe(1);
  });

  it("folds a reason onto one line and cuts a very long one (breaks if a stack buries the other steps)", () => {
    expect(oneLine("line one\n   line two\n\n")).toBe("line one line two");
    const long = oneLine("x".repeat(5_000));
    expect(long.length).toBe(400);
    expect(long.endsWith("…")).toBe(true);
    const { lines, reporter } = make();
    reporter.fail(a, "first\nsecond\nthird");
    expect(lines).toHaveLength(1);
  });

  it("lists every step once, in the order they run, with the startup hook first and the recording last (breaks if a step is added to the flow and not to the printed list)", () => {
    const ids = ALL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("startup-hook");
    expect(ids[ids.length - 1]).toBe("recording");
    for (const step of FLOW_STEPS) expect(ids).toContain(step.id);
    expect(ids.slice(ids.indexOf("wake") + 1, ids.indexOf("final"))).toEqual(["sandbox-mcp", "removed-variables", "state-read", "slash-up", "slash-down", "always-allow", "permission-kinds", "reload", "token-scan"]);
  });
});
