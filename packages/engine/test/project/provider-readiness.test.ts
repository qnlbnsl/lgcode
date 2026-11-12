import { execFileSync } from "node:child_process"
import { accessSync, constants, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { projectView } from "../../src/project/view.ts"
import { makeFakeRunner, type FakeRunner } from "../support/fakeRunner.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { snapshot } from "../support/routingRig.ts"
import { call, failureOf, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner,
  provideRig, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const credential = "synthetic-provider-readiness-credential"
beforeEach(() => {
  rig = makeRig()
  vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  execFileSync("git", ["-C", rig.work, "init", "-b", "main"], { stdio: "ignore" })
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const plant = (path: string, document: unknown) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(document), { mode: 0o600 })
}
const harness = (id: string, adapterPath = process.execPath) => call(owner, "harnesses", { operation: "set",
  harness: harnessSettings(id, { adapterPath, reportedModes: [{ id: "default", level: "ask" }] }) }).pipe(Effect.map(success))
const account = (id: string, provider: string, extra: Record<string, unknown> = {}, operation = "add") =>
  call(owner, "accounts", { operation, account: { id, harness: provider, enabled: true, ...extra } }).pipe(Effect.map(success))
const key = (id: string, name: string) => call(owner, "accounts set-secret", {
  accountId: id, name, nonce: freshRequest(), value: Redacted.make(credential),
}).pipe(Effect.map(success))
const setup = () => Effect.gen(function* () {
  yield* registerRebuildCheck()
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
  return { requestId: freshRequest(), name: "Credential admission", goal: "Choose a ready provider", machineId: "local",
    repository: { _tag: "existing", repoId }, useWorktree: true }
})
const selected = (runner: FakeRunner, provider: string, id: string) => Effect.gen(function* () {
  expect(runner.callsOf("start")).toHaveLength(1)
  expect(runner.callsOf("start")[0]?.input).toMatchObject({ harness: { id: provider }, account: { id } })
  const events = (yield* readLog).filter(({ event }) => event._tag === "AgentStarted")
  expect(events).toHaveLength(1)
  expect(events[0]?.event).toMatchObject({ harness: provider, account: id })
  expect(JSON.stringify(yield* readLog)).not.toContain(credential)
})
const refused = (runner: FakeRunner, request: Record<string, unknown>) => Effect.gen(function* () {
  expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe("no ready signed-in lead account is available")
  expect(runner.callsOf("start")).toHaveLength(0)
  expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toEqual([])
  expect(Object.values(projectView(yield* snapshot).creations)).toEqual([])
  expect(Object.values(projectView(yield* snapshot).projects)).toEqual([])
  expect(existsSync(join(rig.work, ".worktrees"))).toBe(false)
  expect(JSON.stringify(yield* readLog)).not.toContain(credential)
})

// The independent counterexample and its ready-Cursor control both exercise
// the real public command, including planning, the writer and normal start.
for (const unrelatedKey of [false, true]) it.live(`skips unsigned-in Claude for ready Cursor, unrelated OpenAI key=${unrelatedKey}`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("claude"); yield* account("claude", "claude")
    yield* harness("cursor"); yield* account("cursor", "cursor"); yield* key("cursor", "CURSOR_API_KEY")
    if (unrelatedKey) yield* key("claude", "OPENAI_API_KEY")
    success(yield* call(owner, "project.create", request))
    yield* selected(runner, "cursor", "cursor")
  }))
}))

for (const [provider, variable] of [["claude", "ANTHROPIC_API_KEY"], ["codex", "OPENAI_API_KEY"],
  ["gemini", "GEMINI_API_KEY"], ["cursor", "CURSOR_API_KEY"]] as const) {
  for (const source of ["environment", "account secret"] as const) it.live(`launches ${provider} with its resolved ${source}`, () => Effect.gen(function* () {
    const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
    yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
      const request = yield* setup()
      yield* harness(provider); yield* account("ready", provider); yield* key("ready", variable)
      if (source === "account secret") yield* account("ready", provider, { secret: [...secrets.stored.keys()][0] }, "set")
      success(yield* call(owner, "project.create", request))
      yield* selected(runner, provider, "ready")
    }))
  }))
}

