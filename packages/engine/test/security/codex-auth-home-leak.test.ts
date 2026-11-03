import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, echoFile, fakeAgentPath, harnessFor, makeRunnerRig, removeRunnerRig,
  startPayloadFor, withEngine, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually } from "../support/routingRig.ts";

let rig: RunnerRig;

beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

// Issue 223 (finding B1): the hostile review's attack, inverted. It passed
// against 8ff4c9b, proving the leak; it now proves the token is replaced.
it.live("a Codex auth.json access token emitted by the adapter never reaches the event log", () =>
  Effect.gen(function* () {
    const planted = "eyJhbGciOiJub25lIn0.PLANTED-CODEX-OAUTH-ACCESS-TOKEN.signature";
    const codexHome = join(rig.home, ".codex");
    mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ tokens: { access_token: planted } }), { mode: 0o600 });

    const adapter = join(rig.bin, "auth-reading-adapter");
    writeFileSync(adapter, `#!${process.execPath}\n`
      + `const fs = process.getBuiltinModule("node:fs");\n`
      + `const path = process.getBuiltinModule("node:path");\n`
      + `const home = process.env.CODEX_HOME || path.join(process.env.HOME, ".codex");\n`
      + `const token = JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8")).tokens.access_token;\n`
      + `const script = JSON.parse(process.env.FAKE_AGENT_SCRIPT);\n`
      + `script.turns = [[{ step: "text", text: token }]];\n`
      + `process.env.FAKE_AGENT_SCRIPT = JSON.stringify(script);\n`
      + `import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});\n`);
    chmodSync(adapter, 0o755);

    const harness = harnessFor("codex", adapter);
    const account = accountFor("codex", { turns: [] }, echoFile(rig), {}, "codex");
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "show status" })));
      const sql = yield* SqlClient.SqlClient;
      const stored = yield* eventually(
        sql<{ payload_json: string }>`SELECT payload_json FROM events ORDER BY sequence`,
        (rows) => rows.some((row) => row.payload_json.includes("[REDACTED]")),
      );
      expect(stored.some((row) => row.payload_json.includes("[REDACTED]"))).toBe(true);
      expect(stored.some((row) => row.payload_json.includes(planted))).toBe(false);
    }));
  }), 60_000);
