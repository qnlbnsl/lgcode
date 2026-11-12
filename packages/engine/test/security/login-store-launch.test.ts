import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, echoFile, fakeAgentPath, harnessFor, makeRunnerRig, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter,
  type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, snapshot } from "../support/routingRig.ts";

// Issue 223 (finding B1): a harness login store is read before the adapter
// exists, a store that cannot be inspected refuses the launch, and a token
// written to the store while the adapter runs is redacted too. Tokens and
// homes are synthetic and live under the rig's temporary folder.
let rig: RunnerRig;

beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

const codexHome = () => {
  const home = join(rig.home, ".codex");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
};

it.live("a login store that cannot be inspected refuses the launch before any adapter is spawned", () =>
  Effect.gen(function* () {
    // Present but not JSON: its tokens cannot be known, so nothing it holds
    // could be redacted.
    writeFileSync(join(codexHome(), "auth.json"), "{\"tokens\": {\"access_token\": \"truncated-planted", { mode: 0o600 });
    const echo = echoFile(rig);
    const harness = harnessFor("codex", writeFakeAdapter(rig));
    const account = accountFor("codex", { turns: [] }, echo, {}, "codex");
    return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "show status" })));
      const failures = yield* eventually(readLog, (rows) => rows.some((row) => row.event._tag === "AgentStartFailed"));
      expect(failures.filter((row) => row.event._tag === "AgentStartFailed").map((row) => row.event))
        .toEqual([{ _tag: "AgentStartFailed", agentId: reply.agentId, reason: "could-not-start" }]);
      expect((yield* snapshot).agents[reply.agentId]?.state._tag).toBe("stopped");
      expect(existsSync(echo), "the adapter must never be spawned").toBe(false);
      expect(context.events.some((event) => event._tag === "deliveryUpdate")).toBe(false);
      expect(JSON.stringify([failures, context.logLines])).not.toContain("truncated-planted");
    }));
  }), 60_000);

it.live("a token written to the login store while the adapter runs is redacted, and the replaced one stays redacted", () =>
  Effect.gen(function* () {
    const first = "eyJhbGciOiJub25lIn0.PLANTED-FIRST-ACCESS-TOKEN.signature";
    // The same length, written in place: only the store's times change.
    const second = "eyJhbGciOiJub25lIn0.PLANTED-NEXT-ACCESS-TOKEN!.signature";
    expect(second.length).toBe(first.length);
    const store = join(codexHome(), "auth.json");
    const document = (token: string) => JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: token } });
    writeFileSync(store, document(first), { mode: 0o600 });
    const gate = join(rig.root, "store-rewritten");
    // The adapter takes its line from a side file, so the tokens never sit in
    // the account's settings, which the log records before any launch. Only
    // the store tells the engine what the second token is, after the gate.
    const line = join(rig.root, "adapter-line.txt");
    writeFileSync(line, `mode chatgpt old ${first} new ${second} base64 ${Buffer.from(second).toString("base64")} end`);
    const adapter = join(rig.bin, "store-refresh-adapter");
    writeFileSync(adapter, `#!${process.execPath}\n`
      + `const fs = process.getBuiltinModule("node:fs");\n`
      + `const script = JSON.parse(process.env.FAKE_AGENT_SCRIPT);\n`
      + `script.turns = [[{ step: "wait_for_file", path: ${JSON.stringify(gate)} }, { step: "text", text: fs.readFileSync(${JSON.stringify(line)}, "utf8") }]];\n`
      + `process.env.FAKE_AGENT_SCRIPT = JSON.stringify(script);\n`
      + `import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});\n`);
    chmodSync(adapter, 0o755);
    const echo = echoFile(rig);
    const harness = harnessFor("codex", adapter);
    const account = accountFor("codex", { turns: [] }, echo, {}, "codex");
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "show status" })));
      yield* eventually(Effect.sync(() => existsSync(echo)), (spawned) => spawned);
      writeFileSync(store, document(second));
      writeFileSync(gate, "");
      const sql = yield* SqlClient.SqlClient;
      const stored = yield* eventually(
        sql<{ payload_json: string }>`SELECT payload_json FROM events ORDER BY sequence`,
        (rows) => rows.some((row) => row.payload_json.includes(" end")),
      );
      const text = stored.map((row) => row.payload_json).join("\n");
      // `auth_mode` is on the non-secret list, so its ordinary word survives.
      expect(text).toContain("mode chatgpt old [REDACTED] new [REDACTED] base64 [REDACTED] end");
      expect(text).not.toContain(first);
      expect(text).not.toContain(second);
      expect(text).not.toContain(Buffer.from(second).toString("base64"));
    }));
  }), 60_000);
