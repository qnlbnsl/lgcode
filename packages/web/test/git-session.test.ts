import * as Effect from "effect/Effect"
import { afterEach, expect, it, vi } from "vitest"
import type { Client } from "@lgcode/client/browser"
import { createGitSession, pathLabel, safeFailure } from "../src/git/state.ts"
const browser = vi.hoisted(() => ({ client: {} as Client }))
vi.mock("../src/thread/client.ts", () => ({
  requestId: () => crypto.randomUUID(),
  withClient: <A, E>(operation: (client: Client) => Effect.Effect<A, E>) => Effect.runPromise(operation(browser.client))
}))
afterEach(() => vi.unstubAllGlobals())
it("retains a lost reply without replay and requires the same workspace refresh before a new owner choice", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const session = createGitSession(); session.setMutationDisabled(false)
  const payload = { requestId: "one-receipt", worktreeId: "source", message: "original message" }, seen: unknown[] = []
  let calls = 0, acknowledgments = 0
  const operation = () => { seen.push(payload); return ++calls === 1 ? Effect.fail({ _tag: "RpcClientError" }) : Effect.succeed({ head: "committed" }) }
  await session.execute("source", "Commit", operation, () => { acknowledgments++; return "Committed" }, vi.fn())
  expect(session.attempt?.status).toBe("uncertain")
  const competing = vi.fn(() => Effect.succeed(undefined))
  await session.execute("destination", "Push", competing, () => "Pushed", vi.fn())
  expect(competing).not.toHaveBeenCalled()
  const original = session.attempt!
  session.refreshed("destination", original)
  expect(session.attempt).toBe(original)
  session.refreshed("source", { ...original })
  expect(session.attempt).toBe(original)
  session.refreshed("source", original)
  expect(session.attempt?.status).toBe("terminal")
  expect(seen).toEqual([payload]); expect(acknowledgments).toBe(0)
  expect(session.get("source").notice).toBe("")
  expect(session.get("source").error).toContain("does not establish")
  await session.execute("destination", "Push", competing, () => "Pushed", vi.fn())
  expect(competing).toHaveBeenCalledOnce()
  session.close()
})
it("keeps draft changes made while a commit is pending and applies state updates from acknowledgment", async () => {
  const session = createGitSession(); session.setMutationDisabled(false); session.update("a", { message: "sent draft" })
  let complete!: (reply: { head: string }) => void
  const wait = new Promise<{ head: string }>((resolve) => { complete = resolve })
  const send = session.execute("a", "Commit", () => Effect.tryPromise(() => wait), () => {
    session.update("a", (current) => ({ ...(current.message === "sent draft" ? { message: "" } : {}), historyOpen: true })); return "Committed"
  }, vi.fn())
  session.update("a", { message: "next draft" }); session.update("b", { message: "other workspace" }); complete({ head: "new" }); await send
  expect(session.get("a")).toMatchObject({ message: "next draft", historyOpen: true, notice: "Committed", ready: false, revision: 1 })
  expect(session.get("b").message).toBe("other workspace"); session.close()
})
it("known refusals release the request while session close discards protected state", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const session = createGitSession(); session.setMutationDisabled(false)
  await session.execute("a", "Discard", () => Effect.fail({ _tag: "CommandError", reason: "Git: stale_state" }), () => "Discarded", vi.fn())
  expect(session.get("a").error).toContain("state changed"); expect(session.get("a").notice).toBe(""); expect(session.attempt).toBeUndefined()
  session.update("a", { message: "private draft" }); session.close(); session.update("a", { message: "late" })
  expect(session.get("a").message).toBe("")
})
it.each(["database read failed", "database write failed", "database write failed: constraint", "command refused", "Git outcome is uncertain; refresh Git state"])("retains a typed ambiguous %s without re-executing its original closure", async (reason) => {
  const probe = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal("fetch", probe)
  const session = createGitSession(); session.setMutationDisabled(false)
  const payload = { requestId: "frozen-receipt", message: "original body" }, seen: unknown[] = []; let count = 0
  const operation = () => { seen.push(payload); return ++count === 1 ? Effect.fail({ _tag: "CommandError", reason }) : Effect.succeed("receipt") }
  await session.execute("source", "Commit", operation, () => "Committed", vi.fn())
  expect(session.attempt?.status).toBe("uncertain"); expect(session.get("source").notice).toBe("")
  session.update("source", { message: "next draft" })
  const replacement = vi.fn(() => Effect.succeed("replacement"))
  await session.execute("source", "Commit", replacement, () => "Wrong", vi.fn()); expect(replacement).not.toHaveBeenCalled()
  expect(probe).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }))
  const original = session.attempt!
  expect(original.failure).toBe(reason.startsWith("Git outcome") ? "git-uncertain" : "unconfirmed")
  session.refreshed("source", original)
  expect(session.attempt?.status).toBe("terminal"); expect(seen).toEqual([payload])
  expect(session.get("source").message).toBe("next draft"); session.close()
})
it.each(["conflicts", "push_rejected", "pull_diverged", "network_failed", "authentication_required", "invalid_path"])("keeps the accepted fixed %s refusal distinct from Git uncertainty", async (reason) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const session = createGitSession(); session.setMutationDisabled(false)
  await session.execute("source", "Git", () => Effect.fail({ _tag: "CommandError", reason: `Git: ${reason}` }), () => "Wrong", vi.fn())
  expect(session.attempt).toBeUndefined(); expect(session.get("source").notice).toBe("")
  expect(session.get("source").error).not.toContain("uncertain"); session.close()
})
it("disposes a late successful mutation and an earlier refresh token without repopulating protected state", async () => {
  const session = createGitSession(); session.setMutationDisabled(false)
  let finish!: () => void
  const wait = new Promise<void>((resolve) => { finish = resolve })
  const acknowledge = vi.fn(() => "Wrong")
  const send = session.execute("source", "Commit", () => Effect.promise(() => wait), acknowledge, vi.fn())
  const original = session.attempt!
  session.close(); finish(); await send; session.refreshed("source", original)
  expect(acknowledge).not.toHaveBeenCalled(); expect(session.attempt).toBeUndefined()
  expect(session.get("source").message).toBe(""); expect(session.get("source").notice).toBe("")
})
it.each(["database write failed: constraint", "command refused", "Git: stale_state"])("probes expiry on typed %s and permits the shell to close protected state", async (reason) => {
  const session = createGitSession(); session.setMutationDisabled(false); session.update("source", { message: "private draft" })
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })))
  const expired = vi.fn(() => session.close())
  await session.execute("source", "Commit", () => Effect.fail({ _tag: "CommandError", reason }), () => "Wrong", expired)
  expect(expired).toHaveBeenCalledOnce(); expect(session.attempt).toBeUndefined(); expect(session.get("source").message).toBe("")
})
it("never surfaces raw remote exceptions or ambiguous control characters in paths", () => {
  expect(safeFailure({ _tag: "CommandError", reason: "https://user:secret@example.invalid/repo" }).message).not.toContain("secret")
  expect(safeFailure(new Error("secret stderr")).message).not.toContain("secret")
  expect(pathLabel("tab\tline\n<script>" )).toBe("tab\\tline\\n<script>")
})
