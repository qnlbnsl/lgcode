import type { GitChange, GitCommit, GitCommitFile, GitConflict, GitDiff, GitDiscardPlan, GitMainReview, GitReview, GitState, GitEvidenceSet, RepositoryId, WorkspaceId } from "@lgtm/contracts"
import type { Client } from "@lgtm/client/browser"
import type * as EffectType from "effect/Effect"
import * as Effect from "effect/Effect"
import { withClient } from "../thread/client.ts"
import { visibleText } from "../thread/text.tsx"

export type Change = typeof GitChange.Type
export type Commit = typeof GitCommit.Type
export type CommitFile = typeof GitCommitFile.Type
export type Conflict = typeof GitConflict.Type
export type Diff = typeof GitDiff.Type
export type DiscardPlan = typeof GitDiscardPlan.Type
export type State = typeof GitState.Type
export type Review = typeof GitReview.Type
export interface Collection<A> { readonly items: ReadonlyArray<A>; readonly truncated: boolean }
export interface Selection { readonly path: string; readonly side: "staged" | "working" | "conflict" | "commit" }
export interface WorkingData {
  readonly changes: Collection<Change>; readonly state: State; readonly history?: Collection<Commit>
  readonly target?: { readonly changes: Collection<Change>; readonly state: State }
  readonly evidence?: { readonly review: GitMainReview | null; readonly evidence: GitEvidenceSet }
}
export interface GitViewState {
  readonly selection?: Selection | undefined; readonly workingSelection?: Selection | undefined; readonly commitSelections: ReadonlyMap<string, Selection>; readonly commit?: string | undefined; readonly historyOpen: boolean; readonly collapsed: ReadonlySet<string>
  readonly mode: "unified" | "split"; readonly scope: "all" | "file"; readonly message: string
  readonly folded?: boolean; readonly width: number; readonly notice: string; readonly error: string
  readonly prepared?: { readonly review: GitMainReview; readonly comparison: Review } | undefined; readonly discardPlan?: DiscardPlan | undefined;
  /** Received display data only. It never establishes working readiness. */
  readonly receivedSync?: Pick<State, "ahead" | "behind" | "upstream"> | undefined
  readonly data?: WorkingData; readonly ready: boolean; readonly detailsReady: boolean; readonly refreshing: boolean; readonly revision: number
}
interface ReviewAcknowledgment {
  readonly notice: string
  readonly preparedFrom: { readonly data: WorkingData; readonly revision: number }
}
const initial = (): GitViewState => ({ historyOpen: false, collapsed: new Set(), commitSelections: new Map(), mode: "unified", scope: "file", message: "", width: 280, notice: "", error: "", ready: false, detailsReady: false, refreshing: false, revision: 0 })
export const workspaceKey = (repoId: RepositoryId, machine: string, id: WorkspaceId) => JSON.stringify([repoId, machine, id])
export const pathLabel = (path: string) => visibleText(path).replace(/[\r\n\t]/g, (character) => character === "\n" ? "\\n" : character === "\r" ? "\\r" : "\\t")
export const readResult = <A,>(reply: { readonly result: A } | { readonly data: string }): A => {
  if ("result" in reply) return reply.result
  throw new Error("Owner Git reply was unavailable")
}

