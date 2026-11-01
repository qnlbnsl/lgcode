// Unit 1, criterion 1.5 (task 1g, decisions row 22): `bin/shepherd` finds
// Node.js 26 without `node` on the path.
//
// Row 22 says the launcher uses `$SHEPHERD_NODE` if set, else the newest
// `$NVM_DIR/versions/node/v26.*/bin/node`, else `node` on `PATH` if it is
// version 26, else fails with an install hint. It then runs the absolute path of
// `packages/cli/src/bin.ts`, or `bin/stub-entry.ts` while that file is absent
// (decisions row 59), which prints `not built yet` and exits 0.
//
// Wording assumed for the install hint: stderr contains `nvm install`
// (the plan's owner action is `nvm install 26`).
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const repoRoot = realpathSync(fileURLToPath(new URL("../../../../", import.meta.url)));
const launcher = join(repoRoot, "bin", "shepherd");
const stubEntry = join(repoRoot, "bin", "stub-entry.ts");
const cliEntryInRepo = join(repoRoot, "packages", "cli", "src", "bin.ts");

const scratch: Array<string> = [];
afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

const makeScratch = (prefix: string): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(directory);
  return directory;
};

const home = process.env["HOME"];
if (home === undefined || home === "") throw new Error("HOME must be set to run the launcher tests");

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: Error | undefined;
}

// `env` is the whole environment: the launcher must not rely on anything else.
const run = (
  executable: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>,
  cwd: string = makeScratch("shepherd-cwd-"),
): Run => {
  const result = spawnSync(executable, args, { env, cwd, encoding: "utf8", timeout: 30_000 });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
};

// A fake `node` that answers version queries with `version` and otherwise prints
// the tag and each argument on its own line, so a test sees which Node.js the
// launcher chose and what it asked it to run.
const fakeNode = (version: string): string => {
  const major = version.split(".")[0] ?? "0";
  return `#!/bin/sh
case "$1" in
  --version|-v) echo "v${version}"; exit 0 ;;
  -p|-e|--print|--eval)
    case "$2" in
      *major*|*split*|*parseInt*|*Number*) echo "${major}" ;;
      *versions.node*) echo "${version}" ;;
      *) echo "v${version}" ;;
    esac
    exit 0 ;;
esac
echo "NODE:${version}"
for argument in "$@"; do echo "ARG:$argument"; done
`;
};

const writeExecutable = (path: string, content: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

const installFakeNvmNode = (nvmDirectory: string, version: string): string => {
  const path = join(nvmDirectory, "versions", "node", `v${version}`, "bin", "node");
  writeExecutable(path, fakeNode(version));
  return path;
};

// A copy of the launcher and the stub entry in a fresh folder, so a test can
// decide whether `packages/cli/src/bin.ts` exists without touching the repository.
const makeTree = (options: { readonly withCliEntry: boolean }): string => {
  const root = makeScratch("shepherd-tree-");
  writeExecutable(join(root, "bin", "shepherd"), readFileSync(launcher, "utf8"));
  copyFileSync(stubEntry, join(root, "bin", "stub-entry.ts"));
  if (options.withCliEntry) {
    mkdirSync(join(root, "packages", "cli", "src"), { recursive: true });
    writeFileSync(join(root, "packages", "cli", "src", "bin.ts"), "// placeholder\n");
  }
  return root;
};

const argLines = (stdout: string): ReadonlyArray<string> =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("ARG:"))
    .map((line) => line.slice("ARG:".length));

const emptyNvmDirectory = (): string => makeScratch("shepherd-empty-nvm-");

describe("bin/shepherd launcher file", () => {
  it("is an executable POSIX shell script (breaks if the file is missing, not executable, or needs bash)", () => {
    expect(existsSync(launcher)).toBe(true);
    expect(statSync(launcher).mode & 0o111).not.toBe(0);
    expect(readFileSync(launcher, "utf8").split("\n")[0]).toBe("#!/bin/sh");
  });

  it("ships the stub entry that the launcher runs while the command-line tool is absent (breaks if bin/stub-entry.ts is missing)", () => {
    expect(existsSync(stubEntry)).toBe(true);
  });
});

