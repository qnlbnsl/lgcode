import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findLeaks, type LeakSource } from "./support.ts";

// Read only the files selected by this run's SessionOpened identifiers. No
// credential file, log database, or unrelated session content is opened.
export const sessionFiles = (directory: string, sessionId: string): ReadonlyArray<string> => {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(sessionId)) throw new Error("invalid session identifier");
  const found: string[] = [];
  const visit = (folder: string): void => {
    let names: string[];
    try { names = readdirSync(folder); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error(`session directory cannot be inspected: ${folder}`);
    }
    for (const name of names) {
      const path = join(folder, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile() && (name === `${sessionId}.jsonl` || name.endsWith(`-${sessionId}.jsonl`))) found.push(path);
    }
  };
  visit(directory);
  return found;
};

export const scanTokens = (tokens: ReadonlyArray<string>, files: ReadonlyArray<string>, arguments_: ReadonlyArray<LeakSource>) => {
  if (tokens.length === 0 || tokens.some((token) => token.length < 16)) throw new Error("not attempted: no usable agent token to scan for");
  if (files.length === 0) throw new Error("not attempted: no session files found for this run");
  const sources = files.map((path) => ({ label: path, text: readFileSync(path, "utf8") }));
  if (sources.some((source) => source.text.trim().length === 0)) throw new Error("not attempted: a session file has no content");
  return { files: sources.length, arguments: arguments_.length, paths: files, leaks: findLeaks(tokens, [...sources, ...arguments_]) };
};

type Json = Record<string, any>;
const records = (ndjson: string): Json[] => {
  try { return ndjson.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Json); }
  catch { throw new Error("session JSON is malformed or incomplete; content is not printed"); }
};
const textParts = (value: unknown): string => typeof value === "string" ? value
  : Array.isArray(value) ? value.map((part) => part?.type === "text" || part?.type === "input_text" ? part.text ?? "" : "").join("") : "";
export const receivedUserText = (ndjson: string): ReadonlyArray<string> => records(ndjson).flatMap((row) => {
  const message = row.message ?? (row.type === "response_item" ? row.payload : undefined);
  return message?.role === "user" ? [textParts(message.content)] : [];
});
export const compactions = (ndjson: string): number => records(ndjson).filter((row) =>
  row.subtype === "compact_boundary" || row.type === "compacted" || row.payload?.type === "context_compacted").length;

// A delivery receipt must occur in the user's received text, not in an
// assistant's claim or a quoted tool result. Both directions use this rule.
export const slashReceipt = (received: ReadonlyArray<string>, id: string, payload: string, compacted: boolean): string => {
  if (compacted) return "command ran";
  if (received.some((text) => text.replace(/^[\s\p{Cf}]*/u, "").startsWith(payload))) return "unescaped";
  const matching = received.filter((text) => text.includes(`(delivery ${id}):`));
  if (matching.some((text) => text.includes(`\n${payload}\n`))) return "unescaped";
  return matching.some((text) => text.includes(`\n\\${payload}\nEnd data [`)) ? "escaped; no command" : "not attempted";
};

export const exactCommand = (input: string | undefined, command: string): boolean => {
  let value: unknown;
  try { value = JSON.parse(input ?? "null"); }
  catch { value = input; } // Logs written with display text lost the object.
  const actual = typeof value === "string" ? value
    : value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json).command : undefined;
  if (typeof actual !== "string") return false;
  if (actual === command) return true;
  const quoted = `'${command.replaceAll("'", "'\\''")}'`;
  return ["/bin/bash", "/bin/sh", "/bin/zsh", "bash", "sh", "zsh"].some((shell) =>
    ["-c", "-lc"].some((flag) => actual === `${shell} ${flag} ${quoted}`));
};
export const foregroundCommand = (input: string | undefined, command: string): boolean => {
  if (!exactCommand(input, command)) return false;
  try {
    const value = JSON.parse(input!);
    // Plain historical text cannot prove that background flags were absent.
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && [value.run_in_background, value.background].every((flag) => flag === undefined || flag === false);
  } catch { return false; }
};
export const mcpAskInput = (input: string | undefined, title: string, marker: string): boolean => {
  try {
    const value = JSON.parse(input ?? "null");
    if (value === null || typeof value !== "object") return false;
    if (value.server !== undefined || value.tool !== undefined) {
      if (value.server !== "shephrd" || value.tool !== "ask") return false;
      const payload = typeof value.arguments === "string" ? JSON.parse(value.arguments) : value.arguments;
      return payload?.text === marker && Object.keys(payload).length === 1;
    }
    return /shephrd.*ask|ask.*shephrd/i.test(title) && value.text === marker && Object.keys(value).length === 1;
  } catch { return false; }
};