const reasons: Record<string, string> = {
  invalid_path: "Git refused this path. Its literal name remains in the list.", not_repository: "The registered checkout is no longer a Git repository.",
  invalid_ref: "This Git reference is unavailable. Refresh the worktree.", output_limit: "The result exceeds Git's read limit. Select a smaller file.",
  timeout: "Git timed out. Inspect the refreshed state before another operation.", cancelled: "Git was cancelled. Inspect the refreshed state.",
  git_unavailable: "Git is unavailable on this machine.", git_failed: "Git could not complete the operation.", busy: "Another Git operation holds the checkout. Retry after it finishes.",
  collision: "The requested Git name already exists.", dirty_destination: "The destination has uncommitted changes or an unfinished merge. Inspect it before integrating.",
  dirty_source: "Commit or discard the source changes and finish its merge before integrating.", conflicts: "Git has conflicts. Inspect the destination and resolve its files.",
  confirmation_required: "Explicit confirmation is required.", stale_state: "The reviewed state changed. Refresh and make a new selection or review.",
  nothing_staged: "Stage a file before committing.", invalid_message: "Enter a nonempty commit message within the message limit.",
  missing_remote: "This repository has no origin remote.", missing_upstream: "This branch has no upstream. Push it before pulling.",
  authentication_required: "Git requires authentication on the host machine.", network_failed: "Git could not reach its remote.", push_rejected: "The remote rejected the push. Fetch and inspect the branch.",
  pull_diverged: "The branches diverged. A fast-forward pull is unavailable.", base_requires_review: "Main and master require the explicit owner review.",
  unsupported_conflict: "This conflict cannot be resolved here. Binary, deleted, oversized and unsupported conflict states remain unchanged.",
  incomplete_choices: "Choose a result for every conflict hunk.", owner_required: "Only the authenticated owner can approve this review.",
  unsupported_review: "This comparison is binary or incomplete. It cannot become an approvable review."
}
export const gitReason = (reason: string) => reasons[reason.replace(/^Git: /, "")] ?? "Git refused the operation. Refresh the registered worktree and prepare a new attempt."
// Accepted Git planners turn possible effects into the exact uncertainty
// response. Their fixed Git refusals are determinate, including conflicts.
// A generic CommandError or database failure still proves no outcome.
const admissionRefusals = new Set([
  "recovering", "invalid credential", "request id reused",
  "Git: confirmation_required", "Git: invalid_message", "Git: nothing_staged",
  "Git: incomplete_choices", "Git: owner_required", "Git: stale_state",
])
const uncertain = "The acknowledgment is unconfirmed. Refresh Git and inspect the current state before making a new choice."
const terminalUncertainty = "Git state refreshed. This does not establish whether the earlier request succeeded or was refused. Inspect the current state before making a new choice."
export const safeFailure = (failure: unknown): { readonly known: boolean; readonly kind: "known" | "git-uncertain" | "unconfirmed"; readonly message: string } => {
  if (typeof failure === "object" && failure !== null && "_tag" in failure && failure._tag === "CommandError") {
    const reason = "reason" in failure && typeof failure.reason === "string" ? failure.reason : ""
    if (reason === "Git outcome is uncertain; refresh Git state") return { known: false, kind: "git-uncertain", message: "Git reports an uncertain outcome. Refresh Git and inspect the current state. This request will not run again." }
    if (admissionRefusals.has(reason) || reason.startsWith("Git: ") && Object.hasOwn(reasons, reason.slice(5))) return { known: true, kind: "known", message: reason.startsWith("Git: ") ? gitReason(reason) : "The engine refused admission. Refresh after the connection recovers." }
    const message = reason.startsWith("database ") ? "The database could not acknowledge the request. A write failure requires a normal service restart before recovery."
      : Object.hasOwn(reasons, reason.replace(/^Git: /, "")) ? gitReason(reason) : ""
    return { known: false, kind: "unconfirmed", message: `${message ? `${message} ` : ""}${uncertain}` }
  }
  return { known: false, kind: "unconfirmed", message: uncertain }
}
// Read failures never establish an operation's outcome. In the accepted
// engine a successful state read may record terminal uncertainty, not success.
export const safeReadFailure = (failure: unknown): string => {
  const reason = typeof failure === "object" && failure !== null && "_tag" in failure && failure._tag === "CommandError"
    && "reason" in failure && typeof failure.reason === "string" ? failure.reason : ""
  const detail = reason.startsWith("Git: ") && Object.hasOwn(reasons, reason.slice(5)) ? gitReason(reason) : ""
  return `The Git read failed.${detail ? ` ${detail}` : ""} Check the connection, then refresh to read the current state.`
}
export interface Attempt { readonly key: string; readonly label: string; readonly status: "pending" | "uncertain" | "terminal"; readonly failure?: "git-uncertain" | "unconfirmed" }

