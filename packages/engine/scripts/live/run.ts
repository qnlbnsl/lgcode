import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { connect, type Client } from "@shephrd/client";
import type { HarnessSettings } from "@shephrd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

import { resolveHarnessDefaults } from "../../src/runner/harnesses.ts";
import { agentText, envelope } from "../../src/routing/envelope.ts";
import { routedDelivery } from "../../src/routing/holders.ts";
import { liveConfig, liveDriver, liveFolders, LIVE_VARIABLES, registerAccounts, renderedPrompts, REPRESENTATIVE_ROOT, type LiveConfig } from "./driver.ts";
import { flow, makeStepRunner, StepFailed } from "./flow.ts";
import { PROMPTS, placeholdersOf, WORKER_PROMPT } from "./prompts.ts";
import { realRecord, recordLive, type RecordingDeps } from "./recording.ts";
import { createReporter, messageOf } from "./reporter.ts";
import { startLiveService, type LiveService } from "./service.ts";
import { checkStartupHook, realStartupHookDeps, type StartupHookDeps } from "./startupHook.ts";
import { ALL_STEPS, RECORDING_STEP, SERVICE_STEP, SETUP_STEP, STARTUP_HOOK_STEP } from "./steps.ts";
import { readOwnerCredentialFrom, recordReplies } from "./support.ts";

// Unit 8c: `pnpm live-check` (criterion 8.6). The owner runs it on the Herdr
// host. It is never part of `pnpm check`: it uses the owner's real Claude Code
// and Codex accounts and re-writes the recorded fixtures.

export const HELP = `Usage: pnpm live-check [--dry-run] [--help]

Runs the engine's start-to-finish journey on the real Claude Code and Codex
adapters, in a fresh folder under /tmp, and prints one line for each step.

  --dry-run  Prints every prompt this check would send to a real agent, in send
             order, and the steps it would run. Sends nothing, starts no service,
             starts no adapter, and reads no real home. Exits 0.
  --help     Prints this text.

Needs Claude Code and Codex signed in on this machine, and Herdr's startup hook
to have started the service. Exits 0 only when every step passes.

Optional variables: ${Object.values(LIVE_VARIABLES).join(", ")}.`;

export type ParsedArguments =
  | { readonly kind: "run" | "dry-run" | "help" }
  | { readonly kind: "error"; readonly message: string };

export const parseArguments = (argv: ReadonlyArray<string>): ParsedArguments => {
  // Every argument is checked first, so help beside a typo is still an error.
  const unknown = argv.filter((argument) => argument !== "--dry-run" && argument !== "--help" && argument !== "-h");
  if (unknown.length > 0) return { kind: "error", message: `Unknown argument: ${unknown[0]}` };
  if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
  return { kind: argv.includes("--dry-run") ? "dry-run" : "run" };
};

// What the engine itself writes around the script's prompts, built by the
// engine's own formatting functions with stand-in ids. The marker in an
// envelope is random for each one; it is shown as MARKER.
const engineText = (): { readonly firstPrompt: string; readonly permission: string; readonly wait: string } => {
  const lead = { _tag: "agent", agentId: "LEAD_ID" } as const;
  const [queued] = routedDelivery("WORKER_ID" as never, lead as never, "DELIVERY_ID" as never, { _tag: "permission", id: "REQUEST_ID" } as never, "<the worker's description of the change>");
  const permission = queued !== undefined && queued._tag === "DeliveryQueued" && queued.delivery.content._tag === "prompt" ? queued.delivery.content.text : "";
  const plain = (text: string): string => {
    const marker = /Data from another agent \[([^\]]+)\]/.exec(text)?.[1];
    return marker === undefined ? text : text.replaceAll(marker, "MARKER");
  };
  return {
    firstPrompt: plain(agentText(lead as never, "DELIVERY_ID", WORKER_PROMPT)),
    permission: plain(permission),
    wait: plain(envelope("DELIVERY_ID", "Wait WAIT_ID finished.\n- agent WORKER_ID: settled")),
  };
};

