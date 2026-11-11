import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { connect, type Client } from "@lgcode/client"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { NewProjectSession, type CreateProjectPayload } from "../../../web/src/project/creation.ts"
import { RepositoryRegistration } from "../../../web/src/project/registration.ts"
import type { withClient } from "../../../web/src/thread/client.ts"
import * as Server from "../../src/api/server.ts"
import { LogWriteFailed } from "../../src/log/EventLog.ts"
import { projectView } from "../../src/project/view.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { provideRestart, recover } from "../support/restartRig.ts"
import { snapshot } from "../support/routingRig.ts"
import { call, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig, readLog,
  removeRig, success, type Fakes, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const disk = (root: string): unknown => readdirSync(root).sort().map((name) => {
  const path = join(root, name), stat = lstatSync(path)
  return [name, stat.mode, stat.isSymbolicLink() ? readlinkSync(path) : stat.isDirectory() ? disk(path)
    : createHash("sha256").update(readFileSync(path)).digest("hex")]
})
beforeEach(() => {
  rig = makeRig(); chmodSync(rig.stateFolder, 0o700)
  vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  git(rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial")
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); removeRig(rig) })

const configured = () => Effect.gen(function* () {
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
  success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(owner, "accounts", { operation: "add", account: { id: "primary", harness: "cursor", enabled: true } }))
  success(yield* call(owner, "accounts set-secret", { accountId: "primary", name: "CURSOR_API_KEY", nonce: freshRequest(), value: Redacted.make("synthetic-new-project-readiness") }))
})
const connected = () => Effect.gen(function* () {
  yield* registerRebuildCheck()
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "engine.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  return yield* connect({ environment: { LGCODE_SOCKET: socket, LGCODE_TOKEN: bearer } })
})
const runFor = (client: Client): typeof withClient => (action, signal) => Effect.runPromise(action(client), { signal })
const flush = async (session: NewProjectSession) => {
  for (let i = 0; i < 400; i++) {
    if (!session.getSnapshot().loading && session.getSnapshot().previewState !== "loading") return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Creation view did not settle")
}
const register = (api: Client) => api["project.repository.add"]({ requestId: freshRequest(), name: "Product", path: rig.work, machineId: "local" })
const promise = <A>(body: () => Promise<A>) => Effect.promise(body)
// Match creation-recovery.test.ts: provideRestart supplies the runtime services,
// while its generic test-helper signature retains the input environment.
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) => it.live(name, () => body() as Effect.Effect<unknown, unknown, never>)

it.live("the actual form controller previews real branch/folder collisions without writes, then creates exactly one worktree and lead", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected(), { repoId } = yield* register(api)
    git(rig.work, "branch", "console"); mkdirSync(join(rig.work, ".worktrees", "console-2"), { recursive: true })
    const session = new NewProjectSession(() => {}, runFor(api))
    const before = yield* readLog, files = disk(rig.work)
    yield* promise(() => session.refresh())
    session.update({ name: "Console", goal: "Persist this goal", repository: { _tag: "existing", repoId } })
    yield* promise(() => flush(session))
    expect(session.getSnapshot().preview).toMatchObject({ branch: "console-3", path: join(rig.work, ".worktrees/console-3"), checkout: "worktree", reserved: false })
    expect(yield* readLog).toEqual(before)
    expect(disk(rig.work)).toEqual(files)
    expect((yield* api["project.creations"]({ requestId: freshRequest() })).items).toEqual([])
    expect(runner.callsOf("start")).toHaveLength(0)
    // The observational preview does not reserve its branch against a race.
    git(rig.work, "branch", "console-3")
    yield* promise(() => session.start())
    expect(session.getSnapshot().phase).toBe("created")
    const project = session.getSnapshot().project!
    expect(project.goal).toBe("Persist this goal")
    const view = projectView(yield* snapshot), workspace = view.workspaces[project.worktreeId]!
    expect(workspace).toMatchObject({ repoId, branch: "console-4", checkout: "worktree" })
    expect(git(workspace.path, "branch", "--show-current")).toBe("console-4")
    expect(git(workspace.path, "rev-parse", "--git-common-dir")).toBe(join(rig.work, ".git"))
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(runner.callsOf("start")[0]?.input).toMatchObject({ agentId: project.leadAgentId, folder: workspace.path })
    expect((yield* readLog).filter((row) => row.event._tag === "project.Created")).toHaveLength(1)
    session.dispose()
  }))
}))

