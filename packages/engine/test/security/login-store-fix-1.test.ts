import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { it } from "@effect/vitest";
import type { EventEnvelope } from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  configureLoginAccount, inspectBoundaries, loginForms, observeOwner, plantLogin, rowsIn, startLoginAgent,
} from "../support/harnessLoginRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  fakeAgentPath, makeServiceRoot, ownerClient, startService, stopAllServices, waitFor, waitServing, type ServiceRoot,
} from "../support/serviceProcess.ts";

// Fix round 1 of issue 223 (the security review of b88b876, findings F2,
// F3, F5 and F6), each through a real service child and checked at the
// event table, the live thread, the owner subscription and service output.
// Tokens, homes and stores are synthetic and live under a temporary root.
registerRebuildCheck({ noLog: true });
let root: ServiceRoot;
beforeEach(() => {
  root = makeServiceRoot("/tmp/sh-b1f1-");
  for (const [name, value] of Object.entries({
    HOME: root.home, SHEPRD_HOME: root.state, XDG_STATE_HOME: join(root.root, "xdg"),
    CODEX_HOME: join(root.home, ".codex"), CLAUDE_CONFIG_DIR: join(root.home, ".claude"),
  })) vi.stubEnv(name, value);
});
afterEach(async () => { await stopAllServices(); vi.unstubAllEnvs(); });

const token = 'review-SYNTHETIC-+/"\\ space-漢࿿-login-credential-987654321';
const withheld = "[output withheld: account credentials cannot be inspected]";
const serviceOptions = () => ({ env: {
  CODEX_HOME: undefined, CLAUDE_CONFIG_DIR: join(root.home, ".claude"),
  SHEPRD_TEST_DEBUG: "1", SHEPRD_TEST_PROTOCOL_LOG: "1",
} });

// A wrapper around the scripted fake, never a real adapter. Each write
// replaces `__F1_TOKEN__` with the token its store holds at that moment,
// JSON-escaped inside protocol frames. A store the engine cannot parse is
// still read by its `access_token` string, as a real adapter might.
const tokenAdapter = (store: string, pick: string) => {
  const path = join(root.bin, "file-login-adapter");
  writeFileSync(path, `#!${process.execPath}\n`
    + `const fs = process.getBuiltinModule("node:fs");\n`
    + `const read = () => { const text = fs.readFileSync(${JSON.stringify(store)}, "utf8");\n`
    + `  try { const doc = JSON.parse(text); return ${pick}; }\n`
    + `  catch { return JSON.parse(/"access_token"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")/.exec(text)[1]); } };\n`
    + `const replace = (chunk, framed) => String(chunk).replaceAll("__F1_TOKEN__", () => { const value = read(); return framed ? JSON.stringify(value).slice(1, -1) : value; });\n`
    + `const stdout = process.stdout.write.bind(process.stdout);\n`
    + `process.stdout.write = (chunk, ...rest) => stdout(replace(chunk, true), ...rest);\n`
    + `const stderr = process.stderr.write.bind(process.stderr);\n`
    + `process.stderr.write = (chunk, ...rest) => stderr(replace(chunk, false), ...rest);\n`
    + `import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});\n`);
  chmodSync(path, 0o755);
};

const noLeaks = (boundaries: Record<string, string>, tokens: ReadonlyArray<string>) => {
  for (const [boundary, output] of Object.entries(boundaries)) {
    for (const value of tokens) {
      for (const [form, encoded] of Object.entries(loginForms(value))) {
        expect.soft(output.includes(encoded), `${boundary}: ${form} leaked`).toBe(false);
      }
    }
  }
};

// Starts the service, configures one account whose adapter is `tokenAdapter`,
// runs `during` while the agent runs, and returns the four boundaries after
// the agent's turn ends or it crashes.
const run = (options: {
  readonly harness: string; readonly accountId: string; readonly store: string; readonly pick: string;
  readonly steps: ReadonlyArray<Record<string, unknown>>; readonly variables?: Record<string, string>;
  readonly during?: () => Effect.Effect<void, unknown>;
}) => Effect.scoped(Effect.gen(function* () {
  const service = startService(root, serviceOptions());
  yield* waitServing(root, service);
  const owner = yield* ownerClient(root);
  yield* configureLoginAccount(root, owner, { harness: options.harness, accountId: options.accountId,
    script: { turns: [options.steps] }, ...(options.variables === undefined ? {} : { variables: options.variables }) });
  tokenAdapter(options.store, options.pick);
  const received: Array<EventEnvelope> = [];
  yield* observeOwner(owner, received, options.accountId);
  const { agentId } = yield* startLoginAgent(root, owner, options.harness, options.accountId);
  if (options.during !== undefined) yield* options.during();
  yield* waitFor("the agent's turn ended or it crashed", () => received.some((event) => event.agentId === agentId
    && (event.event._tag === "TurnEnded" || event.event._tag === "AgentCrashed")), 40_000);
  const observed = yield* inspectBoundaries(root, owner, received, service, agentId);
  expect(observed.comparison).toMatchObject({ equal: true, differences: [], sequence: observed.head });
  service.child.kill("SIGTERM");
  yield* Effect.promise(() => service.exit);
  return { ...observed, boundaries: { ...observed.boundaries, "service output after shutdown": service.output() } };
}));

