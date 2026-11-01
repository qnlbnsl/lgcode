// Unit 2, tasks 2a-2e and criterion 1.7 re-run (decision 71).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const packages = [
  ["effect-acp", "@shepherd/t3-effect-acp"],
  ["node-sqlite", "@shepherd/t3-node-sqlite"],
  ["provider-instance", "@shepherd/t3-provider-instance"],
  ["provider-testing", "@shepherd/t3-provider-testing"],
  ["source-control", "@shepherd/t3-source-control"],
] as const;
interface Manifest {
  name?: string;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
const packageRoot = (directory: string): string => join(repoRoot, "third_party/t3code", directory);
const manifest = (directory: string): Manifest => {
  const path = join(packageRoot(directory), "package.json");
  expect(existsSync(path), `${path} must exist before checking its package contract`).toBe(true);
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
};
const dependencyNames = (value: Manifest): string[] => Object.keys({
  ...value.dependencies, ...value.devDependencies, ...value.peerDependencies, ...value.optionalDependencies,
});
const firstPartyNames = [
  "@shepherd/contracts", "@shepherd/client", "@shepherd/engine",
  "@shepherd/cli", "@shepherd/mcp", "@shepherd/testing",
];

// The root catalog uses a block mapping, as in the frozen workspace tests.
// Stop at the next top-level key so overrides cannot masquerade as catalog pins.
const catalogNames = (): string[] => {
  const text = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const block = /^catalog:\s*\n((?:[ \t]+[^\n]*\n|\s*\n|#[^\n]*\n)*)/m.exec(text)?.[1];
  expect(block, "pnpm-workspace.yaml must declare the root catalog").toBeDefined();
  return (block ?? "").split("\n").flatMap((line) => {
    const key = /^\s+(?:'([^']+)'|"([^"]+)"|([^\s:'"]+))\s*:/.exec(line);
    const name = key?.[1] ?? key?.[2] ?? key?.[3];
    return name === undefined ? [] : [name];
  });
};

describe("copied package workspace contracts", () => {
  it.each(packages)("registers %s as %s and an ES module (breaks if the copy is missing or workspace imports resolve the wrong package)", (directory, name) => {
    const value = manifest(directory);
    expect(value.name).toBe(name);
    expect(value.type).toBe("module");
  });

  it.each(packages)("makes %s inherit Shepherd's root compiler settings (breaks if a copied tsconfig still points at T3's workspace)", (directory) => {
    const root = packageRoot(directory);
    const path = join(root, "tsconfig.json");
    expect(existsSync(path), `${path} must exist`).toBe(true);
    const config = JSON.parse(readFileSync(path, "utf8")) as { extends?: string };
    expect(config.extends).toBeTypeOf("string");
    expect(resolve(root, config.extends ?? "")).toBe(join(repoRoot, "tsconfig.base.json"));
  });

  it.each(packages)("keeps %s independent of all six first-party packages (breaks if a copied package introduces a reverse dependency or cycle)", (directory) => {
    const names = dependencyNames(manifest(directory));
    expect(names.filter((name) => firstPartyNames.includes(name))).toEqual([]);
  });

  it.each(packages)("pins every external dependency of %s in the root catalog (breaks if a new copied dependency bypasses the shared version inventory)", (directory) => {
    const names = dependencyNames(manifest(directory));
    const copiedNames: string[] = packages.map(([, name]) => name);
    const catalog = catalogNames();
    for (const name of names.filter((name) => !copiedNames.includes(name))) {
      expect(catalog, `${directory}: ${name} must be in the root catalog`).toContain(name);
    }
  });

  it("retires the top-level mergeMessage.ts after moving it into source-control (breaks if the old un-packaged copy remains)", () => {
    expect(existsSync(join(repoRoot, "third_party/t3code/mergeMessage.ts"))).toBe(false);
  });

  it.each([
    "node-sqlite/test/nodeSqliteClient.test.ts",
    "provider-instance/test/CodexHomeLayout.test.ts",
    "provider-testing/test/replayTranscript.test.ts",
  ])("retains the upstream test at %s (breaks if a required copied test is omitted or misplaced)", (path) => {
    expect(existsSync(join(repoRoot, "third_party/t3code", path)), path).toBe(true);
  });
});
