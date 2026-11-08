import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("Vitest collects the live-check tests and none of the live scripts, and check does not invoke live-check (catches accidentally running paid adapters during ordinary checks)", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const home = mkdtempSync("/tmp/sh8ct-collect-");
  roots.push(home);
  const listed = spawnSync(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "list", "packages/engine/test/live-check", "packages/engine/scripts", "--filesOnly", "--json"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
    env: { PATH: process.env.PATH ?? "", HOME: home, LGCODE_HOME: join(home, "state"), XDG_STATE_HOME: join(home, "xdg"), CODEX_HOME: join(home, "codex") },
  });
  expect(listed.status, listed.stderr).toBe(0);
  expect(listed.stdout, `collector output at ${root} using ${process.execPath}; stderr: ${listed.stderr}`).not.toBe("");
  const files = (JSON.parse(listed.stdout) as Array<{ file: string }>).map((entry) => entry.file);
  expect(files).toContain(fileURLToPath(import.meta.url));
  const scripts = join(root, "packages/engine/scripts");
  const candidates = [join(scripts, "live-check.ts"), ...readdirSync(join(scripts, "live")).filter((name) => name.endsWith(".ts")).map((name) => join(scripts, "live", name))];
  expect(candidates.length).toBeGreaterThan(10);
  for (const script of candidates) expect(files).not.toContain(script);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  expect(manifest.scripts.check).not.toContain("live-check");
});
