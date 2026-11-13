import { afterEach, describe, expect, it, vi } from "vitest"
import { ClientError, type connect, type Client, type ClientEnvelope } from "@lgtm/client/browser"
import type { ClientSnapshot } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { engineConnection, type StorePatch } from "../src/connection.ts"
import { engineSnapshot } from "./fixtures.ts"

const connections: ReturnType<typeof engineConnection>[] = []
afterEach(() => { for (const connection of connections.splice(0)) connection.close(); vi.useRealTimers() })

function harness(options: {
  snapshot?: ClientSnapshot; next?: ClientSnapshot; items?: unknown[]; logout?: number | "network";
  open?: typeof connect
} = {}) {
  let reads = 0
  const posts: string[] = []
  const state: StorePatch = {}
  const client = {
    "client.snapshot": () => Effect.succeed(++reads === 1 ? options.snapshot ?? engineSnapshot : options.next ?? engineSnapshot),
    "project.settings": () => Effect.succeed({}),
    "client.subscribe": () => Stream.concat(Stream.fromIterable((options.items ?? []) as ClientEnvelope[]), Stream.never)
  } as unknown as Client
  const connection = engineConnection({
    location: { protocol: "http:", host: "127.0.0.1:8787" }, debug() {},
    connect: options.open ?? (() => Effect.succeed(client)) as typeof connect,
    fetch: (async (path) => {
      posts.push(String(path))
      if (path === "/api/logout" && options.logout === "network") throw new Error("network")
      return { status: path === "/api/logout" ? options.logout ?? 204 : 204 }
    }) as typeof fetch
  })
  connections.push(connection)
  connection.open((patch) => Object.assign(state, patch))
  return { connection, state, posts, reads: () => reads }
}

describe("logout confirmation (findings 1 and 8)", () => {
  for (const result of [204, 403, 500, "network"] as const) it(`clears every mapped collection after real logout with ${result}`, async () => {
    const h = harness({ logout: result })
    await vi.waitFor(() => expect(h.state.projects?.length).toBe(2))
    await h.connection.signOut()
    expect(h.posts).toContain("/api/logout")
    for (const key of ["machines", "subscriptions", "repos", "projects", "teams", "agents", "requests", "worktrees", "sprints", "tasks"] as const) expect(h.state[key], key).toEqual([])
    expect(h.state.owner).toEqual({ name: "Owner", initials: "O" })
    expect(h.state.session?.status).toBe(result === 204 ? "out" : "logout-unconfirmed")
  })
})

describe("stream state (findings 3 and 4)", () => {
  for (const tag of ["AccountChanged", "AccountNeedsSignIn", "AccountAvailable", "AgentConfigurationChosen"]) {
    for (const oversized of [false, true]) it(`refreshes ${tag}${oversized ? " when oversized" : ""}`, async () => {
      const next = { ...engineSnapshot, sequence: 43, accounts: [{ id: "acct-main", enabled: false, status: "needs-sign-in", environment: [] }],
        agents: engineSnapshot.agents.map((a) => ({ ...a, model: "new-model", effort: "low" })) } as unknown as ClientSnapshot
      const item = oversized ? { _tag: "client.Oversized", sequence: 43, tag } : { sequence: 43, occurredAt: 1, event: { _tag: tag } }
      const h = harness({ next, items: [item] })
      await vi.waitFor(() => expect(h.reads()).toBe(2))
      expect(h.state.subscriptions?.[0]).toMatchObject({ enabled: false, signedIn: false })
      expect(h.state.agents?.[0]).toMatchObject({ model: "new-model", effort: "low" })
    })
  }
  it("recomputes activity when a signed-out agent resumes", async () => {
    const snapshot = { ...engineSnapshot, agents: engineSnapshot.agents.map((a) => a.agentId === "ag-lead" ? { ...a, state: { _tag: "paused", reason: "signed-out", midTurn: false }, displayedState: "Signed out" } : a) } as ClientSnapshot
    const h = harness({ snapshot, items: [{ sequence: 43, occurredAt: 1, event: { _tag: "StateChanged", agentId: "ag-lead", state: { _tag: "working" } } }] })
    await vi.waitFor(() => expect(h.state.agents?.[0]?.state).toBe("working"))
    expect(h.state.agents?.[0]?.activity).toBe("")
  })
})

it("becomes offline after 30 seconds of failed retries without inventing contact (finding 5)", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  let attempts = 0
  const h = harness({ open: (() => { attempts++; return Effect.fail(new ClientError({ message: "unavailable" })) }) as unknown as typeof connect })
  await vi.advanceTimersByTimeAsync(35_000)
  expect(attempts).toBeGreaterThan(3)
  expect(h.state.conn?.status).toBe("offline")
  expect(h.state.conn?.lastHeard).toBe(0)
})

it("retains the last successful contact throughout an outage (finding 5)", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  const client = { "client.snapshot": () => Effect.succeed(engineSnapshot), "project.settings": () => Effect.succeed({}),
    "client.subscribe": () => Stream.fail({ _tag: "TransportError" }) } as unknown as Client
  let attempts = 0
  const h = harness({ open: (() => ++attempts === 1 ? Effect.succeed(client) : Effect.fail(new ClientError({ message: "unavailable" }))) as typeof connect })
  await vi.advanceTimersByTimeAsync(35_000)
  expect(h.state.conn).toEqual({ status: "offline", lastHeard: 100_000 })
})

it("forgets records before logout returns and ignores an older session probe (findings 1 and 8)", async () => {
  let resolveProbe!: (value: { status: number }) => void
  let resolveLogout!: (value: { status: number }) => void
  let probes = 0
  const state: StorePatch = {}
  const client = { "client.snapshot": () => Effect.succeed(engineSnapshot), "project.settings": () => Effect.succeed({}), "client.subscribe": () => Stream.never } as unknown as Client
  const connection = engineConnection({
    location: { protocol: "http:", host: "127.0.0.1:8787" }, debug() {}, connect: (() => Effect.succeed(client)) as typeof connect,
    fetch: ((path: unknown) => {
      if (path === "/api/logout") return new Promise<{ status: number }>((resolve) => { resolveLogout = resolve })
      return ++probes === 1 ? Promise.resolve({ status: 204 }) : new Promise<{ status: number }>((resolve) => { resolveProbe = resolve })
    }) as typeof fetch
  })
  connections.push(connection)
  connection.open((patch) => Object.assign(state, patch))
  await vi.waitFor(() => expect(state.projects?.length).toBe(2))
  connection.reconnect()
  const signingOut = connection.signOut()
  expect(state.projects).toEqual([])
  resolveLogout({ status: 204 }); await signingOut
  resolveProbe({ status: 204 })
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(state.session?.status).toBe("out")
  expect(state.projects).toEqual([])
})
