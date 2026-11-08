import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import type { EventEnvelope } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { decodeRow, type EventRow } from "../../src/log/subscribe.ts";
import { apply, emptyViews } from "../../src/views/apply.ts";
import { modeOption } from "./acpRunnerRig.ts";
import {
  fakeAgentPath, fakeHarness, requestId, waitFor, type ServiceProcess, type ServiceRoot,
} from "./serviceProcess.ts";
import type { Client } from "./socketClient.ts";

export const plantedLogin = 'B1-synthetic-+/"\\ space-ÿ࿿-credential';

export const loginForms = (token: string): Record<string, string> => ({
  raw: token, json: JSON.stringify(token).slice(1, -1),
  base64: Buffer.from(token).toString("base64"), base64url: Buffer.from(token).toString("base64url"),
  hex: Buffer.from(token).toString("hex"), HEX: Buffer.from(token).toString("hex").toUpperCase(),
  url: encodeURIComponent(token),
});

export const plantLogin = (path: string, token: string, harness = "codex") => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(harness === "claude"
    ? { claudeAiOauth: { accessToken: token } } : { tokens: { access_token: token } }), { mode: 0o600 });
};

export const marker = (form: string, part = "whole", version = "current") => `__B1_LOGIN_${version}_${form}_${part}__`;

// An executable wrapper around the repository's scripted fake, never a real
// adapter. At the actual wire write it reads the active file, so the refresh
// test cannot accidentally print a token captured before the store changed.
// Credentials are deliberately absent from the account's environment/script.
export const loginAdapter = (root: ServiceRoot, harness: string): string => {
  const path = join(root.bin, "file-login-adapter");
  writeFileSync(path, `#!${process.execPath}\n`
    + `const fs = process.getBuiltinModule("node:fs");\n`
    + `const path = process.getBuiltinModule("node:path");\n`
    + `const harness = ${JSON.stringify(harness)};\n`
    + `const store = harness === "claude" ? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, ".claude"), ".credentials.json") : path.join(process.env.CODEX_HOME || path.join(process.env.HOME, ".codex"), "auth.json");\n`
    + `const read = () => { const doc = JSON.parse(fs.readFileSync(store, "utf8")); return harness === "claude" ? doc.claudeAiOauth.accessToken : doc.tokens.access_token; };\n`
    + `const original = read();\n`
    + `const forms = ${loginForms.toString()};\n`
    + `const replace = (chunk, framed = true) => String(chunk).replace(/__B1_LOGIN_(current|original)_(raw|json|base64|base64url|hex|HEX|url)_(whole|first|second)__/g, (_all, version, form, part) => {\n`
    + `  const value = forms(version === "original" ? original : read())[form];\n`
    + `  const half = Math.floor(value.length / 2);\n`
    + `  const piece = part === "first" ? value.slice(0, half) : part === "second" ? value.slice(half) : value;\n`
    + `  return framed ? JSON.stringify(piece).slice(1, -1) : piece;\n`
    + `});\n`
    + `const stdout = process.stdout.write.bind(process.stdout);\n`
    + `process.stdout.write = (chunk, ...args) => stdout(replace(chunk), ...args);\n`
    + `const stderr = process.stderr.write.bind(process.stderr);\n`
    // stderr is unframed text and must not receive JSON string escaping.
    + `process.stderr.write = (chunk, ...args) => stderr(replace(chunk, false), ...args);\n`
    + `import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});\n`);
  chmodSync(path, 0o755);
  return path;
};

export const channelSteps = (version = "current"): Array<Record<string, unknown>> => Object.keys(loginForms(plantedLogin)).flatMap((form) => [
  { step: "text", text: `B1:text:${form}:before ${marker(form, "whole", version)} :after\n` },
  { step: "text", text: `B1:split:${form}:before ${marker(form, "first", version)}` },
  { step: "slow", ms: 30 },
  { step: "text", text: `${marker(form, "second", version)} :after\n` },
  { step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {
    sessionId: "${session}", update: { sessionUpdate: "agent_thought_chunk", content: {
      type: "text", text: `B1:thought:${form}:before ${marker(form, "whole", version)} :after`,
    } },
  } }) },
  { step: "tool_call", toolCallId: `tool-${form}`, title: `B1:tool:${form}`, kind: "read", status: "completed",
    output: `B1:tool:${form}:before ${marker(form, "whole", version)} :after` },
]);

export const configureLoginAccount = (root: ServiceRoot, owner: Client, options: {
  readonly harness: string; readonly accountId: string; readonly script: Record<string, unknown>;
  readonly variables?: Record<string, string>;
}) => Effect.gen(function* () {
  const echo = join(root.root, "echo-login.json");
  yield* owner.harnesses({ requestId: requestId(), operation: "set", harness: fakeHarness(loginAdapter(root, options.harness), options.harness) } as never);
  yield* owner.accounts({ requestId: requestId(), operation: "add", account: {
    id: options.accountId, harness: options.harness, displayName: "Synthetic login", enabled: true,
    environment: { FAKE_AGENT_ECHO: echo, FAKE_AGENT_SCRIPT: JSON.stringify({ configOptions: [modeOption()], ...options.script }), ...options.variables },
  } } as never);
  return echo;
});

