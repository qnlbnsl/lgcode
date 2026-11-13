import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { beforeEach, afterEach, expect, it } from "vitest";
import { makeGitService } from "../../../src/project/git/index.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });
let root: string, repo: string;
const git = (path: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = Effect.runPromise;
const save = (path: string, text: string) => writeFile(join(path, "file.txt"), text);
const commit = (path: string) => { git(path, "add", "--all"); git(path, "commit", "-m", "Fixture"); return git(path, "rev-parse", "HEAD"); };
const service = () => makeGitService({ workspaceFolder: root });
const reason = <A>(effect: Effect.Effect<A, { reason: string }>) => run(Effect.flip(effect)).then((e) => e.reason);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lgtm-git-actions-"));
  repo = (await run(service().createRepository("repository"))).path;
  git(repo, "config", "user.name", "Builder"); git(repo, "config", "user.email", "builder@example.invalid"); git(repo, "config", "commit.gpgsign", "false");
  await save(repo, "base\n"); commit(repo);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const conflict = async () => {
  const s = service(), ours = await run(s.createWorktree(repo, "team")), theirs = await run(s.createWorktree(repo, "builder"));
  await save(ours.path, "ours\n"); const head = commit(ours.path);
  await save(theirs.path, "theirs\n"); const mergeHead = commit(theirs.path);
  expect(await reason(s.mergeTeam(theirs.path, ours.path, mergeHead))).toBe("conflicts");
  return { s, ours: ours.path, head, mergeHead };
};
it("aborts only the expected active merge and restores its original head and file", async () => {
  const { s, ours, head, mergeHead } = await conflict();
  expect(await reason(s.abortMerge(ours, head, head, true))).toBe("stale_state");
  expect(await reason(s.abortMerge(ours, head, mergeHead, false))).toBe("confirmation_required");
  await run(s.abortMerge(ours, head, mergeHead, true));
  expect((await run(s.state(ours))).mergeHead).toBeNull();
  expect(git(ours, "rev-parse", "HEAD")).toBe(head);
  expect(await readFile(join(ours, "file.txt"), "utf8")).toBe("ours\n");
  expect(await reason(s.abortMerge(ours, head, mergeHead, true))).toBe("no_merge");
});
it("reopens a resolved file after reconstructing the service and restores all three real stages", async () => {
  const { s, ours, head, mergeHead } = await conflict();
  let selection = await run(s.conflict(ours, "file.txt"));
  selection = await run(s.choose(ours, selection, 0, "both"));
  await run(s.resolve(ours, selection));
  expect((await run(s.changes(ours))).items.every((f) => !f.conflict)).toBe(true);
  const next = service();
  const seen = (await run(next.resolvedConflicts(ours))).items[0]!;
  expect(seen).toMatchObject({ path: "file.txt", fingerprint: expect.any(String) });
  expect(await reason(next.reopen(ours, "file.txt", head, head, seen.fingerprint, true))).toBe("stale_state");
  expect(await reason(next.reopen(ours, "../file.txt", head, mergeHead, seen.fingerprint, true))).toBe("invalid_path");
  await run(next.reopen(ours, "file.txt", head, mergeHead, seen.fingerprint, true));
  expect((await run(next.conflict(ours, "file.txt")))).toMatchObject({ ours: "ours\n", base: "base\n", theirs: "theirs\n", choices: [null] });
  expect(git(ours, "ls-files", "--unmerged").split("\n")).toHaveLength(3);
  await run(next.abortMerge(ours, head, mergeHead, true));
  expect(await reason(next.reopen(ours, "file.txt", head, mergeHead, seen.fingerprint, true))).toBe("no_merge");
});
it("counts commits behind the parent independently of remote sync", async () => {
  const s = service(), child = await run(s.createWorktree(repo, "project"));
  await save(repo, "parent\n"); commit(repo);
  expect(await run(s.state(child.path, "main"))).toMatchObject({ behindParent: 1, behind: 0, pending: 0 });
});

const resolvedFixture = async () => {
  const f = await conflict();
  const selection = await run(f.s.conflict(f.ours, "file.txt"));
  await run(f.s.resolve(f.ours, await run(f.s.choose(f.ours, selection, 0, "both"))));
  return f;
};
it("review 4/11: refuses reopening when the last observed resolved contents were edited", async () => {
  const f = await resolvedFixture();
  const seen = (await run(f.s.resolvedConflicts(f.ours))).items[0] as any;
  await save(f.ours, "Keep my edit after resolution\n");
  expect(await reason((f.s.reopen as any)(f.ours, "file.txt", f.head, f.mergeHead, seen.fingerprint, true))).toBe("stale_state");
  expect(await readFile(join(f.ours, "file.txt"), "utf8")).toBe("Keep my edit after resolution\n");
  expect(git(f.ours, "ls-files", "--unmerged")).toBe("");
});
it("review 4: reopening requires explicit confirmation", async () => {
  const f = await resolvedFixture(), seen = (await run(f.s.resolvedConflicts(f.ours))).items[0] as any;
  expect(await reason((f.s.reopen as any)(f.ours, "file.txt", f.head, f.mergeHead, seen.fingerprint, false))).toBe("confirmation_required");
});
for (const kind of ["directory", "symlink", "nested"] as const) it(`review 5: skips a resolved ${kind} path while retaining safe resolved files`, async () => {
  await mkdir(join(repo, "nested")); await writeFile(join(repo, "nested", "bad.txt"), "base\n"); commit(repo);
  const s = service(), ours = (await run(s.createWorktree(repo, "ours"))).path, theirs = (await run(s.createWorktree(repo, "theirs"))).path;
  for (const folder of [ours, theirs]) {
    await save(folder, folder === ours ? "ours\n" : "theirs\n");
    await writeFile(join(folder, "nested", "bad.txt"), folder === ours ? "ours\n" : "theirs\n"); commit(folder);
  }
  expect(await reason(s.mergeTeam(theirs, ours, git(theirs, "rev-parse", "HEAD")))).toBe("conflicts");
  for (const path of ["file.txt", "nested/bad.txt"]) {
    const current = await run(s.conflict(ours, path)); await run(s.resolve(ours, await run(s.choose(ours, current, 0, "both"))));
  }
  if (kind === "nested") await mkdir(join(ours, "nested", ".git"));
  else { await rm(join(ours, "nested", "bad.txt")); if (kind === "directory") await mkdir(join(ours, "nested", "bad.txt")); else await symlink(join(ours, "file.txt"), join(ours, "nested", "bad.txt")); }
  const listed = (await run(s.resolvedConflicts(ours))).items as any[];
  expect(listed.map((row) => row.path)).toEqual(["file.txt"]);
});
it("review 7/11: abort reports a fixed refusal and preserves overlapping local edits and merge state", async () => {
  const f = await resolvedFixture();
  git(f.ours, "add", "--", "file.txt"); await save(f.ours, "local edit after staging\n");
  const before = git(f.ours, "ls-files", "--stage");
  const failed = await run(Effect.flip(f.s.abortMerge(f.ours, f.head, f.mergeHead, true)));
  expect(failed).toMatchObject({ reason: "abort_blocked" });
  expect(failed.uncertain).not.toBe(true);
  expect(await readFile(join(f.ours, "file.txt"), "utf8")).toBe("local edit after staging\n");
  expect(git(f.ours, "ls-files", "--stage")).toBe(before);
  expect((await run(f.s.state(f.ours))).mergeHead).toBe(f.mergeHead);
});
it("review 11: abort removes a file newly staged during the merge and restores the original index", async () => {
  const f = await conflict();
  await writeFile(join(f.ours, "new.txt"), "added during merge\n"); git(f.ours, "add", "--", "new.txt");
  await run(f.s.abortMerge(f.ours, f.head, f.mergeHead, true));
  expect(await readFile(join(f.ours, "new.txt"), "utf8").catch((e) => e.code)).toBe("ENOENT");
  expect(git(f.ours, "status", "--porcelain")).toBe("");
  expect(git(f.ours, "rev-parse", "HEAD")).toBe(f.head);
});
for (const [path, expected] of [["/tmp/file.txt", "invalid_path"], [".git/config", "invalid_path"], ["line\nbreak.txt", "invalid_path"], ["missing.txt", "unsupported_conflict"], ["-missing.txt", "unsupported_conflict"], ["link.txt", "invalid_path"]]) it(`review 10: safely refuses reopening ${JSON.stringify(path)}`, async () => {
  const f = await resolvedFixture(), seen = (await run(f.s.resolvedConflicts(f.ours))).items[0] as any;
  if (path === "link.txt") await symlink(join(f.ours, "file.txt"), join(f.ours, path!));
  expect(await reason((f.s.reopen as any)(f.ours, path, f.head, f.mergeHead, seen.fingerprint, true))).toBe(expected);
  expect(await readFile(join(f.ours, "file.txt"), "utf8")).toBe("ours\ntheirs\n");
});
it("review 10: a resolved leading-dash filename stays a literal path", async () => {
  git(repo, "mv", "--", "file.txt", "-file.txt"); commit(repo);
  const s = service(), ours = (await run(s.createWorktree(repo, "dash-ours"))).path, theirs = (await run(s.createWorktree(repo, "dash-theirs"))).path;
  for (const [folder, text] of [[ours, "ours\n"], [theirs, "theirs\n"]]) { await writeFile(join(folder!, "-file.txt"), text!); commit(folder!); }
  const head = git(ours, "rev-parse", "HEAD"), mergeHead = git(theirs, "rev-parse", "HEAD");
  expect(await reason(s.mergeTeam(theirs, ours, mergeHead))).toBe("conflicts");
  const c = await run(s.conflict(ours, "-file.txt")); await run(s.resolve(ours, await run(s.choose(ours, c, 0, "both"))));
  const seen = (await run(s.resolvedConflicts(ours))).items[0] as any;
  await run((s.reopen as any)(ours, "-file.txt", head, mergeHead, seen.fingerprint, true));
  expect((await run(s.conflict(ours, "-file.txt"))).choices).toEqual([null]);
});
