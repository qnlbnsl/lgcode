import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, echoFile, fakeAgentPath, harnessFor, makeRunnerRig, readEcho, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter,
  type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually } from "../support/routingRig.ts";

// Fix round 2 follow-up (task 1c): the login-store source (issue 223) must
// read the folder the harness really uses once an account's `home` is passed
// through the harness's own variable (A9). A token in that folder is
// registered before the child starts, so it never reaches the event log. The
// default folders hold nothing, so a source that read them would register
// nothing. Tokens and homes are synthetic and live under the rig's folder.
let rig: RunnerRig;

beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPRD_HOME", rig.stateFolder);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

const token = "eyJhbGciOiJub25lIn0.PLANTED-ACCOUNT-HOME-TOKEN.signature";

// The adapter takes its line from a side file, so the token never sits in the
// account's settings, which the log records. Only the store tells the engine
// what to redact.
const printingAdapter = () => {
  const line = join(rig.root, "adapter-line.txt");
  writeFileSync(line, `login ${token} end`);
  const adapter = join(rig.bin, "printing-adapter");
  writeFileSync(adapter, `#!${process.execPath}\n`
    + `const fs = process.getBuiltinModule("node:fs");\n`
    + `const script = JSON.parse(process.env.FAKE_AGENT_SCRIPT);\n`
    + `script.turns = [[{ step: "text", text: fs.readFileSync(${JSON.stringify(line)}, "utf8") }]];\n`
    + `process.env.FAKE_AGENT_SCRIPT = JSON.stringify(script);\n`
    + `import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});\n`);
  chmodSync(adapter, 0o755);
  return adapter;
};

const plant = (folder: string, file: string) => {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(join(folder, file), JSON.stringify({ tokens: { access_token: token }, claudeAiOauth: { accessToken: token } }), { mode: 0o600 });
};

const cases = [
  { name: "Claude with an account home", harness: "claude", accountId: "primary", variable: "CLAUDE_CONFIG_DIR", file: ".credentials.json",
    folder: () => join(rig.root, "claude-login-two") },
  { name: "the Codex account named codex with an account home", harness: "codex", accountId: "codex", variable: "CODEX_HOME", file: "auth.json",
    folder: () => join(rig.root, "codex-login-two") },
  { name: "a Codex account with its own shadow home", harness: "codex", accountId: "secondary", variable: "CODEX_HOME", file: "auth.json",
    folder: () => join(rig.stateFolder, "providers", "codex", "secondary", "shadow") },
] as const;

for (const scenario of cases) {
  it.live(`B1 follows the account home: ${scenario.name} has the token in its login folder registered before the child starts, and the token never reaches the event log`, () =>
    Effect.gen(function* () {
      const folder = scenario.folder();
      // Claude and the Codex account named `codex` use the account home as the login folder. Any other Codex
      // account gets a shadow home and shares only its sessions from the account home.
      const home = scenario.accountId === "secondary" ? join(rig.root, "codex-account-home") : folder;
      mkdirSync(home, { recursive: true, mode: 0o700 });
      plant(folder, scenario.file);
      const echo = echoFile(rig);
      const harness = harnessFor(scenario.harness, printingAdapter());
      const account = { ...accountFor(scenario.harness, { turns: [] }, echo, {}, scenario.accountId), home };
      return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
        yield* registerRebuildCheck();
        success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "show status" })));
        const sql = yield* SqlClient.SqlClient;
        const stored = yield* eventually(
          sql<{ payload_json: string }>`SELECT payload_json FROM events ORDER BY sequence`,
          (rows) => rows.some((row) => row.payload_json.includes(" end")),
        );
        // The child really used the folder that holds the token.
        expect((yield* readEcho(echo)).env[scenario.variable], "the folder the child was given").toBe(folder);
        expect(existsSync(join(rig.home, ".claude", ".credentials.json")) || existsSync(join(rig.home, ".codex", "auth.json"))).toBe(false);
        const text = stored.map((row) => row.payload_json).join("\n");
        expect(text).toContain("login [REDACTED] end");
        expect(text).not.toContain(token);
        expect(text).not.toContain(Buffer.from(token).toString("base64"));
      }));
    }), 60_000);
}
