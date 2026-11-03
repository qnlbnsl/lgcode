import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect } from "vitest";
import { makeTerminalOutput } from "../../src/runner/terminal.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
const terminal = () => makeTerminalOutput({ redactChunk: (_id, text) => Effect.succeed(text), redactText: Effect.succeed });
const bind = (terminalId = "terminal", callId = "call", status = "in_progress") => ({ sessionUpdate: "tool_call_update", toolCallId: callId, title: "Run", status, content: [{ type: "terminal", terminalId }] });
const chunk = (text: string, terminalId = "terminal") => ({ sessionUpdate: "terminal_output_chunk", terminalId, data: Buffer.from(text).toString("base64") });
const exit = (terminalId = "terminal", exitCode = 0) => ({ sessionUpdate: "terminal_update", terminalId, exitStatus: { exitCode } });
const payload = (update: any) => JSON.parse(update.content.output);

it.effect("270: 2,000 chunks retain the unthrottled tail with at most three snapshots and 40 KiB of payload", () => Effect.gen(function* () {
  const output = terminal();
  const emitted = [...yield* output.push(bind())];
  const text = Array.from({ length: 2000 }, (_, i) => String(i).padStart(4, "0") + "x".repeat(96));
  for (const part of text) emitted.push(...yield* output.push(chunk(part)));
  emitted.push(...yield* output.push(exit()));
  emitted.push(...yield* output.finish());
  expect(emitted.length).toBeLessThanOrEqual(3);
  expect(emitted.reduce((bytes, update) => bytes + Buffer.byteLength(JSON.stringify(update)), 0)).toBeLessThan(40 * 1024);
  expect(payload(emitted.at(-1))).toMatchObject({ output: text.join("").slice(-16_384), truncated: true, exitCode: 0 });
}));

it.effect("270: each terminal has a 500 ms window, binding and exit bypass it, and finish flushes dirty output", () => Effect.gen(function* () {
  const output = terminal();
  yield* output.push(chunk("before binding"));
  expect(payload((yield* output.push(bind()))[0]).output).toBe("before binding");
  expect(yield* output.push(chunk(" pending"))).toEqual([]);
  yield* TestClock.adjust(499);
  expect(yield* output.push(chunk(" still pending"))).toEqual([]);
  yield* TestClock.adjust(1);
  expect(payload((yield* output.push(chunk(" released")))[0]).output).toBe("before binding pending still pending released");
  yield* output.push(chunk("second", "other"));
  expect((yield* output.push(bind("other", "other-call")))).toHaveLength(1);
  expect((yield* output.push(exit("other")))).toHaveLength(1);
  expect(yield* output.push(chunk(" final"))).toEqual([]);
  const final = yield* output.finish();
  expect(final).toHaveLength(1);
  expect(payload(final[0]).output).toBe("before binding pending still pending released final");
  expect(yield* output.finish()).toEqual([]);
}));

it.effect("271: 300 completed terminals do not lose the later calls", () => Effect.gen(function* () {
  const output = terminal();
  const exits = [];
  for (let i = 0; i < 300; i++) {
    yield* output.push(bind(`terminal-${i}`, `call-${i}`));
    yield* output.push(chunk(`result-${i}`, `terminal-${i}`));
    exits.push(...yield* output.push(exit(`terminal-${i}`)));
  }
  expect(exits).toHaveLength(300);
  expect(payload(exits.at(-1))).toMatchObject({ output: "result-299", exitCode: 0 });
}));

it.effect("271: 256 unclaimed ids cannot starve a real call", () => Effect.gen(function* () {
  const output = terminal();
  for (let i = 0; i < 256; i++) yield* output.push(chunk("unclaimed", `unknown-${i}`));
  yield* output.push(bind("real", "real-call"));
  yield* output.push(chunk("real output", "real"));
  expect(payload((yield* output.push(exit("real")))[0])).toMatchObject({ output: "real output", exitCode: 0 });
}));

it.effect("F: exit zero preserves the adapter's failed status", () => Effect.gen(function* () {
  const output = terminal();
  yield* output.push(bind("terminal", "call", "failed"));
  yield* output.push(chunk("failed despite exit zero"));
  expect((yield* output.push(exit()))[0]!.content).toMatchObject({ status: "failed" });
}));

it.effect("271: eviction flushes an ended terminal's unpublished status before reclaiming its slot", () => Effect.gen(function* () {
  const output = terminal();
  yield* output.push(bind());
  yield* output.push(chunk("retained result"));
  yield* output.push(exit());
  yield* output.push({ sessionUpdate: "tool_call_update", toolCallId: "call", status: "failed" });
  for (let i = 0; i < 255; i++) yield* output.push(bind(`active-${i}`, `active-call-${i}`));
  const reclaimed = yield* output.push(bind("new", "new-call"));
  expect(reclaimed.some((update) => update.content._tag === "tool-call" && update.content.callId === "call" && update.content.status === "failed")).toBe(true);
}));
