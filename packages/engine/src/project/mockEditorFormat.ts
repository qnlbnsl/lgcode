import { extname } from "node:path"
import { ZipBuffer } from "node:zlib"

const magic = Buffer.from("fig-kiwi")
const kiwi = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, magic.length)).equals(magic)
// Check signatures without extracting archive paths or claiming to validate
// the whole document. Node 26 bounds and verifies the canvas member's content.
export const mockEditorFormatMatches = (file: string, bytes: Buffer): boolean => {
  try {
    if (extname(file).toLowerCase() === ".fig") {
      if (kiwi(bytes)) return true
      const archive = new ZipBuffer(bytes)
      if (archive.size > 256 || !archive.has("canvas.fig")) return false
      const canvas = archive.get("canvas.fig")
      return canvas.isFile && kiwi(canvas.contentSync({ maxSize: 16 * 1024 * 1024 }))
    }
    if (extname(file).toLowerCase() !== ".pen") return false
    const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    return document !== null && typeof document === "object" && !Array.isArray(document)
      && typeof document.version === "string" && document.version.length > 0 && Array.isArray(document.children)
  } catch { return false }
}