const fileCases = [
  { name: "Claude default home", provider: "claude", id: "ready", path: () => join(rig.home, ".claude/.credentials.json"), extra: () => ({}), document: { claudeAiOauth: { accessToken: credential } } },
  { name: "Claude account home", provider: "claude", id: "ready", path: () => join(rig.outside, ".credentials.json"), extra: () => ({ home: rig.outside }), document: { claudeAiOauth: { refreshToken: credential } } },
  { name: "Claude expanded config folder", provider: "claude", id: "ready", path: () => join(rig.home, "private/.credentials.json"), extra: () => ({ environment: { CLAUDE_CONFIG_DIR: "~/private" } }), document: { claudeAiOauth: { accessToken: credential } } },
  { name: "Codex shared home", provider: "codex", id: "codex", path: () => join(rig.home, ".codex/auth.json"), extra: () => ({}), document: { tokens: { access_token: credential } } },
  { name: "Codex explicit account home", provider: "codex", id: "codex", path: () => join(rig.outside, "auth.json"), extra: () => ({ home: rig.outside }), document: { OPENAI_API_KEY: credential } },
  { name: "Codex private shadow home", provider: "codex", id: "private", path: () => join(rig.stateFolder, "providers/codex/private/shadow/auth.json"), extra: () => ({}), document: { tokens: { refresh_token: credential } } },
  { name: "Gemini default home", provider: "gemini", id: "ready", path: () => join(rig.home, ".gemini/oauth_creds.json"), extra: () => ({}), document: { access_token: credential } },
  { name: "Gemini moved CLI home", provider: "gemini", id: "ready", path: () => join(rig.outside, ".gemini/oauth_creds.json"), extra: () => ({ environment: { GEMINI_CLI_HOME: rig.outside } }), document: { refresh_token: credential } },
  { name: "Gemini account HOME", provider: "gemini", id: "ready", path: () => join(rig.outside, ".gemini/oauth_creds.json"), extra: () => ({ environment: { HOME: rig.outside } }), document: { access_token: credential } },
]
for (const test of fileCases) it.live(`selects file-backed ${test.name}`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  plant(test.path(), test.document)
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness(test.provider); yield* account(test.id, test.provider, test.extra())
    success(yield* call(owner, "project.create", request))
    yield* selected(runner, test.provider, test.id)
  }))
}))

for (const [provider, path, document] of [
  ["claude", ".claude/.credentials.json", { arbitrary: credential, claudeAiOauth: { subscriptionType: "max" } }],
  ["codex", ".codex/auth.json", { auth_mode: "chatgpt", account_id: "arbitrary-metadata", OPENAI_API_KEY: " " }],
  ["gemini", ".gemini/oauth_creds.json", { note: credential, nested: { access_token: credential } }],
] as const) it.live(`refuses ${provider} login metadata without recognized credentials`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  plant(join(rig.home, path), document)
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup(), id = provider === "codex" ? "codex" : "ready"
    yield* harness(provider); yield* account(id, provider)
    yield* refused(runner, request)
  }))
}))

for (const variable of ["CUSTOM_API_KEY", "CUSTOM_AUTH_TOKEN", "OPENAI_API_KEY"]) it.live(`refuses unknown harness readiness from ${variable}`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("custom"); yield* account("custom", "custom"); yield* key("custom", variable)
    yield* refused(runner, request)
  }))
}))

it.live("refuses an unavailable named account even when another account and provider are ready", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("claude"); yield* account("named", "claude"); yield* key("named", "OPENAI_API_KEY")
    yield* account("other", "claude"); yield* key("other", "ANTHROPIC_API_KEY")
    yield* harness("cursor"); yield* account("cursor", "cursor"); yield* key("cursor", "CURSOR_API_KEY")
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh",
      lead: { harness: "claude", account: { _tag: "named", accountId: "named" }, permission: "ask" } } }))
    yield* refused(runner, request)
  }))
}))

