import { useEffect, useMemo, useRef, useState } from "react"
import type { ProjectId, Workspace } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../thread/client.ts"
import type { ConnectionState } from "../watchSituation.ts"
import { probeSession, readResult, safeReadFailure, type Collection, type CommitFile, type Diff, type GitSession, type Selection } from "./state.ts"

export function useWorkingReads(session: GitSession, key: string, workspace: Workspace, projectId: ProjectId | undefined, destination: Workspace | undefined,
  revision: number, historyOpen: boolean, connection: ConnectionState | "Offline", expired: () => void) {
  const onExpired = useRef(expired); onExpired.current = expired
  const identity = JSON.stringify([workspace, destination, projectId])
  const generation = useMemo(() => ({}), [identity, revision, historyOpen, connection])
  const latest = useRef(generation); latest.current = generation
  useEffect(() => {
    const controller = new AbortController()
    const current = () => !controller.signal.aborted && latest.current === generation && session.get(key).revision === revision
    const attempt = session.attempt
    let published = false
    if (connection !== "Live") {
      session.update(key, { ready: false, detailsReady: false, refreshing: false, receivedSync: undefined })
      return () => controller.abort()
    }
    if (workspace.machineId !== "local") { session.update(key, { ready: false, refreshing: false, error: "Git on this machine is awaiting machine support." }); return }
    session.update(key, { refreshing: true, ready: false, detailsReady: false, receivedSync: undefined })
    void withClient((client) => Effect.gen(function* () {
      const scope = { worktreeId: workspace.worktreeId }
      const state = readResult(yield* client["project.git.state"]({ requestId: requestId(), ...scope, ...(destination ? { target: destination.branch } : {}) }))
      yield* Effect.sync(() => {
        if (current()) session.update(key, { receivedSync: { ahead: state.ahead, behind: state.behind, upstream: state.upstream } })
      })
      const changes = readResult(yield* client["project.changes"]({ requestId: requestId(), ...scope }))
      const final = readResult(yield* client["project.git.state"]({ requestId: requestId(), ...scope }))
      if (state.head !== final.head || state.branch !== final.branch || state.mergeHead !== final.mergeHead) {
        yield* Effect.sync(() => { if (current()) session.update(key, { receivedSync: undefined }) })
        return yield* Effect.fail({ _tag: "CommandError", reason: "Git: stale_state" })
      }
      // Source mutations need this coherent working view, not history or
      // destination metadata. Only these actual successful reads can retire
      // this generation's original unconfirmed attempt.
      const data = { state, changes }
      yield* Effect.sync(() => {
        if (!current()) return
        published = true
        session.update(key, (previous) => {
          const available: Selection[] = changes.items.flatMap((change): Selection[] => change.conflict ? [{ path: change.path, side: "conflict" }]
            : [...(change.staged ? [{ path: change.path, side: "staged" as const }] : []), ...(change.unstaged ? [{ path: change.path, side: "working" as const }] : [])])
          const selection = previous.commit ? previous.selection : available.find((item) => item.path === previous.selection?.path && item.side === previous.selection.side) ?? available[0]
          return { data, ready: true, refreshing: false, selection, ...(!previous.commit ? { workingSelection: selection } : {}) }
        })
        if (!changes.truncated) session.refreshed(key, attempt)
      })
      // History is read when opened. An uncommitted or conflicted source
      // cannot integrate, so its comparison does not queue destination reads.
      const history = historyOpen ? readResult(yield* client["project.history"]({ requestId: requestId(), ...scope, limit: 200 })) : undefined
      if (history) yield* Effect.sync(() => { if (current()) session.update(key, { data: { ...data, history } }) })
      if (changes.truncated || changes.items.length || state.mergeHead || !destination) return
      const target = destination === undefined ? undefined : {
        state: readResult(yield* client["project.git.state"]({ requestId: requestId(), worktreeId: destination.worktreeId })),
        changes: readResult(yield* client["project.changes"]({ requestId: requestId(), worktreeId: destination.worktreeId }))
      }
      const evidence = projectId === undefined ? undefined : readResult(yield* client["project.review.status"]({ requestId: requestId(), worktreeId: workspace.worktreeId, projectId }))
      const finalSource = readResult(yield* client["project.git.state"]({ requestId: requestId(), ...scope }))
      if (state.head !== finalSource.head || state.branch !== finalSource.branch || state.mergeHead !== finalSource.mergeHead) {
        yield* Effect.sync(() => { if (current()) session.update(key, { ready: false, receivedSync: undefined }) })
        return yield* Effect.fail({ _tag: "CommandError", reason: "Git: stale_state" })
      }
      yield* Effect.sync(() => { if (current()) session.update(key, { detailsReady: true,
        data: { ...data, ...(history ? { history } : {}), ...(target ? { target } : {}), ...(evidence ? { evidence } : {}) } }) })
    }).pipe(Effect.result), controller.signal).then((result) => {
      if (!current()) return
      if (result._tag === "Failure") {
        session.update(key, (previous) => ({ ...(!published ? { ready: false } : {}), detailsReady: false, refreshing: false,
          error: `${previous.error ? `${previous.error} ` : ""}${safeReadFailure(result.failure)}` }))
        void probeSession(controller.signal, onExpired.current); return
      }
    }).catch(() => {
      if (current()) { session.update(key, (previous) => ({ ...(!published ? { ready: false } : {}), detailsReady: false, refreshing: false, error: `${previous.error ? `${previous.error} ` : ""}Could not refresh Git. The last received state remains visible.` })); void probeSession(controller.signal, onExpired.current) }
    })
    return () => controller.abort()
  // Shared projection completeness still disables mutations through the Shell.
  // Only an actual connection transition restarts this read for recovery.
  }, [session, key, identity, revision, historyOpen, connection, generation])
}

