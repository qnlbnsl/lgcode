import { Fragment } from "react"
import { DataText, visibleText } from "../thread/text.tsx"
import { parseDiff, splitRows, type Diff, type DiffLine } from "./diff.ts"

function Cell({ line, side }: { readonly line: DiffLine | null; readonly side?: "old" | "next" }) {
  return <div className={`diff-line ${line?.kind ?? "filler"}`}>
    {side === undefined ? <><span className="line-one" data-phone-number={line?.kind === "removed" ? line.old : line?.next} aria-label="Old line">{line?.old}</span><span className="line-two" aria-label="New line">{line?.next}</span></> : <span className="line-one">{line?.[side]}</span>}
    <code>{line && visibleText(line.text)}{line?.noNewline && <small className="git-no-newline"> (No final newline)</small>}</code>
  </div>
}

export function DiffBody({ diff, mode = "unified" }: { readonly diff: Diff; readonly mode?: "split" | "unified" }) {
  const parsed = parseDiff(diff)
  if (!parsed.complete) return <div className="git-diff-fallback"><p role="note">{parsed.reason}</p><details><summary>Available patch text</summary><DataText text={diff.patch} /></details></div>
  if (!parsed.files.length) return <p className="git-empty">No text differences.</p>
  return <>{parsed.files.map((file, i) => <section className="diff-file" key={i}>
    <header className="diff-file-header"><code>{visibleText(file.header)}</code></header>
    {file.metadata.length > 0 && <details className="git-patch-metadata"><summary>File metadata</summary><DataText text={file.metadata.join("\n")} /></details>}
    <div className={mode === "split" ? "split-diff" : "unified-diff"}>
      {file.hunks.map((hunk, h) => <Fragment key={h}><div className="diff-hunk">{visibleText(hunk.header)}</div>
        {mode === "split" ? splitRows(hunk.lines).map(([left, right], n) => <Fragment key={n}><Cell line={left} side="old" /><Cell line={right} side="next" /></Fragment>)
          : hunk.lines.map((line, n) => <Cell key={n} line={line} />)}
      </Fragment>)}
    </div>
  </section>)}</>
}