it.live("a lost successful reply preserves the exact frozen body across Machines and recovers one receipt without a second launch", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected(); yield* register(api)
    const sent: CreateProjectPayload[] = []
    const observed = new Proxy(api, { get(target, key, receiver) {
      if (key !== "project.create") return Reflect.get(target, key, receiver)
      return (payload: CreateProjectPayload) => { sent.push(payload); return target["project.create"](payload) }
    } })
    let loseReply = true
    const run: typeof withClient = async (action, signal) => {
      const result = await runFor(observed)(action, signal)
      if (sent.length === 1 && loseReply) { loseReply = false; throw new Error("Injected lost acknowledgement after real RPC") }
      return result
    }
    const session = new NewProjectSession(() => {}, run)
    yield* promise(() => session.refresh()); session.update({ name: "Lost reply", goal: "Original goal" }); yield* promise(() => flush(session))
    yield* promise(() => session.start())
    expect(session.getSnapshot().phase).toBe("uncertain")
    const frozen = session.getSnapshot().attempt!
    session.addRepository(); session.update({ name: "Changed", goal: "Changed" }); session.returnFromMachines()
    yield* promise(() => flush(session))
    expect(session.getSnapshot().draft.name).toBe("Lost reply")
    expect(session.getSnapshot().attempt).toBe(frozen)
    yield* promise(() => session.start())
    expect(session.getSnapshot().phase).toBe("created")
    expect(sent).toHaveLength(2); expect(sent[0]).toBe(sent[1]); expect(sent[0]).toEqual(frozen)
    expect(runner.callsOf("start")).toHaveLength(1)
    expect((yield* api["project.creations"]({ requestId: freshRequest() })).items).toEqual([])
    expect((yield* readLog).filter((row) => row.event._tag === "project.Created")).toHaveLength(1)
    session.dispose()
  }))
}))

const failFinalAppend = (): NonNullable<Fakes["wrapLog"]> => {
  let once = true
  return (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
    if (once && events.some((event) => event._tag === "project.Created")) { once = false; return Effect.fail(new LogWriteFailed({ reason: "injected before final append" })) }
    return append(actor, id, hash, events, rows, receipt)
  })) })
}
live("reads durable unfinished intent after lost write and writer restart, retains its lead through settings correction, and recovers the same operation", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let activeClient: Client | undefined
  const run: typeof withClient = (action, signal) => {
    if (activeClient === undefined) throw new Error("No authenticated engine connection")
    return runFor(activeClient)(action, signal)
  }
  const { session, frozen, pending } = yield* provideRig(rig, { runner, secrets, wrapLog: failFinalAppend() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected(); activeClient = api; yield* register(api)
    const session = new NewProjectSession(() => {}, run)
    yield* promise(() => session.refresh()); session.update({ name: "Pending plan" }); yield* promise(() => flush(session))
    yield* promise(() => session.start()); expect(session.getSnapshot().phase).toBe("uncertain")
    const frozen = session.getSnapshot().attempt!, pending = session.getSnapshot().pending[0]!
    expect(pending.requestId).toBe(frozen.requestId)
    expect(session.getSnapshot().project).toBeUndefined(); expect(runner.callsOf("start")).toHaveLength(0)
    return { session, frozen, pending }
  }))
  // An infrastructure write failure deliberately latches the production
  // writer. Restart its real services before correcting Settings. The owner
  // page session and its frozen request survive that engine restart.
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* recover
    const api = yield* connected(); activeClient = api
    success(yield* call(owner, "accounts", { operation: "add", account: { id: "other", harness: "cursor", enabled: true } }))
    success(yield* call(owner, "accounts set-secret", { accountId: "other", name: "CURSOR_API_KEY", nonce: freshRequest(), value: Redacted.make("synthetic-other-project-readiness") }))
    yield* api["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.root, shell: "bash", lead: { harness: pending.lead.harness,
      account: { _tag: "named", accountId: "other" as never }, permission: "ask" } } })
    session.correctRefusal(); expect(session.getSnapshot().attempt).toBe(frozen)
    yield* promise(() => session.refresh()); expect(session.getSnapshot().pending[0]?.lead).toEqual(pending.lead)
    // A reload cannot reconstruct a body from redacted/normalized intent fields.
    const reloaded = new NewProjectSession(() => {}, runFor(api))
    yield* promise(() => reloaded.refresh()); yield* promise(() => reloaded.start())
    expect(reloaded.getSnapshot().attempt).toBeUndefined(); expect(reloaded.getSnapshot().pending[0]?.requestId).toBe(frozen.requestId)
    yield* api.accounts({ requestId: freshRequest(), operation: "disable", accountId: "primary" as never })
    yield* promise(() => session.start())
    expect(session.getSnapshot().phase).toBe("refused")
    expect(session.getSnapshot().attempt).toBe(frozen)
    expect(session.getSnapshot().pending[0]?.lead).toEqual(pending.lead)
    expect(runner.callsOf("start")).toHaveLength(0)
    // Restoring the original account permits recovery; replacing Settings did
    // not silently choose the now-ready alternate account for this plan.
    success(yield* call(owner, "accounts", { operation: "set", account: { id: "primary", harness: "cursor", enabled: true } }))
    success(yield* call(owner, "accounts set-secret", { accountId: "primary", name: "CURSOR_API_KEY", nonce: freshRequest(), value: Redacted.make("synthetic-new-project-readiness") }))
    yield* promise(() => session.start()); expect(session.getSnapshot().phase).toBe("created")
    expect(runner.callsOf("start")[0]?.input).toMatchObject({ account: { id: "primary" } })
    expect(runner.callsOf("start")).toHaveLength(1)
    session.dispose(); reloaded.dispose()
  }), { secrets })
}))

