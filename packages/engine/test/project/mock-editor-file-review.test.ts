import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { fingerprint } from "../../src/project/artifacts.ts"
import { saveMockEditorFile } from "../../src/project/mockEditorFile.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

// These tests call only the filesystem boundary and never open an event log.
registerRebuildCheck({ noLog: true })
let root: string
beforeEach(() => { root = mkdtempSync("/tmp/lgtm-editor-file-review-"); mkdirSync(join(root, "mocks")) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

for (const mode of [0o640, 0o750, 0o1750]) it(`review item 7: preserves mode ${mode.toString(8)} during atomic replacement`, async () => {
  const file = join(root, "mocks/layout.pen"), original = Buffer.from("original design")
  writeFileSync(file, original); chmodSync(file, mode)
  await saveMockEditorFile(root, "mocks/layout.pen", fingerprint(original), Buffer.from("edited design"))
  expect(readFileSync(file, "utf8")).toBe("edited design")
  expect(statSync(file).mode & 0o7777).toBe(mode)
})

it("review item 10: rejects a symbolic link at the actual saver boundary without writing its target", async () => {
  const outside = join(root, "outside.pen"), original = Buffer.from("outside bytes")
  writeFileSync(outside, original)
  symlinkSync(outside, join(root, "mocks/layout.pen"))
  await expect(saveMockEditorFile(root, "mocks/layout.pen", fingerprint(original), Buffer.from("replacement"))).rejects.toThrow("mock editor file save failed")
  expect(readFileSync(outside)).toEqual(original)
  expect(statSync(outside).nlink).toBe(1)
})
