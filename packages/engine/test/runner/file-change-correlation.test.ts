import { randomBytes } from "node:crypto";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { accountFor, echoFile, harnessFor, makeRunnerRig, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });

it.live("FR-004 preserves each diff's tool-call identity through the runner and stored thread items without exposing registered secrets", () => {
  const sensitive = randomBytes(24).toString("hex");
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [[
    { step: "tool_call", toolCallId: "unrelated-read", title: "Read another file", kind: "read", status: "completed", output: "other read" },
    { step: "file_change", toolCallId: "edit-first", path: `${rig.work}/target.ts`, operation: "modify", patch: `+first change ${sensitive}` },
    { step: "tool_call", toolCallId: "unrelated-search", title: "Search another file", kind: "search", status: "completed", output: "other search" },
    { step: "file_change", toolCallId: "edit-second", path: `${rig.work}/target.ts`, operation: "modify", patch: "+second change" },
    { step: "permission", toolCallId: "edit-first", title: "Edit target", kind: "edit", locations: [{ path: `${rig.work}/target.ts` }],
      options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }] },
    { step: "slow", ms: 60_000 },
  ]] }, echoFile(rig));
  return withEngine(rig, { harness, accounts: [account], secrets: { "secret:correlation": sensitive } }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "Edit target" })));
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "PermissionRequested").length === 1);
    expect(tagged(rows, "AgentStartFailed")).toEqual([]);
    const requests = tagged(rows, "PermissionRequested");
    expect(requests, rows.map((row) => row.event._tag).join(", ")).toHaveLength(1);
    expect(requests[0]).toMatchObject({ toolCallId: "edit-first", toolKind: "edit", locations: [{ path: `${rig.work}/target.ts` }] });
    expect(requests[0]).not.toHaveProperty("toolInput");
    const items = tagged(rows, "ThreadItem");
    expect(items.map((item) => item.content._tag)).toEqual(["tool-call", "file-change", "tool-call", "file-change"]);
    const diffs = items.filter((item) => item.content._tag === "file-change");
    expect(diffs.map((item) => item.content)).toEqual([
      { _tag: "file-change", callId: "edit-first", path: `${rig.work}/target.ts`, diff: "+first change [REDACTED]" },
      { _tag: "file-change", callId: "edit-second", path: `${rig.work}/target.ts`, diff: "+second change" },
    ]);
    for (const item of diffs) expect(["edit-first", "edit-second"]).not.toContain(item.itemId);
    expect(JSON.stringify(rows)).not.toContain(sensitive);
  })).pipe(Effect.orDie);
});