export interface LoadedDiff { readonly identity: string; readonly files?: Collection<CommitFile>; readonly diff?: Diff; readonly error?: string }
export function useDiff(workspace: Workspace, selection: Selection | undefined, commit: string | undefined, scope: "file" | "all", revision: number, ready: boolean, expired: () => void) {
  const [loaded, setLoaded] = useState<LoadedDiff & { readonly generation: object }>()
  const path = scope === "file" ? selection?.path : undefined
  const side = scope === "file" ? selection?.side : undefined
  const identity = JSON.stringify([workspace, path, side, commit, scope, revision])
  const generation = useMemo(() => ({}), [identity, ready])
  const onExpired = useRef(expired); onExpired.current = expired
  useEffect(() => {
    if (!ready) return
    if (!commit && scope === "file" && (!selection || selection.side === "conflict")) return
    const controller = new AbortController()
    void withClient((client) => Effect.gen(function* () {
      const files = commit ? readResult(yield* client["project.commit.files"]({ requestId: requestId(), worktreeId: workspace.worktreeId, commit })) : undefined
      const path = scope === "file" ? selection?.path ?? files?.items[0]?.path : undefined
      const diff = readResult(yield* client["project.diff"]({ requestId: requestId(), worktreeId: workspace.worktreeId,
        ...(path === undefined ? {} : { path }), ...(commit ? { commit } : scope === "file" ? { staged: selection?.side === "staged" } : {}) }))
      return { diff, ...(files ? { files } : {}) }
    }).pipe(Effect.result), controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setLoaded(result._tag === "Success" ? { identity, generation, ...result.success } : { identity, generation, error: safeReadFailure(result.failure) })
      if (result._tag === "Failure") void probeSession(controller.signal, onExpired.current)
    }).catch(() => { if (!controller.signal.aborted) { setLoaded({ identity, generation, error: "Could not read this comparison." }); void probeSession(controller.signal, onExpired.current) } })
    return () => controller.abort()
  }, [identity, ready, generation])
  return ready && loaded?.generation === generation ? loaded : undefined
}