// Owned by the authenticated shell lifetime. There is no browser storage and
// no transport here: every call uses the existing scoped authenticated client.
export function createGitSession() {
  const entries = new Map<string, GitViewState>(), listeners = new Set<() => void>()
  let version = 0
  let closed = false, disabled = true, action: AbortController | undefined
  // Retain the original closure/body identity through uncertainty. There is
  // deliberately no replay entry point; a later explicit choice gets a new ID.
  let attempt: (Attempt & { readonly operation: (client: Client) => EffectType.Effect<unknown, unknown> }) | undefined
  const notify = () => { version++; if (!closed) for (const listener of listeners) listener() }
  const get = (key: string) => { let entry = entries.get(key); if (!entry) { entry = initial(); entries.set(key, entry) } return entry }
  const update = (key: string, change: Partial<GitViewState> | ((value: GitViewState) => Partial<GitViewState>)) => {
    if (closed) return
    const entry = get(key); entries.set(key, { ...entry, ...(typeof change === "function" ? change(entry) : change) }); notify()
  }
  const session = {
    get, update,
    version: () => version,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setMutationDisabled(value: boolean) { disabled = value },
    get attempt(): Attempt | undefined { return attempt },
    refreshed(key: string, expected: Attempt | undefined) {
      if (closed || !expected || expected !== attempt || expected.key !== key || expected.status !== "uncertain") return
      attempt = { ...attempt!, status: "terminal" }
      update(key, { error: terminalUncertainty })
    },
    async execute<A>(key: string, label: string, operation: (client: Client) => EffectType.Effect<A, unknown>, acknowledged: (value: A) => string | ReviewAcknowledgment,
      onSessionExpired: () => void): Promise<void> {
      if (closed || disabled || action || attempt && attempt.status !== "terminal") return
      const controller = new AbortController(); action = controller
      attempt = { key, label, status: "pending", operation }; update(key, { error: "", notice: "" }); notify()
      try {
        const result = await withClient((client) => Effect.result(operation(client)), controller.signal)
        if (closed || controller.signal.aborted) return
        if (result._tag === "Success") {
          attempt = undefined
          const acknowledgment = acknowledged(result.success)
          update(key, (entry) => {
            // Only a validated, read-only preparation can retain the exact
            // coherent generation from which it was requested.
            if (typeof acknowledgment !== "string" && entry.ready && entry.detailsReady
              && entry.data === acknowledgment.preparedFrom.data && entry.revision === acknowledgment.preparedFrom.revision) return { notice: acknowledgment.notice }
            return { notice: typeof acknowledgment === "string" ? acknowledgment : acknowledgment.notice,
              ready: false, detailsReady: false, revision: entry.revision + 1 }
          })
        } else {
          const failure = safeFailure(result.failure)
          if (failure.known) attempt = undefined
          else attempt = { key, label, status: "uncertain", operation, failure: failure.kind === "git-uncertain" ? "git-uncertain" : "unconfirmed" }
          update(key, (entry) => ({ error: failure.message, ready: false, detailsReady: false, revision: entry.revision + 1 }))
          await probeSession(controller.signal, onSessionExpired)
        }
      } catch {
        if (!closed && !controller.signal.aborted) {
          attempt = { key, label, status: "uncertain", operation, failure: "unconfirmed" }
          update(key, (entry) => ({ error: uncertain, ready: false, detailsReady: false, revision: entry.revision + 1 }))
          await probeSession(controller.signal, onSessionExpired)
        }
      } finally { if (action === controller) action = undefined; notify() }
    },
    close() { closed = true; disabled = true; action?.abort(); action = undefined; attempt = undefined; entries.clear(); listeners.clear() }
  }
  return session
}
export type GitSession = ReturnType<typeof createGitSession>
export async function probeSession(signal: AbortSignal, expired: () => void) {
  try { const response = await fetch("/api/session", { method: "POST", credentials: "same-origin", cache: "no-store", signal }); if (!signal.aborted && response.status === 401) expired() } catch { /* The fixed connection state remains visible. */ }
}
