import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { it } from "@effect/vitest";
import { AgentId, type Actor } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { canAnswerOption, checkFolder, folderForSpawn } from "../../src/identity/ceiling.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

let root: string;
let parent: string;
let home: string;
let stateFolder: string;
let pluginRoot: string;
const directory = (path: string) => { mkdirSync(path, { recursive: true, mode: 0o700 }); return path; };
beforeEach(() => {
  root = mkdtempSync("/tmp/shephrd-ceiling-fix-1-");
  parent = directory(join(root, "repo"));
  home = directory(join(root, "protected", "home"));
  stateFolder = directory(join(root, "protected", "state"));
  pluginRoot = directory(join(root, "protected", "plugin"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("SHEPHRD_HOME", stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
const agent: Actor = { _tag: "agent", agentId: Schema.decodeUnknownSync(AgentId)("parent") };
const options = (folder: string, parentFolder = parent) => ({ caller: agent, parentFolder, folder, home, stateFolder, pluginRoot });
const answerFor = (settingsPath: string) => canAnswerOption({
  caller: agent, mode: "full", option: { kind: "allow_once", level: "read-only", persistent: false }, settingsPath,
});

it.effect("U5A-F03 symlink before dot-dot: catches lexical normalization bypassing a harness settings ancestor", () => Effect.sync(() => {
  const safe = directory(join(parent, "safe"));
  const settings = directory(join(parent, ".claude"));
  const target = directory(join(settings, "nested"));
  writeFileSync(join(settings, "settings.json"), "{}");
  symlinkSync(target, join(safe, "link"));
  // join() would erase the link/.. before the production code sees it.
  const requested = `${safe}/link/../settings.json`;
  // Node's realpathSync also normalizes link/.. lexically. A real read
  // reaches the kernel and proves which file the harness would modify.
  expect(readFileSync(requested, "utf8")).toBe("{}");
  expect(statSync(requested).ino).toBe(statSync(join(settings, "settings.json")).ino);
  expect(answerFor(requested)).toBe("owner");
}));

it.effect("U5A-F03 cyclic component: catches treating ELOOP beneath a neutral path as an absent settings file", () => Effect.sync(() => {
  const safe = directory(join(parent, "safe"));
  symlinkSync("loop", join(safe, "loop"));
  const requested = join(safe, "loop", "new.json");
  expect(() => realpathSync(requested)).toThrow(expect.objectContaining({ code: "ELOOP" }));
  expect(answerFor(requested)).toBe("owner");
}));

it.effect("U5A-F03 unreadable component: catches treating EACCES as permission to write an unknown path", () => Effect.sync(() => {
  const locked = directory(join(parent, "safe", "locked"));
  const requested = join(locked, "new.json");
  chmodSync(locked, 0o000);
  try {
    expect(() => realpathSync(requested)).toThrow(expect.objectContaining({ code: "EACCES" }));
    expect(answerFor(requested)).toBe("owner");
  } finally { chmodSync(locked, 0o700); }
}));

it.effect("U5A-F03 non-directory component: catches treating ENOTDIR as a harmless missing descendant", () => Effect.sync(() => {
  const file = join(parent, "ordinary-file");
  writeFileSync(file, "safe");
  const requested = join(file, "new.json");
  expect(() => realpathSync(requested)).toThrow(expect.objectContaining({ code: "ENOTDIR" }));
  expect(answerFor(requested)).toBe("owner");
}));

it.effect("U5A-F03 missing final descendant: catches denying an ordinary new file under a readable safe folder", () => Effect.sync(() => {
  const safe = directory(join(parent, "safe"));
  expect(answerFor(join(safe, "new.json"))).toBe("allow");
  expect(answerFor(join(safe, "new-directory", "new.json"))).toBe("allow");
}));

const worktree = () => {
  const common = directory(join(parent, ".git"));
  const child = directory(join(root, "linked-child"));
  const gitdir = directory(join(common, "worktrees", "child"));
  writeFileSync(join(child, ".git"), `gitdir: ${relative(child, gitdir)}\n`);
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  writeFileSync(join(gitdir, "gitdir"), `${join(child, ".git")}\n`);
  return { child, gitdir, backlink: join(gitdir, "gitdir") };
};
const breaks = ["absent", "another-folder", "symlink", "unreadable", "oversized", "directory"] as const;
const breakBacklink = (backlink: string, broken: typeof breaks[number]) => {
  const contents = readFileSync(backlink, "utf8");
  rmSync(backlink);
  switch (broken) {
    case "absent": return;
    case "another-folder": {
      const other = directory(join(root, "other"));
      writeFileSync(join(other, ".git"), "unrelated");
      writeFileSync(backlink, `${join(other, ".git")}\n`);
      return;
    }
    case "symlink": {
      const target = join(root, "otherwise-correct-backlink");
      writeFileSync(target, contents);
      symlinkSync(target, backlink);
      return;
    }
    case "unreadable": writeFileSync(backlink, contents, { mode: 0o000 }); return;
    case "oversized": writeFileSync(backlink, contents + "x".repeat(4097)); return;
    case "directory": directory(backlink); return;
  }
};

it.effect.each(breaks)(
  "U5A-F04 B4 grant/%s: catches accepting a worktree without a readable regular bounded reciprocal gitdir file",
  (broken) => Effect.gen(function* () {
    const { child, backlink } = worktree();
    breakBacklink(backlink, broken);
    try {
      if (broken === "unreadable") expect(() => readFileSync(backlink)).toThrow(expect.objectContaining({ code: "EACCES" }));
      expect(Result.isFailure(yield* checkFolder(options(child)).pipe(Effect.result))).toBe(true);
    } finally { if (broken === "unreadable") chmodSync(backlink, 0o600); }
  }),
);

it.effect.each((["start", "resume", "reload"] as const).flatMap((operation) => breaks.map((broken) => ({ operation, broken }))))(
  "U5A-F04 B4 $operation/$broken: catches trusting a back-link that became invalid after the initial grant",
  ({ operation, broken }) => Effect.gen(function* () {
    const { child, backlink } = worktree();
    const grant = yield* checkFolder(options(child));
    breakBacklink(backlink, broken);
    try {
      expect(Result.isFailure(yield* folderForSpawn(grant, operation).pipe(Effect.result))).toBe(true);
    } finally { if (broken === "unreadable") chmodSync(backlink, 0o600); }
  }),
);

it.effect("U5A-F04 B4 reciprocal registration: catches refusing a genuine linked worktree with a valid back-link", () =>
  Effect.gen(function* () {
    const { child } = worktree();
    const grant = yield* checkFolder(options(child));
    expect(grant.realPath).toBe(child);
    for (const operation of ["start", "resume", "reload"] as const) expect(yield* folderForSpawn(grant, operation)).toBe(child);
  }),
);

it.effect("U5A-F05 parent subfolder without git: catches looking for .git only in the parent's current folder", () =>
  Effect.gen(function* () {
    const { child } = worktree();
    const src = directory(join(parent, "src"));
    vi.stubEnv("PATH", directory(join(root, "empty-path")));
    const grant = yield* checkFolder(options(child, src));
    expect(grant.realPath).toBe(child);
    for (const operation of ["start", "resume", "reload"] as const) expect(yield* folderForSpawn(grant, operation)).toBe(child);
  }),
);

// Intended additive seam: checkFolder(request, { readMountInfo: () => string }).
// The assertion permits the tests to run against f8bd6b7, which ignores this
// optional argument. No production implementation is supplied by the tests.
const checkWithMounts = checkFolder as (
  request: Parameters<typeof checkFolder>[0],
  dependencies: { readonly readMountInfo: () => string },
) => ReturnType<typeof checkFolder>;
const mountLine = (path: string) => `42 1 0:42 / ${path.replaceAll(" ", "\\040")} rw,relatime - tmpfs synthetic rw\n`;

describe.skipIf(process.platform !== "linux")("U5A-F06 Linux mount-table inspection", () => {
  it.effect.each(["home", "state", "plugin", "protected-ancestor"] as const)(
    "%s: catches allowing a protected directory or its ancestor mounted beneath the candidate",
    (which) => Effect.gen(function* () {
      const child = directory(join(parent, "child"));
      const target = which === "home" ? home : which === "state" ? stateFolder
        : which === "plugin" ? pluginRoot : join(root, "protected");
      const mounted = join(child, "mounted folder");
      // A symlink supplies the identity that stat would see for a bind mount.
      // Only the synthetic mount table marks it as a mount. Nothing is mounted.
      symlinkSync(target, mounted);
      expect(statSync(mounted).ino).toBe(statSync(target).ino);
      const outcome = yield* checkWithMounts(options(child), { readMountInfo: () => mountLine(mounted) }).pipe(Effect.result);
      expect(Result.isFailure(outcome)).toBe(true);
    }),
  );

  it.effect("unrelated mount: catches banning every nested mount regardless of its device and inode", () => Effect.gen(function* () {
    const child = directory(join(parent, "child"));
    const mounted = directory(join(child, "unrelated mount"));
    const grant = yield* checkWithMounts(options(child), { readMountInfo: () => mountLine(mounted) });
    expect(grant.realPath).toBe(child);
  }));

  it.effect("unreadable mount table: catches allowing an agent child when Linux mount identities cannot be checked", () => Effect.gen(function* () {
    const child = directory(join(parent, "child"));
    const readMountInfo = () => { throw Object.assign(new Error("synthetic denial"), { code: "EACCES" }); };
    expect(Result.isFailure(yield* checkWithMounts(options(child), { readMountInfo }).pipe(Effect.result))).toBe(true);
  }));
});
