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
  const matching = received.filter((text) => text.includes(`(delivery ${id}):`));
  if (matching.some((text) => text.includes(`\n${payload}\n`))) return "unescaped";
  return matching.some((text) => text.includes(`\n\\${payload}\nEnd data [`)) ? "escaped; no command" : "not attempted";
};

export const exactCommand = (input: string | undefined, command: string): boolean => {
  try {
    const actual = JSON.parse(input ?? "null")?.command;
    if (actual === command) return true;
    const quoted = `'${command.replaceAll("'", "'\\''")}'`;
    return ["/bin/bash", "/bin/sh", "/bin/zsh", "bash", "sh", "zsh"].some((shell) =>
      ["-c", "-lc"].some((flag) => actual === `${shell} ${flag} ${quoted}`));
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
export const authRefused = (output: string, exitCode: number | undefined): boolean =>
  exitCode !== undefined && exitCode !== 0 && /the engine refused this identity \(HTTP 403\)/.test(output);

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