// Everything the run would send and do, exactly as it would send it, and
// nothing else. The prompts are rendered by the function the driver uses; the
// folder in the lead's prompt is an example, because the run's own folder
// does not exist until the run starts.
export const dryRunText = (config: LiveConfig = liveConfig({})): string => {
  const exampleWork = `${REPRESENTATIVE_ROOT}/work`;
  const exampleWorker = liveFolders(exampleWork).worker;
  const prompts = renderedPrompts(config, exampleWorker);
  const lines: Array<string> = [
    "live-check --dry-run: nothing is sent, started or read.",
    `Models: lead ${config.leadHarness} ${config.leadModel} (effort ${config.leadEffort}); worker ${config.workerHarness} ${config.workerModel} (effort ${config.workerEffort}).`,
    `The example folder ${exampleWorker} stands in for the run's own folder, which is a new folder under /tmp.`, "",
  ];
  prompts.forEach((prompt, index) => {
    const placeholders = placeholdersOf(PROMPTS[index]!.text);
    lines.push(
      `Prompt ${index + 1} of ${prompts.length}: ${prompt.name}`,
      `Sent to: ${prompt.receiver}`,
      `When: ${prompt.step}`,
      `Values filled in above: ${placeholders.length === 0 ? "none" : placeholders.join(", ")}`,
      "----", prompt.text, "----", "",
    );
  });
  const engine = engineText();
  lines.push(
    "What else the agents receive. The engine writes these, not this script (it builds each with the same formatting code):",
    "",
    "A. The worker's first prompt reaches Codex wrapped in the engine's envelope, because the lead sent it (src/routing/envelope.ts, agentText):",
    "----", engine.firstPrompt, "----", "",
    "B. When the worker asks for permission, the lead receives this notice (src/routing/holders.ts, routedDelivery). The lead's prompt names it:",
    "----", engine.permission, "----", "",
    "C. When the lead's wait finishes, the lead receives this notice (src/routing/waits.ts, the notice built in check):",
    "----", engine.wait, "----", "",
    "The re-record step (scripts/live/recording.ts, scripts/recorder.ts) then starts more model sessions, each sent the RECORDER_PROMPT above:",
    "- one Claude Code recording and one Codex recording, each in a new temporary folder;",
    "- after a recording succeeds, one signed-out probe for that harness: the adapter is started with an empty temporary home and no account variables, and is expected to be refused for authentication.",
    "In all a full run starts at most 6 model sessions: 2 in the journey (the lead and the worker), 2 recordings, and up to 2 signed-out probes.", "",
    "Steps the run would take, in order:",
  );
  ALL_STEPS.forEach((step, index) => { lines.push(`${index + 1}. ${step.id}: ${step.title}`); });
  return lines.join("\n");
};

export interface RunDeps {
  readonly write: (line: string) => void;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly hook: StartupHookDeps;
  readonly startService: () => LiveService;
  readonly connectOwner: (state: string) => Effect.Effect<Client, unknown, Scope.Scope>;
  readonly harnessSettings: () => Promise<ReadonlyArray<HarnessSettings>>;
  readonly record: RecordingDeps["record"];
  readonly outputDirectory: string;
  readonly config: LiveConfig;
  readonly clock: () => number;
  // How long the engine alone may take for one step, how long to watch for a
  // second wake after the first, and how long the service may take to serve.
  readonly engineTimeout: number;
  readonly settle: number;
  readonly serveTimeout: number;
}

const fixturesFolder = fileURLToPath(new URL("../../../testing/fixtures", import.meta.url));

export const realDeps = (environment: Readonly<Record<string, string | undefined>>, write: (line: string) => void): RunDeps => ({
  write, environment,
  hook: realStartupHookDeps(environment),
  startService: () => startLiveService(environment),
  connectOwner: (state) => connect({ environment: { SHEPHRD_HOME: state }, attempts: 1 }),
  harnessSettings: async () => (await Effect.runPromise(resolveHarnessDefaults({
    binDirectory: fileURLToPath(new URL("../../node_modules/.bin", import.meta.url)), path: environment.PATH ?? "",
  }).pipe(Effect.provide(NodeServices.layer)))).harnesses,
  record: realRecord,
  outputDirectory: fixturesFolder,
  config: liveConfig(environment),
  clock: Date.now,
  engineTimeout: 30_000, settle: 5_000, serveTimeout: 60_000,
});

