import { randomUUID } from "node:crypto"
import { type Event, type GitAttempt } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { CommandUncertain, freshRequest, refused, type Input, type PiecePlan, type PiecePlanner } from "./internal.ts"
import { callerKey } from "../identity/caller.ts"
import { checkObservedWorkspace, gitCall, withGit, workspacePath, workspaceReference } from "../project/gitApi.ts"
import { withLane } from "../routing/lanes.ts"
import { admitMainReview } from "../project/gitReview.ts"
import { own, projectKey, projectView } from "../project/view.ts"

// Only external mutations require durable attempts. Read-backed review/report
// planners still run outside the writer, without an invented mutation marker.
export const gitMutationCommand = (name: string) => !["project.review.prepare", "project.review.report"].includes(name)
export const gitUncertain = () => new CommandUncertain({ reason: "Git outcome is uncertain; refresh Git state" })

// A refresh owns the same workspace interval as a mutation, so it cannot finish
// an attempt whose Git child or outcome transaction is still running. Git is
// observed first; only then are original request lanes and the writer acquired.
export const refreshGitState = <A, E, R>(input: Input, raw: Record<string, unknown>, read: (current: Input) => Effect.Effect<A, E, R>) =>
  withLane(input.runtime.log, `git-operation:${String(raw.worktreeId)}`)(Effect.gen(function* () {
    const { runtime } = input
    const observed = { ...input, snapshot: yield* runtime.views.snapshot }
    const workspace = yield* workspaceReference(observed, raw)
    const reply = yield* read(observed)
    const attempts = Object.values(projectView(yield* runtime.views.snapshot).gitAttempts).filter((row) => row.worktreeId === workspace.worktreeId)
    for (const attempt of attempts) yield* withLane(runtime.log, JSON.stringify(["request", callerKey(attempt.caller), attempt.requestId]))(
      runtime.log.transact((append) => Effect.gen(function* () {
        const current = { ...input, snapshot: yield* runtime.views.snapshot }
        if (current.actor._tag !== "owner" && (current.actor._tag !== "agent"
          || current.snapshot.agents[current.actor.agentId] === undefined
          || ["stopped", "crashed"].includes(current.snapshot.agents[current.actor.agentId]!.state._tag))) return yield* refused()
        yield* workspaceReference(current, raw)
        yield* checkObservedWorkspace(observed, current, workspace, raw.projectId as string | undefined)
        const pending = own(projectView(current.snapshot).gitAttempts, projectKey(callerKey(attempt.caller), attempt.requestId))
        if (JSON.stringify(pending) !== JSON.stringify(attempt)) return
        // This is a terminal uncertainty receipt, not a mutation authorization,
        // refusal or success. Preserve the original caller/body reservation.
        yield* append(attempt.caller, attempt.requestId, attempt.bodyHash, [{ _tag: "project.GitFinished",
          caller: attempt.caller, operationRequestId: attempt.requestId, outcome: "uncertain" }], {})
      })))
    return reply
  }))

export const planGitOperation = (input: Input, name: string, payload: Record<string, unknown>, bodyHash: string, planner: PiecePlanner) => Effect.gen(function* () {
  const { runtime, actor } = input
  if (actor._tag !== "owner" && actor._tag !== "agent") return yield* refused()
  const key = projectKey(callerKey(actor), payload.requestId as string)
  const prior = own(projectView(input.snapshot).gitAttempts, key)
  if (prior !== undefined && (prior.bodyHash !== bodyHash || prior.command !== name)) return yield* refused("request id reused")
  // Only these operations currently have an exact positive reconciliation
  // proof. Absence of a changed local identity cannot prove a network/index
  // operation did not run, so those attempts remain pending without replay.
  if (prior !== undefined && !["project.commit", "project.review.approve"].includes(name)) return yield* gitUncertain()
  if (!gitMutationCommand(name)) return { plan: yield* planner(input, payload) }
  if (prior === undefined) {
    if (name === "project.review.approve") yield* admitMainReview(input, payload)
    const observed = yield* withGit(input, (git) => Effect.gen(function* () {
      const source = yield* workspacePath(input, payload, git)
      const before = yield* gitCall(git.mutationIdentity(source.path))
      const destination = payload.destinationId === undefined ? undefined : yield* workspacePath(input, { ...payload, worktreeId: payload.destinationId }, git)
      return { before, ...(destination === undefined ? {} : { destination: yield* gitCall(git.mutationIdentity(destination.path)) }) }
    }))
    const attempt: GitAttempt = { requestId: payload.requestId as GitAttempt["requestId"], bodyHash,
      caller: actor, command: name, worktreeId: payload.worktreeId as GitAttempt["worktreeId"], ...observed }
    if (Buffer.byteLength(JSON.stringify(attempt)) > 16 * 1024) return yield* refused("Git attempt metadata is unavailable")
    for (const value of [attempt.before.head, attempt.before.branch, attempt.before.tree, attempt.before.mergeHead,
      attempt.destination?.head, attempt.destination?.branch, attempt.destination?.tree, attempt.destination?.mergeHead]) {
      if (value != null && (yield* runtime.log.redactText(value)) !== value) return yield* refused("Git attempt metadata is unavailable")
    }
    // Release the Git gate before acquiring the writer for the durable attempt.
    yield* runtime.log.transact((append) => append(actor, freshRequest(), randomUUID(), [{ _tag: "project.GitAttempted", attempt }], {}, false))
  }
  const snapshot = yield* runtime.views.snapshot
  const planned = yield* planner({ ...input, snapshot, ...(prior === undefined ? {} : { gitRetry: true as const }) }, payload).pipe(Effect.result)
  const finished: Event = { _tag: "project.GitFinished", caller: actor, operationRequestId: payload.requestId as GitAttempt["requestId"] }
  if (planned._tag === "Failure") {
    // A prior possible effect outranks any later failed precondition. It must
    // never be converted into a refusal receipt after restart or disconnect.
    if (planned.failure._tag === "LogWriteFailed") return yield* planned.failure
    if (prior !== undefined || planned.failure instanceof CommandUncertain) return yield* gitUncertain()
    // This bounded enum records only fresh, determinate fixed Git outcomes.
    // Arbitrary refusal prose still takes the ordinary text redaction path.
    const refusal = (["conflicts", "push_rejected", "pull_diverged", "network_failed", "authentication_required"] as const)
      .find((code) => planned.failure.reason === `Git: ${code}`)
    return { failure: planned.failure, finished: { ...finished, ...(refusal === undefined ? {} : { refusal }) } }
  }
  if (prior !== undefined && planned.success.events.some((event) => event._tag === "project.MainReviewDecided" && event.review.outcome === "refused")) return yield* gitUncertain()
  const plan: PiecePlan = { ...planned.success, events: [...planned.success.events, finished] }
  return { plan }
})
