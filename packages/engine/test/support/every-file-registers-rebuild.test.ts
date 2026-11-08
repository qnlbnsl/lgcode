import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

// This is deliberately a discovery guard, not a frozen list of today's files.
// Row 43 requires registration; execution of the real hook is covered by the
// fixtures that register it. Comments, text and an unused import do not count.
const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
const hasRegistration = (file: string, hook: string): boolean => {
  const source = readFileSync(file, "utf8");
  const uncommented = source.replace(tokens, (token) => token.startsWith("//") || token.startsWith("/*") ? " " : token);
  const code = source.replace(tokens, " ");
  const imports = uncommented.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g);
  for (const match of imports) {
    if (resolve(dirname(file), match[2]!) !== hook) continue;
    for (const binding of match[1]!.split(",")) {
      const imported = /^\s*registerRebuildCheck(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(binding);
      if (imported === null) continue;
      const local = imported[1] ?? "registerRebuildCheck";
      const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\s*\\(`).test(code)) return true;
    }
  }
  return false;
};

const missingRegistrations = (root: string): string[] => {
  const hook = resolve(root, "support/rebuildCheck.ts");
  const missing: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      // Only the two root folders named by rows 43 and 63 are exempt. A
      // future views/support/ or views/smoke/ folder still needs its hooks.
      if (directory === root && entry.isDirectory() && ["smoke", "support"].includes(entry.name)) continue;
      if (entry.isDirectory()) visit(path);
      else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name) && !hasRegistration(path, hook)) {
        missing.push(relative(root, path));
      }
    }
  };
  visit(root);
  return missing.sort();
};

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/lgcode-rebuild-guard-");
  vi.stubEnv("LGCODE_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});
const write = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

it("4.4 row 43 registration guard: catches any current or newly added engine test that omits its rebuild hook", () => {
  const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
  expect(missingRegistrations(root), "Engine tests without registerRebuildCheck").toEqual([]);
});

it("4.4 guard mutation: catches hard-coding today's files or exempting a new nested test accidentally", () => {
  const root = join(home, "test");
  write(join(root, "views/registered.test.ts"), 'import { registerRebuildCheck } from "../support/rebuildCheck.ts";\nregisterRebuildCheck({ noLog: true });');
  write(join(root, "smoke/exempt.test.ts"), "it('smoke', () => {});");
  write(join(root, "support/exempt.test.ts"), "it('guard', () => {});");
  expect(missingRegistrations(root)).toEqual([]);
  write(join(root, "views/future/deep.spec.ts"), "it('future', () => {});");
  write(join(root, "views/support/still-a-test.test.ts"), "it('nested support', () => {});");
  expect(missingRegistrations(root)).toEqual(["views/future/deep.spec.ts", "views/support/still-a-test.test.ts"]);
});

it("4.4 guard forms: catches rejecting effectful registration or accepting comments, strings and unused imports as hooks", () => {
  const root = join(home, "test");
  const imported = 'import { registerRebuildCheck } from "../support/rebuildCheck.ts";\n';
  write(join(root, "log/scoped.test.ts"), imported + "Effect.gen(function* () { yield* registerRebuildCheck(); });");
  write(join(root, "runner/no-log.test.ts"), imported + "registerRebuildCheck({ noLog: true });");
  write(join(root, "views/alias.test.ts"), 'import { registerRebuildCheck as check } from "../support/rebuildCheck.ts";\ncheck();');
  write(join(root, "views/import-only.test.ts"), imported + "// registerRebuildCheck();\n/* registerRebuildCheck(); */");
  write(join(root, "views/text-only.test.ts"), imported + 'const text = "registerRebuildCheck()";\nconst template = `registerRebuildCheck()`;');
  write(join(root, "views/impostor.test.ts"), 'import { registerRebuildCheck } from "../other/rebuildCheck.ts";\nregisterRebuildCheck();');
  expect(missingRegistrations(root)).toEqual(["views/import-only.test.ts", "views/impostor.test.ts", "views/text-only.test.ts"]);
});
