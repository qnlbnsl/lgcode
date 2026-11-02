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

export const ALL_STEPS: ReadonlyArray<StepSpec> = [
  STARTUP_HOOK_STEP, SERVICE_STEP, SETUP_STEP, ...FLOW_STEPS, FINAL_STEP, RECORDING_STEP,
];
