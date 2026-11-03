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
import { liveProbeDriver } from "./liveProbes.ts";
import type { ProbeDriver } from "./probes.ts";
import { flow, makeStepRunner, StepFailed } from "./flow.ts";
import { PROMPTS, placeholdersOf, WORKER_PROMPT } from "./prompts.ts";
import { realRecord, recordLive, type RecordingDeps } from "./recording.ts";
import { createReporter, messageOf, StepCancelled } from "./reporter.ts";
import { startLiveService, type LiveService } from "./service.ts";
import { checkStartupHook, realStartupHookDeps, type StartupHookDeps } from "./startupHook.ts";
import { ALL_STEPS, RECORDING_STEP, SERVICE_STEP, SETUP_STEP, STARTUP_HOOK_STEP } from "./steps.ts";
import { readOwnerCredentialFrom, recordReplies, redactSecrets, redactShapes } from "./support.ts";

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
    "The journey steps startup-hook through wake remain fail-fast. The probes sandbox-mcp through token-scan continue after a probe failure when their own preconditions hold: the service answers and their needed agents are alive and idle. A probe with unavailable preconditions is skipped with its reason; final still runs after a probe failure; recording requires every earlier step to pass. Any failure keeps the overall exit nonzero.",
    "The probe prompts above add turns to the same two sessions. The reload step restarts the service twice: one working-turn carry-on, then one pending-envelope replay. Each uses SIGKILL on this run's service child only.",
    "The worker account sets CODEX_CONFIG to shell_environment_policy.inherit=core for SEC-PB-8. Shell permissions are answered only for the exact printed command; always allow is used only in its named step.",
    "PB-A10 already has real evidence in packages/testing/fixtures/{claude,codex}.ndjson. The sandbox-mcp log cites the adapter versions, negotiated ACP versions and config categories; no separate probe is added.",
    "Slash evidence is direction-specific: SEC-PB-2 observes only the Claude parent receiver, and SEC-PB-7 only the Codex child receiver. The other row is explicitly not applicable. PB-A7 old-token refusal is checked for both agents at each restart.",
    "Core inheritance requires the shell's name-only environment listing to omit both identity variables before env -u removes them. Token-scan requires each agent's own tokens, nonempty session files, arguments and environment snapshots.",
    "Persistent permission options with no verifiable localSettings/session destination are denied as no safe persistent option offered. Today's public permission contract omits that destination, so SEC-PB-4 may remain unproven.",
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
  // After the total limit, how long to wait for the cancelled work to end.
  readonly cancelGrace?: number;
  // Tests replace only the external adapter boundary, never the flow or gates.
  readonly probes?: ProbeDriver;
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

// How long the run waits, after the total limit cancels it, for the body to
// finish its own cleanup (the journey's finalizers, the recorder's process
// groups) before it gives up and says the cleanup was not confirmed.
const DEFAULT_CANCEL_GRACE = 30_000;

