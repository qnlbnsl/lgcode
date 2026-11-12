import { randomBytes } from "node:crypto";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { accountFor, deliveryFor, echoFile, harnessFor, makeRunnerRig, removeRunnerRig, spawnFor, withAcpRunner, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });

// The existing fake's raw-frame step sends real ACP (Agent Client Protocol)
// requests. This avoids changing production fakeAgent.ts before the builder.
const request = (fields: Record<string, unknown>) => ({ step: "raw_frame", frame: JSON.stringify({
  jsonrpc: "2.0", id: "permission-fields", method: "session/request_permission", params: {
    sessionId: "${session}", title: "Permission title", subject: { type: "tool_call", toolCall: { toolCallId: "tool-fields", title: "Permission title", ...fields } },
    options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }],
  },
}) });
const observe = (fields: Record<string, unknown>, inspect: (event: Record<string, unknown>) => void, sensitive?: string) =>
  withAcpRunner(rig, { secrets: sensitive === undefined ? {} : { "secret:planted": sensitive } }, (context) => Effect.gen(function* () {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [[request(fields), { step: "slow", ms: 60_000 }]] }, echoFile(rig));
    const spawn = yield* spawnFor(rig, harness, account);
    yield* context.runner.start(spawn.input);
    yield* context.runner.prompt({ sentSequence: 1, agentId: spawn.agentId, incarnation: spawn.incarnation, delivery: deliveryFor(spawn.agentId, "Inspect the action.") });
    const event = yield* context.waitFor((e) => e._tag === "permissionRequested");
    inspect(event as unknown as Record<string, unknown>);
    if (sensitive !== undefined) expect(JSON.stringify(context.events).includes(sensitive)).toBe(false);
  }));

for (const toolKind of ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"]) {
  it.live(`1.42 permission ${toolKind}: catches recording a title without the actual kind and input`, () => observe({ kind: toolKind, rawInput: { command: "pnpm test", path: "src/example.ts" } }, (event) => {
    expect(event).toMatchObject({ toolKind, toolInput: { command: "pnpm test", path: "src/example.ts" } });
    expect(Buffer.byteLength(JSON.stringify(event.toolInput))).toBeLessThanOrEqual(8192);
  }).pipe(Effect.orDie));
}
it.live("1.42 catches secrets in input keys, nested values and _tag bypassing cleanStructure, or missing inputRedacted", () => {
  const sensitive = randomBytes(24).toString("hex");
  return observe({ kind: "execute", rawInput: { [sensitive]: { _tag: sensitive, nested: [sensitive] } } }, (event) => {
    expect(event.inputRedacted).toBe(true);
    expect(JSON.stringify(event.toolInput)).toContain("[REDACTED]");
  }, sensitive).pipe(Effect.orDie);
});
it.live("1.42 catches cutting before redaction, leaking a secret across byte 8192 or exceeding the encoded byte cap", () => {
  const sensitive = randomBytes(24).toString("hex");
  return observe({ kind: "execute", rawInput: { command: `${"x".repeat(8170)}${sensitive}${"🙂".repeat(1000)}` } }, (event) => {
    expect(event.inputRedacted).toBe(true);
    expect(event.inputTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(event.toolInput))).toBeLessThanOrEqual(8192);
    expect(JSON.stringify(event.toolInput).includes(sensitive.slice(0, 16))).toBe(false);
  }, sensitive).pipe(Effect.orDie);
});
it.live("1.42 catches losing a Codex-shaped locations-only permission, or inventing absent input", () => observe({ kind: "edit", locations: [{ path: "/tmp/example.ts", line: 12 }] }, (event) => {
  expect(event).toMatchObject({ toolKind: "edit", locations: [{ path: "/tmp/example.ts", line: 12 }] });
  expect(event).not.toHaveProperty("toolInput");
  expect(event).not.toHaveProperty("inputRedacted");
  expect(event).not.toHaveProperty("inputTruncated");
}).pipe(Effect.orDie));
it.live("1.42 catches unbounded locations or secret paths escaping redaction", () => {
  const sensitive = randomBytes(24).toString("hex");
  return observe({ kind: "edit", locations: Array.from({ length: 25 }, (_, i) => ({ path: `/tmp/${sensitive}/${"x".repeat(300)}/${i}`, line: i + 1 })) }, (event) => {
    expect(event.locations).toBeInstanceOf(Array);
    expect((event.locations as unknown[]).length).toBeLessThanOrEqual(16);
    expect(Buffer.byteLength(JSON.stringify(event.locations))).toBeLessThanOrEqual(2048);
  }, sensitive).pipe(Effect.orDie);
});

it.live("1.39 runner refuses a reserved carrier reference even when the file-backed account schema allows that environment name", () => {
  const value = randomBytes(24).toString("hex");
  return withAcpRunner(rig, { secrets: { "secret:client.alerts.carrier.active": value } }, (context) => Effect.gen(function* () {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [] }, echoFile(rig), { CARRIER: "secret:client.alerts.carrier.active" });
    const spawn = yield* spawnFor(rig, harness, account);
    const result = yield* context.runner.start(spawn.input).pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "RunnerRejected" } });
    expect(context.events.filter((event) => event._tag === "permissionRequested")).toEqual([]);
  })).pipe(Effect.orDie);
});
