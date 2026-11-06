import { fileURLToPath } from "node:url";

export const mcpScriptPath = fileURLToPath(new URL("../../../cli/src/bin.ts", import.meta.url));

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Issue 236, owner option (b). codex-acp 2.5.0's createSessionConfig
// replaces mcp_servers when ACP supplies servers, so this config requires
// an empty ACP list on new, load and resume. Only this server is approved.
// Codex 0.165.0 confirms `approve` returns false from
// requires_mcp_tool_approval_for_mode:
// https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/src/mcp_tool_call.rs#L2440-L2450
// create_env_for_mcp_server reads env_vars from std::env independently of
// shell_environment_policy (including inherit=core), rather than embedding
// token values in the configuration that codex-acp logs at startup:
// https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/rmcp-client/src/utils.rs#L14-L56
// These are configuration facts, not copied implementation code.
export const withSheprdMcp = (accountConfig: string | undefined): string => {
  const config: unknown = accountConfig === undefined ? {} : JSON.parse(accountConfig);
  if (!object(config)) throw new Error("invalid account configuration");
  const servers = config.mcp_servers;
  if (servers !== undefined && !object(servers)) throw new Error("invalid server configuration");
  if (object(servers) && Object.hasOwn(servers, "sheprd")) throw new Error("reserved server configuration");
  return JSON.stringify({ ...config, mcp_servers: { ...(servers ?? {}), sheprd: {
    command: process.execPath, args: [mcpScriptPath, "mcp"],
    env_vars: ["SHEPRD_SOCKET", "SHEPRD_TOKEN"], default_tools_approval_mode: "approve",
  } } });
};
