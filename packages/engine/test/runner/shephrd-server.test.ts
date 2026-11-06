import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, deliveryFor, echoFile, framesOf, harnessFor, makeRunnerRig, mcpScriptPath, readEcho,
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

const options = [
  { optionId: "once", name: "Allow once", kind: "allow_once" },
  { optionId: "always", name: "Allow always", kind: "allow_always" },
  { optionId: "no", name: "Reject", kind: "reject_once" },
];
const geminiMeta = (server = "shephrd") => ({ "gemini-cli": { mcp: { server_name: server, tool_name: "roles_orient" } } });
const claudeMeta = (server = "shephrd", source = "dynamic") => ({ claudeCode: { mcpServer: { name: server, source }, toolName: `mcp__${server}__roles_orient` } });
const permission = (toolCallId: string, _meta?: unknown, offered = options) => ({
  step: "permission", toolCallId, title: "mcp__shephrd__roles_orient", kind: "other", options: offered,
  ...(_meta === undefined ? {} : { _meta }),
});

for (const harnessId of ["claude", "cursor"]) {
  for (const method of ["new", "load", "resume"] as const) {
    live(`own tools: ${harnessId} session/${method} installs only its scoped native rule`, () =>
      withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
        const echo = echoFile(rig);
        const spawn = yield* spawnFor(rig, harnessFor(harnessId, writeFakeAdapter(rig)),
          accountFor(harnessId, { protocolVersion: method === "load" ? 1 : 2, turns: [] }, echo));
        if (method === "new") yield* runner.start(spawn.input);
        else yield* runner.load({ ...spawn.input, session: { _tag: "acp", sessionId: "fake-session-existing" } });
        const seen = yield* readEcho(echo, (current) => framesOf(current, `session/${method}`).length > 0);
        const params = framesOf(seen, `session/${method}`)[0]!.params;
        if (harnessId === "claude") expect(params._meta).toEqual({ claudeCode: { options: { allowedTools: ["mcp__shephrd"] } } });
        else {
          const config = JSON.parse(readFileSync(join(seen.env.CURSOR_CONFIG_DIR!, "cli-config.json"), "utf8"));
          expect(config.permissions.allow).toEqual([`Mcp(${params.mcpServers[0].name}:*)`]);
          expect(params.mcpServers[0].name).toMatch(/^shephrd-[a-f0-9-]{36}$/);
        }
      })));
  }
}

for (const value of ["bad-private-value", "[]", '{"permissions":[]}', '{"permissions":{"allow":"private-value"}}']) {
  live(`Cursor refuses an unreadable settings shape without changing the original (${value.slice(0, 20)})`, () =>
    withAcpRunner(rig, {}, ({ runner, logLines }) => Effect.gen(function* () {
      const directory = join(rig.home, "configured");
      mkdirSync(directory);
      writeFileSync(join(directory, "cli-config.json"), value);
      const echo = echoFile(rig);
      const spawn = yield* spawnFor(rig, harnessFor("cursor", writeFakeAdapter(rig)),
        accountFor("cursor", { turns: [] }, echo, { CURSOR_CONFIG_DIR: directory }));
      const result = yield* runner.start(spawn.input).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      expect(existsSync(echo)).toBe(false);
      expect(readFileSync(join(directory, "cli-config.json"), "utf8")).toBe(value);
      expect(logLines.join("\n")).not.toContain("private-value");
    })));
}

for (const harnessId of ["claude", "codex", "gemini", "cursor"]) {
  for (const mode of ["read-only", "ask", "edit", "full"] as const) {
    live(`own tools: ${harnessId}/${mode} keeps other servers and native tools on the human path`, () =>
      withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
        const echo = echoFile(rig);
        const source = join(rig.home, ".cursor");
        mkdirSync(source, { recursive: true });
        const original = JSON.stringify({ version: 1, permissions: { allow: ["Read(**)"], deny: ["Shell(rm)"] } });
        writeFileSync(join(source, "cli-config.json"), original);
        const servers = JSON.stringify({ mcpServers: { external: { command: "external", env: { EXTERNAL_KEY: "existing-private-value" } } } });
        writeFileSync(join(source, "mcp.json"), servers);
        const account = accountFor(harnessId, { turns: [[
          permission("external", geminiMeta("external")),
          { ...permission("shell", geminiMeta()), kind: "execute", _meta: undefined },
        ]] }, echo);
        const spawn = yield* spawnFor(rig, harnessFor(harnessId, writeFakeAdapter(rig)), account, { permission: mode });
        yield* context.runner.start(spawn.input);
        const seen = yield* readEcho(echo, (current) => framesOf(current, "session/new").length > 0);
        const params = framesOf(seen, "session/new")[0]!.params;
        expect(framesOf(seen, "session/set_config_option").at(-1)?.params.value).toBe(spawn.input.harness.permissionMapping[mode]);
        if (harnessId === "claude") expect(params._meta).toEqual({ claudeCode: { options: { allowedTools: ["mcp__shephrd"] } } });
        if (harnessId === "codex") expect(JSON.parse(seen.env.CODEX_CONFIG!).mcp_servers.shephrd.default_tools_approval_mode).toBe("approve");
        const privateDirectory = seen.env.CURSOR_CONFIG_DIR;
        if (harnessId === "cursor") {
          const server = params.mcpServers[0].name;
          expect(server).toMatch(/^shephrd-[a-f0-9-]{36}$/);
          expect(privateDirectory).not.toBe(source);
          expect(JSON.parse(readFileSync(join(privateDirectory!, "cli-config.json"), "utf8"))).toEqual({ version: 1,
            permissions: { allow: ["Read(**)", `Mcp(${server}:*)`], deny: ["Shell(rm)"] } });
          expect(readFileSync(join(privateDirectory!, "mcp.json"), "utf8")).toBe(servers);
          expect(readFileSync(join(privateDirectory!, "cli-config.json"), "utf8")).not.toContain(spawn.token);
        }
        yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, sentSequence: 1, delivery: deliveryFor(spawn.agentId, "go") });
        for (const toolCallId of ["external", "shell"]) {
          const asked = yield* context.waitFor((event) => event._tag === "permissionRequested" && event.toolCallId === toolCallId);
          if (asked._tag !== "permissionRequested") throw new Error("permission event missing");
          yield* context.runner.answerPermission({ agentId: spawn.agentId, requestId: asked.permissionRequestId, optionId: "no" });
        }
        expect(context.events.filter((event) => event._tag === "permissionRequested")).toHaveLength(2);
        yield* context.runner.stop({ agentId: spawn.agentId });
        if (harnessId === "cursor") expect(existsSync(privateDirectory!)).toBe(false);
        expect(readFileSync(join(source, "cli-config.json"), "utf8")).toBe(original);
        expect(readFileSync(join(source, "mcp.json"), "utf8")).toBe(servers);
      })));
  }
}

