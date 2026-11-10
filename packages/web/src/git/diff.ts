import type { GitDiff } from "@lgcode/contracts"

export type Diff = typeof GitDiff.Type
export interface DiffLine { readonly kind: "context" | "added" | "removed"; readonly text: string; readonly old: number | null; readonly next: number | null; readonly noNewline?: boolean }
export interface DiffHunk { readonly header: string; readonly lines: ReadonlyArray<DiffLine> }
export interface DiffFile { readonly header: string; readonly metadata: ReadonlyArray<string>; readonly hunks: ReadonlyArray<DiffHunk> }
export type ParsedDiff = { readonly complete: true; readonly files: ReadonlyArray<DiffFile> } | { readonly complete: false; readonly reason: string }

// Coordinates come exclusively from the patch's hunk ranges. A partial or
// unsupported patch never becomes a complete-looking comparison.
export function parseDiff(diff: Diff): ParsedDiff {
  if (diff.binary) return { complete: false, reason: "Binary content cannot be displayed as a text comparison." }
  if (diff.truncated) return { complete: false, reason: "The Git comparison was truncated. Select a smaller file." }
  if (diff.patch.includes("\ufffd") || diff.patch.includes("\0")) return { complete: false, reason: "This comparison contains unsupported text encoding." }
  const rows = diff.patch.split("\n")
  if (rows.at(-1) === "") rows.pop()
  if (rows.length > 12000 || rows.some((row) => row.length > 16000)) return { complete: false, reason: "This comparison is too large to lay out. Select a smaller file." }
  const files: DiffFile[] = []
  let file: { header: string; metadata: string[]; hunks: DiffHunk[] } | undefined
  let hunk: { header: string; lines: DiffLine[] } | undefined
  let old = 0, next = 0, oldLeft = 0, nextLeft = 0
  const malformed = (): ParsedDiff => ({ complete: false, reason: "Git returned an unsupported or incomplete patch. Refresh the comparison." })
  for (const row of rows) {
    if (row.startsWith("diff --git ")) {
      if (oldLeft || nextLeft) return malformed()
      file = { header: row.slice(11), metadata: [], hunks: [] }; files.push(file); hunk = undefined
    } else if (row.startsWith("@@ ")) {
      if (!file || oldLeft || nextLeft) return malformed()
      const range = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(row)
      if (!range) return malformed()
      old = Number(range[1]); oldLeft = Number(range[2] ?? 1); next = Number(range[3]); nextLeft = Number(range[4] ?? 1)
      if (![old, oldLeft, next, nextLeft, old + oldLeft, next + nextLeft].every(Number.isSafeInteger) || old === 0 && oldLeft !== 0 || next === 0 && nextLeft !== 0) return malformed()
      hunk = { header: row, lines: [] }; file.hunks.push(hunk)
    } else if (row === "\\ No newline at end of file") {
      const previous = hunk?.lines.at(-1)
      if (!hunk || !previous || previous.noNewline) return malformed()
      hunk.lines[hunk.lines.length - 1] = { ...previous, noNewline: true }
    } else if (hunk && (oldLeft > 0 || nextLeft > 0)) {
      const kind = row[0] === " " ? "context" : row[0] === "+" ? "added" : row[0] === "-" ? "removed" : undefined
      if (!kind) return malformed()
      const consumesOld = kind !== "added", consumesNew = kind !== "removed"
      if (consumesOld && oldLeft <= 0 || consumesNew && nextLeft <= 0) return malformed()
      hunk.lines.push({ kind, text: row.slice(1), old: consumesOld ? old++ : null, next: consumesNew ? next++ : null })
      if (consumesOld) oldLeft--
      if (consumesNew) nextLeft--
    } else if (file && !hunk && /^(?:index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/.test(row)) {
      file.metadata.push(row)
    } else return malformed()
  }
  if (oldLeft || nextLeft || diff.patch !== "" && !files.length) return malformed()
  return { complete: true, files }
}

export function splitRows(lines: ReadonlyArray<DiffLine>): ReadonlyArray<readonly [DiffLine | null, DiffLine | null]> {
  const rows: Array<readonly [DiffLine | null, DiffLine | null]> = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!
    if (line.kind === "context") { rows.push([line, line]); i++; continue }
    const removed: DiffLine[] = [], added: DiffLine[] = []
    while (lines[i]?.kind === "removed") removed.push(lines[i++]!)
    while (lines[i]?.kind === "added") added.push(lines[i++]!)
    for (let j = 0; j < Math.max(removed.length, added.length); j++) rows.push([removed[j] ?? null, added[j] ?? null])
  }
  return rows
}
