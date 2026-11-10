// Exact 71 untracked inputs from the unchanged original layout case.
// This helper is used only by the explicit direct probe, outside discovery.
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const inputSha256 = "5f456447c4357a1f57eacdcb6f620798f093ec9e2a639de4244c6d275b667d6e"
const names = [...Array.from({ length: 70 }, (_, n) => `src/file-${n}.txt`), "tab\tname.txt"].sort()
const save = (folder: string, name: string, text: string) => writeFileSync(join(folder, name), text)
export function prepareAggregateInput(f: { source: { path: string } }) {
    mkdirSync(join(f.source.path, "src")); for (let n = 0; n < 70; n++) save(f.source.path, `src/file-${n}.txt`, Array.from({ length: 10 }, (_, i) => `row ${i} ${"long literal <script>data</script> ".repeat(n === 0 && i === 0 ? 200 : 2)}`).join("\n") + "\n")
    save(f.source.path, "tab\tname.txt", "tabbed file\n")
}
export function aggregateInput(folder: string) {
  const files = names.map((path) => {
    const bytes = readFileSync(join(folder, path))
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
  })
  return { files, sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") }
}
