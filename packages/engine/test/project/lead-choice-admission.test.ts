import { existsSync } from "node:fs"
import { join } from "node:path"
import { Event } from "@lgtm/contracts"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { EventLog } from "../../src/log/EventLog.ts"
import { projectView } from "../../src/project/view.ts"
import { makeFakeRunner, type FakeRunner } from "../support/fakeRunner.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { snapshot } from "../support/routingRig.ts"
import { call, failureOf, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner,
  provideRig, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts"

let rig: Rig
beforeEach(() => {
  rig = makeRig()
  vi.stubEnv("HOME", rig.home)
  vi.stubEnv("LGTM_HOME", rig.stateFolder)
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const axes = ["model", "effort"] as const
const good = { model: "model-small", effort: "high" }
const settings = (lead?: Record<string, unknown>) => ({ workspaceFolder: rig.root, shell: "sh", ...(lead === undefined ? {} : { lead }) })
const lead = (axis: typeof axes[number], value: string) => ({ harness: "cursor", account: { _tag: "named", accountId: "ready" }, permission: "ask", [axis]: value })
const harness = (axis: typeof axes[number], value: string, listed: boolean, fallback = false) => harnessSettings("cursor", {
  adapterPath: process.execPath, models: axis === "model" && listed ? [value] : [],
  efforts: axis === "effort" && listed ? [value] : [], reportedModes: [{ id: "default", level: "ask" }],
  ...(fallback ? { [axis === "model" ? "defaultModel" : "defaultEffort"]: value } : {}),
})
const setup = () => Effect.gen(function* () {
  yield* registerRebuildCheck()
  success(yield* call(owner, "accounts", { operation: "add", account: { id: "ready", harness: "cursor", enabled: true } }))
  success(yield* call(owner, "accounts set-secret", { accountId: "ready", name: "CURSOR_API_KEY", nonce: freshRequest(), value: Redacted.make("synthetic-choice-admission-credential") }))
  return { requestId: freshRequest(), name: "Choice admission", goal: "Use valid launch choices", machineId: "local",
    repository: { _tag: "new", name: "Choice repo" }, useWorktree: true }
})
const noCreation = (runner: FakeRunner) => Effect.gen(function* () {
  const view = projectView(yield* snapshot)
  expect(Object.values(view.creations)).toEqual([])
  expect(Object.values(view.projects)).toEqual([])
  expect(runner.callsOf("start")).toHaveLength(0)
  expect(existsSync(join(rig.root, "choice-repo"))).toBe(false)
  const tags = (yield* readLog).map(({ event }) => event._tag)
  expect(tags).not.toContain("project.CreationPlanned")
  expect(tags).not.toContain("project.CreationClaimed")
  expect(tags).not.toContain("AgentStarted")
})
const launchesOnce = (runner: FakeRunner, request: Record<string, unknown>) => Effect.gen(function* () {
  const reply = success(yield* call(owner, "project.create", request))
  expect(success(yield* call(owner, "project.create", request))).toEqual(reply)
  expect(Object.values(projectView(yield* snapshot).projects)).toHaveLength(1)
  expect(Object.values(projectView(yield* snapshot).creations)).toEqual([])
  expect(runner.callsOf("start")).toHaveLength(1)
  expect(existsSync(join(rig.root, "choice-repo/.git"))).toBe(true)
})

for (const axis of axes) for (const [label, value] of [["newline", "bad\nchoice"], ["NUL", "bad\u0000choice"], ["DEL", "bad\u007fchoice"]]) {
  for (const listed of [false, true]) it.live(`544 refuses saved ${axis} ${label} before effects, listed=${listed}`, () => Effect.gen(function* () {
    const runner = yield* makeFakeRunner()
    yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
      const request = yield* setup()
      success(yield* call(owner, "harnesses", { operation: "set", harness: harness(axis, value!, listed) }))
      expect(failureOf(yield* call(owner, "project.settings.set", { settings: settings(lead(axis, value!)) }))).toBeDefined()
      expect((yield* readLog).filter(({ event }) => event._tag === "project.SettingsChanged")).toEqual([])
      expect(failureOf(yield* call(owner, "project.create", request))).toBeDefined()
      yield* noCreation(runner)
      success(yield* call(owner, "harnesses", { operation: "set", harness: harness(axis, good[axis], listed) }))
      success(yield* call(owner, "project.settings.set", { settings: settings(lead(axis, good[axis])) }))
      yield* launchesOnce(runner, request)
    }))
  }))
}

for (const axis of axes) for (const [label, value] of [["newline", "bad\nchoice"], ["stored maximum", "x".repeat(129)], ["overlong", "x".repeat(257)]]) {
  for (const listed of [false, true]) it.live(`544 refuses effective harness ${axis} ${label} before intent, listed=${listed}`, () => Effect.gen(function* () {
    const runner = yield* makeFakeRunner()
    yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
      const request = yield* setup()
      success(yield* call(owner, "harnesses", { operation: "set", harness: harness(axis, value!, listed, true) }))
      success(yield* call(owner, "project.settings.set", { settings: settings() }))
      expect(failureOf(yield* call(owner, "project.create", request))).toBeDefined()
      yield* noCreation(runner)
      success(yield* call(owner, "harnesses", { operation: "set", harness: harness(axis, good[axis], listed, true) }))
      yield* launchesOnce(runner, request)
    }))
  }))
}

for (const axis of axes) it.live(`544 replays historical invalid ${axis} settings and refuses before a new intent`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    const request = yield* setup()
    success(yield* call(owner, "harnesses", { operation: "set", harness: harness(axis, "bad\nchoice", false) }))
    // The historical event schema stays readable. Admission, rather than log
    // decoding, enforces the current start contract before new side effects.
    const log = yield* EventLog
    const event = Schema.decodeUnknownSync(Event)({ _tag: "project.SettingsChanged", settings: settings(lead(axis, "bad\nchoice")) })
    yield* log.append({ _tag: "owner" }, freshRequest(), "d".repeat(64), [event], {}, false)
    expect(failureOf(yield* call(owner, "project.create", request))).toBeDefined()
    yield* noCreation(runner)
    success(yield* call(owner, "project.settings.set", { settings: settings(lead(axis, good[axis])) }))
    yield* launchesOnce(runner, request)
  }))
}))
