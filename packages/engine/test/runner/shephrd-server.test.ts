import { existsSync } from "node:fs";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, echoFile, framesOf, harnessFor, makeRunnerRig, mcpScriptPath, readEcho,
  removeRunnerRig, spawnFor, withAcpRunner, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });

const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

for (const method of ["new", "load", "resume"] as const) {
  live(`issue 236: session/${method} configures only the Shephrd server approval-free without embedding its token`, () =>
    withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
      const echo = echoFile(rig);
      const accountConfig = {
        shell_environment_policy: { inherit: "core" }, model_reasoning_effort: "high",
        mcp_servers: { external: { command: "/test/approval-gated", default_tools_approval_mode: "prompt", env_vars: ["EXTERNAL_KEY"] } },
      };
      const harness = harnessFor("codex", writeFakeAdapter(rig));
      const account = accountFor("codex", { protocolVersion: method === "load" ? 1 : 2, turns: [] }, echo,
        { CODEX_CONFIG: JSON.stringify(accountConfig) });
      const spawn = yield* spawnFor(rig, harness, account);
      if (method === "new") yield* runner.start(spawn.input);
      else yield* runner.load({ ...spawn.input, session: { _tag: "acp", sessionId: "fake-session-existing" } });
      const seen = yield* readEcho(echo, (current) => framesOf(current, `session/${method}`).length > 0);
      expect(framesOf(seen, `session/${method}`)).toHaveLength(1);
      expect(framesOf(seen, `session/${method}`)[0]!.params.mcpServers ?? []).toEqual([]);
      expect(JSON.parse(seen.env.CODEX_CONFIG!)).toEqual({ ...accountConfig, mcp_servers: {
        ...accountConfig.mcp_servers, shephrd: {
          command: process.execPath, args: [mcpScriptPath, "mcp"],
          env_vars: ["SHEPHRD_SOCKET", "SHEPHRD_TOKEN"], default_tools_approval_mode: "approve",
        },
      } });
      expect(seen.env.CODEX_CONFIG).not.toContain(spawn.token);
      expect(seen.env.SHEPHRD_SOCKET).toBe(rig.socket);
      expect(seen.env.SHEPHRD_TOKEN).toBe(spawn.token);
    })));
}

live("issue 236: an account without CODEX_CONFIG still gets the scoped server", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor("codex", writeFakeAdapter(rig)), accountFor("codex", { turns: [] }, echo));
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo);
    expect(seen.env.CODEX_CONFIG).toBeTypeOf("string");
    expect(JSON.parse(seen.env.CODEX_CONFIG!)).toEqual({ mcp_servers: { shephrd: {
      command: process.execPath, args: [mcpScriptPath, "mcp"],
      env_vars: ["SHEPHRD_SOCKET", "SHEPHRD_TOKEN"], default_tools_approval_mode: "approve",
    } } });
  })));

for (const value of ["invalid-private-value", "null", "[]", '"private-value"', "42", '{"mcp_servers":[]}',
  '{"mcp_servers":null}', '{"mcp_servers":{"shephrd":{"env":{"secret":"private-value"}}}}',
  '{"mcp_servers":{"shephrd":null}}']) {
  live(`issue 236: an invalid or colliding account config is refused before spawning (${value.slice(0, 25)})`, () =>
    withAcpRunner(rig, {}, ({ runner, logLines }) => Effect.gen(function* () {
      const echo = echoFile(rig);
      const spawn = yield* spawnFor(rig, harnessFor("codex", writeFakeAdapter(rig)),
        accountFor("codex", { turns: [] }, echo, { CODEX_CONFIG: value }));
      const result = yield* runner.start(spawn.input).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure).toMatchObject({
        _tag: "RunnerRejected", reason: "account tool server configuration cannot be prepared",
      });
      expect(existsSync(echo)).toBe(false);
      expect(logLines.join("\n")).not.toContain("private-value");
    })));
}

live("issue 236: a Claude start retains the ACP server and its account configuration unchanged", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const config = "unparsed account setting";
    const spawn = yield* spawnFor(rig, harnessFor("claude", writeFakeAdapter(rig)),
      accountFor("claude", { turns: [] }, echo, { CODEX_CONFIG: config }));
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo, (current) => framesOf(current, "session/new").length > 0);
    expect(seen.env.CODEX_CONFIG).toBe(config);
    expect(framesOf(seen, "session/new")[0]!.params.mcpServers).toEqual([{
      type: "stdio", name: "shephrd", command: process.execPath, args: [mcpScriptPath, "mcp"], env: [
        { name: "SHEPHRD_SOCKET", value: rig.socket }, { name: "SHEPHRD_TOKEN", value: spawn.token },
      ],
    }]);
  })));
