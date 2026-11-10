import { useEffect, useRef, useState } from "react"
import type { Project, Repository, Team, Workspace, WorkspaceId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../thread/client.ts"
import { visibleText } from "../thread/text.tsx"
import { probeSession, readResult, workspaceKey, type GitSession } from "./state.ts"

export function WorktreeNavigation({ repository, projects, teams, workspaces, inspected, assigned, onInspect, onSessionExpired, session, folded, toggle, revision }: {
  readonly repository: Repository; readonly projects: ReadonlyArray<Project>; readonly teams: ReadonlyArray<Team>; readonly workspaces: ReadonlyArray<Workspace>
  readonly inspected: WorkspaceId; readonly assigned: WorkspaceId; readonly onInspect: (id: WorkspaceId) => void; readonly session: GitSession; readonly folded: boolean; readonly revision: number; readonly toggle: () => void
  readonly onSessionExpired: () => void
}) {
  const rows = workspaces.filter((row) => row.repoId === repository.repoId)
  const key = rows.map((row) => JSON.stringify([row.worktreeId, row.machineId])).join(":")
  const [counts, setCounts] = useState<ReadonlyMap<WorkspaceId, string>>(new Map())
  const expired = useRef(onSessionExpired); expired.current = onSessionExpired
  useEffect(() => {
    const controller = new AbortController()
    const candidates = rows.filter((row) => row.machineId === "local" && row.worktreeId !== inspected).slice(0, 32)
    setCounts(new Map(candidates.map((row) => [row.worktreeId, "Checking changes…"])))
    // Counts are actual reads, including for unvisited rows. An unavailable or
    // bounded result is labeled, never rendered as a clean checkout.
    void withClient((client) => Effect.gen(function* () {
      for (const workspace of candidates) {
        const result = yield* client["project.changes"]({ requestId: requestId(), worktreeId: workspace.worktreeId }).pipe(Effect.result)
        if (controller.signal.aborted) return
        const record = (text: string) => setCounts((previous) => new Map(previous).set(workspace.worktreeId, text))
        if (result._tag === "Success") {
          const changes = readResult(result.success)
          const conflicts = changes.items.filter((change) => change.conflict).length
          record(changes.truncated ? "Partial change list" : conflicts ? `${conflicts} conflict${conflicts === 1 ? "" : "s"}` : `${changes.items.length} changes`)
        } else { setCounts(new Map(candidates.map((row) => [row.worktreeId, "Unavailable"]))); yield* Effect.promise(() => probeSession(controller.signal, expired.current)); return }
      }
    }), controller.signal).catch(() => { if (!controller.signal.aborted) { setCounts(new Map(candidates.map((row) => [row.worktreeId, "Unavailable"]))); void probeSession(controller.signal, expired.current) } })
    return () => controller.abort()
  }, [key, inspected, revision])
  const label = (row: Workspace) => row.checkout === "main" ? "Main checkout" : teams.find((team) => team.worktreeId === row.worktreeId)?.name
    ?? projects.find((project) => project.worktreeId === row.worktreeId)?.name ?? row.branch
  const ordered: Workspace[] = []
  const visit = (row: Workspace) => { if (ordered.includes(row)) return; ordered.push(row); for (const child of rows.filter((candidate) => candidate.parentId === row.worktreeId)) visit(child) }
  rows.filter((row) => row.checkout === "main").forEach(visit); rows.filter((row) => row.checkout !== "main" && !row.teamId).forEach(visit); rows.forEach(visit)
  return <nav className={`worktree-navigation${folded ? " is-rail" : ""}`} aria-label="Repository worktrees"><header className="worktree-head"><h2>Worktrees</h2>
    <button id="worktree-fold" onClick={toggle} aria-expanded={!folded} aria-label={folded ? "Show the worktree list" : "Fold the worktree list"}>{folded ? "›" : "‹"}</button></header>
    <div className="worktree-rows">{ordered.map((row) => {
      const data = session.get(workspaceKey(repository.repoId, row.machineId, row.worktreeId)).data
      const changes = data?.changes
      const conflicts = changes?.items.filter((change) => change.conflict).length
      const status = row.machineId !== "local" ? "Machine Git unavailable" : !changes ? counts.get(row.worktreeId) ?? "Inspect for changes" : changes.truncated ? "Partial change list" : conflicts ? `${conflicts} conflicts` : `${changes.items.length} changes`
      return <button key={row.worktreeId} className={`worktree-row${row.teamId ? " depth-1" : ""}${conflicts ? " has-conflict" : ""}`} data-git-worktree={row.worktreeId}
        aria-current={row.worktreeId === inspected ? "true" : undefined} aria-label={`${visibleText(label(row))}, ${visibleText(row.branch)}, ${status}`} title={`${visibleText(label(row))} · ${visibleText(row.branch)} · ${visibleText(row.machineId)}`}
        onClick={() => onInspect(row.worktreeId)}><span className="git-branch-mark" aria-hidden="true">⑂</span><span className="wt-text"><span className="wt-line"><strong>{visibleText(label(row))}</strong>
          <small className="wt-status">{status}</small></span>
          <span className="wt-line"><code>{visibleText(row.teamId ? `…/${row.branch.split("/").at(-1)}` : row.branch)}</code><small>{visibleText(row.machineId)}{assigned === row.worktreeId ? " · Assigned" : ""}</small></span></span></button>
    })}</div></nav>
}
