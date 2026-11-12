import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { Project, Repository, Team, Workspace, WorkspaceId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../thread/client.ts"
import { visibleText } from "../thread/text.tsx"
import { ChangeGroup, History } from "./ChangesPane.tsx"
import { ConflictPane } from "./ConflictPane.tsx"
import { DiffBody } from "./DiffPane.tsx"
import { GitDialog } from "./Dialog.tsx"
import { Evidence, ReviewDialog } from "./ReviewDialog.tsx"
import { WorktreeNavigation } from "./WorktreeNavigation.tsx"
import { gitReason, pathLabel, probeSession, readResult, safeReadFailure, workspaceKey, type GitSession, type Selection } from "./state.ts"
import { useDiff, useWorkingReads } from "./useGitReads.ts"
import type { ConnectionState } from "../watchSituation.ts"
import "./git.css"

export interface GitPageProps {
  readonly repository: Repository
  readonly projects: ReadonlyArray<Project>
  readonly teams: ReadonlyArray<Team>
  readonly workspaces: ReadonlyArray<Workspace>
  readonly assignedWorkspaceId: WorkspaceId
  readonly inspectedWorkspaceId: WorkspaceId
  readonly onInspect: (id: WorkspaceId) => void
  /** Pass the existing shared mutation authority's disabled value directly. */
  readonly mutationDisabled: boolean
  readonly connection: ConnectionState | "Offline"
  readonly onSessionExpired: () => void
  /** Create once per authenticated shell lifetime; close on logout/expiry. */
  readonly session: GitSession
}

export function gitDestination(workspace: Workspace, props: Pick<GitPageProps, "repository" | "projects" | "teams" | "workspaces">): Workspace | undefined {
  const team = props.teams.find((row) => row.worktreeId === workspace.worktreeId)
  const project = props.projects.find((row) => team ? row.projectId === team.projectId : row.worktreeId === workspace.worktreeId)
  if (!project || project.repoId !== workspace.repoId || project.archiving || project.archivedAt !== undefined) return undefined
  const destination = props.workspaces.find((row) => team ? row.worktreeId === project.worktreeId && workspace.parentId === row.worktreeId
    : row.checkout === "main" && row.path === props.repository.path && ["main", "master"].includes(row.branch))
  return destination && destination.worktreeId !== workspace.worktreeId && destination.repoId === workspace.repoId && destination.machineId === workspace.machineId ? destination : undefined
}

export function GitPage(props: GitPageProps) {
  const inspected = props.workspaces.find((row) => row.worktreeId === props.inspectedWorkspaceId && row.repoId === props.repository.repoId)
  const assigned = props.workspaces.find((row) => row.worktreeId === props.assignedWorkspaceId && row.repoId === props.repository.repoId)
  if (!inspected || !assigned) return <section aria-label="Git"><p role="alert">The registered worktree is unavailable in this repository.</p></section>
  return <GitWorkspace key={workspaceKey(inspected.repoId, inspected.machineId, inspected.worktreeId)} {...props} workspace={inspected} assigned={assigned} />
}

function GitWorkspace(props: GitPageProps & { readonly workspace: Workspace; readonly assigned: Workspace }) {
  const { session, workspace, onSessionExpired } = props
  const key = workspaceKey(workspace.repoId, workspace.machineId, workspace.worktreeId)
  useSyncExternalStore(session.subscribe, session.version, session.version)
  const view = session.get(key)
  const destination = gitDestination(workspace, props)
  const project = props.projects.find((row) => row.worktreeId === workspace.worktreeId)
  const team = props.teams.find((row) => row.worktreeId === workspace.worktreeId)
  const mainTarget = destination !== undefined && ["main", "master"].includes(destination.branch)
  const binding = JSON.stringify([workspace, project, destination])
  const currentBinding = useRef(binding); currentBinding.current = binding
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  session.setMutationDisabled(props.mutationDisabled)
  useWorkingReads(session, key, workspace, project?.projectId, destination, view.revision, view.historyOpen, props.connection, onSessionExpired)
  const loaded = useDiff(workspace, view.selection, view.commit, view.scope, view.revision, view.ready, onSessionExpired)
  useEffect(() => {
    if (!view.commit || !loaded?.files || !loaded.files.items.length || view.selection && loaded.files.items.some((file) => file.path === view.selection?.path)) return
    const selection: Selection = { path: loaded.files.items[0]!.path, side: "commit" }
    session.update(key, (previous) => ({ selection, commitSelections: new Map(previous.commitSelections).set(view.commit!, selection) }))
  }, [session, key, view.commit, view.selection, loaded?.files])
  const host = useRef<HTMLElement>(null), diffHost = useRef<HTMLElement>(null), toolbar = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(0), [viewport, setViewport] = useState(() => window.innerWidth)
  const [dialog, setDialog] = useState<"discard" | "review">()
  const [planning, setPlanning] = useState(false)
  const planController = useRef<AbortController | undefined>(undefined)
  const resize = useRef<{ pointer: number; x: number; width: number } | undefined>(undefined)
  useEffect(() => () => planController.current?.abort(), [])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && !session.get(key).refreshing) session.update(key, (previous) => ({ ready: false, revision: previous.revision + 1 })) }
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh)
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh) }
  }, [session, key])
  useEffect(() => {
    const measure = () => { setWidth(host.current?.clientWidth ?? 0); setViewport(window.innerWidth); host.current?.style.setProperty("--git-toolbar-height", `${toolbar.current?.clientHeight ?? 0}px`) }
    measure(); window.addEventListener("resize", measure)
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
    if (host.current) observer?.observe(host.current)
    if (toolbar.current) observer?.observe(toolbar.current)
    return () => { window.removeEventListener("resize", measure); observer?.disconnect() }
  }, [])
  const folded = view.folded ?? viewport < 1600
  const maxWidth = Math.max(240, Math.min(480, width - (folded ? 40 : 240) - 360))
  const paneWidth = Math.max(240, Math.min(maxWidth, view.width))
  const needsRoom = view.mode === "split" && viewport > 900 && width - paneWidth - (folded ? 40 : 240) - 6 < 900
  const split = view.mode === "split" && viewport > 900 && width - paneWidth - 6 >= 900
  const hideTree = split && needsRoom
  useEffect(() => { host.current?.style.setProperty("--git-changes-width", `${paneWidth}px`) }, [paneWidth])
  const attempt = session.attempt?.status === "terminal" ? undefined : session.attempt
  const disabled = props.mutationDisabled || !view.ready || !!attempt || planning || workspace.machineId !== "local" || !!view.commit
  const changes = view.data?.changes
  const syncState = view.receivedSync ?? view.data?.state
  const staged = changes?.items.filter((row) => row.staged && !row.conflict) ?? []
  const unstaged = changes?.items.filter((row) => row.unstaged && !row.conflict) ?? []
  const conflicts = changes?.items.filter((row) => row.conflict) ?? []
  const commitReason = view.commit ? "Older commits are read-only. Return to working changes."
    : props.mutationDisabled ? "Commits wait for the connection."
    : !view.ready ? "Refresh Git before committing."
    : attempt ? "Wait for the current request's acknowledgment."
    : workspace.machineId !== "local" ? "Git on this machine is awaiting machine support."
    : conflicts.length ? "Resolve the conflicts first."
    : changes?.truncated ? "The change list is incomplete. Reduce the changes before committing."
    : !staged.length && !view.data?.state.mergeHead && !view.message.trim() ? "Add a message and stage a file."
    : !staged.length && !view.data?.state.mergeHead ? "Stage a file to commit."
    : !view.message.trim() ? "Add a message to commit." : ""
  const targetDirty = view.data?.target?.changes.truncated || view.data?.target?.changes.items.length || view.data?.target?.state.mergeHead
  const staleReview = !!view.prepared && !!view.data && (view.data.state.head !== view.prepared.review.head || view.detailsReady && view.data.target?.state.head !== view.prepared.review.baseHead)
  const integrationReason = disabled ? view.commit ? "Older commits are read-only." : "Integration waits for current Git state and the connection."
    : !destination ? "This checkout has no registered integration target."
    : conflicts.length ? "Resolve the conflicted files first."
    : changes?.truncated ? "The change list is incomplete."
    : changes?.items.length || view.data?.state.mergeHead ? "Commit or discard the source changes first."
    : !view.detailsReady ? "Integration waits for a fresh destination and review."
    : targetDirty ? "The destination has uncommitted changes or an unfinished merge."
    : !view.data?.target ? "Refresh the destination before integrating."
    : view.data.state.behind > 0 ? "Pull the incoming commits before integrating."
    : view.data.state.pending === 0 ? "No commits to integrate." : ""
  const refresh = () => session.update(key, (previous) => ({ ready: false, revision: previous.revision + 1 }))
  const select = (selection: Selection) => {
    session.update(key, (previous) => ({ selection, ...(previous.commit ? { commitSelections: new Map(previous.commitSelections).set(previous.commit, selection) } : { workingSelection: selection }) }))
    if (viewport <= 700) requestAnimationFrame(() => { diffHost.current?.scrollIntoView?.({ block: "start" }); diffHost.current?.focus({ preventScroll: true }) })
  }
  const stage = (path: string, unstage: boolean) => {
    if (disabled) return
    const payload = { requestId: requestId(), worktreeId: workspace.worktreeId, path }
    void session.execute(key, unstage ? "Unstage file" : "Stage file", (client) => unstage ? client["project.unstage"](payload) : client["project.stage"](payload), () => unstage ? "File unstaged." : "File staged.", onSessionExpired)
  }
  const all = (unstage: boolean) => {
    if (disabled || changes?.truncated) return
    const payload = { requestId: requestId(), worktreeId: workspace.worktreeId }
    void session.execute(key, unstage ? "Unstage all" : "Stage all", (client) => unstage ? client["project.unstage.all"](payload) : client["project.stage.all"](payload), () => unstage ? "All available files unstaged." : "All available nonconflicting files staged.", onSessionExpired)
  }
  const sync = (tag: "project.fetch" | "project.pull" | "project.push") => {
    if (disabled) return
    const payload = { requestId: requestId(), worktreeId: workspace.worktreeId }
    void session.execute(key, tag.slice(8), (client) => client[tag](payload), () => `${tag.slice(8)} completed.`, onSessionExpired)
  }
  const planDiscard = () => {
    if (disabled || planController.current || changes?.truncated) return
    const controller = new AbortController(); planController.current = controller; setPlanning(true)
    void withClient((client) => client["project.discard.plan"]({ requestId: requestId(), worktreeId: workspace.worktreeId }).pipe(Effect.result), controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (result._tag === "Success") { session.update(key, { discardPlan: result.success.result }); setDialog("discard") }
        else { session.update(key, { error: safeReadFailure(result.failure) }); void probeSession(controller.signal, onSessionExpired) }
      }).catch(() => { if (!controller.signal.aborted) { session.update(key, { error: "Could not prepare a discard plan. The files are unchanged." }); void probeSession(controller.signal, onSessionExpired) } })
      .finally(() => { if (!controller.signal.aborted) { planController.current = undefined; setPlanning(false) } })
  }
  const discard = () => {
    if (disabled || !view.discardPlan) return
    const payload = { requestId: requestId(), worktreeId: workspace.worktreeId, plan: view.discardPlan, confirmed: true }
    void session.execute(key, "Discard changes", (client) => client["project.discard"](payload), () => { session.update(key, { discardPlan: undefined }); return `Discarded ${payload.plan.paths.length} changes.` }, onSessionExpired)
    setDialog(undefined)
  }
  const prepare = () => {
    if (disabled || !view.detailsReady || !project || !destination || !mainTarget) return
    const observed = view.data, target = observed?.target, revision = view.revision
    if (!observed || !target) return
    const payload = { requestId: requestId(), worktreeId: workspace.worktreeId, projectId: project.projectId, destinationId: destination.worktreeId }
    void session.execute(key, "Prepare owner review", (client) => client["project.review.prepare"](payload), (reply) => {
      const current = session.get(key), { review, comparison } = reply.result
      // Preparation records a comparison but does not mutate Git. Retain the
      // working generation only while all returned identities still bind to it.
      const matches = mounted.current && currentBinding.current === binding && current.ready && current.detailsReady && !current.commit
        && current.revision === revision && current.data === observed
        && !observed.changes.truncated && !observed.changes.items.length && observed.state.mergeHead === null
        && !target.changes.truncated && !target.changes.items.length && target.state.mergeHead === null
        && review.reviewId === payload.requestId && review.projectId === payload.projectId
        && review.worktreeId === payload.worktreeId && review.destinationId === payload.destinationId
        && review.head === observed.state.head && review.baseHead === target.state.head
        && review.branch === workspace.branch && review.branch === observed.state.branch
        && review.base === destination.branch && review.base === target.state.branch && review.outcome === "open"
        && comparison.head === review.head && comparison.baseHead === review.baseHead
        && comparison.branch === review.branch && comparison.base === review.base
        && !comparison.commits.truncated && !comparison.files.truncated && !comparison.diff.truncated && !comparison.diff.binary
      if (!matches) {
        session.update(key, { prepared: undefined })
        return "Review response no longer matches this workspace. Refresh Git and prepare a new review."
      }
      session.update(key, { prepared: reply.result })
      return { notice: "Review prepared for the exact source and destination heads.", preparedFrom: { data: observed, revision } }
    }, onSessionExpired)
  }
  const integrate = () => {
    if (integrationReason || !destination || !view.data?.state.head) return
    if (mainTarget) { setDialog("review"); prepare(); return }
    const payload = { requestId: requestId(), worktreeId: workspace.worktreeId, destinationId: destination.worktreeId, expectedHead: view.data.state.head }
    void session.execute(key, "Integrate into project", (client) => client["project.integrate"](payload), (reply) => `Merged into ${pathLabel(destination.branch)} at ${reply.result.head}.`, onSessionExpired)
  }
  const approve = (decision: "approve" | "approve_without_evidence") => {
    if (disabled || !view.detailsReady || staleReview || !project || !view.prepared || view.prepared.review.outcome !== "open") return
    const review = view.prepared.review, comparison = view.prepared.comparison
    const payload = { requestId: requestId(), worktreeId: workspace.worktreeId, projectId: project.projectId, reviewId: review.reviewId, expectedHead: review.head, expectedBaseHead: review.baseHead, confirmed: true, decision }
    void session.execute(key, "Approve reviewed heads", (client) => client["project.review.approve"](payload), (reply) => {
      session.update(key, { prepared: { review: reply.result, comparison } })
      return reply.result.outcome === "merged" ? `Merged into ${pathLabel(review.base)} at ${reply.result.mergeHead}.` : `Merge refused. ${gitReason(reply.result.reason ?? "")}`
    }, onSessionExpired)
  }
  const resizeTo = (value: number) => session.update(key, { width: Math.max(240, Math.min(maxWidth, value)) })
  return <section ref={host} className={`git-workspace${folded ? " rail" : ""}${hideTree ? " split-wide" : ""}`} aria-label="Git">
    <WorktreeNavigation {...props} inspected={workspace.worktreeId} assigned={props.assigned.worktreeId} folded={folded} revision={view.revision}
      deferReads={workspace.machineId === "local" && !view.ready} toggle={() => session.update(key, { folded: !folded })} />
    <section className="git-changes" aria-label="Changes and history"><header className="git-pane-head"><h2>{visibleText(team?.name ?? project?.name ?? "Main checkout")}</h2>
      <p className="git-inspecting">Inspecting <code>{visibleText(workspace.branch)}</code> · {visibleText(workspace.machineId)}{workspace.worktreeId !== props.assigned.worktreeId && <> · Assigned: <code>{visibleText(props.assigned.branch)}</code></>}</p>
      <div className="git-sync">{([['project.fetch', 'Fetch'], ['project.pull', 'Pull'], ['project.push', 'Push']] as const).map(([tag, label]) => <button key={tag} disabled={disabled} onClick={() => sync(tag)}>{label}</button>)}
        <p id="git-sync-state">{syncState ? `${syncState.behind} incoming · ${syncState.ahead} outgoing${syncState.upstream === null ? " · No upstream" : ""}` : "Sync state unavailable"}</p>
        {syncState && <small id="git-sync-received">{view.receivedSync ? "Received Git state" : "Last coherent Git state"}{!view.ready && " · working refresh pending"}</small>}</div>
      <button disabled={view.refreshing} onClick={refresh}>{view.refreshing ? "Refreshing…" : "Refresh Git"}</button>
      {view.notice && <p id="git-notice" role="status">{view.notice}</p>}{view.error && <p role="alert">{view.error}</p>}
      {attempt && <p role="status">{attempt.label}: {attempt.status === "pending" ? "Waiting for acknowledgment…" : "Outcome unconfirmed. Refresh Git and inspect the current state."}</p>}
    </header><div className="git-pane-body">
      <form id="git-commit-form" onSubmit={(event) => {
        event.preventDefault(); if (disabled || commitReason) return
        const message = view.message, payload = { requestId: requestId(), worktreeId: workspace.worktreeId, message }
        void session.execute(key, "Commit", (client) => client["project.commit"](payload), (reply) => {
          session.update(key, (current) => ({ ...(current.message === message ? { message: "" } : {}), historyOpen: true })); return `Committed ${reply.result.head}.`
        }, onSessionExpired)
      }}><label htmlFor="git-message">Commit message</label><textarea id="git-message" rows={2} placeholder="Describe these changes" maxLength={8192} disabled={!!view.commit} value={view.message} onChange={(event) => session.update(key, { message: event.target.value })} />
        <button type="submit" id="git-commit" disabled={disabled || !!commitReason} aria-describedby="git-commit-reason">Commit{staged.length ? ` ${staged.length} ${staged.length === 1 ? "file" : "files"}` : ""}</button><p id="git-commit-reason">{commitReason}</p></form>
      {view.commit ? <><p>Commit <code>{visibleText(view.commit)}</code> · Read-only</p><button onClick={() => session.update(key, { commit: undefined, selection: view.workingSelection })}>Back to changes</button>
        {loaded?.files && <ChangeGroup title="Committed changes" changes={loaded.files.items} side="commit" view={view} disabled select={select} stage={stage} toggle={(folder) => session.update(key, (previous) => { const collapsed = new Set(previous.collapsed); collapsed.has(folder) ? collapsed.delete(folder) : collapsed.add(folder); return { collapsed } })} />}
        {loaded?.files?.truncated && <p role="note">This commit's file list is incomplete.</p>}
      </> : <>{!changes && <p role="status">Loading registered Git changes…</p>}{changes?.truncated && <p role="note">The change list is incomplete. Bulk actions and commits are unavailable.</p>}
        {([['Conflicts', conflicts, 'conflict'], ['Staged changes', staged, 'staged'], ['Changes', unstaged, 'working']] as const).map(([title, files, side]) => side === "conflict" && !files.length ? null : <ChangeGroup key={side} title={title} changes={files} side={side} view={view} disabled={disabled || !!changes?.truncated} select={select} stage={stage}
          toggle={(folder) => session.update(key, (previous) => { const collapsed = new Set(previous.collapsed); collapsed.has(folder) ? collapsed.delete(folder) : collapsed.add(folder); return { collapsed } })}
          {...(side === "conflict" ? {} : { all: () => all(side === "staged") })} {...(side === "working" ? { discard: planDiscard } : {})} />)}
        {changes && !changes.truncated && !changes.items.length && <p>{view.ready ? "No uncommitted changes" : "No changes in the last received state"}</p>}
      </>}
      {view.data?.evidence && <details className="git-current-evidence"><summary>Reported evidence for this branch head</summary><Evidence evidence={view.data.evidence.evidence} /></details>}
      <History view={view} toggle={() => session.update(key, { historyOpen: !view.historyOpen })} select={(commit) => session.update(key, { commit, selection: view.commitSelections.get(commit), ...(!view.commit ? { workingSelection: view.selection } : {}) })} />
    </div><footer className="git-integration" id="git-integration"><h3>{mainTarget ? `Integrate into ${visibleText(destination.branch)}` : "Integrate into project"}</h3>
      {destination && <p><code>{visibleText(workspace.branch)}</code> → <code>{visibleText(destination.branch)}</code></p>}
      <p className="integration-state">{integrationReason || `${view.data?.state.pending} commits ready`}</p>
      {conflicts.map((file) => <button className="inline-link" key={file.path} onClick={() => select({ path: file.path, side: "conflict" })}>Resolve {pathLabel(file.path)}</button>)}
      {destination && targetDirty ? <button onClick={() => props.onInspect(destination.worktreeId)}>Inspect destination</button> : null}
      <button id="git-integrate" disabled={!!integrationReason} onClick={integrate}>{mainTarget ? `Review merge to ${visibleText(destination.branch)}` : "Merge into project"}</button>
      {mainTarget && view.prepared && <button onClick={() => setDialog("review")}>Inspect recorded review</button>}
    </footer></section>
    <div id="git-resize" className="git-resize" role="separator" tabIndex={0} aria-label="Resize the commit pane" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={maxWidth} aria-valuenow={paneWidth}
      onDoubleClick={() => resizeTo(280)} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); resizeTo(event.key === "Home" ? 280 : event.key === "End" ? maxWidth : paneWidth + (event.key === "ArrowRight" ? 16 : -16)) }}
      onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); resize.current = { pointer: event.pointerId, x: event.clientX, width: paneWidth }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={(event) => { if (resize.current?.pointer === event.pointerId) resizeTo(resize.current.width + event.clientX - resize.current.x) }} onPointerUp={() => { resize.current = undefined }} onPointerCancel={() => { resize.current = undefined }} onLostPointerCapture={() => { resize.current = undefined }} />
    <section ref={diffHost} className="diff-content" tabIndex={-1} aria-label="Git comparison"><header ref={toolbar} className="diff-toolbar"><div role="group" aria-label="Diff scope">{([['all', 'All files'], ['file', 'This file']] as const).map(([scope, label]) => <button key={scope} aria-pressed={view.scope === scope} onClick={() => session.update(key, { scope })}>{label}</button>)}</div>
      <div role="group" aria-label="Diff mode">{([['unified', 'Unified'], ['split', 'Split']] as const).map(([mode, label]) => <button key={mode} aria-pressed={view.mode === mode} onClick={() => session.update(key, { mode })}>{label}</button>)}</div>
      <p id="diff-context">{visibleText(workspace.branch)}{view.commit && <> · Commit {visibleText(view.commit)}</>}</p><p id="diff-path">{view.scope === "all" ? "All files" : view.selection ? pathLabel(view.selection.path) : view.commit ? "Commit changes" : "Select a changed file"}</p>
      {view.mode === "split" && <p id="split-note">{!split ? "Split comparison needs a wider window. Showing unified." : hideTree ? "Split comparison hides the worktree list to make room." : "Both sides scroll together."}</p>}
    </header>
      {!view.commit && view.selection?.side === "conflict" ? <ConflictPane key={view.selection.path} workspace={workspace} path={view.selection.path} session={session} entryKey={key} disabled={disabled} revision={view.revision} onSessionExpired={onSessionExpired} />
        : loaded?.error ? <p role="alert">{loaded.error}</p> : loaded?.diff ? <DiffBody diff={loaded.diff} mode={split ? "split" : "unified"} /> : <p role="status">{view.selection || view.commit ? "Loading comparison…" : "Select a file to inspect its changes."}</p>}
    </section>
    {dialog === "discard" && view.discardPlan && <GitDialog title={`Discard ${view.discardPlan.paths.length} changes?`} close={() => setDialog(undefined)}><p>This removes only the unstaged changes in the exact confirmed plan. Staged content is kept.</p><ul>{view.discardPlan.paths.map((path) => <li key={path}>{pathLabel(path)}</li>)}</ul><footer><button disabled={disabled} onClick={discard}>Confirm discard</button><button onClick={() => setDialog(undefined)}>Cancel</button></footer></GitDialog>}
    {dialog === "review" && destination && <ReviewDialog source={workspace} destination={destination} {...(view.prepared ? { prepared: view.prepared } : {})} pending={!!attempt} disabled={props.mutationDisabled || !view.ready || !view.detailsReady || !!view.commit} stale={staleReview} error={view.error} close={() => setDialog(undefined)} prepare={prepare} approve={approve} />}
  </section>
}