// Claude's deferred tools require a lookup before the ask can be invoked.
// Permit only discovery of this exact tool, with its own completed reference;
// it is never evidence that the ask itself happened.
export const mcpAskDiscovery = (tool: { input?: string; title: string; status: string; output?: string }): boolean => {
  if (tool.title !== "ToolSearch" || tool.status !== "completed") return false;
  try {
    const input = JSON.parse(tool.input ?? "null");
    if (input?.query !== "select:mcp__shephrd__ask" || input.max_results !== 1 || Object.keys(input).length !== 2) return false;
    const references = (tool.output ?? "").split("\n").filter(Boolean).flatMap((line) => {
      const value: unknown = JSON.parse(line);
      if (!Array.isArray(value)) throw new Error("not a lookup result");
      return value;
    });
    return references.length > 0 && references.every((reference) => reference?.type === "tool_reference"
      && reference.tool_name === "mcp__shephrd__ask" && Object.keys(reference).length === 2);
  } catch { return false; }
};
// terminal.ts emits redacted replacement snapshots in the existing serialized
// tool-output field. Decode before inspecting line-oriented shell evidence.
export const terminalToolOutput = (output: string | undefined): string | undefined => {
  try {
    const value = JSON.parse(output ?? "null");
    if (typeof value?.terminalId !== "string" || typeof value.output !== "string" || typeof value.truncated !== "boolean") return undefined;
    return value.output + (Number.isSafeInteger(value.exitCode) ? `\nExit code: ${value.exitCode}\n` : "");
  } catch { return undefined; }
};
export const authRefused = (output: string, exitCode: number | undefined): boolean =>
  exitCode !== undefined && exitCode !== 0 && /the engine refused this identity \(HTTP 403\)/.test(output);

export const fixtureEvidence = (ndjson: string, harness: string, path: string): string => {
  let rows: Json[];
  try { rows = records(ndjson); } catch { throw new Error("not attempted: invalid real adapter fixture JSON"); }
  const header = rows[0];
  const categories = [...new Set(rows.flatMap((row) => row.frame?.result?.configOptions ?? []).map((entry: Json) => entry.category).filter(Boolean))];
  if (header?.type !== "transcript_start" || header.provider !== harness || header.protocol !== "acp"
    || typeof header.version !== "string" || header.version.trim() === ""
    || !Number.isInteger(header.metadata?.protocolVersion) || header.metadata.protocolVersion < 1
    || !categories.includes("model") || !categories.includes("thought_level")) {
    throw new Error(`not attempted: ${harness} fixture lacks a matching adapter header, version, negotiated protocol or config categories`);
  }
  return `PB-A10 existing evidence cited: ${path}:1; ${harness} adapter ${header.version}, ACP ${header.metadata.protocolVersion}; categories ${categories.join(",")}; no separate probe`;
};

// The command prints names before explicitly removing identity variables, so
// this observes the shell policy rather than just the env -u operation.
export const shellIdentityStatus = (output: string): "absent" | "present" | "not observed" | "invalid listing" => {
  const listing = /(?:^|\n)LCP_ENV_BEGIN\r?\n([\s\S]*?)\r?\nLCP_ENV_END(?:\r?\n|$)/.exec(output)?.[1];
  if (listing === undefined) return "not observed";
  const names = listing.split(/\r?\n/);
  if (names.length === 0 || !names.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) return "invalid listing";
  return names.includes("SHEPHRD_SOCKET") || names.includes("SHEPHRD_TOKEN") ? "present" : "absent";
};
export const shellIdentityAbsent = (output: string): boolean => shellIdentityStatus(output) === "absent";

export const canaryDenied = (output: string, path: string): boolean => {
  const lines = output.split(/\r?\n/);
  return lines.some((line) => ["Permission denied", "Operation not permitted"].some((reason) =>
    line === `cat: ${path}: ${reason}` || line === `cat: '${path}': ${reason}`)
    || /^Permission to read \/tmp\/[^\r\n]*\/live-canary has been denied by a deny rule\.$/.test(line));
};

// Read the original tool output, not the agent's prose. The adapters nest a
// terminal result differently; recurse through JSON wrappers but not strings
// that merely say a command was run.
export const exitCodeOf = (output: string): number | undefined => {
  const visit = (value: unknown): number | undefined => {
    if (value === null || typeof value !== "object") return undefined;
    const row = value as Json;
    if (typeof row.exit_code === "number") return row.exit_code;
    if (typeof row.exitCode === "number") return row.exitCode;
    for (const child of Object.values(row)) { const found = visit(child); if (found !== undefined) return found; }
    return undefined;
  };
  try { const code = visit(JSON.parse(output)); if (code !== undefined) return code; } catch { /* Some adapters expose rendered terminal text. */ }
  const rendered = /(?:Process exited with (?:code|exit code)|Exit code:|LCP_EXIT=)\s*(\d+)/i.exec(output);
  return rendered === null ? undefined : Number(rendered[1]);
};
