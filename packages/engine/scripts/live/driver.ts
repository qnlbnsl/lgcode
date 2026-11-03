import { join } from "node:path";
import type { Client } from "@shephrd/client";
import type { HarnessSettings } from "@shephrd/contracts";
import * as Effect from "effect/Effect";

import type { AgentRef, FlowDriver } from "./flow.ts";
import { CORE_CONFIG, probeCommands } from "./liveProbes.ts";
import { fill, LEAD_PROMPT, PROMPTS, WORKER_PROMPT } from "./prompts.ts";
import { requestId } from "./support.ts";

// Unit 8c: the live side of the journey. The lead is a real Claude Code agent
// and the worker a real Codex agent. Everything the lead does, it does because
// `LEAD_PROMPT` says so, so the driver only starts the lead and watches: it
// never starts the worker, passes a request up, or nudges the lead. A lead
// that does not follow the prompt makes a step fail by name.

export interface LiveConfig {
  readonly leadHarness: string;
  readonly leadAccount: string;
  readonly leadModel: string;
  readonly leadEffort: string;
  readonly workerHarness: string;
  readonly workerAccount: string;
  readonly workerModel: string;
  readonly workerEffort: string;
  // Milliseconds a wait for a real agent may take, and the whole run.
  readonly agentTimeout: number;
  readonly totalTimeout: number;
}

// The cheapest model and effort each adapter offers (the recorded fixtures of
// 2026-11-01 list haiku for Claude Code and gpt-6-luna for Codex). The owner
// can change any of them with the variables named in the second column.
export const LIVE_VARIABLES = {
  leadModel: "SHEPHRD_LIVE_LEAD_MODEL",
  leadEffort: "SHEPHRD_LIVE_LEAD_EFFORT",
  workerModel: "SHEPHRD_LIVE_WORKER_MODEL",
  workerEffort: "SHEPHRD_LIVE_WORKER_EFFORT",
  agentTimeoutSeconds: "SHEPHRD_LIVE_AGENT_TIMEOUT_SECONDS",
  totalTimeoutSeconds: "SHEPHRD_LIVE_TOTAL_TIMEOUT_SECONDS",
} as const;

const seconds = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed * 1_000 : fallback * 1_000;
};

export const liveConfig = (environment: Readonly<Record<string, string | undefined>>): LiveConfig => ({
  leadHarness: "claude", leadAccount: "claude",
  leadModel: environment[LIVE_VARIABLES.leadModel] ?? "haiku",
  leadEffort: environment[LIVE_VARIABLES.leadEffort] ?? "low",
  workerHarness: "codex", workerAccount: "codex",
  workerModel: environment[LIVE_VARIABLES.workerModel] ?? "gpt-6-luna",
  workerEffort: environment[LIVE_VARIABLES.workerEffort] ?? "low",
  agentTimeout: seconds(environment[LIVE_VARIABLES.agentTimeoutSeconds], 300),
  totalTimeout: seconds(environment[LIVE_VARIABLES.totalTimeoutSeconds], 1_800),
});

