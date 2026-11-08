// Unit 2 fix round 1: the first-party packages must declare and resolve the
// copied T3 Code packages they use (decision rows 23 and 71), and the copies
// must not depend on the first-party packages.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const readJson = (path: string): { dependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(repoRoot, path), "utf8"));

const edges: ReadonlyArray<readonly [string, string, string]> = [
  ["engine", "@lgcode/t3-effect-acp", "@lgcode/t3-effect-acp/client"],
  ["engine", "@lgcode/t3-node-sqlite", "@lgcode/t3-node-sqlite/nodeSqliteClient"],
  ["engine", "@lgcode/t3-provider-instance", "@lgcode/t3-provider-instance/providerInstance"],
  ["testing", "@lgcode/t3-effect-acp", "@lgcode/t3-effect-acp/agent"],
  ["testing", "@lgcode/t3-provider-testing", "@lgcode/t3-provider-testing/replayTranscript"],
];

describe("copied package edges", () => {
  it.each(edges)("%s declares %s as a workspace dependency (breaks if a first-party package imports a copy it does not declare)", (consumer, name) => {
    expect(readJson(`packages/${consumer}/package.json`).dependencies?.[name]).toBe("workspace:*");
  });

  it.each(edges)("%s resolves %s after a frozen install (breaks if the lockfile or links omit the edge)", (consumer, _name, specifier) => {
    // An evaluated ES module resolves relative to the working folder.
    const result = spawnSync(process.execPath, [
      "--input-type=module", "-e", `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`,
    ], { cwd: join(repoRoot, "packages", consumer), encoding: "utf8", timeout: 30_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("/third_party/t3code/");
  });

  it("adds no first-party edge to the source-control copy (it has no planned consumer)", () => {
    for (const consumer of readdirSync(join(repoRoot, "packages"))) {
      const dependencies = readJson(`packages/${consumer}/package.json`).dependencies ?? {};
      expect(Object.keys(dependencies), consumer).not.toContain("@lgcode/t3-source-control");
    }
  });

  it("keeps the copies free of edges to the six first-party packages (breaks if a copy imports LGcode code)", () => {
    const base = join(repoRoot, "third_party/t3code");
    for (const directory of readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "node_modules")) {
      const manifest = JSON.parse(readFileSync(join(base, directory.name, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
      for (const name of names) {
        expect(name, `${directory.name} depends on ${name}`).not.toMatch(/^@lgcode\/(client|cli|contracts|engine|mcp|testing)$/);
      }
    }
  });
});
