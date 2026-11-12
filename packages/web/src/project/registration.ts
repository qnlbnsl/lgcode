import type { Client } from "@lgtm/client/browser"
import type { Repository } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../thread/client.ts"

type Add = Parameters<Client["project.repository.add"]>[0]
type Locate = Parameters<Client["project.repository.locate"]>[0]
type Attempt = { readonly kind: "add"; readonly payload: Add } | { readonly kind: "locate"; readonly payload: Locate }
interface RegistrationState {
  readonly open: boolean; readonly name: string; readonly path: string; readonly busy: boolean
  readonly phase: "editing" | "uncertain" | "refused" | "registered"
  readonly repository?: Repository | undefined; readonly result?: Repository | undefined
  readonly attempt?: Attempt | undefined; readonly message: string
}
const initial = (): RegistrationState => ({ open: false, name: "", path: "", busy: false, phase: "editing", message: "" })

// These exact public reasons arise before an add/locate plan writes its
// registration events. A generic CommandError also carries storage failures;
// its tag alone cannot release the frozen request (issue 573).
const admissionRefusals = new Set([
  "set the workspace folder before using Git", "workspace settings changed; refresh and retry",
  "only the local machine can register a checkout before machine pairing", "a path cannot contain a registered secret",
  "an existing local Git checkout root with a named branch is required", "repository is already registered",
  "repository not found", "checkout belongs to a different repository", "name is invalid after redaction",
  "Git: invalid_path", "Git: not_repository",
])
const failureKind = (error: { readonly _tag: string }) => error._tag === "CommandError" && "reason" in error
  && typeof error.reason === "string" && admissionRefusals.has(error.reason) ? "refused" as const : "uncertain" as const

const readRepository = (client: Client, repoId: Repository["repoId"]) => Effect.gen(function* () {
  const start = yield* client["client.sequence"]({ requestId: requestId() })
  let after: string | undefined
  const cursors = new Set<string>()
  for (;;) {
    const page = yield* client["project.repositories"]({ requestId: requestId(), ...(after === undefined ? {} : { after }) })
    const row = page.items.find((item) => item.repoId === repoId)
    if (row !== undefined) {
      const end = yield* client["client.sequence"]({ requestId: requestId() })
      if (end.sequence !== start.sequence) return yield* Effect.fail(new Error("Repository state changed"))
      return row
    }
    if (page.next === undefined) return yield* Effect.fail(new Error("Registered repository unavailable"))
    if (page.items.length === 0 || cursors.has(page.next)) return yield* Effect.fail(new Error("Repository cursor did not advance"))
    cursors.add(page.next); after = page.next
  }
})

// One instance belongs to the owner session, beside NewProjectSession. It is
// disposed with that session, so navigation cannot lose an uncertain receipt.
export class RepositoryRegistration {
  private state = initial()
  private listeners = new Set<() => void>()
  private operation: AbortController | undefined
  private alive = true
  private readonly onSessionExpired: () => void
  private readonly run: typeof withClient
  constructor(onSessionExpired: () => void, run: typeof withClient = withClient) {
    this.onSessionExpired = onSessionExpired; this.run = run
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(change: Partial<RegistrationState>) {
    if (!this.alive) return
    this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener()
  }
  open = (options?: { readonly repository?: Repository; readonly path?: string }) => {
    if (!this.alive) return
    // Never replace a frozen operation when another screen opens the form.
    if (this.state.attempt !== undefined) { this.publish({ open: true }); return }
    this.publish({ open: true, repository: options?.repository, name: options?.repository?.name ?? this.state.name,
      path: options?.path ?? options?.repository?.path ?? this.state.path, phase: "editing", result: undefined, message: "" })
  }
  close = () => this.publish({ open: false })
  update = (change: { readonly name?: string; readonly path?: string }) => {
    if (!this.state.busy && this.state.attempt === undefined) this.publish({ ...change, phase: "editing", message: "" })
  }
  dispose = () => {
    this.operation?.abort(); this.operation = undefined; this.state = initial(); this.alive = false
    for (const listener of this.listeners) listener(); this.listeners.clear()
  }
  private async sessionExpired(signal: AbortSignal) {
    try {
      const response = await fetch("/api/session", { method: "POST", credentials: "same-origin", cache: "no-store", signal })
      if (!signal.aborted && this.alive && response.status === 401) { this.dispose(); this.onSessionExpired(); return true }
    } catch { /* Unavailable transport does not establish logout. */ }
    return signal.aborted || !this.alive
  }
  async submit() {
    if (!this.alive || this.operation !== undefined) return
    const existing = this.state.repository
    const attempt = this.state.attempt ?? (existing === undefined
      ? { kind: "add" as const, payload: { requestId: requestId(), name: this.state.name, path: this.state.path, machineId: "local" } }
      : { kind: "locate" as const, payload: { requestId: requestId(), repoId: existing.repoId, path: this.state.path, machineId: "local" } })
    if (!this.state.name.trim() || !this.state.path.trim()) return
    const controller = new AbortController(); this.operation = controller
    this.publish({ busy: true, attempt, message: "" })
    try {
      const result = await this.run((client) => Effect.gen(function* () {
        if (attempt.kind === "add") {
          const reply = yield* client["project.repository.add"](attempt.payload).pipe(Effect.result)
          if (reply._tag === "Failure") return { kind: failureKind(reply.failure) }
          return { kind: "registered" as const, repository: yield* readRepository(client, reply.success.repoId) }
        }
        const reply = yield* client["project.repository.locate"](attempt.payload).pipe(Effect.result)
        if (reply._tag === "Failure") return { kind: failureKind(reply.failure) }
        return { kind: "registered" as const, repository: yield* readRepository(client, attempt.payload.repoId) }
      }), controller.signal)
      if (controller.signal.aborted || !this.alive) return
      if (result.kind !== "registered" && await this.sessionExpired(controller.signal)) return
      if (result.kind === "registered") this.publish({ phase: "registered", attempt: undefined, result: result.repository, message: "Repository registration confirmed." })
      else if (result.kind === "refused") this.publish({ phase: "refused", attempt: undefined, message: "Registration refused. Check the existing Git checkout and its repository identity, then correct the form." })
      else this.publish({ phase: "uncertain", message: "Registration is unconfirmed. Check the same request to recover its receipt." })
    } catch {
      if (controller.signal.aborted || !this.alive) return
      this.publish({ phase: "uncertain", message: "Registration is unconfirmed. Check the same request to recover its receipt." })
      await this.sessionExpired(controller.signal)
    } finally {
      if (!controller.signal.aborted && this.alive) { this.operation = undefined; this.publish({ busy: false }) }
    }
  }
}
