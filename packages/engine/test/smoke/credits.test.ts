// Unit 2, criteria 2.5 and 2.7. The builder implements this interface:
// scripts/check-credits.sh [root], defaulting to the script's repository.
// Stale README rows fail: otherwise a renamed file can leave misleading credit.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const checker = join(repoRoot, "scripts/check-credits.sh");
const scratch: string[] = [];
const makeScratch = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lgcode-credits-")));
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
const creditedFile = "effect-acp/src/client.ts";
const copyright = "Copyright (c) 2026 T3 Tools Inc.";
const clientRow = `| effect-acp | \`${creditedFile}\` | \`packages/effect-acp/src/client.ts\` | \`${copyright}\` | Imports changed. |`;
const reviewRow = `| \`${creditedFile}\` | read, no findings |`;
const readme = (rows: string[]): string => [
  "# T3 Code copies",
  "| Package | File here | File in T3 Code | Copyright line | Changes |",
  "| --- | --- | --- | --- | --- |",
  ...rows,
  "",
].join("\n");
const review = (rows: string[]): string => [
  "# Security review",
  "| File | Result |",
  "| --- | --- |",
  ...rows,
  "",
].join("\n");
const helperRow = "| source-control | `source-control/src/helper.ts` | `packages/shared/src/helper.ts` | none in original | None. |";
const helperReview = "| `source-control/src/helper.ts` | read, no findings |";

const makeTree = (): string => {
  const root = makeScratch();
  write(root, `third_party/t3code/${creditedFile}`, `// ${copyright}\nexport const client = 1;\n`);
  write(root, "third_party/t3code/source-control/src/helper.ts", "export const helper = 2;\n");
  write(root, "third_party/t3code/README.md", readme([clientRow, helperRow]));
  write(root, "third_party/t3code/SECURITY-REVIEW.md", review([reviewRow, helperReview]));
  write(root, "NOTICE", "T3 Code (MIT): third_party/t3code/effect-acp and third_party/t3code/source-control.\n");
  // Neither package metadata nor vendored dependency files need table rows.
  for (const directory of ["", "effect-acp/", "source-control/"]) {
    for (const filename of ["README.md", "LICENSE", "SECURITY-REVIEW.md", "package.json", "tsconfig.json"]) {
      if (directory === "" && ["README.md", "SECURITY-REVIEW.md"].includes(filename)) continue;
      write(root, `third_party/t3code/${directory}${filename}`, filename.endsWith(".json") ? "{}\n" : "Metadata.\n");
    }
  }
  write(root, "third_party/t3code/effect-acp/node_modules/dependency/index.js", "// Not copied code.\n");
  write(root, "third_party/t3code/node_modules/dependency/index.js", "// Not copied code.\n");
  return root;
};

const run = (root?: string) => spawnSync(checker, root === undefined ? [] : [root], {
  cwd: makeScratch(), encoding: "utf8", timeout: 30_000,
});
const expectRejected = (root: string, path: string): void => {
  const result = run(root);
  expect(result.error).toBeUndefined();
  expect(result.status).toBeTypeOf("number");
  expect(result.status, result.stderr).not.toBe(0);
  expect(result.stderr).toContain(path);
};

describe("copied-code credit checker", () => {
  it("accepts a fully credited and reviewed tree (breaks if root arguments, metadata exclusions, node_modules exclusions, or none-in-original rows stop working)", () => {
    const result = run(makeTree());
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects a copied file omitted from the README table (breaks if new copies can bypass attribution)", () => {
    const root = makeTree();
    write(root, "third_party/t3code/README.md", readme([helperRow]));
    expectRejected(root, creditedFile);
  });

  it("rejects a file whose credited copyright text was removed (breaks if a table row alone can satisfy copyright preservation)", () => {
    const root = makeTree();
    write(root, `third_party/t3code/${creditedFile}`, "export const client = 1;\n");
    expectRejected(root, creditedFile);
  });

  it("rejects a copied file omitted from the security review table (breaks if unreviewed copies pass the check)", () => {
    const root = makeTree();
    write(root, "third_party/t3code/SECURITY-REVIEW.md", review([helperReview]));
    expectRejected(root, creditedFile);
  });

  it("rejects a package omitted from NOTICE (breaks if one package's notice can stand in for every copy)", () => {
    const root = makeTree();
    write(root, "NOTICE", "T3 Code (MIT): third_party/t3code/source-control.\n");
    expectRejected(root, "third_party/t3code/effect-acp");
  });

  it("rejects a README row naming a nonexistent file (breaks if stale credits survive moves or deletions)", () => {
    const root = makeTree();
    write(root, "third_party/t3code/README.md", readme([
      clientRow, helperRow,
      "| effect-acp | `effect-acp/src/deleted.ts` | `packages/effect-acp/src/deleted.ts` | none in original | None. |",
    ]));
    expectRejected(root, "effect-acp/src/deleted.ts");
  });

  it("checks the real repository from an unrelated working directory (breaks if default root follows cwd or committed credits are incomplete)", () => {
    const result = run();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