// Runs the check and returns the exit code. A step that fails stops the run:
// the steps after it are printed as skipped, so the owner reads the first
// cause, and a failed run spends no more of their usage than it must.
export const main = async (argv: ReadonlyArray<string>, deps: RunDeps): Promise<number> => {
  const parsed = parseArguments(argv);
  if (parsed.kind === "help") { deps.write(HELP); return 0; }
  if (parsed.kind === "error") { deps.write(`${parsed.message}\n${HELP}`); return 2; }
  if (parsed.kind === "dry-run") { deps.write(dryRunText(deps.config)); return 0; }

  const reporter = createReporter(deps.write, deps.clock);
  const step = makeStepRunner(reporter, deps.clock);
  const config = deps.config;
  let service: LiveService | undefined;
  let stopped = false;
  let timedOut = false;
  const controller = new AbortController();

  const stopService = async (): Promise<void> => {
    if (service === undefined || stopped) return;
    stopped = true;
    const killed = await service.stop();
    if (killed.length > 0) reporter.note(`These processes ignored the first signal and were killed: ${killed.join(", ")}`);
  };

  const body = async (): Promise<void> => {
    const hook = await reporter.step(STARTUP_HOOK_STEP, async () => {
      const result = await checkStartupHook(deps.hook);
      if (!result.passed) throw new Error(result.reason);
      return result;
    }, (result) => result.reason);
    if (!hook.passed) return;

    const replies: Array<string> = [];
    const journey = Effect.scoped(Effect.gen(function* () {
      const owner = yield* step(SERVICE_STEP, Effect.gen(function* () {
        service = deps.startService();
        const deadline = deps.clock() + deps.serveTimeout;
        for (;;) {
          if (service.exited()) return yield* Effect.fail(new Error(`the service exited before it served; its log is ${service.logFile}`));
          const probe = yield* Effect.exit(Effect.scoped(deps.connectOwner(service.state)));
          if (Exit.isSuccess(probe)) break;
          if (deps.clock() > deadline) return yield* Effect.fail(new Error(`the service did not serve within ${deps.serveTimeout / 1000} seconds; its log is ${service.logFile}`));
          yield* Effect.sleep(100);
        }
        const client = yield* deps.connectOwner(service.state);
        return recordReplies(client, replies);
      }), () => `service ${service?.pid} in ${service?.root}`);
      const live = service!;
      const { lead: leadFolder, worker: workerFolder } = liveFolders(live.work);
      yield* step(SETUP_STEP, Effect.gen(function* () {
        mkdirSync(workerFolder, { mode: 0o700 });
        yield* registerAccounts(owner, config, yield* Effect.promise(() => deps.harnessSettings()), deps.environment);
      }), () => `${config.leadHarness} (${config.leadModel}, ${config.leadEffort}) and ${config.workerHarness} (${config.workerModel}, ${config.workerEffort})`);
      return yield* flow({
        owner, openOwner: () => deps.connectOwner(live.state).pipe(Effect.map((client) => recordReplies(client, replies))),
        driver: liveDriver(owner, config, leadFolder, workerFolder), step,
        leadHarness: config.leadHarness, workerHarness: config.workerHarness, workerFolder,
        agentTimeout: config.agentTimeout, engineTimeout: deps.engineTimeout, settle: deps.settle,
        secrets: () => readOwnerCredentialFrom(live.state),
        outputs: () => [{ label: "the output of the service process", text: live.output() }],
        replies: () => replies,
      });
    }));
    const exit = await Effect.runPromiseExit(journey, { signal: controller.signal });
    if (Exit.isFailure(exit)) {
      if (timedOut) return;
      const error = Cause.squash(exit.cause);
      // A failed step has printed its own line; anything else is unexpected.
      if (!(error instanceof StepFailed) || error.stepId === "flow") {
        reporter.fail({ id: "journey", title: "the journey ran without an unexpected error" }, messageOf(error));
      }
      return;
    }
    await stopService();
    await reporter.step(RECORDING_STEP, async () => {
      const outcome = await recordLive({
        environment: deps.environment, settings: await deps.harnessSettings(), outputDirectory: deps.outputDirectory, record: deps.record,
      });
      reporter.note(outcome.report.replaceAll("\n", " | "));
      if (!outcome.passed) throw new Error(outcome.reason);
      return outcome;
    }, (outcome) => outcome.reason);
  };

  const limit = new Promise<"timeout">((done) => {
    const timer = setTimeout(() => done("timeout"), config.totalTimeout);
    timer.unref();
  });
  try {
    const outcome = await Promise.race([body().then(() => "done" as const), limit]);
    if (outcome === "timeout") {
      timedOut = true;
      controller.abort();
      reporter.fail({ id: "time-limit", title: `the whole run finishes within ${config.totalTimeout / 1000} seconds` }, "the run took longer; the last step printed above was the one still running");
    }
  } catch (error) {
    reporter.fail({ id: "journey", title: "the journey ran without an unexpected error" }, messageOf(error));
  } finally {
    await stopService().catch(() => undefined);
  }

  if (reporter.failed()) {
    const ran = new Set(reporter.results().map((result) => result.id));
    for (const spec of ALL_STEPS) if (!ran.has(spec.id)) reporter.skip(spec, "an earlier step failed");
    if (service !== undefined) {
      reporter.note(`The run's folder is kept at ${service.root}; the service's log is ${service.logFile}. The real service was not touched.`);
    }
  } else if (service !== undefined) {
    service.remove();
  }
  const code = reporter.exitCode(ALL_STEPS);
  deps.write(code === 0
    ? `live-check: all ${ALL_STEPS.length} steps passed`
    : `live-check: failed (${reporter.results().filter((result) => result.passed).length} of ${ALL_STEPS.length} steps passed)`);
  return code;
};
