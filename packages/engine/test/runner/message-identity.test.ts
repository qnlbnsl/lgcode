import { groupThreadItems, toolText } from "@shephrd/contracts/thread";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { accountFor, echoFile, harnessFor, makeRunnerRig, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { eventually, tagged } from "../support/routingRig.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
it.live("preserves reply identity for fragments and separates adapter messages and later turns", () => {
  const frame = (messageId: string, text: string) => ({ step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {
    sessionId: "${session}", update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } }
  } }) });
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [[frame("a", "P"), frame("a", "INE"), frame("a", "APPLE"), frame("b", "second"), frame("a", " again")], [frame("a", "later")]] }, echoFile(rig));
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
    const messages = tagged(rows, "ThreadItem");
    expect(messages, JSON.stringify(rows)).toHaveLength(5);
    expect(new Set(messages.slice(0, 3).map((event) => event.itemId)).size).toBe(1);
    expect(messages[3]!.itemId).not.toBe(messages[0]!.itemId);
    expect(messages[4]!.itemId).toBe(messages[0]!.itemId);
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "again" }));
    const later = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 2);
    expect(tagged(later, "ThreadItem").at(-1)!.itemId).not.toBe(messages[0]!.itemId);
  })).pipe(Effect.orDie);
});


it.live("folds repeated real-shaped tool updates without repeating command text or losing output", () => {
  const frame = (update: object) => ({ step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}", update } }) });
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const toolTurn = [
    frame({ sessionUpdate: "tool_call_update", toolCallId: "shell-1", title: "Run command", kind: "execute", status: "pending", rawInput: { command: "printf hello" } }),
    frame({ sessionUpdate: "tool_call_update", toolCallId: "shell-1", status: "in_progress" }),
    frame({ sessionUpdate: "tool_call_update", toolCallId: "shell-1", status: "completed", content: [{ type: "content", content: { type: "text", text: "hello\nworld" } }] }),
    frame({ sessionUpdate: "tool_call_update", toolCallId: "shell-1", rawOutput: "hello\nworld" })
  ];
  const account = accountFor("first", { turns: [toolTurn, toolTurn] }, echoFile(rig));
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "run command" })));
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
    const displayed = groupThreadItems(rows).filter((row) => row.event._tag === "ThreadItem");
    expect(displayed).toHaveLength(1);
    expect(displayed[0]?.event, JSON.stringify(rows.filter((row) => ["ThreadItem", "TurnStarted", "SessionOpened"].includes(row.event._tag)))).toMatchObject({ content: { callId: "shell-1", title: "Run command", status: "completed", input: '{"command":"printf hello"}', output: '"hello\\nworld"' } });
    const content = (displayed[0]!.event as Extract<import("@shephrd/contracts").Event, { _tag: "ThreadItem" }>).content;
    if (content._tag !== "tool-call") throw new Error("missing tool call");
    expect(toolText(content.input!)).toBe("printf hello");
    expect(toolText(content.output!)).toBe("hello\nworld");
    const started = tagged(rows, "AgentStarted")[0]!;
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "run again" }));
    const later = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 2);
    expect(groupThreadItems(later).filter((row) => row.event._tag === "ThreadItem")).toHaveLength(2);
  })).pipe(Effect.orDie);
});
