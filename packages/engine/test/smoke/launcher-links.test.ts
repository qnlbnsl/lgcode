// Unit 2 regression tests for docs/issues.md issues 7 and 8.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const scratch: string[] = [];
const makeScratch = (prefix: string): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(root);
  return root;
};
afterAll(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true });
});

const makeTree = () => {
  const root = makeScratch("lgcode launcher tree-");
  mkdirSync(join(root, "bin"));
  copyFileSync(join(repoRoot, "bin/lgcode"), join(root, "bin/lgcode"));
  chmodSync(join(root, "bin/lgcode"), 0o755);
  copyFileSync(join(repoRoot, "bin/stub-entry.ts"), join(root, "bin/stub-entry.ts"));
  const home = makeScratch("lgcode-link-home-");
  const nvm = join(home, "fake-nvm");
  const nodeDirectory = join(nvm, "versions/node/v26.13.0/bin");
  mkdirSync(nodeDirectory, { recursive: true });
  // Use a real runtime, so success means the repository's stub actually ran.
  expect(process.versions.node.split(".")[0], "run smoke tests with Node.js 26").toBe("26");
  symlinkSync(process.execPath, join(nodeDirectory, "node"));
  return { root, home, nvm, launcher: join(root, "bin/lgcode") };
};
const run = (launcher: string, home: string, nvm: string, path?: string) => spawnSync("/usr/bin/env", [
  "-i", `HOME=${home}`, `NVM_DIR=${nvm}`, ...(path === undefined ? [] : [`PATH=${path}`]),
  launcher, "serve", "--detach",
], { cwd: home, env: {}, encoding: "utf8", timeout: 30_000 });
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

describe("launcher path resolution", () => {
  it("runs the real stub through a launcher symlink from another folder (breaks if checkout resolution uses the link's directory)", () => {
    const tree = makeTree();
    const links = makeScratch("lgcode launcher links-");
    const link = join(links, "lgcode");
    symlinkSync(tree.launcher, link);
    const result = run(link, tree.home, tree.nvm);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("not built yet");
  });

  it("never executes dirname from PATH (breaks if a hostile dirname runs before the selected Node.js)", () => {
    const tree = makeTree();
    const path = makeScratch("lgcode-hostile-path-");
    const marker = join(path, "dirname-ran");
    const fakeDirname = join(path, "dirname");
    writeFileSync(fakeDirname, `#!/bin/sh\nprintf 'executed\\n' > ${shellQuote(marker)}\nexec /usr/bin/dirname "$@"\n`);
    chmodSync(fakeDirname, 0o755);
    const result = run(tree.launcher, tree.home, tree.nvm, path);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("not built yet");
    expect(existsSync(marker), "the launcher executed the hostile PATH dirname").toBe(false);
  });
});