it.live("a repository registered through a linked worktree creates its dedicated worktree under the actual main repository identity", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected()
    const linked = join(rig.root, "linked")
    git(rig.work, "worktree", "add", "-b", "linked-branch", linked)
    const { repoId } = yield* api["project.repository.add"]({ requestId: freshRequest(), name: "Linked Product", path: linked, machineId: "local" })
    const session = new NewProjectSession(() => {}, runFor(api))
    yield* promise(() => session.refresh()); session.update({ name: "From linked" }); yield* promise(() => flush(session))
    const folder = join(rig.work, ".worktrees/from-linked")
    expect(session.getSnapshot().preview).toMatchObject({ repositoryPath: rig.work, path: folder, branch: "from-linked", checkout: "worktree" })
    yield* promise(() => session.start())
    const created = session.getSnapshot().project!, view = projectView(yield* snapshot)
    expect(created.repoId).toBe(repoId)
    expect(view.workspaces[created.worktreeId]).toMatchObject({ repoId, path: folder, branch: "from-linked", checkout: "worktree" })
    expect(session.getSnapshot().attempt?.useWorktree).toBe(true)
    expect(git(rig.work, "branch", "--show-current")).toBe("main")
    expect(runner.callsOf("start")[0]?.input.folder).toBe(folder)
    session.dispose()
  }))
}))

it.live("keeps an unavailable selected machine and an unlocated repository explicit without a preview mutation or a launch", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected(); yield* register(api)
    const session = new NewProjectSession(() => {}, runFor(api))
    yield* promise(() => session.refresh())
    const before = yield* readLog
    session.update({ name: "Unavailable machine", machineId: "remote-unavailable" }); yield* promise(() => flush(session))
    expect(session.getSnapshot().draft.machineId).toBe("remote-unavailable")
    expect(session.getSnapshot().previewReason).toBe("only the confirmed local machine can start a project")
    expect(session.getSnapshot().previewState).toBe("unavailable")
    yield* promise(() => session.start())
    expect(yield* readLog).toEqual(before); expect(runner.callsOf("start")).toHaveLength(0)
    expect(session.getSnapshot().attempt).toBeUndefined()
    session.dispose()
  }))
}))

it.live("a real conclusive case-insensitive collision unlocks correction only after the engine reports no pending intent", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected(), { repoId } = yield* register(api)
    const session = new NewProjectSession(() => {}, runFor(api))
    yield* promise(() => session.refresh()); session.update({ name: "Console" }); yield* promise(() => flush(session))
    yield* api["project.create"]({ requestId: freshRequest(), name: "cONSOLE", goal: "Other", machineId: "local", repository: { _tag: "existing", repoId } })
    yield* promise(() => session.start()); expect(session.getSnapshot().phase).toBe("refused")
    const old = session.getSnapshot().attempt!
    expect(session.getSnapshot().pending).toEqual([])
    session.correctRefusal(); yield* promise(() => flush(session))
    session.update({ name: "Another" }); yield* promise(() => flush(session)); yield* promise(() => session.start())
    expect(session.getSnapshot().phase).toBe("created"); expect(session.getSnapshot().attempt?.requestId).not.toBe(old.requestId)
    expect(Object.keys(projectView(yield* snapshot).projects)).toHaveLength(2)
    session.dispose()
  }))
}))

