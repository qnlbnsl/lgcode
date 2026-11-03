import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { Translated } from "./translate.ts";

// Source: claude-agent-acp 0.99.1 dist/v2/terminal.js:20-59,91-94 and
// dist/v2/agent.js:242-270; codex-acp 2.5.0 dist/index.js:31808-31835,
// 31974-32018,32693-32724. V2 sends base64 terminal updates BEFORE the
// associated tool report; v1 puts decoded output/deltas and exits in _meta.
// Correlation comes only from that report's terminal reference or info.
// This is independent adapter-notification handling, not copied adapter code.
const object = (value: unknown): Record<string, any> | undefined => value !== null && typeof value === "object" ? value as Record<string, any> : undefined;
const keys = ["terminal_info", "terminal_output", "terminal_output_delta", "terminal_exit"];
export const withoutTerminalData = (value: unknown): unknown => {
  const row = object(value);
  if (row === undefined) return value;
  // Protocol logs must not retain independently encoded or partial secrets.
  // The corresponding decoded text is emitted only through the chunk redactor.
  if (row.sessionUpdate === "terminal_output_chunk" || row.sessionUpdate === "terminal_update") {
    return { ...row, ...(row.data === undefined ? {} : { data: "[terminal output withheld]" }),
      ...(row.output === undefined ? {} : { output: "[terminal output withheld]" }) };
  }
  if (object(row._meta) === undefined) return value;
  return { ...row, _meta: Object.fromEntries(Object.entries(row._meta).filter(([key]) => !keys.includes(key))) };
};

// A v1 delta-only report has no independent tool information. Emitting its
// stripped, empty tool report would bypass the terminal snapshot throttle.
export const terminalDataOnly = (value: unknown): boolean => {
  const row = object(value);
  const meta = object(row?._meta);
  return row?.sessionUpdate === "tool_call_update" && meta !== undefined
    && Object.keys(meta).length > 0 && Object.keys(meta).every((key) => keys.includes(key))
    && Object.keys(row).every((key) => ["sessionUpdate", "toolCallId", "_meta"].includes(key));
};

export const withoutTerminalPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutTerminalPayload);
  const row = object(withoutTerminalData(value));
  return row === undefined ? value : Object.fromEntries(Object.entries(row).map(([key, item]) => [key, withoutTerminalPayload(item)]));
};

