// Unit 2 fix round 1: the credit checker must not accept names it has not
// credited. Each case reproduces a bypass found in the focused review.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const checker = join(repoRoot, "scripts/check-credits.sh");
const scratch: string[] = [];
const makeScratch = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "shephrd-credits-names-")));
  scratch.push(root);
  return root;
};
afterAll(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true });
});

const write = (root: string, path: string, text: string): void => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
};
const clientRow = "| effect-acp | `effect-acp/src/client.ts` | `packages/effect-acp/src/client.ts` | none in original | None. |";
const helperRow = "| source-control | `source-control/src/helper.ts` | `packages/shared/src/helper.ts` | none in original | None. |";
const readme = (rows: string[]): string =>
  ["# T3 Code copies", "| Package | File here | File in T3 Code | Copyright line | Changes |", "| --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
const review = (rows: string[]): string =>
  ["# Security review", "| File | Result |", "| --- | --- |", ...rows, ""].join("\n");

// A fully credited tree, with or without the two credited files on disk.
const makeTree = (withFiles = true): string => {
  const root = makeScratch();
  if (withFiles) {
    write(root, "third_party/t3code/effect-acp/src/client.ts", "export const client = 1;\n");
    write(root, "third_party/t3code/source-control/src/helper.ts", "export const helper = 2;\n");
  }
  write(root, "third_party/t3code/README.md", readme([clientRow, helperRow]));
  write(root, "third_party/t3code/SECURITY-REVIEW.md", review([
    "| `effect-acp/src/client.ts` | read, no findings |",
    "| `source-control/src/helper.ts` | read, no findings |",
  ]));
  write(root, "NOTICE", "T3 Code (MIT): third_party/t3code/effect-acp and third_party/t3code/source-control.\n");
  for (const directory of ["", "effect-acp/", "source-control/"]) {
    write(root, `third_party/t3code/${directory}LICENSE`, "Licence.\n");
    write(root, `third_party/t3code/${directory}package.json`, "{}\n");
  }
  return root;
};
const run = (root: string) =>
  spawnSync(checker, [root], { cwd: makeScratch(), encoding: "utf8", timeout: 30_000 });

describe("credit checker names", () => {
  it("accepts the baseline tree (breaks if the helpers in this file build an invalid tree)", () => {
    const result = run(makeTree());
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects a path with a newline whose fragments match credited files (breaks if line-based inventories trust split names)", () => {
    const root = makeTree(false);
    // The path is effect-acp/src/client.ts, a newline, then source-control/src/helper.ts.
    write(root, "third_party/t3code/effect-acp/src/client.ts\nsource-control/src/helper.ts", "export const x = 1;\n");
    const result = run(root);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("control character");
  });

  it("rejects a path with a tab (breaks if tabs can alter the tab-separated table rows)", () => {
    const root = makeTree();
    write(root, "third_party/t3code/effect-acp/src/a\tb.ts", "export const x = 1;\n");
    const result = run(root);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("control character");
  });

  it("rejects an uncredited symbolic link under a package (breaks if find -type f hides links from the inventory)", () => {
    const root = makeTree();
    symlinkSync("client.ts", join(root, "third_party/t3code/effect-acp/src/alias.ts"));
    const result = run(root);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("effect-acp/src/alias.ts");
    expect(result.stderr).toContain("symbolic link");
  });

  it("rejects a package folder whose name only matches a credited name as a pattern, such as effect-acp.* (breaks if NOTICE names are matched as regular expressions)", () => {
    const root = makeTree();
    write(root, "third_party/t3code/effect-acp.*/package.json", "{}\n");
    write(root, "third_party/t3code/effect-acp.*/LICENSE", "Licence.\n");
    const result = run(root);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("third_party/t3code/effect-acp.*");
  });

  it("accepts a package named in NOTICE followed by a full stop (breaks if sentence punctuation counts as part of the name)", () => {
    const root = makeTree();
    write(root, "NOTICE", "Copies: third_party/t3code/effect-acp, third_party/t3code/source-control.\n");
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
  });
});
