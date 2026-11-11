// Unit 1, criteria 1.6 and 1.7 and tasks 1a, 1d and 1f of
// `.plans/plans/shepherd-engine/plan.md`: the committed workspace files declare
// everything later units need, so no later unit edits the root manifest or the
// lockfile (decisions rows 59 and 71).
//
// There is no TOML or YAML parser among the declared dependencies, so
// `pnpm-workspace.yaml` and `herdr-plugin.toml` are read as text with small,
// precise patterns. JSON files are parsed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const readText = (relative: string): string => readFileSync(join(repoRoot, relative), "utf8");

interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly type?: string;
  readonly packageManager?: string;
  readonly engines?: Record<string, string>;
  readonly scripts?: Record<string, string>;
  readonly exports?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const readPackage = (relative: string): PackageJson =>
  JSON.parse(readText(relative)) as PackageJson;

const PACKAGES = ["contracts", "client", "engine", "cli", "mcp", "testing"] as const;
type PackageDirectory = (typeof PACKAGES)[number];

const packageName = (directory: PackageDirectory): string => {
  const name = readPackage(`packages/${directory}/package.json`).name;
  if (name === undefined || name === "") throw new Error(`packages/${directory}/package.json has no name`);
  return name;
};

// --- pnpm-workspace.yaml -----------------------------------------------------

// The lines that belong to a top-level key: the rest of its own line, then every
// following line up to the next top-level key. Comments and blank lines are kept
// out. A list may sit at the key's own indent (`key:\n- item`), as YAML allows.
const topLevelBlock = (text: string, key: string): { inline: string; lines: Array<string> } | undefined => {
  const all = text.split("\n");
  const start = all.findIndex((line) => new RegExp(`^["']?${key}["']?\\s*:`).test(line));
  if (start < 0) return undefined;
  const inline = (all[start] ?? "").replace(new RegExp(`^["']?${key}["']?\\s*:`), "").trim();
  const lines: Array<string> = [];
  for (const line of all.slice(start + 1)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line) && !line.startsWith("- ")) break;
    lines.push(line);
  }
  return { inline, lines };
};

const listItems = (block: { lines: Array<string> }): ReadonlyArray<string> =>
  block.lines.flatMap((line) => {
    const match = /^\s*-\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });

const catalogEntries = (text: string): Record<string, string> => {
  const block = topLevelBlock(text, "catalog");
  if (block === undefined) return {};
  const entries: Record<string, string> = {};
  for (const line of block.lines) {
    const match = /^\s+["']?([^"':\s]+(?:\/[^"':\s]+)?)["']?\s*:\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) entries[match[1]] = match[2];
  }
  return entries;
};

describe("root package.json (task 1a)", () => {
  const root = readPackage("package.json");

  it("is a private ES module package (breaks if the root could be published or is CommonJS)", () => {
    expect(root.private).toBe(true);
    expect(root.type).toBe("module");
  });

  it("requires Node.js >=26.13 <27 and names pnpm as the package manager (breaks if engines or packageManager is missing or looser)", () => {
    expect(root.engines?.["node"]).toBe(">=26.13 <27");
    expect(root.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+/);
  });

  it("defines typecheck, test, check, record-fixtures and live-check with the commands task 1a names (breaks if a script is missing or runs another command)", () => {
    const scripts = root.scripts ?? {};
    expect(scripts["typecheck"]).toMatch(/pnpm -r typecheck/);
    expect(scripts["test"]).toMatch(/vitest run/);
    expect(scripts["record-fixtures"]).toBe("node packages/engine/scripts/record-fixtures.ts");
    expect(scripts["live-check"]).toBe("node packages/engine/scripts/live-check.ts");
  });

  it("makes `check` run the type check, then Vitest, then the credit script (breaks if one is dropped or the order changes, since a failing type check should stop first)", () => {
    const check = root.scripts?.["check"] ?? "";
    const typecheck = check.indexOf("pnpm -r typecheck");
    const vitest = check.indexOf("vitest run");
    const credits = check.indexOf("scripts/check-credits.sh");
    expect(typecheck).toBeGreaterThanOrEqual(0);
    expect(vitest).toBeGreaterThan(typecheck);
    expect(credits).toBeGreaterThan(vitest);
  });
});