for (const harnessId of ["claude", "gemini"]) {
  for (const version of [1, 2] as const) {
    for (const mode of ["read-only", "ask", "edit", "full"] as const) {
      live(`${harnessId} v${version}/${mode} answers only its structured own-server request once`, () =>
        withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
          const echo = echoFile(rig);
          const meta = harnessId === "claude" ? claudeMeta : geminiMeta;
          const own = harnessId === "claude" && version === 2
            ? { ...permission("own", { claudeCode: { mcpServer: { name: "shephrd", source: "dynamic" } } }), name: "mcp__shephrd__roles_orient" }
            : permission("own", meta());
          const spawn = yield* spawnFor(rig, harnessFor(harnessId, writeFakeAdapter(rig)),
            accountFor(harnessId, { protocolVersion: version, turns: [[own, permission("other", meta("shephrd-other"))]] }, echo), { permission: mode });
          yield* context.runner.start(spawn.input);
          yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, sentSequence: 1, delivery: deliveryFor(spawn.agentId, "go") });
          const asked = yield* context.waitFor((event) => event._tag === "permissionRequested");
          expect(asked).toMatchObject({ toolCallId: "other" });
          expect(context.events.filter((event) => event._tag === "permissionRequested")).toHaveLength(1);
          const seen = yield* readEcho(echo);
          expect(seen.inbound.filter((frame) => frame.result?.outcome)).toMatchObject([{ result: { outcome: { outcome: "selected", optionId: "once" } } }]);
          if (asked._tag === "permissionRequested") yield* context.runner.answerPermission({ agentId: spawn.agentId, requestId: asked.permissionRequestId, optionId: "no" });
        })));
    }
  }
}

for (const source of ["user", "project", "local", "plugin", "sdk", "managed", ""]) {
  live(`Claude leaves a similarly named server from source ${source || "unknown"} on the human path`, () =>
    withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
      const echo = echoFile(rig);
      const spawn = yield* spawnFor(rig, harnessFor("claude", writeFakeAdapter(rig)),
        accountFor("claude", { turns: [[permission("uncertain", claudeMeta("shephrd", source))]] }, echo));
      yield* context.runner.start(spawn.input);
      yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, sentSequence: 1, delivery: deliveryFor(spawn.agentId, "go") });
      const asked = yield* context.waitFor((event) => event._tag === "permissionRequested");
      expect(asked).toMatchObject({ toolCallId: "uncertain" });
      expect((yield* readEcho(echo)).inbound.filter((frame) => frame.result?.outcome)).toEqual([]);
      if (asked._tag === "permissionRequested") yield* context.runner.answerPermission({ agentId: spawn.agentId, requestId: asked.permissionRequestId, optionId: "no" });
    })));
}

for (const [name, meta, offered] of [
  ["title only", undefined, options],
  ["other server", geminiMeta("external"), options],
  ["similar server", geminiMeta("shephrd__external"), options],
  ["no tool identity", { "gemini-cli": { mcp: { server_name: "shephrd" } } }, options],
  ["blank tool identity", { "gemini-cli": { mcp: { server_name: "shephrd", tool_name: " " } } }, options],
  ["persistent only", geminiMeta(), options.filter((option) => option.kind !== "allow_once")],
  ["ambiguous once", geminiMeta(), [...options, { optionId: "once2", kind: "allow_once", name: "Other" }]],
  ["duplicate ids", geminiMeta(), [...options, { optionId: "once", kind: "reject_once", name: "Other" }]],
] as const) {
  live(`Gemini leaves uncertain requests on the human path: ${name}`, () =>
    withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
      const echo = echoFile(rig);
      const spawn = yield* spawnFor(rig, harnessFor("gemini", writeFakeAdapter(rig)),
        accountFor("gemini", { turns: [[permission("uncertain", meta, [...offered])]] }, echo));
      yield* context.runner.start(spawn.input);
      yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, sentSequence: 1, delivery: deliveryFor(spawn.agentId, "go") });
      const asked = yield* context.waitFor((event) => event._tag === "permissionRequested");
      expect(asked).toMatchObject({ toolCallId: "uncertain" });
      expect((yield* readEcho(echo)).inbound.filter((frame) => frame.result?.outcome)).toEqual([]);
      if (asked._tag === "permissionRequested") yield* context.runner.answerPermission({ agentId: spawn.agentId, requestId: asked.permissionRequestId, optionId: "no" });
    })));
}

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
