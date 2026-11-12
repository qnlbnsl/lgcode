import { fileURLToPath } from "node:url";

export const mcpScriptPath = fileURLToPath(new URL("../../../cli/src/bin.ts", import.meta.url));

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Issue 236, owner option (b). codex-acp 2.6.0's createSessionConfig (dist/index.js:43391-43448)
// replaces mcp_servers when ACP supplies servers, so this config requires
// an empty ACP list on new, load and resume. Only this server is approved.
// Codex 0.166.0 confirms `approve` returns false from
// requires_mcp_tool_approval_for_mode:
// https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/mcp_tool_call.rs#L2447-L2458
// create_env_for_mcp_server reads env_vars from std::env independently of
// shell_environment_policy (including inherit=core), rather than embedding
// token values in the configuration that codex-acp logs at startup:
// https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/rmcp-client/src/utils.rs#L15-L57
// These are configuration facts, not copied implementation code.
export const withLgtmMcp = (accountConfig: string | undefined): string => {
  const config: unknown = accountConfig === undefined ? {} : JSON.parse(accountConfig);
  if (!object(config)) throw new Error("invalid account configuration");
  const servers = config.mcp_servers;
  if (servers !== undefined && !object(servers)) throw new Error("invalid server configuration");
  if (object(servers) && Object.hasOwn(servers, "lgtm")) throw new Error("reserved server configuration");
  return JSON.stringify({ ...config, mcp_servers: { ...(servers ?? {}), lgtm: {
    command: process.execPath, args: [mcpScriptPath, "mcp"],
    env_vars: ["LGTM_SOCKET", "LGTM_TOKEN"], default_tools_approval_mode: "approve",
  } } });
};