// The journey is fail-fast. Probes collect independent evidence after a
// failure, then final still checks the views and secrets. Recording requires
// every earlier step to pass. Any failure keeps the overall exit nonzero.
//
// One AbortController owns the whole body (the startup-hook probe, the
// journey and the recording). The total limit aborts it, then the run waits
// for the body to end, stops what it started, prints the summary last and
// closes the output. Nothing starts and nothing prints after `main` returns.
export const main = async (argv: ReadonlyArray<string>, deps: RunDeps): Promise<number> => {
  const parsed = parseArguments(argv);
  if (parsed.kind === "help") { deps.write(HELP); return 0; }
  if (parsed.kind === "error") { deps.write(`${parsed.message}\n${HELP}`); return 2; }
  if (parsed.kind === "dry-run") { deps.write(dryRunText(deps.config)); return 0; }

  let service: LiveService | undefined;
  let stopped = false;
  let timedOut = false;
  let cleanupUnconfirmed = false;
  let open = true;
  const controller = new AbortController();

  // The run's secret list. The owner credential joins it the first time it can
  // be read and stays on it; every printed line is redacted with the list.
  let credential: ReadonlyArray<string> = [];
  const agentSecrets = new Set<string>();
  const probeOutputs: Array<{ label: string; text: string }> = [];
  const registered = (): ReadonlyArray<string> => {
    if (credential.length === 0 && service !== undefined) {
      try { credential = readOwnerCredentialFrom(service.state); } catch { /* The final step reports an unreadable credential. */ }
    }
    return [...credential, ...agentSecrets];
  };
  const reporter = createReporter(
    (line) => { if (open) deps.write(line); }, deps.clock,
    (line) => redactShapes(redactSecrets(line, registered())),
  );
  const step = makeStepRunner(reporter, deps.clock);
  const config = deps.config;

  // A promise that is abandoned, not awaited, when the run is cancelled: the
  // step ends at once, and a late result is dropped.
  const abortable = <A>(promise: Promise<A>): Promise<A> => new Promise<A>((resolve, reject) => {
    if (controller.signal.aborted) { reject(new StepCancelled()); return; }
    const onAbort = (): void => { reject(new StepCancelled()); };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { controller.signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { controller.signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });

  const stopService = async (): Promise<void> => {
    if (service === undefined || stopped) return;
    stopped = true;
    try {
      const killed = await service.stop();
      if (killed.length > 0) reporter.note(`These processes ignored the first signal and were killed: ${killed.join(", ")}`);
    } catch (error) {
      cleanupUnconfirmed = true;
      reporter.fail({ id: "cleanup", title: "every process this run started has stopped" }, messageOf(error));
    }
  };

  const body = async (): Promise<void> => {
    const hook = await reporter.step(STARTUP_HOOK_STEP, async () => {
      const result = await abortable(checkStartupHook(deps.hook));
      if (!result.passed) throw new Error(result.reason);
      return result;
    }, (result) => result.reason);
    if (!hook.passed || controller.signal.aborted) return;

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
      const checkRestart = () => Effect.gen(function* () {
        if (service?.restart === undefined) return yield* Effect.fail(new Error("not attempted: service wrapper cannot restart"));
        service = yield* Effect.tryPromise((signal) => service!.restart!(signal));
        const deadline = deps.clock() + deps.serveTimeout;
        for (;;) {
          if (service.exited()) return yield* Effect.fail(new Error("restarted service exited before listening"));
          const connected = yield* Effect.exit(Effect.scoped(deps.connectOwner(service.state)));
          if (Exit.isSuccess(connected)) return;
          if (deps.clock() > deadline) return yield* Effect.fail(new Error("restarted service did not listen within the limit"));
          yield* Effect.sleep(100);
        }
      });
      return yield* flow({
        owner, openOwner: () => deps.connectOwner(live.state).pipe(Effect.map((client) => recordReplies(client, replies))),
        driver: liveDriver(owner, config, leadFolder, workerFolder), step,
        probes: deps.probes ?? liveProbeDriver({
          service: () => service!, openOwner: () => deps.connectOwner(live.state), environment: deps.environment,
          agentTimeout: config.agentTimeout, engineTimeout: deps.engineTimeout, secrets: agentSecrets,
          captureOutput: (source) => { probeOutputs.push(source); },
          restart: checkRestart,
        }),
        probeNote: reporter.note,
        leadHarness: config.leadHarness, workerHarness: config.workerHarness, workerFolder,
        agentTimeout: config.agentTimeout, engineTimeout: deps.engineTimeout, settle: deps.settle,
        // Fails when the credential cannot be read, and the final step names that.
        secrets: () => [...readOwnerCredentialFrom(live.state), ...agentSecrets],
        outputs: () => [
          ...probeOutputs,
          { label: "the output of the service process", text: service!.output() },
          { label: "the lines the script printed", text: reporter.printed() },
        ],
        replies: () => replies,
      });
    }));
    // Awaited to the end, including the finalizers of every owner connection.
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
    if (cleanupUnconfirmed || controller.signal.aborted) return;
    await reporter.step(RECORDING_STEP, async () => {
      let outcome: Awaited<ReturnType<typeof recordLive>>;
      try {
        outcome = await recordLive({
          environment: deps.environment, settings: await deps.harnessSettings(), outputDirectory: deps.outputDirectory,
          record: deps.record, signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new StepCancelled();
        throw error;
      }
      if (controller.signal.aborted) throw new StepCancelled();
      reporter.note(outcome.report.replaceAll("\n", " | "));
      if (!outcome.passed) throw new Error(outcome.reason);
      return outcome;
    }, (outcome) => outcome.reason);
  };

  let finished = false;
  let reachLimit: () => void = () => undefined;
  const limitReached = new Promise<void>((done) => { reachLimit = done; });
  const limit = setTimeout(() => {
    if (finished) return;
    timedOut = true;
    controller.abort();
    reporter.fail({ id: "time-limit", title: `the whole run finishes within ${config.totalTimeout / 1000} seconds` }, "the run took longer; the last step printed above was the one still running");
    reachLimit();
  }, config.totalTimeout);
  const grace = deps.cancelGrace ?? DEFAULT_CANCEL_GRACE;
  let graceTimer: NodeJS.Timeout | undefined;
  try {
    const running = body().catch((error: unknown) => {
      if (!(error instanceof StepCancelled)) reporter.fail({ id: "journey", title: "the journey ran without an unexpected error" }, messageOf(error));
    });
    // The body ends by itself, or ends because the limit cancelled it. After a
    // cancel it is still awaited, for a bounded time, so that the recorder's
    // process groups and the journey's finalizers have ended before cleanup.
    const ended = await Promise.race([
      running.then(() => "ended" as const),
      limitReached.then(() => new Promise<"ended" | "late">((done) => {
        void running.then(() => { done("ended"); });
        graceTimer = setTimeout(() => { done("late"); }, grace);
      })),
    ]);
    if (ended === "late") {
      cleanupUnconfirmed = true;
      reporter.fail({ id: "cleanup", title: "the run's work has stopped after the time limit" }, `the work did not end within ${grace / 1000} seconds of the limit`);
    }
  } finally {
    finished = true;
    clearTimeout(limit);
    clearTimeout(graceTimer);
    await stopService();
  }

  if (reporter.failed()) {
    const ran = new Set(reporter.results().map((result) => result.id));
    for (const spec of ALL_STEPS) if (!ran.has(spec.id)) reporter.skip(spec, spec.id === "recording"
      ? `requires every earlier step to pass; failed: ${reporter.results().filter((row) => !row.passed && row.id !== "recording").map((row) => row.id).join(", ")}`
      : `depends on ${reporter.results().find((row) => !row.passed)?.id ?? "an earlier step"}`);
    if (service !== undefined) {
      reporter.note(`The run's folder is kept at ${service.root}; the service's log is ${service.logFile}. The real service was not touched.`);
      if (cleanupUnconfirmed) reporter.note("Cleanup was not confirmed: a process this run started may still be running. Check the folder above before you remove it.");
    }
  } else if (service !== undefined) {
    service.remove();
  }
  const code = reporter.exitCode(ALL_STEPS);
  deps.write(code === 0
    ? `live-check: all ${ALL_STEPS.length} steps passed`
    : `live-check: failed (${reporter.results().filter((result) => result.passed).length} of ${ALL_STEPS.length} steps passed)`);
  open = false;
  return code;
};
