import { createZipArchiveSync, ZipEntry } from "node:zlib"
import { expect, it } from "vitest"
import { mockEditorFormatMatches } from "../../src/project/mockEditorFormat.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

registerRebuildCheck({ noLog: true })
const archive = (name: string, bytes: Buffer) => Buffer.concat([...createZipArchiveSync([ZipEntry.createSync(name, bytes)])])

it("accepts Pencil JSON and raw or archived Kiwi signatures only for their recorded kind", () => {
  const pen = Buffer.from(JSON.stringify({ version: "2.8", children: [], name: "<script>data</script> $(touch escaped)" }))
  const fig = Buffer.concat([Buffer.from("fig-kiwi"), Buffer.alloc(32)])
  for (const bytes of [fig, archive("canvas.fig", fig)]) {
    expect(mockEditorFormatMatches("mocks/layout.fig", bytes)).toBe(true)
    expect(mockEditorFormatMatches("mocks/layout.pen", bytes)).toBe(false)
  }
  expect(mockEditorFormatMatches("mocks/layout.pen", pen)).toBe(true)
  expect(mockEditorFormatMatches("mocks/layout.fig", pen)).toBe(false)
})

it("rejects generic ZIPs, malformed documents, high-bit magic impostors and oversized compressed members", () => {
  for (const bytes of [archive("index.html", Buffer.from("not a design")), archive("canvas.fig", Buffer.from("not Kiwi")),
    Buffer.from([0xe6, ...Buffer.from("ig-kiwi")]), archive("canvas.fig", Buffer.alloc(16 * 1024 * 1024 + 1))])
    expect(mockEditorFormatMatches("mocks/layout.fig", bytes)).toBe(false)
  for (const bytes of [Buffer.from("{}"), Buffer.from("[]"), Buffer.from('{"version":"2.8","children":{}}'), Buffer.from([0xff])])
    expect(mockEditorFormatMatches("mocks/layout.pen", bytes)).toBe(false)
})
