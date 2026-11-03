import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { check, type AgentRef, type StepRunner } from "./flow.ts";
import { PROBE_STEPS } from "./steps.ts";

export type ProbeId = (typeof PROBE_STEPS)[number]["id"];
export interface ProbeAgents { readonly lead: AgentRef; readonly worker: AgentRef }
export interface Observation { readonly harness: string; readonly outcome: string; readonly detail: string }
export interface ProbeDriver {
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

export const runProbes = (driver: ProbeDriver, step: StepRunner, agents: ProbeAgents, note?: (text: string) => void) => Effect.gen(function* () {
  for (const spec of PROBE_STEPS) {
    yield* step(spec, Effect.gen(function* () {
      const rows = yield* driver.observe(spec.id, agents);
      yield* check(rows.length === 2 && rows[0]?.harness === "claude" && rows[1]?.harness === "codex", "not attempted: evidence for both harnesses is required");
      for (const row of rows) {
        // The reporter folds long lines. Emit bounded pieces so no evidence
        // is silently truncated, including settings scopes and scan paths.
        const detail = `${spec.id} ${row.harness}: ${row.outcome}; ${row.detail}`;
        for (let at = 0; at < detail.length; at += 400) note?.(detail.slice(at, at + 400));
      }
      for (const row of rows) {
        yield* check(row.detail.length > 0 && (accepted[spec.id].includes(row.outcome) || (spec.id === "always-allow" && row.harness === "codex" && row.outcome === "not applicable (criterion names Claude only)")), `${row.harness}: ${row.outcome}; ${row.detail}`);
      }
      return rows.map((row) => `${row.harness}: ${row.outcome}`).join(" | ");
    }), (reason) => reason);
  }
});
