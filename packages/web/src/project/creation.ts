import type { Client } from "@lgcode/client/browser"
import type { Discovery, Project, ProjectCreation, ProjectSettings, Repository } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../thread/client.ts"

export type CreateProjectPayload = Parameters<Client["project.create"]>[0]
type Placement = Effect.Success<ReturnType<Client["project.placement.preview"]>>["result"]
export interface ProjectDraft {
  readonly name: string
  readonly goal: string
  readonly machineId: string
  readonly repository: CreateProjectPayload["repository"] | undefined
}
export interface CreationState {
  readonly draft: ProjectDraft
  readonly open: boolean
  readonly origin: string
  readonly detour: boolean
  readonly loading: boolean
  readonly loaded: boolean
  readonly repositories: ReadonlyArray<Repository>
  readonly pending: ReadonlyArray<ProjectCreation>
  readonly settings?: ProjectSettings | undefined
  readonly discovery?: typeof Discovery.Type | undefined
  readonly preview?: Placement | undefined
  readonly previewReason?: string | undefined
  readonly previewState: "empty" | "loading" | "ready" | "unavailable"
  readonly phase: "editing" | "creating" | "uncertain" | "refused" | "created"
  readonly busy: boolean
  readonly message: string
  readonly attempt?: CreateProjectPayload | undefined
  readonly project?: Project | undefined
}
const initial = (): CreationState => ({ draft: { name: "", goal: "", machineId: "local", repository: undefined },
  open: false, origin: "/#/", detour: false, loading: false, loaded: false, repositories: [], pending: [],
  previewState: "empty", phase: "editing", busy: false, message: "" })
// Public CommandError also wraps transport-adjacent database failures. Only
// these explicit admission refusals, plus absence of a durable intent, permit
// correction. A generic refusal cannot establish that Create did not commit.
const correctable = new Set(["project name already exists in this repository", "name is invalid after redaction",
  "only the confirmed local machine can start a project", "configure the workspace folder before creating a project",
  "no ready signed-in lead account is available", "invalid lead defaults", "repository location not found",
  "repository is unavailable", "main repository checkout is required",
  "check out main or master in the main repository checkout before creating a project",
  "a path cannot contain a registered secret"])

// These are the real paged RPC replies. No partial page establishes absence.
export const readCreations = (client: Client) => Effect.gen(function* () {
  const rows: ProjectCreation[] = [], cursors = new Set<string>()
  let after: string | undefined
  for (;;) {
    const page = yield* client["project.creations"]({ requestId: requestId(), limit: 200, ...(after === undefined ? {} : { after }) })
    rows.push(...page.items)
    if (page.next === undefined) return rows
    if (!page.items.length || cursors.has(page.next)) return yield* Effect.fail(new Error("Creation cursor did not advance"))
    cursors.add(page.next); after = page.next
  }
})
const readRepositories = (client: Client) => Effect.gen(function* () {
  const rows: Repository[] = [], cursors = new Set<string>()
  let after: string | undefined
  for (;;) {
    const page = yield* client["project.repositories"]({ requestId: requestId(), limit: 200, ...(after === undefined ? {} : { after }) })
    rows.push(...page.items)
    if (page.next === undefined) return rows
    if (!page.items.length || cursors.has(page.next)) return yield* Effect.fail(new Error("Repository cursor did not advance"))
    cursors.add(page.next); after = page.next
  }
})
const readProject = (client: Client, projectId: Project["projectId"]) => Effect.gen(function* () {
  const rows: Project[] = [], cursors = new Set<string>()
  let after: string | undefined
  for (;;) {
    const page = yield* client["project.read"]({ requestId: requestId(), projectId, collection: "projects", limit: 200,
      ...(after === undefined ? {} : { after }) })
    if (!("items" in page)) return yield* Effect.fail(new Error("Project details unavailable"))
    for (const row of page.items) if ("leadAgentId" in row) rows.push(row)
    if (page.next === undefined) return rows.find((row) => row.projectId === projectId)
    if (!page.items.length || cursors.has(page.next)) return yield* Effect.fail(new Error("Project cursor did not advance"))
    cursors.add(page.next); after = page.next
  }
})