it.live("creates dedicated worktrees for existing and new repositories while retaining their actual repository identity", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected(), { repoId } = yield* register(api)
    const session = new NewProjectSession(() => {}, runFor(api))
    yield* promise(() => session.refresh()); session.update({ name: "Existing work" }); yield* promise(() => flush(session))
    const folder = join(rig.work, ".worktrees/existing-work")
    expect(session.getSnapshot().preview).toMatchObject({ branch: "existing-work", path: folder, checkout: "worktree" })
    yield* promise(() => session.start()); const existing = session.getSnapshot().project!
    expect(existing.repoId).toBe(repoId)
    expect(projectView(yield* snapshot).workspaces[existing.worktreeId]).toMatchObject({ path: folder, checkout: "worktree" })
    expect(session.getSnapshot().attempt?.useWorktree).toBe(true)
    expect(git(rig.work, "branch", "--show-current")).toBe("main")
    session.open(); yield* promise(() => flush(session))
    session.update({ name: "New service", repository: { _tag: "new", name: "Billing API" } }); yield* promise(() => flush(session))
    expect(session.getSnapshot().draft).not.toHaveProperty("useWorktree")
    expect(existsSync(join(rig.root, "billing-api"))).toBe(false)
    yield* promise(() => session.start())
    const created = session.getSnapshot().project!, view = projectView(yield* snapshot), workspace = view.workspaces[created.worktreeId]!
    expect(session.getSnapshot().attempt?.useWorktree).toBe(true)
    expect(workspace.checkout).toBe("worktree"); expect(workspace.repoId).toBe(created.repoId)
    expect(git(workspace.path, "rev-parse", "--git-common-dir")).toBe(join(rig.root, "billing-api/.git"))
    expect(readFileSync(join(rig.root, "billing-api/.git/HEAD"), "utf8")).toContain("refs/heads/main")
    session.dispose()
  }))
}))

it.live("keeps the draft through actual local repository registration and refuses unready defaults without creating anything", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    const api = yield* connected(), session = new NewProjectSession(() => {}, runFor(api))
    yield* promise(() => session.refresh())
    expect(session.getSnapshot().discovery?.readyDefaults).toBeUndefined()
    expect(session.getSnapshot().repositories).toEqual([])
    session.update({ name: "Owner draft", goal: "Keep across Machines" }); session.addRepository()
    yield* configured(); const { repoId } = yield* register(api)
    session.returnFromMachines(); yield* promise(() => flush(session))
    expect(session.getSnapshot().draft).toMatchObject({ name: "Owner draft", goal: "Keep across Machines", machineId: "local", repository: { repoId } })
    yield* api.accounts({ requestId: freshRequest(), operation: "disable", accountId: "primary" as never })
    yield* promise(() => session.refresh()); expect(session.getSnapshot().discovery?.readyDefaults).toBeUndefined()
    yield* promise(() => session.start())
    expect(session.getSnapshot().attempt).toBeUndefined(); expect(runner.callsOf("start")).toHaveLength(0)
    expect(Object.keys(projectView(yield* snapshot).projects)).toHaveLength(0)
    session.dispose(); expect(session.getSnapshot().draft.name).toBe("")
  }))
}))

it.live("the joined registration controller returns a real repository to the original project draft and creates its dedicated worktree and single lead", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected(), run = runFor(api)
    const creation = new NewProjectSession(() => {}, run), registration = new RepositoryRegistration(() => {}, run)
    creation.open("/#/?view=projects"); yield* promise(() => flush(creation))
    creation.update({ name: "Joined draft", goal: "Actual registration return" })
    creation.addRepository(); registration.open(); registration.update({ name: "Registered Product", path: rig.work })
    yield* promise(() => registration.submit())
    const repository = registration.getSnapshot().result!
    expect(registration.getSnapshot().phase).toBe("registered")
    expect(repository.path).toBe(rig.work)
    registration.close(); creation.returnFromMachines(); yield* promise(() => flush(creation))
    expect(creation.getSnapshot()).toMatchObject({ open: true, origin: "/#/?view=projects", detour: false,
      draft: { name: "Joined draft", goal: "Actual registration return", repository: { _tag: "existing", repoId: repository.repoId } } })
    yield* promise(() => creation.start())
    expect(creation.getSnapshot().phase).toBe("created")
    const project = creation.getSnapshot().project!, view = projectView(yield* snapshot)
    expect(project.goal).toBe("Actual registration return")
    expect(view.workspaces[project.worktreeId]).toMatchObject({ repoId: repository.repoId, branch: "joined-draft", checkout: "worktree" })
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(runner.callsOf("start")[0]?.input.agentId).toBe(project.leadAgentId)
    creation.dispose(); registration.dispose()
    expect(creation.getSnapshot().attempt).toBeUndefined(); expect(creation.getSnapshot().repositories).toEqual([])
    expect(registration.getSnapshot()).toMatchObject({ name: "", path: "" })
    expect(registration.getSnapshot().attempt).toBeUndefined()
  }))
}))

