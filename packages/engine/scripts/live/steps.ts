// Unit 8c: the steps of `pnpm live-check`, in the order they run. The run, the
// printer and `--dry-run` all read this one list.

export interface StepSpec {
  readonly id: string;
  readonly title: string;
}

export const STARTUP_HOOK_STEP = { id: "startup-hook", title: "Herdr's startup hook started exactly one service for the real home" } as const;
export const SERVICE_STEP = { id: "service", title: "a fresh service starts in a new /tmp folder, with its own owner credential" } as const;
export const SETUP_STEP = { id: "setup", title: "Claude Code and Codex are registered, each with the account that is signed in on this machine" } as const;

// The eight links of "One request, start to finish" (the engine design spec),
// plus the owner's two starts. The fake-driver test runs the same list.
export const FLOW_STEPS = [
  { id: "lead", title: "the owner starts the lead, a Claude Code agent, with its first prompt" },
  { id: "wide-start", title: "step 2: the lead's start with a mode wider than its own is refused, and no agent starts" },
  { id: "worker-start", title: "steps 1 and 2: the lead starts a Codex worker on any account, in group auth, asking before changes" },
  { id: "session", title: "step 3: the worker's session opens in the folder, and its first prompt is recorded as sent by the lead" },
  { id: "live-view", title: "step 4: a second owner connection sees the worker's streamed work while its permission is open" },
  { id: "routed", title: "step 5: the worker's permission request is held by the lead" },
  { id: "pass-up", title: "step 6: the lead's wait on the worker is open, the lead passes the request up, and the owner is told once" },
  { id: "owner-answer", title: "step 7: the owner answers Allow from a second connection, and a later answer is refused" },
  { id: "wake", title: "step 8: the worker's turn ends, and the lead is woken exactly once" },
] as const satisfies ReadonlyArray<StepSpec>;

export const FINAL_STEP = { id: "final", title: "the views rebuilt from the log equal the live views, and no secret appears in any event, reply or output" } as const;
export const RECORDING_STEP = { id: "recording", title: "the fixtures of Claude Code and Codex are re-recorded without a failure" } as const;

// L-1: every outcome is checked by the same routine with a live or fake driver.
export const PROBE_STEPS = [
  { id: "fixture-evidence", title: "PB-A10: existing real fixture versions and config categories are cited" },
  { id: "sandbox-mcp", title: "PB-A3: each real harness calls a Shephrd tool through its socket" },
  { id: "permission-kinds", title: "SEC-PB-3: each observed permission option has a level and persistence" },
  { id: "removed-variables", title: "SEC-PB-5 and SEC-PB-8: both variables removed; owner ancestry refuses, including core inheritance" },
  { id: "state-read", title: "SEC-PB-6: each harness attempts the non-secret state canary read" },
  { id: "slash-up", title: "SEC-PB-2: child-to-parent /compact arrives escaped and runs no command" },
  { id: "slash-down", title: "SEC-PB-7: parent-to-child /compact arrives escaped and runs no command" },
  { id: "always-allow", title: "SEC-PB-4: offered persistent choices route to owner and their saved scopes are inspected" },
  { id: "reload", title: "PB-A7, PB-A8, PB-A11, PB-A12: SIGKILL, reconnect, refuse old tokens, carry on and observe replay" },
  { id: "token-scan", title: "PB-A4 and SEC-PB-1: run session files and process arguments contain no agent token" },
] as const satisfies ReadonlyArray<StepSpec>;

export const ALL_STEPS: ReadonlyArray<StepSpec> = [
  STARTUP_HOOK_STEP, SERVICE_STEP, SETUP_STEP, ...FLOW_STEPS, ...PROBE_STEPS, FINAL_STEP, RECORDING_STEP,
];
