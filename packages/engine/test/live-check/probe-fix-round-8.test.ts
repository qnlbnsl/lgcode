import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { flow, makeStepRunner } from "../../scripts/live/flow.ts";
import { leadPromptFor, liveConfig } from "../../scripts/live/driver.ts";
import { WORKER_PROMPT } from "../../scripts/live/prompts.ts";
import { createReporter } from "../../scripts/live/reporter.ts";
import { dryRunText, main } from "../../scripts/live/run.ts";
import { scenario, eventsUntil, isTag, refusal, requestId, stopAllServices } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: ReturnType<typeof scriptedApi>[] = [];
const make = (fault: Parameters<typeof scriptedApi>[0] = {}) => { const fixture = scriptedApi(fault); fixtures.push(fixture); return fixture; };
afterEach(async () => { for (const fixture of fixtures.splice(0)) fixture.dispose(); await stopAllServices(); });
const probes = ["sandbox-mcp", "permission-kinds", "removed-variables", "state-read", "slash-up", "slash-down", "always-allow", "reload", "token-scan"];

it("272: an ended worker with no permission request fails by cause and still collects every probe and final", async () => {
  const a = make({ workerEndsWithoutPermission: true });
  expect(await main([], a.deps)).toBe(1);
  const failure = a.lines.find((line) => line.startsWith("FAIL live-view:"));
  expect(failure).toContain("the worker's turn ended without a permission request (issue 272)");
  expect(failure).not.toContain("Timed out");
  for (const id of ["routed", "pass-up", "owner-answer", "wake"]) {
    expect(a.lines.find((line) => line.startsWith(`SKIP ${id}:`))).toContain("no permission request (live-view failed; issue 272)");
  }
  for (const id of [...probes, "final"]) expect(a.lines.find((line) => line.startsWith(`PASS ${id}:`)), id).toBeDefined();
  expect(a.lines.find((line) => line.startsWith("SKIP recording:"))).toContain("live-view");
  expect(a.answers).toEqual([]);
  expect(a.calls).not.toContain("record");
  expect(a.removeCount).toBe(0);
});

it.each(["live-view", "routed", "pass-up", "owner-answer", "wake", "session", "wide-start"])("a %s failure retains independent probe and final evidence", async (step) => {
  const a = make({ step });
  expect(await main([], a.deps)).toBe(1);
  expect(a.lines.some((line) => line.startsWith(`FAIL ${step}:`))).toBe(true);
  for (const id of [...probes, "final"]) expect(a.lines.some((line) => line.startsWith(`PASS ${id}:`)), id).toBe(true);
  expect(a.calls).not.toContain("record");
});

it("a service failure remains a hard stop and names the missing probe precondition", async () => {
  const a = make({ step: "service" });
  expect(await main([], a.deps)).toBe(1);
  expect(a.lines.some((line) => line.startsWith("FAIL service:"))).toBe(true);
  for (const id of probes) expect(a.lines.find((line) => line.startsWith(`SKIP ${id}:`))).toContain("service");
  expect(a.calls).not.toContain("start");
  expect(a.calls).not.toContain("record");
});

it("a live-view failure with an actual request still evaluates its dependent steps without passing live-view", async () => {
  const a = make({ noThreadItem: true });
  expect(await main([], a.deps)).toBe(1);
  expect(a.lines.find((line) => line.startsWith("FAIL live-view:"))).toMatch(/thread item/i);
  for (const id of ["routed", "pass-up", "owner-answer", "wake", ...probes, "final"]) expect(a.lines.some((line) => line.startsWith(`PASS ${id}:`)), id).toBe(true);
});

it("the worker asks for approval explicitly, retries a read-only refusal once, and can report honest failure", () => {
  expect(WORKER_PROMPT).toMatch(/read-only until.*approval/i);
  expect(WORKER_PROMPT).toMatch(/request approval.*same write.*retry once/i);
  expect(WORKER_PROMPT).toMatch(/do not end.*before/i);
  expect(WORKER_PROMPT).toMatch(/denied|unavailable/i);
  expect(WORKER_PROMPT).not.toContain("Use your file editing tool, not a shell command");
  const rendered = leadPromptFor(liveConfig({}), "/tmp/example/project");
  expect(JSON.parse(rendered.match(/Step 2\. Call the "start" tool once, with exactly this input: (\{[^\n]+\})/)![1]!).prompt).toBe(WORKER_PROMPT);
  expect(dryRunText()).toContain(WORKER_PROMPT);
});

scenario("272 real fake-engine journey: a worker that refuses the write and ends cannot pass live-view or suppress later evidence", (w) => Effect.gen(function* () {
  const lines: string[] = [];
  const reporter = createReporter((line) => lines.push(line));
  const folder = join(w.root.work, "project");
  mkdirSync(folder, { recursive: true });
  let leadClient: typeof w.owner;
  let prepared: Effect.Success<ReturnType<typeof w.prepare>>;
  const boundary = make();
  const failure = yield* Effect.flip(flow({
    owner: w.owner, openOwner: () => w.reopenOwner(), step: makeStepRunner(reporter),
    driver: {
      startLead: () => Effect.gen(function* () {
        const lead = yield* w.start(w.owner, { role: "lead", permission: "edit", prompt: "Plan", script: { turns: [[]] } });
        yield* eventsUntil(w.owner, 0, "lead idle", isTag("TurnEnded", lead.agentId));
        leadClient = yield* w.asAgent((yield* w.token(lead)).token);
        return lead;
      }),
      wideStart: () => Effect.gen(function* () {
        prepared = yield* w.prepare({ folder, permission: "ask", groups: ["auth"], anyAccount: true, prompt: "write", script: { turns: [[{ step: "text", text: "read-only: cannot create hello.txt" }]] } });
        expect(yield* refusal(leadClient.start({ ...prepared.request, requestId: requestId(), permission: "full" } as never))).toBeDefined();
      }),
      startWorker: () => leadClient.start(prepared.request as never).pipe(Effect.asVoid), passUp: () => Effect.void,
    },
    probes: boundary.deps.probes!,
    leadHarness: "fake", workerHarness: "fake", workerFolder: folder,
    agentTimeout: 500, engineTimeout: 5_000, settle: 1,
    secrets: () => w.secrets, outputs: () => [], replies: () => w.replies,
  }));
  expect(failure.stepId).toBe("live-view");
  expect(failure.message).toContain("issue 272");
  expect(failure.message).not.toContain("Timed out");
  for (const id of [...probes, "final"]) expect(lines.some((line) => line.startsWith(`PASS ${id}:`)), id).toBe(true);
}), { timeout: 60_000 });
