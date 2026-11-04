import { existsSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";

// The small input is deliberately independent of the engine's full rows.
type Input = {
  agents: Record<string, { agentId: string; state: { _tag: string }; reloadable: boolean }>;
  requests: Record<string, { agentId: string; status: string; holder: { _tag: string; agentId?: string } }>;
  questions: Input["requests"];
  deliveries: Record<string, { target: string; status: string }>;
  waits: Record<string, { agentId: string; status: string; blocking: boolean }>;
};
interface Settled {
  settled: (input: Input, id: string) => boolean;
  holds: (input: Input, id: string) => boolean;
  reasonOf: (input: Input, id: string) => string | undefined;
  waitSatisfied: (mode: "any" | "all", members: ReadonlyArray<string>, resolved: ReadonlyArray<{ agentId: string; reason: string }>) => boolean;
}
async function load(): Promise<Settled> {
  const url = new URL("../src/settled.ts", import.meta.url);
  expect(existsSync(url), "E19 must supply the shared settled predicates in contracts").toBe(true);
  return import(/* @vite-ignore */ url.href) as Promise<Settled>;
}
const idle = (): Input => ({ agents: { a: { agentId: "a", state: { _tag: "idle" }, reloadable: true } }, requests: {}, questions: {}, deliveries: {}, waits: {} });

for (const obstacle of ["queued", "sent", "own permission", "own question", "held permission", "held question", "nonblocking wait"] as const) {
  it(`1.16 settled ${obstacle}: catches declaring an idle agent settled while this work remains`, async () => {
    const api = await load();
    const state = idle();
    expect(api.settled(state, "a")).toBe(true);
    switch (obstacle) {
      case "queued": case "sent": state.deliveries.d = { target: "a", status: obstacle }; break;
      case "own permission": state.requests.r = { agentId: "a", status: "open", holder: { _tag: "owner" } }; break;
      case "own question": state.questions.q = { agentId: "a", status: "open", holder: { _tag: "owner" } }; break;
      case "held permission": state.requests.r = { agentId: "child", status: "open", holder: { _tag: "agent", agentId: "a" } }; break;
      case "held question": state.questions.q = { agentId: "child", status: "open", holder: { _tag: "agent", agentId: "a" } }; break;
      case "nonblocking wait": state.waits.w = { agentId: "a", status: "open", blocking: false }; break;
    }
    expect(api.settled(state, "a")).toBe(false);
    expect(api.reasonOf(state, "a")).toBeUndefined();
    expect(api.holds(state, "a")).toBe(obstacle.startsWith("held"));
  });
}
for (const [tag, reloadable, want] of [["idle", true, "settled"], ["working", true, undefined], ["starting", true, undefined], ["crashed", true, "crashed"], ["stopped", true, "stopped"], ["paused", true, "paused"], ["interrupted", true, undefined], ["interrupted", false, "interrupted"]] as const) {
  it(`1.16 reason ${tag}/${reloadable}: catches resolving a recoverable member or losing a terminal reason`, async () => {
    const api = await load();
    const state = idle(); state.agents.a = { agentId: "a", state: { _tag: tag }, reloadable };
    expect(api.reasonOf(state, "a")).toBe(want);
    expect(api.settled(state, "missing")).toBe(false);
  });
}
it("1.16 shared any/all rule catches old resolutions or an unrelated resolved member satisfying a wait", async () => {
  const api = await load();
  fc.assert(fc.property(fc.boolean(), fc.boolean(), (first, second) => {
    const resolved = [...(first ? [{ agentId: "a", reason: "settled" }] : []), ...(second ? [{ agentId: "b", reason: "crashed" }] : [])];
    expect(api.waitSatisfied("any", ["a", "b"], resolved)).toBe(first || second);
    expect(api.waitSatisfied("all", ["a", "b"], resolved)).toBe(first && second);
    expect(api.waitSatisfied("all", ["a", "b"], [{ agentId: "a", reason: "settled" }, { agentId: "a", reason: "settled" }, { agentId: "other", reason: "settled" }])).toBe(false);
  }));
});
