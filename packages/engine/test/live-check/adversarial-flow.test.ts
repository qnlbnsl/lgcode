import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";

import { liveDriver } from "../../scripts/live/driver.ts";
import { flow, makeStepRunner } from "../../scripts/live/flow.ts";
import { createReporter } from "../../scripts/live/reporter.ts";
import { main } from "../../scripts/live/run.ts";
import { ALL_STEPS } from "../../scripts/live/steps.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi, type Faults } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: Array<ReturnType<typeof scriptedApi>> = [];
const setup = (fault: Faults = {}) => { const fixture = scriptedApi(fault); fixtures.push(fixture); return fixture; };
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); });

// Hand-derived order: the expected list deliberately does not come from the
// production ALL_STEPS list that the runner also uses to decide its exit code.
const ids = ["startup-hook", "service", "setup", "lead", "wide-start", "worker-start", "session", "live-view", "routed", "pass-up", "owner-answer", "wake", "final", "recording"];
const printed = (lines: string[]) => lines.flatMap((line) => /^(PASS|FAIL|SKIP) ([a-z-]+):/.exec(line)?.slice(1) ?? []);

describe("the real runner and flow against a controlled API", () => {
  it("returns 0 only after all fourteen steps pass, closes before recording, and answers on the second owner connection (catches a missing step, wrong answer connection, or premature success)", async () => {
    const fixture = setup();
    expect(await main([], fixture.deps)).toBe(0);
    expect(printed(fixture.lines)).toEqual(ids.flatMap((id) => ["PASS", id]));
    // Connection 0 is the readiness probe, 1 the primary owner, 2 the phone,
    // and 3 the live-view watcher. Both answers must use the phone.
    expect(fixture.answers).toEqual([
      { connection: 2, input: expect.objectContaining({ kind: "permission", id: "permission", optionId: "allow-once" }) },
      { connection: 2, input: expect.objectContaining({ kind: "permission", id: "permission", optionId: "allow-once" }) },
    ]);
    expect(fixture.calls.indexOf("stopped")).toBeLessThan(fixture.calls.indexOf("record"));
    expect(fixture.stopCount).toBe(1);
    expect(fixture.removeCount).toBe(1);
    expect(fixture.lines.at(-1)).toBe("live-check: all 14 steps passed");
  });

  it.each(ids)("a defect at %s exits nonzero and prints SKIP for every later step (catches an ignored failure at any position, including the first and last)", async (id) => {
    const fixture = setup({ step: id });
    expect(await main([], fixture.deps)).toBe(1);
    const at = ids.indexOf(id);
    expect(printed(fixture.lines)).toEqual(ids.flatMap((step, index) => [index < at ? "PASS" : index === at ? "FAIL" : "SKIP", step]));
    expect(fixture.stopCount).toBe(id === "startup-hook" ? 0 : 1);
    expect(fixture.removeCount).toBe(0);
    expect(fixture.calls.filter((call) => call === "record")).toHaveLength(id === "recording" ? 1 : 0);
  });

  it("refuses an accepted wide start at wide-start (catches a live check that trusts the lead's attempt instead of the engine's refusal)", async () => {
    const fixture = setup({ wideAccepted: true });
    expect(await main([], fixture.deps)).toBe(1);
    expect(fixture.lines.find((line) => line.startsWith("FAIL wide-start:"))).toContain("refusal");
    expect(fixture.answers).toEqual([]);
  });

  it("fails owner-answer if a later repeated answer is accepted (catches a missing first-answer-wins assertion)", async () => {
    const fixture = setup({ repeatAnswerAccepted: true });
    expect(await main([], fixture.deps)).toBe(1);
    expect(fixture.lines.find((line) => line.startsWith("FAIL owner-answer:"))).toContain("second answer from the owner was accepted");
  });

  it("fails wake on a second queued wake even when the first was accepted (catches counting only accepted wakes)", async () => {
    const fixture = setup({ duplicateWake: true });
    expect(await main([], fixture.deps)).toBe(1);
    expect(fixture.lines.find((line) => line.startsWith("FAIL wake:"))).toContain("woken 2 times");
  });

  it.each(["event", "reply", "output"] as const)("fails final when the owner credential reaches an %s, and prints only the location (catches a missing leak source or a diagnostic that repeats the secret)", async (leak) => {
    const fixture = setup({ leak });
    expect(await main([], fixture.deps)).toBe(1);
    expect(fixture.lines.find((line) => line.startsWith("FAIL final:"))).toContain("credential or secret was found");
    expect(fixture.lines.join("\n")).not.toContain(fixture.secret);
  });

  it.each(["event", "reply", "output"] as const)("fails final when an agent token reaches an %s (catches scanning only the owner credential when a token is supplied)", async (leak) => {
    const fixture = setup({ leak, secret: "agent-token-only-for-this-test-0123456789" });
    const owner = await Effect.runPromise(Effect.scoped(fixture.deps.connectOwner(fixture.state)));
    const reporter = createReporter((line) => { fixture.lines.push(line); });
    const failure = await Effect.runPromise(Effect.scoped(Effect.flip(flow({
      owner, openOwner: () => fixture.deps.connectOwner(fixture.state),
      driver: liveDriver(owner, fixture.deps.config, `${fixture.work}/lead`, `${fixture.work}/project`),
      step: makeStepRunner(reporter), leadHarness: "claude", workerHarness: "codex", workerFolder: `${fixture.work}/project`,
      agentTimeout: 60, engineTimeout: 60, settle: 1, secrets: () => [fixture.secret], replies: () => fixture.replies,
      outputs: () => [{ label: "fake process output", text: fixture.service.output() }],
    }))));
    expect(failure.stepId).toBe("final");
    expect(failure.message).toContain("credential or secret was found");
    expect(fixture.lines.join("\n")).not.toContain(fixture.secret);
    expect(reporter.exitCode(ALL_STEPS)).toBe(1);
  });
});
