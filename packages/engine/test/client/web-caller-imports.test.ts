import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it("5.2 caller boundary: catches a route constructing its own owner credential or a listener disconnected from webCaller", () => {
  const root = fileURLToPath(new URL("../../src/client/web", import.meta.url));
  const caller = join(root, "webCaller.ts");
  expect(existsSync(caller), "Unit 5 must provide the sole cookie-to-owner boundary client/web/webCaller.ts").toBe(true);
  const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
  const bypasses: string[] = [];
  const imports = new Map<string, string[]>();
  for (const path of files(root)) {
    // The installed TypeScript runner has no compiler API. Tokenize strings
    // and comments so a comment cannot satisfy the dependency check.
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
      (token) => token.startsWith("//") || token.startsWith("/*") ? " " : token);
    const dependencies: string[] = [];
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](\.[^"']+)["']/g)) {
      dependencies.push(resolve(dirname(path), match[1]!.replace(/\.js$/, ".ts")));
    }
    if (path !== caller && /\{[^{}]*?(?:\b_tag|["']_tag["'])\s*:\s*["']owner["']/.test(source)) bypasses.push(path);
    imports.set(path, dependencies);
  }
  expect(bypasses, "Only webCaller may construct the web owner's credential").toEqual([]);
  const seen = new Set<string>();
  const reaches = (path: string): boolean => {
    if (path === caller) return true;
    if (seen.has(path)) return false;
    seen.add(path); return (imports.get(path) ?? []).some(reaches);
  };
  expect(reaches(join(root, "server.ts")), "the listener must reach the shared webCaller boundary").toBe(true);
});