// One instance belongs to one authenticated owner mount, above route changes.
// The shell must dispose it on expiry, logout, and unmount. Nothing is stored in
// a URL or browser storage; a reload reads durable intents instead of inventing
// a replacement operation. The dialog and setup share this same instance.
export class NewProjectSession {
  private state = initial()
  private listeners = new Set<() => void>()
  private reads: AbortController | undefined
  private preview: AbortController | undefined
  private operation: AbortController | undefined
  private alive = true
  private returnFocus: (() => HTMLElement | null) | undefined
  private nameEdited = false
  private readonly onSessionExpired: () => void
  private readonly run: typeof withClient
  constructor(onSessionExpired: () => void, run: typeof withClient = withClient) {
    this.onSessionExpired = onSessionExpired
    this.run = run
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(change: Partial<CreationState>) {
    if (!this.alive) return
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }
  open(origin = "/#/", returnFocus?: () => HTMLElement | null) {
    if (!this.alive) return
    if (this.state.phase === "created") { this.state = initial(); this.nameEdited = false }
    const trigger = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    // Home remounts after a Machines detour. Resolve its current trigger rather
    // than retaining a detached button from the previous route mount.
    this.returnFocus = returnFocus ?? (trigger === undefined ? undefined : () => trigger)
    this.publish({ open: true, origin, detour: false })
    void this.refresh()
  }
  close = () => {
    this.preview?.abort()
    this.publish({ open: false })
    this.restoreFocus()
  }
  restoreFocus = () => {
    if (this.alive && !this.state.open && !this.state.detour) this.returnFocus?.()?.focus({ preventScroll: true })
  }
  addRepository = () => {
    this.preview?.abort()
    this.publish({ open: false, detour: true })
  }
  returnFromMachines = () => {
    if (!this.state.detour) return
    this.publish({ open: true, detour: false })
    void this.refresh()
  }
  dispose = () => {
    this.reads?.abort(); this.preview?.abort(); this.operation?.abort()
    this.state = initial()
    this.returnFocus = undefined
    this.alive = false
    for (const listener of this.listeners) listener()
    this.listeners.clear()
  }
  private async checkSession(signal: AbortSignal) {
    try {
      const response = await fetch("/api/session", { method: "POST", credentials: "same-origin", cache: "no-store", signal })
      if (!signal.aborted && response.status === 401) { this.dispose(); this.onSessionExpired() }
    } catch { /* A connection failure is not evidence of logout. */ }
  }
  update(change: Partial<ProjectDraft>) {
    if (!this.alive || this.state.attempt !== undefined || this.state.busy) return
    if (change.name !== undefined) this.nameEdited = true
    let draft = { ...this.state.draft, ...change }
    if (change.repository !== undefined && !this.nameEdited) {
      const repository = change.repository
      const name = repository._tag === "existing" ? this.state.repositories.find((row) => row.repoId === repository.repoId)?.name
        : repository._tag === "new" ? repository.name : undefined
      if (name !== undefined) draft = { ...draft, name }
    }
    this.preview?.abort()
    this.publish({ draft, preview: undefined, previewReason: undefined, previewState: "empty", message: "", phase: "editing" })
    void this.previewPlacement()
  }
  async refresh() {
    if (!this.alive) return
    this.reads?.abort()
    this.preview?.abort()
    const controller = new AbortController()
    this.reads = controller
    this.publish({ loading: true, loaded: false, preview: undefined, previewReason: undefined, previewState: "empty" })
    try {
      const data = await this.run((client) => Effect.gen(function* () {
        const start = yield* client["client.sequence"]({ requestId: requestId() })
        const settings = yield* client["project.settings"]({ requestId: requestId() })
        const discovery = yield* client["project.setup.discover"]({ requestId: requestId() })
        const repositories = yield* readRepositories(client), pending = yield* readCreations(client)
        const end = yield* client["client.sequence"]({ requestId: requestId() })
        if (start.sequence !== end.sequence) return yield* Effect.fail(new Error("Project state changed; refresh"))
        return { settings: settings.settings, discovery: discovery.result, repositories, pending }
      }), controller.signal)
      if (controller.signal.aborted || !this.alive) return
      let draft = this.state.draft
      if (draft.repository === undefined && data.repositories[0] !== undefined) draft = { ...draft,
        repository: { _tag: "existing", repoId: data.repositories[0].repoId }, name: this.nameEdited ? draft.name : data.repositories[0].name }
      this.publish({ ...data, draft, loaded: true, loading: false })
      await this.previewPlacement()
    } catch {
      if (controller.signal.aborted || !this.alive) return
      this.publish({ loading: false, loaded: false, message: "Could not read project settings, repositories, and readiness. Refresh to try again." })
      await this.checkSession(controller.signal)
    }
  }
  private payload(): CreateProjectPayload | undefined {
    const draft = this.state.draft
    if (!draft.name.trim() || draft.repository === undefined || draft.repository._tag === "new" && !draft.repository.name.trim()) return
    return { requestId: requestId(), name: draft.name, goal: draft.goal, machineId: draft.machineId, repository: { ...draft.repository }, useWorktree: true }
  }
  async previewPlacement() {
    this.preview?.abort()
    const payload = this.payload()
    if (!this.alive || !this.state.loaded || this.state.attempt !== undefined || payload === undefined) return
    const controller = new AbortController()
    this.preview = controller
    this.publish({ preview: undefined, previewReason: undefined, previewState: "loading" })
    try {
      const result = await this.run((client) => Effect.result(client["project.placement.preview"](payload)), controller.signal)
      if (controller.signal.aborted || !this.alive) return
      if (result._tag === "Success") this.publish({ preview: result.success.result, previewState: "ready" })
      else {
        this.publish({ previewState: "unavailable", previewReason: result.failure._tag === "CommandError" ? result.failure.reason : undefined })
        await this.checkSession(controller.signal)
      }
    } catch {
      if (!controller.signal.aborted && this.alive) { this.publish({ previewState: "unavailable" }); await this.checkSession(controller.signal) }
    }
  }
  // A refusal without a surviving intent conclusively releases this body. With
  // a plan, both the body and its stored lead stay frozen, even after Settings.
  correctRefusal = () => {
    if (this.state.phase !== "refused" || this.state.pending.some((row) => row.requestId === this.state.attempt?.requestId)) return
    this.publish({ attempt: undefined, phase: "editing", message: "", project: undefined })
    void this.refresh()
  }
  async start() {
    if (!this.alive || this.state.busy || this.state.phase === "created") return
    let payload = this.state.attempt
    const recovering = payload !== undefined
    if (!recovering && (!this.state.loaded || this.state.pending.length > 0 || this.state.previewState !== "ready" || !this.state.discovery?.readyDefaults)) return
    payload ??= this.payload()
    if (payload === undefined) return
    Object.freeze(payload.repository); Object.freeze(payload)
    this.preview?.abort()
    const controller = new AbortController()
    this.operation = controller
    this.publish({ attempt: payload, busy: true, phase: "creating", message: "" })
    try {
      const frozen = payload
      const result = await this.run((client) => Effect.gen(function* () {
        const pending = yield* readCreations(client)
        if (!recovering && pending.length > 0) return { kind: "other-pending" as const, pending }
        const reply = yield* Effect.result(client["project.create"](frozen))
        if (reply._tag === "Failure") {
          if (reply.failure._tag !== "CommandError") return yield* Effect.fail(reply.failure)
          const pending = yield* readCreations(client)
          if (!correctable.has(reply.failure.reason)) return { kind: "uncertain" as const, pending }
          return { kind: "refused" as const, pending }
        }
        const project = yield* readProject(client, reply.success.projectId)
        if (project === undefined) return yield* Effect.fail(new Error("Created project details not yet available"))
        return { kind: "created" as const, project }
      }), controller.signal)
      if (controller.signal.aborted || !this.alive) return
      if (result.kind === "other-pending") this.publish({ pending: result.pending, attempt: undefined, phase: "editing",
        message: "The engine has an unfinished creation. Resolve it before starting another project." })
      else if (result.kind === "uncertain") {
        this.publish({ pending: result.pending, phase: "uncertain", message: "Could not confirm creation. The original request remains locked. Check the same creation to recover its receipt or unfinished plan." })
        await this.checkSession(controller.signal)
      }
      else if (result.kind === "refused") this.publish({ pending: result.pending, phase: "refused", message:
        result.pending.some((row) => row.requestId === payload.requestId)
          ? "The engine refused this attempt and retained its original plan. Settings changes do not replace its planned lead. Restore that plan’s prerequisites, then retry the same creation."
          : "The engine refused this creation and reports no unfinished intent for it. Check the name, repository, and lead settings, then correct the form." })
      else this.publish({ project: result.project, phase: "created", message: "Project created. Open its lead’s conversation." })
    } catch {
      if (controller.signal.aborted || !this.alive) return
      this.publish({ phase: "uncertain", message: "Could not confirm creation. Check the same operation to recover its receipt. Its exact name, goal, repository, and request remain locked." })
      await this.checkSession(controller.signal)
    } finally {
      if (!controller.signal.aborted && this.alive) { this.operation = undefined; this.publish({ busy: false }) }
    }
  }
}
