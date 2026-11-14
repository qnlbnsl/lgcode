import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import { appendSetup, call, eventOf, ownerCredential, seedAccount, seedAgent, seedHarness, success, type Rig } from "../support/handlerRig.ts"

export const screenBundle = () => ({ sources: [{ sourceId: "page", worktreeId: "workspace", path: "mocks/page.html", kind: "screens" }],
  screens: [{ screenId: "home", sourceId: "page", name: "Home", route: "/home", scenarioRoutes: [] }], scenarios: [], draftedFields: [], components: [] })
export const seedScreens = (rig: Rig) => Effect.gen(function* () {
  yield* seedAccount(); yield* seedHarness()
  execFileSync("git", ["-C", rig.work, "init", "-b", "main"], { stdio: "ignore" })
  const lead = yield* seedAgent({ id: "project-lead", name: "Project lead" }), designer = yield* seedAgent({ id: "designer", name: "Designer", role: "designer", parent: "project-lead" }), stranger = yield* seedAgent({ id: "stranger", name: "Other project agent" })
  success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "sh" } }))
  const repoId = success(yield* call(ownerCredential, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
  yield* appendSetup([eventOf({ _tag: "project.WorktreeCreated", worktreeId: "workspace", repoId, machineId: "local", branch: "main", path: rig.work, checkout: "main" }),
    eventOf({ _tag: "project.Created", projectId: "project", name: "Mocks", goal: "Review screens", repoId, worktreeId: "workspace", leadAgentId: lead.agentId, machineId: "local" }),
    eventOf({ _tag: "project.StageChanged", projectId: "project", stage: "design" })])
  mkdirSync(join(rig.work, "mocks")); writeFileSync(join(rig.work, "mocks/page.html"), "<h1>Screen</h1>")
  const revisionId = success(yield* call(ownerCredential, "project.mocks.record", { projectId: "project", bundle: screenBundle() })).revisionId
  return { lead, designer, stranger, repoId, revisionId, selection: { projectId: "project", revisionId, screenId: "home" } }
})