interface Terminal {
  readonly terminalId: string;
  stream: string;
  decoder: StringDecoder;
  call?: { callId: string; title: string; status: "pending" | "in_progress" | "completed" | "failed" };
  output: string;
  truncated: boolean;
  ended: boolean;
  dirty: boolean;
  publishedAt?: number;
  exitCode?: number;
  signal?: string;
}
// Same character bound as a runner stderr line (recovery/crash.ts:13).
// Only redacted text is retained; the redactor separately bounds raw carry.
const outputCharacters = 16_384;
const terminalCount = 256;
// Two output snapshots per second keep interactive progress visible without
// repeatedly persisting a 16 KiB tail for every small adapter chunk.
const publishWindowMs = 500;
export const makeTerminalOutput = (options: {
  readonly redactChunk: (id: string, text: string, final: boolean) => Effect.Effect<string>;
  readonly redactText: (text: string) => Effect.Effect<string>;
}) => {
  const terminals = new Map<string, Terminal>();
  let capWarned = false;
  const get = (id: unknown, evicted: Translated[]): Effect.Effect<Terminal | undefined> => Effect.gen(function* () {
    if (typeof id !== "string" || id === "") return undefined;
    const previous = terminals.get(id);
    if (previous !== undefined) return previous;
    if (terminals.size >= terminalCount) {
      if (!capWarned) {
        capWarned = true;
        yield* Effect.logWarning("terminal limit reached: retaining at most 256 terminals in this turn");
      }
      const oldest = [...terminals.values()].find((entry) => entry.ended || entry.call === undefined);
      if (oldest === undefined) return undefined; // Never steal an active call's terminal.
      // Release the evicted stream's bounded redactor carry, discarding its
      // result. Unclaimed output must never be attributed to another call.
      if (oldest.ended && oldest.dirty) evicted.push(...yield* report(oldest, true));
      if (!oldest.ended) yield* options.redactChunk(oldest.stream, oldest.decoder.end(), true);
      terminals.delete(oldest.terminalId);
    }
    const entry: Terminal = { terminalId: id, stream: randomUUID(), decoder: new StringDecoder("utf8"), output: "", truncated: false, ended: false, dirty: false };
    terminals.set(id, entry);
    return entry;
  });
  const append = (entry: Terminal, text: string) => {
    const combined = entry.output + text;
    entry.truncated ||= combined.length > outputCharacters;
    entry.output = combined.slice(-outputCharacters);
    entry.dirty ||= text.length > 0;
  };
  const report = (entry: Terminal, immediate = false): Effect.Effect<ReadonlyArray<Translated>> => Effect.gen(function* () {
    if (entry.call === undefined || (!entry.dirty && !immediate)) return [];
    const now = yield* Clock.currentTimeMillis;
    if (!immediate && entry.publishedAt !== undefined && now - entry.publishedAt < publishWindowMs) return [];
    entry.publishedAt = now;
    entry.dirty = false;
    const callId = yield* options.redactText(entry.call.callId);
    const title = yield* options.redactText(entry.call.title);
    // ThreadContent already serializes structured tool output as a string.
    // Numeric exitCode is preserved in that existing field; no contract change.
    const output = JSON.stringify({ terminalId: yield* options.redactText(entry.terminalId), output: entry.output, truncated: entry.truncated,
      ...(entry.exitCode === undefined ? {} : { exitCode: entry.exitCode }),
      ...(entry.signal === undefined ? {} : { signal: yield* options.redactText(entry.signal) }) });
    const status = entry.call.status === "failed" || entry.signal !== undefined || (entry.exitCode !== undefined && entry.exitCode !== 0)
      ? "failed" : entry.exitCode === 0 ? "completed" : entry.call.status;
    return [{ kind: "tool-call", text: output, content: { _tag: "tool-call", callId, title, status, output } }];
  });
  const end = (entry: Terminal) => Effect.gen(function* () {
    if (entry.ended) return;
    append(entry, yield* options.redactChunk(entry.stream, entry.decoder.end(), true));
    entry.ended = true;
  });
  const data = (entry: Terminal, text: string, snapshot: boolean) => Effect.gen(function* () {
    if (snapshot) {
      // Drop the old undecided carry instead of releasing a partial secret
      // when a snapshot replaces the stream. The new snapshot is redacted anew.
      yield* options.redactChunk(entry.stream, "", true);
      entry.stream = randomUUID(); entry.decoder = new StringDecoder("utf8");
      entry.output = ""; entry.truncated = false; entry.ended = false;
    } else if (entry.ended) return;
    entry.dirty = true;
    append(entry, yield* options.redactChunk(entry.stream, text, false));
  });
  const push = (value: unknown): Effect.Effect<ReadonlyArray<Translated>> => Effect.gen(function* () {
    const row = object(value);
    if (row === undefined) return [];
    const evicted: Translated[] = [];
    const changed = new Set<Terminal>();
    const immediate = new Set<Terminal>();
    if (row.sessionUpdate === "terminal_update" || row.sessionUpdate === "terminal_output_chunk") {
      const entry = yield* get(row.terminalId, evicted);
      if (entry === undefined) return evicted;
      const encoded = row.sessionUpdate === "terminal_output_chunk" ? row.data : object(row.output)?.data;
      if (typeof encoded === "string") {
        // V2's data is bytes, not text to redact while still base64 encoded.
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return evicted;
        const bytes = Buffer.from(encoded, "base64");
        if (row.sessionUpdate === "terminal_update") {
          yield* data(entry, bytes.toString("utf8"), true);
        } else yield* data(entry, entry.decoder.write(bytes), false);
        changed.add(entry);
      }
      const exit = object(row.exitStatus);
      if (exit !== undefined) {
        if (Number.isSafeInteger(exit.exitCode)) entry.exitCode = exit.exitCode;
        if (typeof exit.signal === "string" && exit.signal !== "") entry.signal = exit.signal;
        entry.dirty = true; yield* end(entry); changed.add(entry); immediate.add(entry);
      }
    } else if ((row.sessionUpdate === "tool_call" || row.sessionUpdate === "tool_call_update") && typeof row.toolCallId === "string") {
      const meta = object(row._meta);
      const genericReport = !terminalDataOnly(row);
      const references = Array.isArray(row.content) ? row.content.filter((part: any) => part?.type === "terminal").map((part: any) => part.terminalId) : [];
      if (object(meta?.terminal_info) !== undefined) references.push(meta!.terminal_info.terminal_id);
      for (const id of references) {
        const entry = yield* get(id, evicted);
        if (entry === undefined || (entry.call !== undefined && entry.call.callId !== row.toolCallId)) continue;
        if (entry.call === undefined) immediate.add(entry);
        entry.dirty = true;
        entry.call = { callId: row.toolCallId, title: typeof row.title === "string" ? row.title : entry.call?.title ?? "",
          status: ["pending", "in_progress", "completed", "failed"].includes(row.status) ? row.status : entry.call?.status ?? "pending" };
        changed.add(entry);
      }
      // Later status-only reports need not repeat their terminal reference.
      // Refresh only terminals already explicitly bound to this call.
      for (const entry of terminals.values()) {
        if (entry.call?.callId !== row.toolCallId) continue;
        // An independent tool report is emitted before these snapshots. Even
        // unchanged status must leave a dirty snapshot to restore at finish.
        entry.dirty ||= genericReport;
        if (typeof row.title === "string") { entry.dirty ||= entry.call.title !== row.title; entry.call.title = row.title; }
        if (["pending", "in_progress", "completed", "failed"].includes(row.status)) { entry.dirty ||= entry.call.status !== row.status; entry.call.status = row.status; }
        changed.add(entry);
      }
      for (const key of ["terminal_output", "terminal_output_delta", "terminal_exit"] as const) {
        const part = object(meta?.[key]);
        if (part === undefined) continue;
        const entry = yield* get(part.terminal_id, evicted);
        // Metadata cannot reassign a terminal already owned by another call.
        if (entry === undefined || entry.call?.callId !== row.toolCallId) continue;
        if (key === "terminal_exit") {
          if (Number.isSafeInteger(part.exit_code)) entry.exitCode = part.exit_code;
          if (typeof part.signal === "string" && part.signal !== "") entry.signal = part.signal;
          entry.dirty = true; yield* end(entry); immediate.add(entry);
        } else if (typeof part.data === "string") yield* data(entry, part.data, key === "terminal_output");
        changed.add(entry);
      }
    }
    return [...evicted, ...(yield* Effect.forEach(changed, (entry) => report(entry, immediate.has(entry)))).flat()];
  });
  const finish = ({ resetLimitWarning = true }: { readonly resetLimitWarning?: boolean } = {}): Effect.Effect<ReadonlyArray<Translated>> => Effect.gen(function* () {
    const pending: Translated[] = [];
    for (const entry of terminals.values()) {
      yield* end(entry);
      if (entry.dirty) pending.push(...yield* report(entry, true));
    }
    terminals.clear();
    if (resetLimitWarning) capWarned = false;
    return pending;
  });
  return { push, finish };
};
