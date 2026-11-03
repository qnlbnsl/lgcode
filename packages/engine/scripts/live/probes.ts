import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { check, StepFailed, type AgentRef, type StepRunner } from "./flow.ts";
import { PROBE_STEPS } from "./steps.ts";

export type ProbeId = (typeof PROBE_STEPS)[number]["id"];
export interface ProbeAgents { readonly lead: AgentRef; readonly worker: AgentRef }
export interface Observation { readonly harness: string; readonly outcome: string; readonly detail: string }
export interface ProbeDriver {
  // Returns a reason when this probe cannot safely run. Read-only probes
  // may need fewer agents than a turn-producing probe.
  readonly unavailable?: (id: ProbeId, agents: ProbeAgents) => Effect.Effect<string | undefined, unknown, Scope.Scope>;
  // Only the boundary differs: a live driver collects actual adapter evidence.
  readonly observe: (id: ProbeId, agents: ProbeAgents) => Effect.Effect<ReadonlyArray<Observation>, unknown, Scope.Scope>;
}

// Pass rules are exact and closed. Empty evidence and "not attempted" never pass.
const accepted: Record<ProbeId, ReadonlyArray<string>> = {
  "sandbox-mcp": ["succeeds"],
  "permission-kinds": ["recorded"],
  "removed-variables": ["refused by ancestry check"],
  "state-read": ["refused", "no mechanism: the agent read the canary file"],
  "slash-up": ["escaped; no command"],
  "slash-down": ["escaped; no command"],
  "always-allow": ["scopes recorded; persistent options routed to owner"],
  "reload": ["old token refused; tool succeeds; found", "old token refused; tool succeeds; re-send on restart"],
  "token-scan": ["not found"],
};

export const ADAPTER_CANCELLED = "attempted; the adapter cancelled the call before Shephrd saw a permission request (see issue 236)";
// These are known failing outcomes, never aliases for a passing observation.
export const failingOutcomes: Partial<Record<ProbeId, ReadonlyArray<string>>> = {
  "sandbox-mcp": ["attempted; failed", ADAPTER_CANCELLED],
  "permission-kinds": ["attempted; failed"],
  "removed-variables": ["attempted; failed"],
  "state-read": ["attempted; failed"],
  "slash-up": ["attempted; failed"],
  "slash-down": ["attempted; failed"],
  "always-allow": ["attempted; failed"],
  "reload": ["attempted; failed", "attempted; failed: pending delivery accepted before reload (restart race)"],
};

export const runProbes = (driver: ProbeDriver, step: StepRunner, agents: ProbeAgents, note?: (text: string) => void): Effect.Effect<void, StepFailed, Scope.Scope> => Effect.gen(function* () {
  let firstFailure: StepFailed | undefined;
  for (const spec of PROBE_STEPS) {
    const ready = driver.unavailable === undefined ? Exit.succeed(undefined)
      : yield* Effect.exit(Effect.scoped(driver.unavailable(spec.id, agents)));
    if (Exit.isSuccess(ready) && ready.value !== undefined) {
      const reason = `probe preconditions unavailable${firstFailure === undefined ? "" : ` after ${firstFailure.stepId}`}: ${ready.value}`;
      yield* step.skip(spec, reason);
      firstFailure ??= new StepFailed(spec.id, reason);
      continue;
    }
    // Every probe owns its subscriptions. Failure closes them before another
    // probe can answer permissions or send turns to the same agents.
    const exit = yield* Effect.exit(step(spec, Effect.scoped(Effect.gen(function* () {
      if (Exit.isFailure(ready)) return yield* Effect.failCause(ready.cause);
      const rows = yield* driver.observe(spec.id, agents);
      yield* check(rows.length === 2 && rows[0]?.harness === "claude" && rows[1]?.harness === "codex", "not attempted: evidence for both harnesses is required");
      for (const row of rows) {
        const detail = `${spec.id} ${row.harness}: ${row.outcome}; ${row.detail}`;
        for (let at = 0; at < detail.length; at += 400) note?.(detail.slice(at, at + 400));
      }
      for (const row of rows) {
        const inapplicable = (spec.id === "slash-up" && row.harness === "codex" && row.outcome === "not applicable (no codex parent receiver in this team)")
          || (spec.id === "slash-down" && row.harness === "claude" && row.outcome === "not applicable (no claude child receiver in this team)")
          || (spec.id === "always-allow" && row.harness === "codex" && row.outcome === "not applicable (criterion names Claude only)");
        yield* check(row.detail.length > 0 && !failingOutcomes[spec.id]?.includes(row.outcome)
          && (accepted[spec.id].includes(row.outcome) || inapplicable), `${row.harness}: ${row.outcome}; ${row.detail}`);
      }
      return rows.map((row) => `${row.harness}: ${row.outcome}`).join(" | ");
    })), (reason) => reason));
    if (Exit.isFailure(exit)) {
      if (!Cause.hasFails(exit.cause)) return yield* Effect.failCause(exit.cause);
      firstFailure ??= Cause.squash(exit.cause) as StepFailed;
    }
  }
  if (firstFailure !== undefined) return yield* Effect.fail(firstFailure);
});
