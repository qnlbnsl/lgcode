// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildStudio } from "../scripts/build.ts"
import * as mappings from "../src/git.ts"

const root = mkdtempSync(join(tmpdir(), "lgtm-harness-integration-"))
let source: string
beforeAll(async () => {
  const dist = await buildStudio(join(root, "studio"))
  source = readFileSync(join(dist, "js/live/git.js"), "utf8").replace(/^import .*;$/gm, "").replace(/export /g, "")
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

it.each(["first", "fixture"])("keeps %s installation metadata when the built page receives asynchronous model choices", async (id) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const harnesses = ["first", "fixture"].map((id) => ({ id, runMode: "acp", models: [], efforts: [] }))
  const installed = [{ harnessId: "first", installed: true, path: "/fixture/first" }, { harnessId: "fixture", installed: false }]
  const state: any = { session: { status: "in" }, ui: {}, settings: {}, subscriptions: [] }, table: any = {}, toasts: string[] = []
  const request = async (tag: string, payload: any) => {
    if (tag === "accounts") return { accounts: [] }
    if (tag === "harnesses") return { harnesses }
    if (tag === "project.settings") return { settings: {} }
    if (tag === "roles.settings.get") return { settings: {} }
    if (tag === "client.web.settings") return {}
    if (tag === "roles.role-file.get") return { file: null }
    if (tag === "client.snapshot") return { accounts: [] }
    if (tag === "client.harness.status") return { harnesses: installed }
    if (tag === "client.harness.recipe") {
      if (payload.harnessId === "first") throw new Error("command refused")
      return { recipe: { harnessId: "fixture", name: "Fixture harness", signInArguments: ["login"], signInCommand: "fixture login" } }
    }
    if (tag === "client.harness.choices") {
      if (payload.harnessId === "first") await held
      return { harnessId: payload.harnessId, models: { source: "negotiated", options: [{ id: "reported-model" }] }, efforts: { source: "unavailable", options: [] } }
    }
    throw new Error(`Unexpected request: ${tag}`)
  }
  const actions = new Function("serviceSettings", "store", "live", "engineWrite", "notify", "engine", "act", "HARNESSES", "addEventListener", "removeEventListener", `${source}\nreturn { installMappings, openScreen, busy };`)(
    { loadVersion: async () => {} }, { state }, { on: true }, (patch: object) => Object.assign(state, patch), () => {}, { request }, { toast: (value: string) => toasts.push(value) }, table, () => {}, () => {})
  actions.installMappings(mappings)
  const close = actions.openScreen("harnesses")
  try {
    await vi.waitFor(() => expect(state.ui.serviceReady).toBe(true))
    // The first report is held until the installation status is published.
    release()
    await vi.waitFor(() => expect(table[id]?.models).toEqual(["reported-model"]))
    if (id === "first") expect(table.first).toMatchObject({ installed: true, path: "/fixture/first" })
    else expect(table.fixture).toMatchObject({ name: "Fixture harness", installed: false, recipe: { harnessId: "fixture" } })
    expect(toasts).toEqual([])
  } finally { release(); close() }
})
