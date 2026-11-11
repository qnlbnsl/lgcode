import type { Change, CommitFile, GitViewState, Selection } from "./state.ts"
import { pathLabel } from "./state.ts"
import { visibleText } from "../thread/text.tsx"

export function ChangeGroup({ title, changes, side, view, disabled, select, toggle, stage, all, discard }: {
  readonly title: string; readonly changes: ReadonlyArray<Change | CommitFile>; readonly side: Selection["side"]; readonly view: GitViewState; readonly disabled: boolean
  readonly select: (selection: Selection) => void; readonly toggle: (folder: string) => void; readonly stage: (path: string, staged: boolean) => void
  readonly all?: () => void; readonly discard?: () => void
}) {
  const folders = Map.groupBy(changes, (change) => change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : ".")
  return <section className={`git-file-group${side === "conflict" ? " is-conflicts" : ""}`} aria-label={title}>
    <header className="git-group-head"><h3>{title}</h3><small className="git-count">{changes.length}</small>{all && <button disabled={disabled || !changes.length} onClick={all}>{side === "staged" ? "Unstage all" : "Stage all"}</button>}{discard && <button disabled={disabled || !changes.length} onClick={discard}>Discard</button>}</header>
    {[...folders].map(([folder, files]) => { const key = JSON.stringify([side, folder]), collapsed = view.collapsed.has(key)
      return <div key={folder}><button className="folder-row" data-source-folder={folder} aria-expanded={!collapsed} onClick={() => toggle(key)}><span aria-hidden="true">{collapsed ? "›" : "⌄"}</span>{pathLabel(folder)}</button>
        {!collapsed && files.map((file) => <div className="git-file-row" key={file.path}><button className="source-file" data-source-file={file.path} aria-current={view.selection?.path === file.path && view.selection.side === side ? "true" : undefined}
          title={pathLabel(file.path)} onClick={() => select({ path: file.path, side })}><span>{pathLabel(file.path.split("/").at(-1) ?? file.path)}</span><small className="file-status">{side === "conflict" ? "Conflict" : visibleText("status" in file ? file.status : side === "staged" ? file.index : file.worktree)}</small></button>
          {(side === "staged" || side === "working") && <button className="stage-file" data-stage-file={file.path} aria-label={`${side === "staged" ? "Unstage" : "Stage"} ${pathLabel(file.path)}`} disabled={disabled} onClick={() => stage(file.path, side === "staged")}>{side === "staged" ? "−" : "+"}</button>}
          {file.originalPath && <small className="git-rename">From {pathLabel(file.originalPath)}</small>}</div>)}
      </div>})}
  </section>
}
export function History({ view, toggle, select }: { readonly view: GitViewState; readonly toggle: () => void; readonly select: (head: string) => void }) {
  return <><button className="source-history-toggle" aria-expanded={view.historyOpen} onClick={toggle}>History</button>{view.historyOpen && <>{!view.data?.history && <p role="status">{view.error ? "History is unavailable. Refresh Git." : "Loading history…"}</p>}<ol className="source-history">{view.data?.history?.items.map((commit) => <li key={commit.head}><button data-source-commit={commit.head} aria-current={view.commit === commit.head ? "true" : undefined} onClick={() => select(commit.head)}><strong>{visibleText(commit.title)}</strong><small>{visibleText(commit.head.slice(0, 10))} · {visibleText(commit.author)} · {visibleText(commit.at)}</small></button></li>)}</ol>{view.data?.history?.truncated && <p role="note">Only the first 200 commits are available.</p>}</>}</>
}
