import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";
import { gitProcess, processFailure } from "../../../src/project/git/process.ts";
import { makeGitService, type GitOperation, type GitService } from "../../../src/project/git/index.ts";

registerRebuildCheck({ noLog: true });

it.each([
  { name: "modern no-connection suffix", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Failed to connect to 127.0.0.1 port 1 after 0 ms: Could not connect to server\n", truncated: false, expected: true },
  { name: "failed-connect suffix without port detail", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Failed to connect to fixture.invalid: Could not connect to server\n", truncated: false, expected: true },
  { name: "legacy no-connection suffix", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Could not connect to server\n", truncated: false, expected: true },
  { name: "generic lost transport", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': outcome transport lost\n", truncated: false, expected: false },
  { name: "connection reset", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Recv failure: Connection reset by peer\n", truncated: false, expected: false },
  { name: "timeout", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Operation timed out\n", truncated: false, expected: false },
  { name: "failed-connect disconnect without refusal suffix", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Failed to connect to fixture.invalid: connection disconnected; outcome unknown\n", truncated: false, expected: false },
  { name: "failed-connect reset without refusal suffix", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Failed to connect to fixture.invalid: Recv failure: Connection reset by peer\n", truncated: false, expected: false },
  { name: "failed-connect timeout without refusal suffix", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Failed to connect to fixture.invalid: Operation timed out\n", truncated: false, expected: false },
  { name: "missing completed exit", code: -1, stderr: "Connection refused\n", truncated: false, expected: false },
  { name: "truncated legacy diagnostic", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Could not connect to server\n", truncated: true, expected: false },
  { name: "truncated failed-connect diagnostic without port detail", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Failed to connect to fixture.invalid: Could not connect to server\n", truncated: true, expected: false },
  { name: "zero exit", code: 0, stderr: "fatal: unable to access 'https://fixture.invalid/': Could not connect to server\n", truncated: false, expected: false },
  { name: "phrase only inside remote URL", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/: Could not connect to server': outcome transport lost\n", truncated: false, expected: false },
  { name: "failed-connect phrase only inside remote URL", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/: Failed to connect to fixture.invalid: Could not connect to server': outcome transport lost\n", truncated: false, expected: false },
  { name: "phrase without network mapping", code: 128, stderr: "Could not connect to server\n", truncated: false, expected: false },
  { name: "generic diagnostic continues after phrase", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Could not connect to server; previous outcome unknown\n", truncated: false, expected: false },
  { name: "failed-connect diagnostic continues after phrase", code: 128, stderr: "fatal: unable to access 'https://fixture.invalid/': Failed to connect to fixture.invalid: Could not connect to server; previous outcome unknown\n", truncated: false, expected: false },
])("issue 590: completed refusal evidence and unknown transport remain distinct: $name", ({ code, stderr, truncated, expected }) => {
  const failure = processFailure({ code, stderr, stdout: "", truncated });
  expect(failure.determinate === true).toBe(expected);
});

let root: string, repo: string, service: GitService;
const run = <A>(operation: GitOperation<A>) => Effect.runPromise(operation);
const reason = async <A>(operation: GitOperation<A>) => (await Effect.runPromise(Effect.flip(operation))).reason;
const git = (folder: string, args: string[], extra: NodeJS.ProcessEnv = {}) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
  cwd: folder, encoding: "utf8", env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", ...extra }, stdio: ["ignore", "pipe", "pipe"],
}).trim();
const configure = (folder: string) => {
  git(folder, ["config", "user.name", "Git fixture"]);
  git(folder, ["config", "user.email", "fixture@example.invalid"]);
  git(folder, ["config", "commit.gpgsign", "false"]);
};
const save = async (folder: string, file: string, text: string) => writeFile(join(folder, file), text);
const commit = (folder: string, title: string, date?: string) => {
  git(folder, ["add", "--all"]);
  git(folder, ["commit", "-m", title], date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(folder, ["rev-parse", "HEAD"]);
};
const worktree = async (name: string, from = "HEAD") => run(service.createWorktree(repo, name, from));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lgcode-git-service-"));
  service = makeGitService({ workspaceFolder: root });
  repo = (await run(service.createRepository("Example"))).path;
  configure(repo);
  await save(repo, ".gitignore", ".worktrees/\n");
  await save(repo, "file.txt", "start\n");
  commit(repo, "Initial", "2026-01-01T01:00:00Z");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("bounded Git service with real temporary repositories", () => {
  it("discovers and registers repositories and creates unborn main repositories", async () => {
    const empty = await run(service.createRepository("New garden"));
    expect(await run(service.state(empty.path))).toMatchObject({ head: null, branch: "main", ahead: 0, behind: 0 });
    expect((await run(service.discover())).items.map((item) => item.name).sort()).toEqual(["example", "new-garden"]);
    expect((await run(service.register(repo))).commonDirectory).toBe(join(repo, ".git"));
    expect(await reason(service.createRepository("Example"))).toBe("collision");
    await mkdir(join(repo, "sub"));
    expect(await reason(service.register(join(repo, "sub")))).toBe("not_repository");
    expect((await run(service.history(empty.path))).items).toEqual([]);
    await save(empty.path, "first", "first\n");
    await run(service.stageAll(empty.path));
    await run(service.unstageAll(empty.path));
    expect((await run(service.changes(empty.path))).items[0]?.untracked).toBe(true);
  });

  it("starts a project worktree in a newly created repository before its first commit", async () => {
    const empty = await run(service.createRepository("First project repository")); configure(empty.path);
    const first = await run(service.createWorktree(empty.path, "First project"));
    expect(first).toMatchObject({ branch: "first-project", head: null });
    expect(await run(service.state(first.path))).toMatchObject({ branch: "first-project", head: null });
    expect((await run(service.worktrees(empty.path))).items).toHaveLength(2);
    await save(first.path, "first", "real first content\n");
    await run(service.stageAll(first.path));
    expect((await run(service.diff(first.path))).additions).toBe(1);
    const head = await run(service.commit(first.path, "Project's first commit"));
    expect((await run(service.state(first.path))).head).toBe(head);
    expect((await run(service.state(empty.path))).head).toBe(null);
  });

  it("allocates collision-safe branches and main-root worktree folders, including calls from a linked worktree", async () => {
    git(repo, ["branch", "garden-tools"]);
    await mkdir(join(repo, ".worktrees", "garden-tools-2"), { recursive: true });
    const first = await worktree("Garden tools");
    const second = await run(service.createWorktree(first.path, "Garden tools"));
    expect(first.branch).toBe("garden-tools-3");
    expect(second.path).toBe(join(repo, ".worktrees", "garden-tools-4"));
    expect((await run(service.branches(repo))).items.map((item) => item.name)).toEqual(expect.arrayContaining(["main", "garden-tools", "garden-tools-3", "garden-tools-4"]));
    expect((await run(service.worktrees(first.path))).items).toHaveLength(3);
    expect((await run(service.register(second.path))).commonDirectory).toBe(join(repo, ".git"));
  });

  it("keeps managed linked checkouts out of the main checkout's untracked changes without editing tracked ignore files", async () => {
    await rm(join(repo, ".gitignore")); commit(repo, "No tracked ignore rule");
    await worktree("Managed");
    expect((await run(service.changes(repo))).items).toEqual([]);
    expect(await readFile(join(repo, ".git", "info", "exclude"), "utf8")).toContain("/.worktrees/");
    await expect(readFile(join(repo, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads porcelain including untracked, renames, staged and unstaged changes without quoting paths", async () => {
    await rename(join(repo, "file.txt"), join(repo, "renamed file.txt"));
    git(repo, ["add", "--all"]);
    await save(repo, "renamed file.txt", "start\nmore\n");
    await save(repo, "strange\tname.txt", "tab\n");
    const changes = (await run(service.changes(repo))).items;
    expect(changes.find((item) => item.path === "renamed file.txt")).toMatchObject({ originalPath: "file.txt", staged: true, unstaged: true, index: "R" });
    expect(changes.find((item) => item.path === "strange\tname.txt")).toMatchObject({ untracked: true });
    await run(service.stage(repo, "renamed file.txt"));
    expect((await run(service.changes(repo))).items.find((item) => item.path === "renamed file.txt")).toMatchObject({ staged: true, unstaged: false });
    await run(service.unstage(repo, "renamed file.txt"));
    expect((await run(service.changes(repo))).items.every((item) => !item.staged)).toBe(true);
  });

  it("stages and commits only selected files, unstages all, and handles literal option-looking path names", async () => {
    await save(repo, "file.txt", "changed\n");
    await save(repo, "--help", "literal\n");
    await save(repo, ":(glob)*", "literal pathspec\n");
    await run(service.stage(repo, "--help"));
    expect((await run(service.changes(repo))).items.filter((item) => item.staged).map((item) => item.path)).toEqual(["--help"]);
    const head = await run(service.commit(repo, "A real selected commit"));
    expect((await run(service.commitFiles(repo, head))).items.map((item) => item.path)).toEqual(["--help"]);
    await run(service.stage(repo, ":(glob)*"));
    expect((await run(service.changes(repo))).items.find((item) => item.path === "file.txt")?.staged).toBe(false);
    await run(service.stageAll(repo));
    await run(service.unstageAll(repo));
    expect((await run(service.changes(repo))).items.every((item) => !item.staged)).toBe(true);
    expect(await reason(service.commit(repo, "not staged"))).toBe("nothing_staged");
    expect(await reason(service.commit(repo, "  "))).toBe("invalid_message");
  });

  it("returns actual diffs, binary flags, commit files, history and full line counts even when the patch is cut", async () => {
    await save(repo, "file.txt", "start\n" + "new\n".repeat(200));
    const bounded = makeGitService({ workspaceFolder: root, maxDiffBytes: 180 });
    const working = await run(bounded.diff(repo, { path: "file.txt" }));
    expect(working).toMatchObject({ additions: 200, deletions: 0, truncated: true, binary: false });
    expect(Buffer.byteLength(working.patch)).toBeLessThanOrEqual(180);
    await save(repo, "binary", "\0\x01\x02");
    expect(await run(service.diff(repo, { path: "binary" }))).toMatchObject({ binary: true });
    await save(repo, "new", "a\nb\n");
    expect(await run(service.diff(repo, { path: "new" }))).toMatchObject({ additions: 2 });
    await run(service.stageAll(repo));
    expect((await run(service.diff(repo, { staged: true }))).additions).toBe(202);
    const head = await run(service.commit(repo, "Real diff history"));
    expect((await run(service.history(repo))).items[0]).toMatchObject({ head, title: "Real diff history", author: "Git fixture" });
    expect((await run(service.diff(repo, { commit: head, path: "file.txt" }))).additions).toBe(200);
    const initial = (await run(service.history(repo))).items.at(-1)!;
    expect((await run(service.commitFiles(repo, initial.head))).items.map((item) => item.path)).toContain("file.txt");
  });

  it("returns the earliest pending commit date from actual history and binds review evidence to HEAD", async () => {
    const project = await worktree("Project");
    await save(project.path, "file.txt", "one\n");
    commit(project.path, "One", "2026-02-01T01:00:00Z");
    await save(project.path, "file.txt", "two\n");
    const head = commit(project.path, "Two", "2026-03-01T01:00:00Z");
    expect(await run(service.state(project.path, "main"))).toMatchObject({ pending: 2, pendingSince: "2026-02-01T01:00:00Z" });
    const review = await run(service.review(project.path, "main"));
    expect(review.head).toBe(head);
    expect(review.commits.items.map((item) => item.title)).toEqual(["Two", "One"]);
    expect(review.files.items.map((item) => item.path)).toEqual(["file.txt"]);
    expect(review.diff.patch).toContain("+two");
    expect(git(repo, ["show", "HEAD:file.txt"])).toBe("start");
  });

  it("consumes both NUL-delimited rename paths without counting tab-bearing names as statistics", async () => {
    const old = "100\t200\told", next = "300\t400\tnew";
    await save(repo, old, "same\n"); commit(repo, "Tab-bearing original");
    await rename(join(repo, old), join(repo, next));
    await run(service.stageAll(repo));
    // This is a real zero-line rename, not a delete/add pair.
    expect(git(repo, ["diff", "--cached", "--numstat", "-z"])).toBe(`0\t0\t\0${old}\0${next}\0`);
    for (const options of [undefined, { staged: true }]) {
      expect(await run(service.diff(repo, options))).toMatchObject({ additions: 0, deletions: 0, binary: false });
    }
    await save(repo, "file.txt", "replacement\nsecond line");
    await save(repo, "500\t600\tordinary", "extra\n");
    await save(repo, "binary", "\0binary");
    await run(service.stageAll(repo));
    const bounded = makeGitService({ workspaceFolder: root, maxDiffBytes: 80 });
    expect(await run(bounded.diff(repo, { staged: true }))).toMatchObject({ additions: 3, deletions: 1, binary: true, truncated: true });
    const head = await run(service.commit(repo, "Rename and mixed records"));
    expect(await run(service.diff(repo, { commit: head }))).toMatchObject({ additions: 3, deletions: 1, binary: true });
  });

  it("requires a fresh explicit discard confirmation and preserves the index of partially staged files", async () => {
    await save(repo, "file.txt", "staged\n");
    await run(service.stage(repo, "file.txt"));
    await save(repo, "file.txt", "unstaged\n");
    await save(repo, "new", "delete me\n");
    const plan = await run(service.planDiscard(repo));
    expect(plan.paths).toEqual(["file.txt", "new"]);
    expect(await reason(service.discard(repo, plan, false))).toBe("confirmation_required");
    await save(repo, "new", "edited since confirmation\n");
    expect(await reason(service.discard(repo, plan, true))).toBe("stale_state");
    await run(service.discard(repo, await run(service.planDiscard(repo)), true));
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("staged\n");
    expect((await run(service.changes(repo))).items).toHaveLength(1);
    expect((await run(service.changes(repo))).items[0]).toMatchObject({ staged: true, unstaged: false });
    await expect(readFile(join(repo, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    await rm(join(repo, "file.txt"));
    await run(service.discard(repo, await run(service.planDiscard(repo)), true));
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("staged\n");
  });

  it("refuses dirty destination/source and direct base integration, then merges a clean team into its project", async () => {
    const project = await worktree("Project"), team = await worktree("Team", project.branch!);
    await save(team.path, "team", "real team change\n");
    const head = commit(team.path, "Team change");
    await save(project.path, "dirty", "keep\n");
    expect(await reason(service.mergeTeam(team.path, project.path, head))).toBe("dirty_destination");
    await rm(join(project.path, "dirty"));
    await save(team.path, "dirty", "keep\n");
    expect(await reason(service.mergeTeam(team.path, project.path, head))).toBe("dirty_source");
    await rm(join(team.path, "dirty"));
    expect(await reason(service.mergeTeam(team.path, project.path, "old-head"))).toBe("stale_state");
    expect(await run(service.mergeTeam(team.path, project.path, head))).toBe(head);
    expect(await readFile(join(project.path, "team"), "utf8")).toBe("real team change\n");
    expect(await reason(service.mergeTeam(project.path, repo, head))).toBe("base_requires_review");
    expect(git(repo, ["branch", "--show-current"])).toBe("main");
  });

  it("reads real three-way conflicts, protects them from bulk changes, and resolves each chosen hunk back to unstaged changes", async () => {
    const original = "one\n" + Array.from({ length: 15 }, (_, i) => `shared ${i}\n`).join("") + "two\n";
    await save(repo, "file.txt", original); commit(repo, "Conflict base");
    const project = await worktree("Project"), team = await worktree("Team");
    await save(project.path, "file.txt", original.replace("one\n", "ours one\n").replace("two\n", "ours two\n"));
    commit(project.path, "Ours");
    await save(team.path, "file.txt", original.replace("one\n", "theirs one\n").replace("two\n", "theirs two\n"));
    const head = commit(team.path, "Theirs");
    expect(await reason(service.mergeTeam(team.path, project.path, head))).toBe("conflicts");
    expect((await run(service.changes(project.path))).items[0]?.conflict).toBe(true);
    expect(await reason(service.stage(project.path, "file.txt"))).toBe("conflicts");
    await save(project.path, "safe", "can stage\n");
    await run(service.stageAll(project.path));
    expect((await run(service.changes(project.path))).items.find((item) => item.path === "file.txt")?.conflict).toBe(true);
    await run(service.unstageAll(project.path));
    const plan = await run(service.planDiscard(project.path));
    expect(plan.paths).toEqual(["safe"]);
    await run(service.discard(project.path, plan, true));
    let selection = await run(service.conflict(project.path, "file.txt"));
    expect(selection.choices).toEqual([null, null]);
    expect(selection.base).toBe(original);
    expect(await reason(service.resolve(project.path, selection))).toBe("incomplete_choices");
    selection = await run(service.choose(project.path, selection, 0, "ours"));
    selection = await run(service.choose(project.path, selection, 1, "both"));
    // Client-supplied segments are never trusted for the write.
    await run(service.resolve(project.path, { ...selection, segments: [] }));
    const resolved = await readFile(join(project.path, "file.txt"), "utf8");
    expect(resolved).toBe(original.replace("one\n", "ours one\n").replace("two\n", "ours two\ntheirs two\n"));
    expect((await run(service.changes(project.path))).items[0]).toMatchObject({ conflict: false, staged: false, unstaged: true });
    await run(service.stageAll(project.path));
    await run(service.commit(project.path, "Resolved real merge"));
    expect(git(project.path, ["show", "--format=%P", "-s"]).split(" ")).toHaveLength(2);
  });

  it("refuses stale conflict choices after a real file edit", async () => {
    const project = await worktree("Project"), team = await worktree("Team");
    await save(project.path, "file.txt", "ours\n"); commit(project.path, "Ours");
    await save(team.path, "file.txt", "theirs\n"); const head = commit(team.path, "Theirs");
    expect(await reason(service.mergeTeam(team.path, project.path, head))).toBe("conflicts");
    const selection = await run(service.conflict(project.path, "file.txt"));
    await save(project.path, "file.txt", "manually edited\n");
    expect(await reason(service.choose(project.path, selection, 0, "theirs"))).toBe("stale_state");
    expect(await readFile(join(project.path, "file.txt"), "utf8")).toBe("manually edited\n");
  });

  it("can finish an ours-only conflict as a real merge even when the resolution matches HEAD", async () => {
    const project = await worktree("Project"), team = await worktree("Team");
    await save(project.path, "file.txt", "ours\n"); commit(project.path, "Ours");
    await save(team.path, "file.txt", "theirs\n"); const head = commit(team.path, "Theirs");
    expect(await reason(service.mergeTeam(team.path, project.path, head))).toBe("conflicts");
    const selected = await run(service.choose(project.path, await run(service.conflict(project.path, "file.txt")), 0, "ours"));
    await run(service.resolve(project.path, selected));
    expect((await run(service.changes(project.path))).items).toEqual([]);
    expect((await run(service.state(project.path))).mergeHead).toBe(head);
    await run(service.commit(project.path, "Finish ours merge"));
    expect((await run(service.state(project.path))).mergeHead).toBe(null);
    expect(git(project.path, ["show", "--format=%P", "-s"]).split(" ")).toHaveLength(2);
  });

  it("preserves a missing final newline and treats marker-like source as literal context", async () => {
    const prefix = "<".repeat(64) + " literal source marker\n";
    await save(repo, "file.txt", prefix + "base"); commit(repo, "No newline base");
    const project = await worktree("Project"), team = await worktree("Team");
    await save(project.path, "file.txt", prefix + "ours"); commit(project.path, "Ours");
    await save(team.path, "file.txt", prefix + "theirs"); const head = commit(team.path, "Theirs");
    expect(await reason(service.mergeTeam(team.path, project.path, head))).toBe("conflicts");
    const selection = await run(service.conflict(project.path, "file.txt"));
    expect(selection.choices).toHaveLength(1);
    await run(service.resolve(project.path, await run(service.choose(project.path, selection, 0, "theirs"))));
    expect(await readFile(join(project.path, "file.txt"), "utf8")).toBe(prefix + "theirs");
    expect(await reason(service.mergeTeam(team.path, project.path, head))).toBe("dirty_destination");
  });

  it("terminates real Git subprocesses on timeout and cancellation", async () => {
    const controller = new AbortController();
    await expect(gitProcess(repo, ["-c", "alias.wait=!sleep 10", "wait"], { bytes: 1024, timeoutMs: 30 }, controller.signal)).rejects.toMatchObject({ reason: "timeout" });
    const pending = gitProcess(repo, ["-c", "alias.wait=!sleep 10", "wait"], { bytes: 1024, timeoutMs: 5000 }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: "cancelled" });
  });

  for (const linked of [false, true]) {
    for (const bulk of [false, true]) {
      for (const interruption of ["timeout", "cancel"] as const) {
        it(`recovers ${bulk ? "bulk" : "single"} staging after ${interruption} in a ${linked ? "linked" : "main"} checkout`, async () => {
          const folder = linked ? (await worktree("Recovery")).path : repo;
          const index = git(folder, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
          const marker = join(root, "filter-entered");
          const originalIndex = await readFile(index);
          // Status also invokes clean filters. Only pause when add holds its
          // actual per-worktree index lock, as in the verifier's reproduction.
          git(folder, ["config", "filter.slow.clean", `if test -f '${index}.lock'; then printf entered > '${marker}'; sleep 10; fi; cat`]);
          await save(folder, ".gitattributes", "*.txt filter=slow\n");
          await save(folder, "file.txt", "changed length\n");
          const short = makeGitService({ workspaceFolder: root, timeoutMs: interruption === "timeout" ? 500 : 5000 });
          const mutation = bulk ? short.stageAll(folder) : short.stage(folder, "file.txt");
          if (interruption === "timeout") {
            expect(await reason(mutation)).toBe("timeout");
            expect(await readFile(marker, "utf8")).toBe("entered");
          } else {
            const controller = new AbortController();
            const pending = Effect.runPromise(mutation, { signal: controller.signal }).then(() => "succeeded", () => "interrupted");
            try {
              await expect.poll(() => readFile(marker, "utf8"), { timeout: 3000 }).toBe("entered");
            } finally { controller.abort(); }
            expect(await pending).toBe("interrupted");
          }
          // Observe the interrupted subprocess's actual cleanup before
          // verifying the index and the ownership of its lock.
          await run(short.changes(folder));
          await expect(readFile(index + ".lock")).rejects.toMatchObject({ code: "ENOENT" });
          expect(await readFile(index)).toEqual(originalIndex);
          git(folder, ["config", "--unset", "filter.slow.clean"]);
          await run(bulk ? short.stageAll(folder) : short.stage(folder, "file.txt"));
          expect((await run(service.changes(folder))).items.find((change) => change.path === "file.txt")?.staged).toBe(true);
        });
      }
    }
  }

  it("preserves pre-existing and other worktrees' index locks while recovering its own failed add", async () => {
    const linked = await worktree("Other index");
    const mainLock = join(repo, ".git", "index.lock");
    const linkedLock = git(linked.path, ["rev-parse", "--path-format=absolute", "--git-path", "index"]) + ".lock";
    await writeFile(mainLock, "foreign main lock", { flag: "wx" });
    await writeFile(linkedLock, "foreign linked lock", { flag: "wx" });
    for (const folder of [repo, linked.path]) {
      await save(folder, "file.txt", "changed length\n");
      expect(await reason(service.stage(folder, "file.txt"))).toBe("busy");
    }
    await expect(gitProcess(linked.path, ["-c", "alias.wait=!sleep 10", "wait"], { bytes: 1024, timeoutMs: 30 }, new AbortController().signal)).rejects.toMatchObject({ reason: "timeout" });
    expect(await readFile(mainLock, "utf8")).toBe("foreign main lock");
    expect(await readFile(linkedLock, "utf8")).toBe("foreign linked lock");
  });

  it("bounds termination even when a descendant ignores SIGTERM and preserves the first failure", async () => {
    const marker = join(root, "stubborn-pid");
    const controller = new AbortController();
    const pending = gitProcess(repo, ["-c", `alias.wait=!trap '' TERM; echo $$ > '${marker}'; while :; do :; done`, "wait"],
      { bytes: 1024, timeoutMs: 200 }, controller.signal).catch((error: unknown) => error);
    const started = Date.now();
    await expect.poll(() => readFile(marker, "utf8"), { interval: 10 }).toMatch(/^\d+\n$/);
    // Cancellation starts termination; the shorter command deadline must not
    // overwrite that reason while the child is using its cleanup grace.
    controller.abort();
    expect(await pending).toMatchObject({ reason: "cancelled" });
    expect(Date.now() - started).toBeLessThan(2000);
    const pid = (await readFile(marker, "utf8")).trim();
    await expect.poll(async () => {
      try { return /\) Z /.test(await readFile(`/proc/${pid}/stat`, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
    }).toBe(true);
  });

  it("does not remove another live Git operation's lock on failure or timeout", async () => {
    const marker = join(root, "other-filter-entered"), lock = join(repo, ".git", "index.lock");
    git(repo, ["config", "filter.slow.clean", `if test -f '${lock}'; then printf entered > '${marker}'; sleep 10; fi; cat`]);
    await save(repo, ".gitattributes", "*.txt filter=slow\n");
    await save(repo, "file.txt", "other process's change\n");
    const other = new AbortController();
    let settled = false;
    const pending = gitProcess(repo, ["add", "--", "file.txt"], { bytes: 1024, timeoutMs: 5000 }, other.signal)
      .then((value) => { settled = true; return value; }, (error: unknown) => { settled = true; return error; });
    try {
      await expect.poll(() => readFile(marker, "utf8")).toBe("entered");
      const original = await readFile(lock);
      expect(await reason(service.stage(repo, "file.txt"))).toBe("busy");
      await expect(gitProcess(repo, ["-c", "alias.wait=!sleep 10", "wait"], { bytes: 1024, timeoutMs: 30 }, new AbortController().signal)).rejects.toMatchObject({ reason: "timeout" });
      expect(settled).toBe(false);
      expect(await readFile(lock)).toEqual(original);
    } finally { other.abort(); await pending; }
    await expect(readFile(lock)).rejects.toMatchObject({ code: "ENOENT" });
    git(repo, ["config", "--unset", "filter.slow.clean"]);
    await run(service.stage(repo, "file.txt"));
    expect((await run(service.changes(repo))).items.find((change) => change.path === "file.txt")?.staged).toBe(true);
  });

  it("rolls back its index lock after a real staging filter exceeds the stderr bound", async () => {
    const lock = join(repo, ".git", "index.lock");
    git(repo, ["config", "filter.noisy.clean", `if test -f '${lock}'; then head -c 20000 /dev/zero >&2; sleep 10; fi; cat`]);
    await save(repo, ".gitattributes", "*.txt filter=noisy\n");
    await save(repo, "file.txt", "changed length\n");
    expect(await reason(service.stage(repo, "file.txt"))).toBe("output_limit");
    await expect(readFile(lock)).rejects.toMatchObject({ code: "ENOENT" });
    git(repo, ["config", "--unset", "filter.noisy.clean"]);
    await run(service.stage(repo, "file.txt"));
    expect((await run(service.changes(repo))).items.find((change) => change.path === "file.txt")?.staged).toBe(true);
  });

  it("fetches, pushes, reports actual ahead/behind, and fast-forward pulls using a local bare remote", async () => {
    const remote = join(root, "remote.git"); await mkdir(remote); git(remote, ["init", "--bare", "--initial-branch=main"]);
    git(repo, ["remote", "add", "origin", remote]);
    await run(service.push(repo));
    expect(await run(service.state(repo))).toMatchObject({ upstream: "origin/main", ahead: 0, behind: 0 });
    await save(repo, "outgoing", "one\n"); commit(repo, "Outgoing");
    expect((await run(service.state(repo))).ahead).toBe(1);
    await run(service.push(repo));
    const other = join(root, "other"); git(root, ["clone", remote, other]); configure(other);
    await save(other, "incoming", "two\n"); commit(other, "Incoming"); git(other, ["push", "origin", "main"]);
    await run(service.fetch(repo));
    expect((await run(service.state(repo))).behind).toBe(1);
    await run(service.pull(repo));
    expect(await readFile(join(repo, "incoming"), "utf8")).toBe("two\n");
    await save(other, "diverge", "remote\n"); commit(other, "Remote divergence"); git(other, ["push", "origin", "main"]);
    await save(repo, "local", "local\n"); commit(repo, "Local divergence");
    expect(await reason(service.push(repo))).toBe("push_rejected");
    expect(await reason(service.pull(repo))).toBe("pull_diverged");
  });

  it("reports missing remote/upstream prerequisites without invented successes or raw stderr", async () => {
    expect(await reason(service.fetch(repo))).toBe("missing_remote");
    expect(await reason(service.pull(repo))).toBe("missing_remote");
    expect(await reason(service.push(repo))).toBe("missing_remote");
    const remote = join(root, "remote.git"); await mkdir(remote); git(remote, ["init", "--bare"]);
    git(repo, ["remote", "add", "origin", remote]);
    expect(await reason(service.pull(repo))).toBe("missing_upstream");
    git(repo, ["remote", "set-url", "origin", join(root, "SECRET-not-a-repository")]);
    expect(await reason(service.fetch(repo))).toBe("network_failed");
  });

  it("bounds structured reads and refuses bulk mutations on a truncated file set", async () => {
    for (let i = 0; i < 4; i++) await save(repo, `new-${i}`, "x\n");
    const bounded = makeGitService({ workspaceFolder: root, maxEntries: 2 });
    expect(await run(bounded.changes(repo))).toMatchObject({ truncated: true, items: [{ path: "new-0" }, { path: "new-1" }] });
    expect(await reason(bounded.stageAll(repo))).toBe("output_limit");
    expect((await run(service.changes(repo))).items.every((item) => !item.staged)).toBe(true);
    expect(await reason(makeGitService({ workspaceFolder: root, maxOutputBytes: 8 }).changes(repo))).toBe("output_limit");
    git(repo, ["branch", "one"]); git(repo, ["branch", "two"]);
    expect((await run(bounded.branches(repo))).truncated).toBe(true);
  });

  it("refuses path escape, symlink redirection, nested repositories, metadata access and option/revision injection", async () => {
    const outside = await mkdtemp(join(tmpdir(), "lgcode-git-outside-"));
    try {
      await writeFile(join(outside, "secret"), "do not change\n");
      await symlink(outside, join(repo, "escape"));
      await symlink(outside, join(root, "linked-outside"));
      for (const path of ["../secret", "/etc/passwd", ".git/config", "escape/secret", "file.txt/../secret"]) {
        expect(await reason(service.diff(repo, { path }))).toBe("invalid_path");
      }
      expect(await reason(service.register(join(root, "linked-outside")))).toBe("invalid_path");
      expect(await reason(service.register(outside))).toBe("invalid_path");
      expect(await reason(service.history(repo, 0))).toBe("output_limit");
      for (const ref of ["--help", "HEAD:file.txt", "HEAD@{1}", "HEAD~1", "HEAD\nmain"]) expect(await reason(service.commitFiles(repo, ref))).toBe("invalid_ref");
      const nested = join(repo, "nested"); await mkdir(nested); git(nested, ["init"]); await save(nested, "own", "x\n");
      expect(await reason(service.diff(repo, { path: "nested/own" }))).toBe("invalid_path");
      await symlink(outside, join(repo, ".worktrees"));
      expect(await reason(service.createWorktree(repo, "escape"))).toBe("invalid_path");
      expect(await readFile(join(outside, "secret"), "utf8")).toBe("do not change\n");
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it("refuses broken worktree backlinks and metadata symlinks", async () => {
    const linked = await worktree("Linked");
    await writeFile(join(repo, ".git", "worktrees", "linked", "gitdir"), join(repo, ".git") + "\n");
    expect(await reason(service.register(linked.path))).toBe("invalid_path");
    const exclude = join(repo, ".git", "info", "exclude");
    await rm(exclude); await symlink(join(repo, "file.txt"), exclude);
    expect(await reason(service.createWorktree(repo, "Refused"))).toBe("invalid_path");
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("start\n");
  });

  it("does not run repository-controlled fsmonitor, hooks, external diffs or textconv during reads and mutations", async () => {
    const marker = join(root, "helper-ran"), helper = join(root, "helper.sh");
    await writeFile(helper, `#!/bin/sh\nprintf ran >> '${marker}'\nexit 0\n`); await chmod(helper, 0o700);
    git(repo, ["config", "core.fsmonitor", helper]);
    git(repo, ["config", "diff.external", helper]);
    git(repo, ["config", "diff.danger.textconv", helper]);
    git(repo, ["config", "core.hooksPath", join(repo, ".git", "hooks")]);
    for (const hook of ["pre-commit", "post-checkout", "post-merge"]) {
      await writeFile(join(repo, ".git", "hooks", hook), `#!/bin/sh\nprintf ran >> '${marker}'\n`);
      await chmod(join(repo, ".git", "hooks", hook), 0o700);
    }
    await save(repo, ".gitattributes", "*.txt diff=danger\n");
    await save(repo, "file.txt", "changed\n");
    await run(service.register(repo)); await run(service.discover()); await run(service.changes(repo));
    await run(service.diff(repo)); await run(service.diff(repo, { commit: "HEAD" }));
    await run(service.history(repo)); await run(service.commitFiles(repo, "HEAD"));
    await run(service.stageAll(repo)); await run(service.commit(repo, "Safe reads and commit"));
    await worktree("No hooks");
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("issue 585: gives real network Git its own longer bounded subprocess budget", async () => {
  const remote = join(root, "network.git")
  await mkdir(remote); git(remote, ["init", "--bare"])
  git(repo, ["remote", "add", "origin", remote])
  const bin = join(root, "network-bin"), marker = join(root, "network-entered")
  await mkdir(bin)
  const priorPath = process.env.PATH
  await writeFile(join(bin, "git"), `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst args=process.argv.slice(2);\nif(args.includes('fetch')) { writeFileSync(${JSON.stringify(marker)}, 'fetch'); await new Promise(r=>setTimeout(r, 700)); }\nconst result=spawnSync('/usr/bin/git',args,{stdio:'inherit'}); process.exit(result.status??1);\n`, { mode: 0o700 })
  process.env.PATH = `${bin}:${priorPath}`
  try {
    const bounded = makeGitService({ workspaceFolder: root, timeoutMs: 500, networkTimeoutMs: 3000 })
    await run(bounded.fetch(repo))
    expect(await readFile(marker, "utf8")).toBe("fetch")
    const tooShort = makeGitService({ workspaceFolder: root, timeoutMs: 500, networkTimeoutMs: 500 })
    const failure = await Effect.runPromise(Effect.flip(tooShort.fetch(repo)))
    expect(failure).toMatchObject({ reason: "timeout", uncertain: true })
  } finally {
    if (priorPath === undefined) delete process.env.PATH
    else process.env.PATH = priorPath
  }
})
