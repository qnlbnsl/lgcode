import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Cursor 2026.10.14-941492e, installed runtime index.js:
// cursor-config/dist/paths.js uses CURSOR_CONFIG_DIR for cli-config.json.
// InteractivePermissionsService.shouldBlockMcp checks Mcp(server:*) allow
// rules before its read-only check. matchesMcpPattern folds case and strips
// ::mcpScope:, so the runner supplies a fresh, unguessable server name rather
// than trusting a display name or sharing a rule with an owner's server.
// The ACP pending-decision provider in 6136.index.js drops the provider id;
// answering from its title would be ambiguous. --approve-mcps covers every
// server and is therefore unsuitable. Authentication uses the separate
// credential manager (Linux: XDG_CONFIG_HOME/cursor/auth.json).
// Only this process's copy is changed. No credential is added to the config.
export function cursorMcpConfig(environment: Readonly<Record<string, string | undefined>>, server: string, cwd: string) {
  const configured = environment.CURSOR_CONFIG_DIR;
  const xdg = environment.XDG_CONFIG_HOME;
  const source = resolve(cwd, configured?.trim() ? configured
    : xdg?.trim() ? join(xdg, "cursor") : join(environment.HOME ?? homedir(), ".cursor"));
  const file = join(source, "cli-config.json");
  const config: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { version: 1 };
  if (!object(config) || (config.permissions !== undefined && !object(config.permissions))) throw new Error("Invalid Cursor settings");
  const permissions = config.permissions as Record<string, unknown> | undefined;
  if (permissions?.allow !== undefined && (!Array.isArray(permissions.allow) || !permissions.allow.every((value) => typeof value === "string"))) {
    throw new Error("Invalid Cursor permissions");
  }
  const directory = mkdtempSync(join(tmpdir(), "shephrd-cursor-"));
  const remove = () => rmSync(directory, { recursive: true, force: true });
  try {
    chmodSync(directory, 0o700);
    writeFileSync(join(directory, "cli-config.json"), JSON.stringify({ ...config, permissions: {
      ...permissions, allow: [...(permissions?.allow as string[] | undefined ?? []), `Mcp(${server}:*)`],
    } }), { mode: 0o600 });
    // Keep the owner's other servers and connection approvals available.
    // Copies ensure a harness write cannot change the owner's originals.
    for (const name of ["mcp.json", "mcp-approvals.json"]) {
      if (existsSync(join(source, name))) {
        copyFileSync(join(source, name), join(directory, name));
        chmodSync(join(directory, name), 0o600);
      }
    }
    return { directory, remove };
  } catch (error) { remove(); throw error; }
}
