// Unit 2, criterion 2.6: run the plan's exact single-line import/export grep.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const pattern = "^[[:space:]]*(import|export)[^;]*['\"]@t3tools/";
const scratch: string[] = [];
afterAll(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true });
});
const scan = (path: string) => spawnSync("grep", ["-rnE", pattern, path], {
  encoding: "utf8", timeout: 30_000,
});

describe("copied packages' import boundary", () => {
  it("has no T3 workspace imports or exports in the real tree (breaks if a copied module keeps an unresolved @t3tools dependency)", () => {
    const result = scan(join(repoRoot, "third_party/t3code"));
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
    expect(result.status).toBe(1); // grep's no-match status, not an I/O error.
  });

  it.each([
    ['  import { client } from "@t3tools/x";', "@t3tools/x"],
    ["export * from '@t3tools/y';", "@t3tools/y"],
  ])("detects %s (breaks if criterion 2.6's pattern misses %s)", (statement, module) => {
    const root = mkdtempSync(join(tmpdir(), "lgtm-t3-imports-"));
    scratch.push(root);
    const path = join(root, "probe.ts");
    writeFileSync(path, `// import from '@t3tools/comment'\n${statement}\nconst text = '@t3tools/string';\n`);
    const result = scan(root);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toEqual([`${path}:2:${statement}`]);
    expect(result.stdout).toContain(module);
  });
});