// The accounts are the ones signed in on this machine: the harness keeps its
// login in the owner's home, which the service's adapters inherit. A named
// config folder, when the owner has set one, is passed on; no key is stored.
export const registerAccounts = (
  owner: Client, config: LiveConfig, settings: ReadonlyArray<HarnessSettings>, environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<void, unknown> => Effect.gen(function* () {
  for (const [harness, account, variable] of [
    [config.leadHarness, config.leadAccount, "CLAUDE_CONFIG_DIR"], [config.workerHarness, config.workerAccount, "CODEX_HOME"],
  ] as const) {
    const found = settings.find((candidate) => candidate.id === harness);
    if (found === undefined) return yield* Effect.fail(new Error(`${harness} is not installed: its adapter was not found in packages/engine/node_modules/.bin`));
    yield* (owner.harnesses({ requestId: requestId(), operation: "set", harness: found } as never) as Effect.Effect<unknown, unknown>);
    const configured = environment[variable];
    const accountEnvironment = { ...(configured === undefined || configured === "" ? {} : { [variable]: configured }),
      ...(harness === "codex" ? { CODEX_CONFIG: JSON.stringify(CORE_CONFIG) } : {}) };
    yield* (owner.accounts({
      requestId: requestId(), operation: "add",
      account: { id: account, harness, displayName: account, enabled: true, ...(Object.keys(accountEnvironment).length === 0 ? {} : { environment: accountEnvironment }) },
    } as never) as Effect.Effect<unknown, unknown>);
  }
});

// The lead's folder is the work root and the worker's is a folder beneath it,
// because the engine accepts a child's folder only within its parent's
// (src/identity/ceiling.ts). `main`, the setup step and the dry run all take
// both folders from here.
export const liveFolders = (work: string): { readonly lead: string; readonly worker: string } =>
  ({ lead: work, worker: join(work, "project") });

// The folder the dry run shows in place of the run's own, which does not exist
// until the run starts.
export const REPRESENTATIVE_ROOT = "/tmp/shephrd-live-EXAMPLE";

export const leadPromptFor = (config: LiveConfig, workerFolder: string): string => fill(LEAD_PROMPT, {
  WORKER_FOLDER: JSON.stringify(workerFolder).slice(1, -1),
  WORKER_MODEL: config.workerModel,
  WORKER_EFFORT: config.workerEffort,
  WORKER_PROMPT_JSON: JSON.stringify(WORKER_PROMPT),
});

// Every prompt of the script exactly as the run sends it, in send order. The
// lead's is filled in by `leadPromptFor`, the function the driver calls.
export const probePromptFor = (name: string, text: string, workerFolder: string): string => {
  const commands = probeCommands(join(workerFolder, "../../state"));
  const values: Record<string, string> = name === "REMOVED_VARIABLES_PROMPT" ? { COMMAND: commands.removedVariables }
    : name === "STATE_READ_PROMPT" ? { COMMAND: commands.stateRead }
    : name === "ALWAYS_ALLOW_PROMPT" ? { COMMAND: commands.alwaysAllow }
    : name === "RESTART_ACTIVE_PROMPT" ? { COMMAND: commands.restartHold, MARKER: "RUN_RANDOM_MARKER" }
    : name === "RESTART_PENDING_PROMPT" ? { COMMAND: commands.restartHold }
    : name === "PROBE_MCP_PROMPT" || name === "RESTART_PREPARE_PROMPT" ? { MARKER: "RUN_RANDOM_MARKER" } : {};
  return fill(text, values);
};
export const renderedPrompts = (config: LiveConfig, workerFolder: string): ReadonlyArray<{ readonly name: string; readonly receiver: string; readonly step: string; readonly text: string }> =>
  PROMPTS.map((entry) => ({ ...entry, text: entry.name === "LEAD_PROMPT" ? leadPromptFor(config, workerFolder) : probePromptFor(entry.name, entry.text, workerFolder) }));

export const liveDriver = (owner: Client, config: LiveConfig, leadFolder: string, workerFolder: string): FlowDriver => ({
  startLead: () => Effect.gen(function* () {
    const started = yield* (owner.start({
      requestId: requestId(), name: "Live lead", role: "lead", harness: config.leadHarness,
      account: { _tag: "named", accountId: config.leadAccount }, permission: "edit", folder: leadFolder, runMode: "acp", groups: [],
      model: config.leadModel, effort: config.leadEffort, prompt: leadPromptFor(config, workerFolder),
    } as never) as Effect.Effect<{ agentId: string }, unknown>);
    return { agentId: started.agentId } satisfies AgentRef;
  }),
  // The lead does these three because its prompt tells it to.
  wideStart: () => Effect.void,
  startWorker: () => Effect.void,
  passUp: () => Effect.void,
});