it.live("the joined registration keeps the same uncertain add body through Cancel and reopens its actual receipt without another repository", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected()
    const sent: Array<Parameters<Client["project.repository.add"]>[0]> = []
    const observed = new Proxy(api, { get(target, key, receiver) {
      if (key !== "project.repository.add") return Reflect.get(target, key, receiver)
      return (payload: Parameters<Client["project.repository.add"]>[0]) => { sent.push(payload); return target["project.repository.add"](payload) }
    } })
    let lose = true
    const run: typeof withClient = async (action, signal) => {
      const reply = await runFor(observed)(action, signal)
      if (sent.length === 1 && lose) { lose = false; throw new Error("Injected lost registration reply after real add") }
      return reply
    }
    const creation = new NewProjectSession(() => {}, runFor(api)), registration = new RepositoryRegistration(() => {}, run)
    yield* promise(() => creation.refresh()); creation.update({ name: "Owner goal", goal: "Keep while registration is uncertain" }); creation.addRepository()
    registration.open(); registration.update({ name: "Actual Product", path: rig.work }); yield* promise(() => registration.submit())
    expect(registration.getSnapshot().phase).toBe("uncertain")
    const frozen = registration.getSnapshot().attempt!
    registration.close(); creation.returnFromMachines(); yield* promise(() => flush(creation))
    expect(creation.getSnapshot().draft.goal).toBe("Keep while registration is uncertain")
    creation.addRepository(); registration.open({ path: rig.outside }); registration.update({ name: "Changed", path: rig.outside })
    expect(registration.getSnapshot().attempt).toBe(frozen)
    expect(registration.getSnapshot()).toMatchObject({ name: "Actual Product", path: rig.work })
    yield* promise(() => registration.submit())
    expect(registration.getSnapshot().phase).toBe("registered")
    expect(sent).toHaveLength(2); expect(sent[0]).toBe(sent[1])
    expect((yield* api["project.repositories"]({ requestId: freshRequest() })).items).toHaveLength(1)
    expect((yield* readLog).filter((row) => row.event._tag === "project.RepositoryAdded")).toHaveLength(1)
    expect(runner.callsOf("start")).toHaveLength(0)
    creation.dispose(); registration.dispose()
  }))
}))

it.live("the joined controller releases an effect-free main-branch refusal and preserves its terminal same-request receipt", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* configured(); const api = yield* connected(); yield* register(api)
    const session = new NewProjectSession(() => {}, runFor(api))
    yield* promise(() => session.refresh()); session.update({ name: "Branch correction", goal: "Keep the actual owner goal" })
    yield* promise(() => flush(session))
    expect(session.getSnapshot().previewState).toBe("ready")
    // The branch changes after the read-only preview. The actual Create call
    // must return an effect-free, durable refusal rather than uncertain success.
    git(rig.work, "checkout", "-b", "owner-feature")
    const before = disk(rig.work)
    yield* promise(() => session.start())
    const frozen = session.getSnapshot().attempt!
    expect(session.getSnapshot().phase).toBe("refused")
    expect(session.getSnapshot().pending).toEqual([])
    expect(session.getSnapshot().project).toBeUndefined()
    expect(disk(rig.work)).toEqual(before)
    expect(Object.keys(projectView(yield* snapshot).projects)).toHaveLength(0)
    expect((yield* readLog).filter((row) => row.event._tag === "project.CreationPlanned")).toHaveLength(0)
    expect(runner.callsOf("start")).toHaveLength(0)
    git(rig.work, "checkout", "main")
    const replay = yield* Effect.result(api["project.create"](frozen))
    expect(replay._tag).toBe("Failure")
    if (replay._tag === "Failure") expect(replay.failure).toMatchObject({ _tag: "CommandError",
      reason: "check out main or master in the main repository checkout before creating a project" })
    expect(Object.keys(projectView(yield* snapshot).projects)).toHaveLength(0)
    session.correctRefusal(); yield* promise(() => flush(session)); yield* promise(() => session.start())
    expect(session.getSnapshot().phase).toBe("created")
    expect(session.getSnapshot().attempt?.requestId).not.toBe(frozen.requestId)
    expect(session.getSnapshot().project?.goal).toBe("Keep the actual owner goal")
    expect(git(rig.work, "branch", "--show-current")).toBe("main")
    expect(runner.callsOf("start")).toHaveLength(1)
    session.dispose()
  }))
}))