describe("bin/shepherd with the environment reduced to HOME and NVM_DIR", () => {
  // Criterion 1.5, first half. This needs the host's nvm to hold a Node.js 26
  // (the plan's owner action `nvm install 26`). Once unit 7 adds
  // packages/cli/src/bin.ts the launcher stops running the stub, so the
  // assertion moves to the copied-tree test below.
  it.skipIf(existsSync(cliEntryInRepo))(
    "runs the stub entry, prints `not built yet` and exits 0 with no node on the path (breaks if the launcher needs PATH or ignores nvm)",
    () => {
      const nvmDir = join(home, ".nvm");
      const versionsDir = join(nvmDir, "versions", "node");
      const installed = existsSync(versionsDir) ? readdirSync(versionsDir) : [];
      expect(
        installed.some((name) => name.startsWith("v26.")),
        `host precondition: ${versionsDir} must hold a v26.* Node.js (run \`nvm install 26\`)`,
      ).toBe(true);

      const result = run(launcher, ["serve", "--detach"], { HOME: home, NVM_DIR: nvmDir });

      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain("not built yet");
      expect(result.status).toBe(0);
    },
  );

  // Criterion 1.5, second half.
  it("exits 1 with an install hint when NVM_DIR holds no Node.js (breaks if the launcher continues without Node.js or prints no hint)", () => {
    const result = run(launcher, ["serve", "--detach"], {
      HOME: home,
      NVM_DIR: emptyNvmDirectory(),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/nvm install/);
    expect(result.stdout).not.toContain("not built yet");
  });

  it("runs the real stub entry from a copied tree under a Node.js 26 found in NVM_DIR (breaks if the stub does not print `not built yet` and exit 0)", () => {
    const tree = makeTree({ withCliEntry: false });
    const nvmDir = makeScratch("shepherd-nvm-");
    // A real Node.js 26 is needed here: link the host's, so the stub runs for real.
    const hostVersions = join(home, ".nvm", "versions", "node");
    const hostNode26 = (existsSync(hostVersions) ? readdirSync(hostVersions) : []).find((name) =>
      name.startsWith("v26."),
    );
    expect(
      hostNode26,
      `host precondition: ${hostVersions} must hold a v26.* Node.js (run \`nvm install 26\`)`,
    ).toBeDefined();
    mkdirSync(join(nvmDir, "versions", "node"), { recursive: true });
    writeExecutable(
      join(nvmDir, "versions", "node", String(hostNode26), "bin", "node"),
      `#!/bin/sh\nexec "${join(hostVersions, String(hostNode26), "bin", "node")}" "$@"\n`,
    );

    const result = run(join(tree, "bin", "shepherd"), ["serve", "--detach"], {
      HOME: home,
      NVM_DIR: nvmDir,
    });

    expect(result.stdout).toContain("not built yet");
    expect(result.status).toBe(0);
  });
});

describe("bin/shepherd Node.js choice (decisions row 22)", () => {
  it("picks the newest v26.* under NVM_DIR by version number, ignoring v25 and v27 (breaks if it sorts as text, takes the first match, or accepts another major)", () => {
    const tree = makeTree({ withCliEntry: false });
    const nvmDir = makeScratch("shepherd-nvm-");
    for (const version of ["25.9.0", "26.2.0", "26.9.0", "26.13.0", "27.0.0"]) {
      installFakeNvmNode(nvmDir, version);
    }

    const result = run(join(tree, "bin", "shepherd"), ["serve", "--detach"], {
      HOME: home,
      NVM_DIR: nvmDir,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NODE:26.13.0");
  });

  it("runs the absolute path of bin/stub-entry.ts with the user's arguments while packages/cli/src/bin.ts is absent (breaks if the arguments or the stub path are wrong or relative)", () => {
    const tree = makeTree({ withCliEntry: false });
    const nvmDir = makeScratch("shepherd-nvm-");
    installFakeNvmNode(nvmDir, "26.13.0");

    const result = run(join(tree, "bin", "shepherd"), ["serve", "--detach"], {
      HOME: home,
      NVM_DIR: nvmDir,
    });

    expect(result.status).toBe(0);
    const lines = argLines(result.stdout);
    const entryIndex = lines.indexOf(join(tree, "bin", "stub-entry.ts"));
    expect(entryIndex).toBeGreaterThanOrEqual(0);
    expect(lines.slice(entryIndex + 1)).toEqual(["serve", "--detach"]);
  });

  it("runs the absolute path of packages/cli/src/bin.ts once that file exists (breaks if the launcher keeps running the stub)", () => {
    const tree = makeTree({ withCliEntry: true });
    const nvmDir = makeScratch("shepherd-nvm-");
    installFakeNvmNode(nvmDir, "26.13.0");

    const result = run(join(tree, "bin", "shepherd"), ["serve", "--detach"], {
      HOME: home,
      NVM_DIR: nvmDir,
    });

    expect(result.status).toBe(0);
    const lines = argLines(result.stdout);
    const entryIndex = lines.indexOf(join(tree, "packages", "cli", "src", "bin.ts"));
    expect(entryIndex).toBeGreaterThanOrEqual(0);
    expect(lines.slice(entryIndex + 1)).toEqual(["serve", "--detach"]);
    expect(lines).not.toContain(join(tree, "bin", "stub-entry.ts"));
  });

  it("works from any working directory, because Herdr starts it from its own (breaks if the launcher finds its files relative to the current folder)", () => {
    const tree = makeTree({ withCliEntry: false });
    const nvmDir = makeScratch("shepherd-nvm-");
    installFakeNvmNode(nvmDir, "26.13.0");
    const elsewhere = makeScratch("shepherd-elsewhere-");

    const result = run(
      join(tree, "bin", "shepherd"),
      ["serve", "--detach"],
      { HOME: home, NVM_DIR: nvmDir },
      elsewhere,
    );

    expect(result.status).toBe(0);
    expect(argLines(result.stdout)).toContain(join(tree, "bin", "stub-entry.ts"));
  });

  it("prefers $SHEPHERD_NODE over NVM_DIR (breaks if the override is ignored or checked after nvm)", () => {
    const tree = makeTree({ withCliEntry: false });
    const nvmDir = makeScratch("shepherd-nvm-");
    installFakeNvmNode(nvmDir, "26.13.0");
    const overrideDir = makeScratch("shepherd-override-");
    const override = join(overrideDir, "node");
    writeExecutable(override, fakeNode("26.99.0"));

    const result = run(join(tree, "bin", "shepherd"), ["serve", "--detach"], {
      HOME: home,
      NVM_DIR: nvmDir,
      SHEPHERD_NODE: override,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NODE:26.99.0");
    expect(result.stdout).not.toContain("NODE:26.13.0");
  });

  it("falls back to a version 26 `node` on PATH when NVM_DIR holds none (breaks if the PATH fallback is missing)", () => {
    const tree = makeTree({ withCliEntry: false });
    const binDirectory = makeScratch("shepherd-path-");
    writeExecutable(join(binDirectory, "node"), fakeNode("26.1.0"));

    const result = run(join(tree, "bin", "shepherd"), ["serve", "--detach"], {
      HOME: home,
      NVM_DIR: emptyNvmDirectory(),
      PATH: `${binDirectory}:/usr/bin:/bin`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NODE:26.1.0");
  });

  it("refuses a `node` on PATH that is not version 26 and prints the install hint (breaks if any node on PATH is accepted)", () => {
    const tree = makeTree({ withCliEntry: false });
    const binDirectory = makeScratch("shepherd-path-");
    writeExecutable(join(binDirectory, "node"), fakeNode("25.1.0"));

    const result = run(join(tree, "bin", "shepherd"), ["serve", "--detach"], {
      HOME: home,
      NVM_DIR: emptyNvmDirectory(),
      PATH: `${binDirectory}:/usr/bin:/bin`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/nvm install/);
    expect(result.stdout).not.toContain("NODE:25.1.0");
  });
});
