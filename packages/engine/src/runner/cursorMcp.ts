import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import type { ConfigOption } from "./config.ts";
import { randomUUID } from "node:crypto";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Cursor 2026.10.14-941492e's 6136.index.js buildVariantModelConfigOptions
// exposes Auto as `default[]`, while the CLI calls it `auto`. Resolve only
// this exact advertised option; never select another model or its default.
export function cursorModelId(requested: string, options: ReadonlyArray<ConfigOption>): string {
  if (requested !== "auto") return requested;
  const values = options.find((option) => option.category === "model")?.options;
  if (!Array.isArray(values) || values.some((value) => object(value) && value.value === "auto")) return requested;
  const matches = values.filter((value) => object(value) && value.value === "default[]" && value.name === "Auto");
  return matches.length === 1 ? "default[]" : requested;
}

// Cursor restores provider identifiers from its conversation on load. Keep
// the unguessable server alias with that agent's session, across processes.
export function cursorServerName(sessions: string): string {
  mkdirSync(sessions, { recursive: true, mode: 0o700 });
  chmodSync(sessions, 0o700);
  const file = join(sessions, "lgtm-server-name");
  if (!existsSync(file)) writeFileSync(file, `lgtm-${randomUUID()}`, { flag: "wx", mode: 0o600 });
  const name = readFileSync(file, "utf8");
  if (!/^lgtm-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(name)) throw new Error("Invalid Cursor server identity");
  return name;
}

// Cursor 2026.10.14-941492e, installed runtime index.js:
// cursor-config/dist/paths.js uses CURSOR_CONFIG_DIR for cli-config.json.
// InteractivePermissionsService.shouldBlockMcp checks Mcp(server:*) allow
// rules before its read-only check. matchesMcpPattern folds case and strips
// ::mcpScope:, so the runner supplies an unguessable per-agent server name rather
// than trusting a display name or sharing a rule with an owner's server.
// The ACP pending-decision provider in 6136.index.js drops the provider id;
// answering from its title would be ambiguous. --approve-mcps covers every
// server and is therefore unsuitable. Authentication uses the separate
// credential manager (Linux: XDG_CONFIG_HOME/cursor/auth.json).
// Only this process's copy is changed. No credential is added to the config.
export function cursorMcpConfig(environment: Readonly<Record<string, string | undefined>>, server: string, cwd: string, sessions?: string) {
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
  const directory = mkdtempSync(join(tmpdir(), "lgtm-cursor-"));
  const remove = () => rmSync(directory, { recursive: true, force: true });
  try {
    chmodSync(directory, 0o700);
    // 6136.index.js acp-storage.ts stores loadSession's database beneath
    // CURSOR_CONFIG_DIR/acp-sessions. Keep history in this agent's engine
    // state directory while settings and approval rules remain disposable.
    if (sessions !== undefined) {
      mkdirSync(sessions, { recursive: true, mode: 0o700 });
      chmodSync(sessions, 0o700);
      symlinkSync(sessions, join(directory, "acp-sessions"), "dir");
    }
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
