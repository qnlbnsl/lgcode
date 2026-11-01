// Unit 2 fix round 1: a linked launcher must resolve its path with the chosen
// Node.js, so no command found through PATH runs before it (decision row 22).
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
  const root = makeScratch("shepherd-readlink-tree-");
  mkdirSync(join(root, "bin"));
  copyFileSync(join(repoRoot, "bin/shepherd"), join(root, "bin/shepherd"));
  chmodSync(join(root, "bin/shepherd"), 0o755);
  copyFileSync(join(repoRoot, "bin/stub-entry.ts"), join(root, "bin/stub-entry.ts"));
  const home = makeScratch("shepherd-readlink-home-");
  const nvm = join(home, "fake-nvm");
  const nodeDirectory = join(nvm, "versions/node/v26.13.0/bin");
  mkdirSync(nodeDirectory, { recursive: true });
  expect(process.versions.node.split(".")[0], "run smoke tests with Node.js 26").toBe("26");
  symlinkSync(process.execPath, join(nodeDirectory, "node"));
  return { root, home, nvm, launcher: join(root, "bin/shepherd") };
};
const run = (launcher: string, home: string, nvm: string, path: string) => spawnSync("/usr/bin/env", [
  "-i", `HOME=${home}`, `NVM_DIR=${nvm}`, `PATH=${path}`, launcher, "serve", "--detach",
], { cwd: home, env: {}, encoding: "utf8", timeout: 30_000 });

describe("linked launcher and PATH", () => {
  it("runs through a link when PATH holds only the link folder (breaks if readlink is looked up on PATH)", () => {
    const tree = makeTree();
    const links = makeScratch("shepherd-readlink-links-");
    symlinkSync(tree.launcher, join(links, "shepherd"));
    const result = run(join(links, "shepherd"), tree.home, tree.nvm, links);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("not built yet");
  });

  it("never executes readlink from PATH (breaks if a substituted readlink runs before the selected Node.js)", () => {
    const tree = makeTree();
    const links = makeScratch("shepherd-readlink-links-");
    symlinkSync(tree.launcher, join(links, "shepherd"));
    const hostile = makeScratch("shepherd-hostile-readlink-");
    const marker = join(hostile, "readlink-ran");
    writeFileSync(join(hostile, "readlink"), `#!/bin/sh\nprintf 'executed\\n' > '${marker}'\nexec /usr/bin/readlink "$@"\n`);
    chmodSync(join(hostile, "readlink"), 0o755);
    const result = run(join(links, "shepherd"), tree.home, tree.nvm, hostile);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(marker), "the launcher executed the hostile PATH readlink").toBe(false);
  });

  it("follows a chain of links (breaks if only one link level is resolved)", () => {
    const tree = makeTree();
    const links = makeScratch("shepherd-readlink-links-");
    symlinkSync(tree.launcher, join(links, "inner"));
    symlinkSync(join(links, "inner"), join(links, "shepherd"));
    const result = run(join(links, "shepherd"), tree.home, tree.nvm, links);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("not built yet");
  });
});