export const startLoginAgent = (root: ServiceRoot, owner: Client, harness: string, accountId: string) =>
  owner.start({ requestId: requestId(), name: "Login regression", role: "worker", harness,
    account: { _tag: "named", accountId }, permission: "ask", folder: root.work, runMode: "acp", groups: [],
    prompt: "Exercise the synthetic login output.",
  } as never) as Effect.Effect<{ agentId: string }, unknown>;

export const rowsIn = (root: ServiceRoot): Array<EventRow> => {
  const database = new DatabaseSync(join(root.state, "events.sqlite"), { readOnly: true });
  try { return database.prepare("SELECT * FROM events ORDER BY sequence").all() as unknown as Array<EventRow>; }
  finally { database.close(); }
};

export const observeOwner = (owner: Client, received: Array<EventEnvelope>, ready: string) => Effect.gen(function* () {
  // A known harness event is the subscription barrier. No tested agent exists
  // yet; everything the adapter later emits must traverse the live branch.
  yield* (owner.subscribe({ requestId: requestId(), after: 0 } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
    Stream.runForEach((event) => Effect.sync(() => { received.push(event); })), Effect.forkScoped,
  );
  yield* waitFor("owner subscription barrier", () => received.some((event) => event.event._tag === "AccountChanged" && event.event.accountId === ready));
});

// Strings are checked both on the serialized boundary and after decoding.
// Tool output and structured logger messages can themselves contain JSON.
export const readableText = (value: unknown, depth = 0): string => {
  if (depth > 8) return "";
  if (typeof value === "string") {
    let nested = "";
    try { const parsed: unknown = JSON.parse(value); if (parsed !== value) nested = readableText(parsed, depth + 1); } catch { /* ordinary text */ }
    return value + "\n" + nested;
  }
  if (Array.isArray(value)) return value.map((item) => readableText(item, depth + 1)).join("\n");
  if (value !== null && typeof value === "object") return Object.values(value).map((item) => readableText(item, depth + 1)).join("\n");
  return "";
};

export const boundaryText = (events: ReadonlyArray<EventEnvelope>): string => {
  const textChunks = events.flatMap((envelope) => envelope.event._tag === "ThreadItem" && envelope.event.content._tag === "text"
    ? [envelope.event.content.text] : []);
  return JSON.stringify(events) + "\n" + readableText(events) + "\n" + textChunks.join("");
};

export const inspectBoundaries = (root: ServiceRoot, owner: Client, received: ReadonlyArray<EventEnvelope>, service: ServiceProcess, agentId: string) => Effect.gen(function* () {
  // This RPC captures the real live snapshot under the writer permit and
  // compares every field with a rebuild. Scan through that same durable head:
  // a reactor may append an alert after the agent's terminal event, including
  // while this request is in flight. Later events belong to a later snapshot.
  const comparison = yield* owner["debug.compare-views"]({ requestId: requestId() } as never) as Effect.Effect<{ sequence: number; equal: boolean; differences: ReadonlyArray<string> }, unknown>;
  const rows = rowsIn(root).filter((row) => row.sequence <= comparison.sequence);
  const envelopes = yield* Effect.forEach(rows, decodeRow);
  const projected = envelopes.reduce(apply, emptyViews());
  return {
    comparison, head: rows.at(-1)?.sequence ?? 0,
    // Positive controls must come from adapter ThreadItems, not the account
    // event that stores the fake script's harmless marker strings.
    storedThread: boundaryText(envelopes.filter((envelope) => envelope.agentId === agentId && envelope.event._tag === "ThreadItem")),
    boundaries: {
      "events.payload_json": rows.map((row) => row.payload_json).join("\n") + "\n" + boundaryText(envelopes),
      "live thread (equality checked)": boundaryText(projected.threads[agentId] ?? []),
      "owner live subscription": boundaryText(received.filter((event) => event.agentId === agentId)),
      "service stdout/stderr": service.output() + "\n" + service.output().split("\n").map((line) => readableText(line)).join("\n"),
    },
  };
});

export const captureServiceOutput = (root: ServiceRoot, service: ServiceProcess): string => {
  // service.ts has no file sink: its structured log goes to stdout. Preserve
  // those exact captured bytes as a test-owned log, including stderr.
  const path = join(root.root, "captured-service.log");
  writeFileSync(path, service.output(), { mode: 0o600 });
  return readFileSync(path, "utf8");
};