it.live("skips an unready earlier account without changing normal account order", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("claude")
    yield* account("a-unready", "claude"); yield* key("a-unready", "CURSOR_API_KEY")
    yield* account("b-ready", "claude"); yield* key("b-ready", "ANTHROPIC_API_KEY")
    yield* account("c-ready", "claude"); yield* key("c-ready", "ANTHROPIC_API_KEY")
    success(yield* call(owner, "project.create", request))
    yield* selected(runner, "claude", "b-ready")
  }))
}))

it.live("does not admit an inherited provider key excluded from the spawn environment", () => Effect.gen(function* () {
  vi.stubEnv("ANTHROPIC_API_KEY", credential)
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("claude"); yield* account("ready", "claude")
    yield* refused(runner, request)
  }))
}))

it.live("does not use a shared Codex login for a private shadow account", () => Effect.gen(function* () {
  plant(join(rig.home, ".codex/auth.json"), { tokens: { access_token: credential } })
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("codex"); yield* account("private", "codex")
    yield* refused(runner, request)
  }))
}))


const adapterKinds = ["executable", "symlinked executable", "directory", "non-executable file", "missing", "symlinked directory", "dangling symlink"] as const
type AdapterKind = typeof adapterKinds[number]
const adapter = (kind: AdapterKind) => {
  const path = join(rig.outside, "adapter")
  switch (kind) {
    case "executable": return process.execPath
    case "symlinked executable": symlinkSync(process.execPath, path); break
    case "directory": mkdirSync(path, { mode: 0o700 }); accessSync(path, constants.X_OK); break
    case "non-executable file": writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o600 }); break
    case "symlinked directory": symlinkSync(rig.home, path, "dir"); break
    case "dangling symlink": symlinkSync(join(rig.outside, "absent-target"), path); break
    case "missing": break
  }
  return path
}
const usableAdapter = (kind: AdapterKind) => kind === "executable" || kind === "symlinked executable"

for (const kind of adapterKinds) it.live(`project.create selects the first usable adapter with an earlier ${kind}`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets(), path = adapter(kind)
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("claude", path); yield* account("claude", "claude"); yield* key("claude", "ANTHROPIC_API_KEY")
    yield* harness("cursor"); yield* account("cursor", "cursor"); yield* key("cursor", "CURSOR_API_KEY")
    success(yield* call(owner, "project.create", request))
    const provider = usableAdapter(kind) ? "claude" : "cursor"
    yield* selected(runner, provider, provider)
  }))
}))

for (const kind of adapterKinds.filter((kind) => !usableAdapter(kind))) it.live(`project.create refuses a named account with a ${kind} before recording an intent or lead`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets(), path = adapter(kind)
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("claude", path); yield* account("named", "claude"); yield* key("named", "ANTHROPIC_API_KEY")
    yield* harness("cursor"); yield* account("cursor", "cursor"); yield* key("cursor", "CURSOR_API_KEY")
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh",
      lead: { harness: "claude", account: { _tag: "named", accountId: "named" }, permission: "ask" } } }))
    yield* refused(runner, request)
    expect((yield* readLog).filter(({ event }) => event._tag === "project.CreationPlanned")).toEqual([])
  }))
}))

it.live("project.create refuses a named harness with a directory even when account selection is any", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets(), path = adapter("directory")
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const request = yield* setup()
    yield* harness("claude", path); yield* account("claude", "claude"); yield* key("claude", "ANTHROPIC_API_KEY")
    yield* harness("cursor"); yield* account("cursor", "cursor"); yield* key("cursor", "CURSOR_API_KEY")
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh",
      lead: { harness: "claude", account: { _tag: "any" }, permission: "ask" } } }))
    yield* refused(runner, request)
    expect((yield* readLog).filter(({ event }) => event._tag === "project.CreationPlanned")).toEqual([])
  }))
}))