it.live("F2: a token under a metadata name, nested below it, is redacted at every boundary", () => Effect.gen(function* () {
  const store = join(root.home, ".codex", "auth.json");
  mkdirSync(dirname(store), { recursive: true });
  writeFileSync(store, JSON.stringify({ auth_mode: "chatgpt", scopes: { nested: { token } } }), { mode: 0o600 });
  const observed = yield* run({ harness: "codex", accountId: "codex", store, pick: "doc.scopes.nested.token",
    steps: [{ step: "text", text: "F2:text __F1_TOKEN__ :end\n" },
      { step: "tool_call", toolCallId: "f2-tool", title: "F2:tool", kind: "read", status: "completed", output: "F2:tool __F1_TOKEN__ :end" }] });
  expect(observed.storedThread).toContain("F2:text [REDACTED] :end");
  expect(observed.storedThread).toContain("F2:tool [REDACTED] :end");
  noLeaks(observed.boundaries, [token]);
}), 90_000);

for (const mode of ["half-written", "over 1 MiB"] as const) {
  it.live(`F3 ${mode}: a store that breaks while the agent runs withholds its output, and output flows again, redacted, after a valid rewrite`, () => Effect.gen(function* () {
    const store = join(root.home, ".codex", "auth.json");
    plantLogin(store, "original-login-token-for-fix-1");
    const next = `${token}-${mode === "half-written" ? "half" : "oversize"}`;
    const broken = join(root.root, "store-broken");
    const repaired = join(root.root, "store-repaired");
    const observed = yield* run({ harness: "codex", accountId: "codex", store, pick: "doc.tokens.access_token",
      steps: [
        { step: "wait_for_file", path: broken },
        { step: "text", text: "F3:during __F1_TOKEN__ :end\n" },
        { step: "tool_call", toolCallId: "f3-during", title: "F3:during-tool", kind: "read", status: "completed", output: "F3:during-tool __F1_TOKEN__" },
        { step: "stderr_part", text: "F3:during-stderr __F1_TOKEN__\n" },
        { step: "wait_for_file", path: repaired },
        { step: "text", text: "F3:after __F1_TOKEN__ :end\n" },
        { step: "tool_call", toolCallId: "f3-after", title: "F3:after-tool", kind: "read", status: "completed", output: "F3:after-tool __F1_TOKEN__ :end" },
        { step: "stderr_part", text: "F3:after-stderr __F1_TOKEN__ :end\n" },
        { step: "slow", ms: 50 },
        { step: "crash", exitCode: 3 },
      ],
      during: () => Effect.gen(function* () {
        yield* waitFor("the adapter is running", () => existsSync(join(root.root, "echo-login.json")));
        // The new token's own string is complete, so the adapter can read it,
        // but the engine cannot inspect the store.
        writeFileSync(store, mode === "half-written"
          ? `{"tokens":{"access_token":${JSON.stringify(next)}`
          : JSON.stringify({ tokens: { access_token: next }, padding: "x".repeat(1024 * 1024) }));
        writeFileSync(broken, "");
        yield* waitFor("output withheld while the store is broken", () => rowsIn(root).some((row) => row.payload_json.includes(withheld)));
        plantLogin(store, next);
        writeFileSync(repaired, "");
      }),
    });
    expect(observed.storedThread).toContain(withheld);
    expect(observed.storedThread).not.toContain("F3:during");
    expect(observed.storedThread).toContain("F3:after [REDACTED] :end");
    expect(observed.storedThread).toContain("F3:after-tool [REDACTED] :end");
    expect(observed.boundaries["events.payload_json"]).toContain("F3:after-stderr [REDACTED] :end");
    noLeaks(observed.boundaries, [next, "original-login-token-for-fix-1"]);
  }), 90_000);
}

it.live("F5: a Gemini account whose GEMINI_CLI_HOME moves its store is redacted at every boundary", () => Effect.gen(function* () {
  const moved = join(root.root, "gemini-home");
  const store = join(moved, ".gemini", "oauth_creds.json");
  plantLogin(store, token, "gemini");
  const observed = yield* run({ harness: "gemini", accountId: "gemini", store, pick: "doc.tokens.access_token",
    variables: { GEMINI_CLI_HOME: moved },
    steps: [{ step: "text", text: "F5:gemini __F1_TOKEN__ :end\n" }] });
  expect(existsSync(join(root.home, ".gemini", "oauth_creds.json"))).toBe(false);
  expect(observed.storedThread).toContain("F5:gemini [REDACTED] :end");
  noLeaks(observed.boundaries, [token]);
}), 90_000);

it.live("F6: a secret that would span a structure separator leaves unrelated tool fields where they were", () => Effect.gen(function* () {
  const store = join(root.home, ".codex", "auth.json");
  mkdirSync(dirname(store), { recursive: true });
  writeFileSync(store, JSON.stringify({ tokens: { access_token: token }, extra: "cancelleft\n\u0000\ncancelright" }), { mode: 0o600 });
  const input = { cancelleft: "cancelright", other: "head\n\u0000\ntail" };
  const observed = yield* run({ harness: "codex", accountId: "codex", store, pick: "doc.tokens.access_token",
    steps: [{ step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}", update: {
      sessionUpdate: "tool_call_update", toolCallId: "separator-cancel", title: "F6:separator", kind: "read", status: "completed",
      rawInput: input, rawOutput: { regular: "F6:output __F1_TOKEN__ :end" },
    } } }) }, { step: "slow", ms: 100 }] });
  const envelopes = JSON.parse(observed.storedThread.split("\n")[0]!) as Array<EventEnvelope>;
  const calls = envelopes.flatMap((envelope) => envelope.event._tag === "ThreadItem" && envelope.event.content._tag === "tool-call"
    ? [envelope.event.content] : []);
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) expect(JSON.parse(call.input!)).toEqual(input);
  expect(JSON.parse(calls.at(-1)!.output!)).toEqual({ regular: "F6:output [REDACTED] :end" });
  noLeaks(observed.boundaries, [token]);
}), 90_000);
