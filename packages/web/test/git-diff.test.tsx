import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { parseDiff, splitRows, type Diff } from "../src/git/diff.ts"

const folders: string[] = []
afterEach(() => { for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }) })
function actualPatch(before: string, after: string) {
  const folder = mkdtempSync(join(tmpdir(), "lgcode-web-diff-")); folders.push(folder)
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: folder, encoding: "utf8" })
  git("init", "-q"); writeFileSync(join(folder, "source.txt"), before); git("add", "--", "source.txt"); git("commit", "-qm", "Initial")
  writeFileSync(join(folder, "source.txt"), after)
  const patch = git("diff", "--no-color", "--no-ext-diff", "--no-textconv", "--", "source.txt")
  return { patch, additions: 0, deletions: 0, binary: false, truncated: false } satisfies Diff
}
it("uses actual Git coordinates and aligns unequal removal/addition blocks with fillers", () => {
  const parsed = parseDiff(actualPatch("one\ntwo\nthree\nfour\n", "one\nreplacement\nfour\n"))
  expect(parsed.complete).toBe(true); if (!parsed.complete) return
  const lines = parsed.files[0]!.hunks[0]!.lines
  expect(lines.map((line) => [line.kind, line.old, line.next])).toEqual([["context",1,1],["removed",2,null],["removed",3,null],["added",null,2],["context",4,3]])
  const paired = splitRows(lines)
  expect(paired[1]!.map((line) => line?.text)).toEqual(["two", "replacement"])
  expect(paired[2]).toEqual([expect.objectContaining({ text: "three" }), null])
})
it("preserves no-final-newline and literal markup in real Git output", () => {
  const parsed = parseDiff(actualPatch("old", "<script>literal()</script>\tvalue"))
  expect(parsed.complete).toBe(true); if (!parsed.complete) return
  expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
    expect.objectContaining({ text: "old", noNewline: true, old: 1, next: null }),
    expect.objectContaining({ text: "<script>literal()</script>\tvalue", noNewline: true, old: null, next: 1 })
  ])
})
it.each(["@@ -1,2 +1 @@\n-old\n+new\n", "@@@ -1 +1 @@@\n-old\n+new\n", "@@ -1 +1 @@\n?old\n+new\n", "@@ -1 +1 @@\n-old\n+new\nextra\n"])("refuses incomplete or unsupported hunks: %s", (hunk) => {
  expect(parseDiff({ patch: `diff --git a/f b/f\n--- a/f\n+++ b/f\n${hunk}`, additions: 1, deletions: 1, binary: false, truncated: false }).complete).toBe(false)
})
it.each(["binary", "truncated"] as const)("labels %s comparisons incomplete", (kind) => {
  expect(parseDiff({ ...actualPatch("old\n", "new\n"), [kind]: true })).toEqual({ complete: false, reason: expect.any(String) })
})
it("keeps rename-only metadata and zero-length ranges honest", () => {
  expect(parseDiff({ patch: "diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n", additions: 0, deletions: 0, binary: false, truncated: false })).toMatchObject({ complete: true, files: [{ hunks: [] }] })
  const parsed = parseDiff({ patch: "diff --git a/f b/f\n--- /dev/null\n+++ b/f\n@@ -0,0 +1,2 @@\n+first\n+second\n", additions: 2, deletions: 0, binary: false, truncated: false })
  expect(parsed).toMatchObject({ complete: true, files: [{ hunks: [{ lines: [{ old: null, next: 1 }, { old: null, next: 2 }] }] }] })
})
