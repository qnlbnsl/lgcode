import * as Effect from "effect/Effect"
import { expect, it } from "vitest"
import { call, ownerCredential } from "../support/handlerRig.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { http, login, post, readSettings, setSettings, withWeb } from "../support/webRig.ts"

registerRebuildCheck({ noLog: true })

// The existing temporary owner listener, cookie, database and settings are
// real. These controls never configure or start a display listener/editor.
it("keeps display routes behind the actual owner cookie, origin, bounded identity body and configured availability", async () => withWeb((ctx) => Effect.gen(function* () {
  const selection = { _tag: "editor", repoId: "registered-repository" }
  expect((yield* Effect.promise(() => post(ctx, "/api/display/open", selection))).status).toBe(401)
  const { cookie } = yield* login(ctx)
  expect((yield* Effect.promise(() => post(ctx, "/api/display/open", selection, { Cookie: cookie, Origin: "https://elsewhere.example" }))).status).toBe(403)
  expect((yield* Effect.promise(() => http(ctx, "/api/display/open", { headers: { Cookie: cookie } }))).status).toBe(405)
  for (const body of [{ ...selection, path: "/private/design.fig" }, { _tag: "editor", repoId: "" }, { _tag: "unknown" }]) {
    expect((yield* Effect.promise(() => post(ctx, "/api/display/open", body, { Cookie: cookie }))).status).toBe(400)
  }
  expect((yield* Effect.promise(() => post(ctx, "/api/display/open", { padding: "x".repeat(4096) }, { Cookie: cookie }))).status).toBe(413)
  expect((yield* Effect.promise(() => post(ctx, "/api/display/open", selection, { Cookie: cookie }))).status).toBe(503)
  expect((yield* Effect.promise(() => post(ctx, "/api/display/close", { id: "unknown-frame" }, { Cookie: cookie }))).status).toBe(204)
  expect((yield* Effect.promise(() => post(ctx, "/api/logout", undefined, { Cookie: cookie }))).status).toBe(204)
  expect((yield* Effect.promise(() => post(ctx, "/api/display/close", { id: "unknown-frame" }, { Cookie: cookie }))).status).toBe(401)
})))

it("persists display configuration through existing settings and adds only its exact frame origin without launching it", async () => withWeb((ctx) => Effect.gen(function* () {
  const configured = { ...ctx.settings, display: { publicAddress: "https://display.example", port: ctx.settings.port === 65535 ? 65534 : 65535 } }
  yield* setSettings(configured)
  expect(yield* readSettings).toMatchObject({ display: configured.display })
  const reply = yield* Effect.promise(() => http(ctx, "/", { headers: { Origin: undefined } }))
  expect(reply.headers["content-security-policy"]).toBe("default-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; frame-src https://display.example")
  expect(reply.headers["access-control-allow-origin"]).toBeUndefined()
  for (const display of [{ ...configured.display, port: ctx.settings.port }, { ...configured.display, publicAddress: "https://127.0.0.1" }]) {
    expect((yield* call(ownerCredential, "client.web.settings.set", { settings: { ...configured, display } }))._tag).toBe("Failure")
    expect(yield* readSettings).toMatchObject({ display: configured.display })
  }
  yield* setSettings(ctx.settings)
  const restored = yield* Effect.promise(() => http(ctx, "/", { headers: { Origin: undefined } }))
  expect(restored.headers["content-security-policy"]).not.toContain("frame-src")
})))