describe("pnpm-workspace.yaml (tasks 1a, criterion 1.6)", () => {
  const text = readText("pnpm-workspace.yaml");

  it("lists packages/* and third_party/t3code/* as workspace packages (breaks if the copied T3 packages of unit 2 would not be linked)", () => {
    const block = topLevelBlock(text, "packages");
    expect(block).toBeDefined();
    const items = listItems(block ?? { lines: [] });
    expect(items).toContain("packages/*");
    expect(items).toContain("third_party/t3code/*");
  });

  it("pins effect, @effect/platform-node, @effect/vitest and @effect/openapi-generator at 4.0.5 in the catalog (breaks if any Effect package floats or differs)", () => {
    const catalog = catalogEntries(text);
    expect(catalog["effect"]).toBe("4.0.5");
    expect(catalog["@effect/platform-node"]).toBe("4.0.5");
    expect(catalog["@effect/vitest"]).toBe("4.0.5");
    expect(catalog["@effect/openapi-generator"]).toBe("4.0.5");
  });

  it("pins vitest at 5.x, @types/node for Node.js 26, and ws with its types in the catalog (breaks if Vitest is not the 5.x line @effect/vitest 4.0.5 accepts, or a tool is missing)", () => {
    const catalog = catalogEntries(text);
    expect(catalog["vitest"]).toMatch(/^[\^~]?5\./);
    expect(catalog["@types/node"]).toMatch(/^[\^~]?26\./);
    expect(catalog["ws"]).toMatch(/^[\^~]?\d+\./);
    expect(catalog["@types/ws"]).toMatch(/^[\^~]?\d+\./);
  });

  it("allows exactly @tsc-rs/typescript@0.8.0 to run an install script and makes pnpm fail on any other (criterion 1.6, decisions rows 39 and 77; breaks if allowBuilds is missing, lists another package, or strictDepBuilds is not true)", () => {
    const block = topLevelBlock(text, "allowBuilds");
    expect(block, "allowBuilds must be a top-level key").toBeDefined();
    const allowed: Record<string, string> = {};
    for (const line of block?.lines ?? []) {
      const match = /^\s+["']?([^"':\s]+(?:\/[^"':\s]+)?(?:@[^"':\s]+)?)["']?\s*:\s*([^\s#]+)\s*(?:#.*)?$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) allowed[match[1]] = match[2];
    }
    expect(allowed).toEqual({ "@tsc-rs/typescript@0.8.0": "true" });
    expect(topLevelBlock(text, "strictDepBuilds")?.inline).toBe("true");
  });

  it("has no onlyBuiltDependencies key, which pnpm 12 does not enforce (criterion 1.6, decisions row 77; breaks if the dead list comes back and can drift from allowBuilds)", () => {
    expect(topLevelBlock(text, "onlyBuiltDependencies")).toBeUndefined();
  });

  it("does not switch every install script back on (criterion 1.6, row 77; breaks if a catch-all build setting such as dangerouslyAllowAllBuilds defeats allowBuilds)", () => {
    expect(text).not.toMatch(/^dangerouslyAllowAllBuilds\s*:\s*true/m);
  });
});

describe("the six packages (task 1d, decisions rows 23, 59, 71)", () => {
  it.each(PACKAGES)("packages/%s has a package.json, a tsconfig.json and a placeholder src/index.ts (breaks if a package is missing a file task 1d names)", (directory) => {
    expect(existsSync(join(repoRoot, "packages", directory, "package.json"))).toBe(true);
    expect(existsSync(join(repoRoot, "packages", directory, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(repoRoot, "packages", directory, "src", "index.ts"))).toBe(true);
  });

  it.each(PACKAGES)("packages/%s exports ./src/*.ts and runs tsc --noEmit as its typecheck (breaks if a package cannot be imported as source or is skipped by `pnpm -r typecheck`)", (directory) => {
    const manifest = readPackage(`packages/${directory}/package.json`);
    expect(manifest.name).toBeTruthy();
    expect(manifest.type).toBe("module");
    expect(JSON.stringify(manifest.exports)).toContain('"./src/*.ts"');
    expect(manifest.scripts?.["typecheck"]).toMatch(/tsc --noEmit/);
    expect(readText(`packages/${directory}/tsconfig.json`)).toMatch(
      /"extends"\s*:\s*"[^"]*tsconfig\.base\.json"/,
    );
  });

  it("gives the packages different names (breaks if two packages share a name and pnpm links the wrong one)", () => {
    const names = PACKAGES.map(packageName);
    expect(new Set(names).size).toBe(PACKAGES.length);
  });

  it("declares effect from the catalog or at 4.0.5 in contracts, client and engine (breaks if a package floats on another Effect version)", () => {
    for (const directory of ["contracts", "client", "engine"] as const) {
      const version = readPackage(`packages/${directory}/package.json`).dependencies?.["effect"];
      expect(version, `${directory} depends on effect`).toMatch(/^(catalog:(default)?|4\.0\.5)$/);
    }
  });

  it("declares ws in client and testing (decisions rows 54, 59; breaks if the client socket library is missing from either)", () => {
    for (const directory of ["client", "testing"] as const) {
      const dependencies = readPackage(`packages/${directory}/package.json`).dependencies ?? {};
      expect(dependencies["ws"], `${directory} depends on ws`).toBeTruthy();
    }
  });

  it("builds the engine's dependency edges per rows 23, 59 and 71 (breaks if a package imports another that it does not declare)", () => {
    const dependencies = (directory: PackageDirectory) =>
      Object.keys(readPackage(`packages/${directory}/package.json`).dependencies ?? {});
    const devDependencies = (directory: PackageDirectory) =>
      Object.keys(readPackage(`packages/${directory}/package.json`).devDependencies ?? {});

    // contracts <- client <- cli, mcp
    expect(dependencies("client")).toContain(packageName("contracts"));
    expect(dependencies("mcp")).toContain(packageName("client"));
    expect(dependencies("cli")).toContain(packageName("client"));
    // row 59: cli -> engine, cli -> mcp
    expect(dependencies("cli")).toContain(packageName("engine"));
    expect(dependencies("cli")).toContain(packageName("mcp"));
    // row 23: engine depends on contracts
    expect(dependencies("engine")).toContain(packageName("contracts"));
    // row 71: testing depends on contracts and client
    expect(dependencies("testing")).toContain(packageName("contracts"));
    expect(dependencies("testing")).toContain(packageName("client"));
    // row 59: engine has dev dependencies on client and testing (not runtime ones)
    expect(devDependencies("engine")).toContain(packageName("client"));
    expect(devDependencies("engine")).toContain(packageName("testing"));
    expect(dependencies("engine")).not.toContain(packageName("client"));
    expect(dependencies("engine")).not.toContain(packageName("testing"));
    expect(dependencies("engine")).not.toContain(packageName("cli"));
    expect(dependencies("engine")).not.toContain(packageName("mcp"));
  });

  it("has no dependency cycle among the six packages, counting dev dependencies (breaks if testing and engine depend on each other: `tsc -b` rejects it, row 23)", () => {
    const names = new Map(PACKAGES.map((directory) => [packageName(directory), directory] as const));
    const edges = new Map<PackageDirectory, ReadonlyArray<PackageDirectory>>(
      PACKAGES.map((directory) => {
        const manifest = readPackage(`packages/${directory}/package.json`);
        const targets = [
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
        ].flatMap((name) => {
          const target = names.get(name);
          return target === undefined ? [] : [target];
        });
        return [directory, targets] as const;
      }),
    );

    const visiting = new Set<PackageDirectory>();
    const done = new Set<PackageDirectory>();
    const visit = (directory: PackageDirectory, trail: ReadonlyArray<PackageDirectory>): void => {
      if (done.has(directory)) return;
      if (visiting.has(directory)) {
        throw new Error(`dependency cycle: ${[...trail, directory].join(" -> ")}`);
      }
      visiting.add(directory);
      for (const target of edges.get(directory) ?? []) visit(target, [...trail, directory]);
      visiting.delete(directory);
      done.add(directory);
    };
    for (const directory of PACKAGES) visit(directory, []);
  });
});

describe("packages/engine/package.json adapter pins (criterion 1.7, decisions rows 18, 59)", () => {
  const raw = readText("packages/engine/package.json");
  const manifest = readPackage("packages/engine/package.json");

  it("pins @agentclientprotocol/claude-agent-acp to exactly 0.99.1 (breaks if it floats, with ^ or ~ or in the wrong dependency group)", () => {
    // The criterion greps this exact line, so the spelling is part of the check.
    expect(raw).toContain('"@agentclientprotocol/claude-agent-acp": "0.99.1"');
    expect(manifest.dependencies?.["@agentclientprotocol/claude-agent-acp"]).toBe("0.99.1");
  });

  it("pins @agentclientprotocol/codex-acp to exactly 2.6.0 (breaks if it floats, with ^ or ~ or in the wrong dependency group)", () => {
    expect(raw).toContain('"@agentclientprotocol/codex-acp": "2.6.0"');
    expect(manifest.dependencies?.["@agentclientprotocol/codex-acp"]).toBe("2.6.0");
  });
});

describe("herdr-plugin.toml (task 1f, criterion 1.4's input)", () => {
  const text = readText("plugins/herdr/herdr-plugin.toml");

  // Split into the top-level table and each `[[name]]` array-of-tables entry.
  const sections = (() => {
    const result: Array<{ readonly header: string; readonly body: string }> = [
      { header: "", body: "" },
    ];
    for (const line of text.split("\n")) {
      const header = /^\s*\[\[?([A-Za-z0-9_.-]+)\]\]?\s*$/.exec(line);
      if (header?.[1] !== undefined) result.push({ header: header[1], body: "" });
      else {
        const last = result[result.length - 1];
        if (last !== undefined) result[result.length - 1] = { header: last.header, body: `${last.body}${line}\n` };
      }
    }
    return result;
  })();

  const topLevel = sections[0]?.body ?? "";
  const command = /^command\s*=\s*\[\s*"lgcode"\s*,\s*"serve"\s*,\s*"--detach"\s*\]\s*$/m;

  it("identifies the plugin as lgcode 0.0.1 for Herdr 0.8.2 or newer on Linux only (breaks if a top-level field is missing or differs)", () => {
    expect(topLevel).toMatch(/^id\s*=\s*"lgcode"\s*$/m);
    expect(topLevel).toMatch(/^name\s*=\s*"LGcode"\s*$/m);
    expect(topLevel).toMatch(/^version\s*=\s*"0\.0\.1"\s*$/m);
    expect(topLevel).toMatch(/^min_herdr_version\s*=\s*"0\.8\.2"\s*$/m);
    expect(topLevel).toMatch(/^platforms\s*=\s*\[\s*"linux"\s*\]\s*$/m);
  });

  it("starts the engine with `lgcode serve --detach` when Herdr starts (breaks if the [[startup]] entry is missing or runs another command)", () => {
    const startup = sections.filter((section) => section.header === "startup");
    expect(startup).toHaveLength(1);
    expect(startup[0]?.body).toMatch(command);
  });

  it("offers a `serve` action in the global context that runs the same command (breaks if the action is missing, in another context, or runs another command)", () => {
    const serve = sections.filter(
      (section) => section.header === "actions" && /^id\s*=\s*"serve"\s*$/m.test(section.body),
    );
    expect(serve).toHaveLength(1);
    expect(serve[0]?.body).toMatch(/^contexts\s*=\s*\[\s*"global"\s*\]\s*$/m);
    expect(serve[0]?.body).toMatch(command);
  });
});
