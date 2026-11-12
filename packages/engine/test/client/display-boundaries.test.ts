import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { configuredDisplay, displayConfiguration, displayHeaders, displayRequestAllowed } from "../../src/client/web/display/policy.ts"
import { defaultWebSettings, WebSettings } from "@lgtm/contracts"
import * as Schema from "effect/Schema"
import { openPencilImage, openPencilLaunch } from "../../src/client/web/display/openPencil.ts"
import { makeDisplaySessions } from "../../src/client/web/display/sessions.ts"
import { readDisplayResource } from "../../src/client/web/display/resources.ts"
import { displayUrl } from "../../src/client/web/display/url.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

registerRebuildCheck({ noLog: true })

let temporary: string | undefined
afterEach(async () => { if (temporary !== undefined) await rm(temporary, { recursive: true, force: true }); temporary = undefined })
const configuration = () => displayConfiguration("https://lgtm.example", "https://design.example", 4123)

it("uses the existing optional web settings and actual listening owner port for exact display configuration", () => {
  const settings = { ...defaultWebSettings, display: { publicAddress: "https://display.example", port: 4123 } }
  expect(Schema.is(WebSettings)(settings)).toBe(true)
  expect(configuredDisplay(settings, 8787)?.ownerOrigin).toBe("http://127.0.0.1:8787")
  expect(configuredDisplay({ ...settings, enabled: false }, 8787)).toBeUndefined()
  expect(configuredDisplay(defaultWebSettings, 8787)).toBeUndefined()
  expect(() => configuredDisplay(settings, 4123)).toThrow()
  expect(Schema.is(WebSettings)({ ...settings, display: { ...settings.display, port: 8787 } })).toBe(false)
  expect(Schema.is(WebSettings)({ ...settings, proxyMode: true, publicAddress: "https://display.example" })).toBe(false)
})

it("requires an explicit different HTTPS hostname and exposes no owner cookie, API or WebSocket policy", () => {
  for (const origin of ["https://lgtm.example:8443", "http://design.example", "https://design.example/path", "https://user@design.example", "https://design.example?x=1"]) {
    expect(() => displayConfiguration("https://lgtm.example", origin, 4123)).toThrow()
  }
  for (const port of [0, 65536, 1.5]) expect(() => displayConfiguration("https://lgtm.example", "https://design.example", port)).toThrow()
  const config = configuration(), headers = displayHeaders(config, "editor")
  expect(headers["content-security-policy"]).toContain("sandbox allow-scripts allow-same-origin;")
  const mockHeaders = displayHeaders(config, "mock")
  expect(mockHeaders["content-security-policy"]).toContain("sandbox allow-scripts;")
  expect(mockHeaders["content-security-policy"]).not.toContain("allow-same-origin")
  expect(headers["content-security-policy"]).toContain("frame-ancestors https://lgtm.example")
  expect(headers).not.toHaveProperty("access-control-allow-credentials")
  expect(headers).not.toHaveProperty("set-cookie")
  expect(displayRequestAllowed(config, { host: "design.example", origin: "null" }, "GET")).toBe(true)
  for (const extra of [{ cookie: "lgtm_session=private" }, { authorization: "Bearer private" }, { upgrade: "websocket" }, { host: "lgtm.example" }]) {
    expect(displayRequestAllowed(config, { host: "design.example", ...extra }, "GET")).toBe(false)
  }
  expect(displayRequestAllowed(config, { host: "design.example" }, "POST")).toBe(false)
})

it("delivers a redactor-registered scoped URL without requiring opaque-origin cookies, and revokes it on close or expiry", () => {
  let now = 0
  const secrets: string[] = [], sessions = makeDisplaySessions(configuration(), (value) => secrets.push(value), () => now)
  const target = { kind: "mock" as const, selection: { projectId: "project" as never, revisionId: "revision" as never, screenId: "screen" } }
  const first = sessions.issue(target), second = sessions.issue({ ...target, selection: { ...target.selection, projectId: "other" as never } })
  expect(secrets).toHaveLength(2)
  expect(first.base).toContain(secrets[0])
  expect(sessions.authorize(first.base)?.target).toEqual(target)
  const frame = first.mockUrl("/home?state=empty")
  expect(new URL(frame).pathname).toBe("/home")
  expect(new URL(frame).searchParams.get("state")).toBe("empty")
  expect(sessions.authorize(frame)?.id).toBe(first.id)
  expect(sessions.authorize("/theme.css", frame)?.id).toBe(first.id)
  const editor = new URL(first.editorUrl("actual.fig"))
  const privateFile = editor.searchParams.get("file")!
  expect(new URL(privateFile).protocol).toBe("https:")
  expect(new URL(privateFile).pathname).toMatch(/\.fig$/)
  expect(sessions.authorize(privateFile)?.id).toBe(first.id)
  expect(sessions.authorize("/assets/theme.css", first.base)?.id).toBe(first.id)
  expect(sessions.authorize("/api", first.base)).toBeUndefined()
  expect(sessions.authorize("/api/session", first.base)).toBeUndefined()
  expect(sessions.authorize("/assets/theme.css", "https://attacker.example/" + first.base)).toBeUndefined()
  expect(sessions.authorize("/session/invalid/assets/theme.css", first.base)).toBeUndefined()
  sessions.revoke(first.id)
  expect(sessions.authorize(first.base)).toBeUndefined()
  expect(sessions.authorize(second.base)?.id).toBe(second.id)
  now = second.expiresAt
  expect(sessions.authorize(second.base)).toBeUndefined()
  sessions.revokeAll()
  expect(sessions.authorize(second.base)).toBeUndefined()
})

it("reads actual current CSS and image bytes from one confined folder and refuses private names, links and wrong resource kinds", async () => {
  temporary = await mkdtemp(join(tmpdir(), "lgtm-display-"))
  const folder = join(temporary, "design")
  await mkdir(folder)
  const css = Buffer.from(".screen { color: #123456; background-image: url(image.png) }")
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  await writeFile(join(folder, "theme.css"), css); await writeFile(join(folder, "image.png"), png)
  await writeFile(join(folder, "actual.fig"), "actual registered file bytes")
  await writeFile(join(folder, ".env"), "private")
  await writeFile(join(temporary, "outside.css"), "outside")
  await symlink(join(temporary, "outside.css"), join(folder, "redirect.css"))
  const root = await realpath(folder), redact = async (text: string) => text
  expect((await readDisplayResource(root, "theme.css", "mock", redact)).bytes).toEqual(css)
  expect((await readDisplayResource(root, "image.png", "mock", redact)).bytes).toEqual(png)
  await writeFile(join(folder, "theme.css"), "changed current CSS")
  expect((await readDisplayResource(root, "theme.css", "mock", redact)).bytes.toString()).toBe("changed current CSS")
  for (const path of ["../outside.css", "redirect.css", ".env", "actual.fig", "https://attacker.example/theme.css", "file%2ecss"]) {
    await expect(readDisplayResource(root, path, "mock", redact)).rejects.toThrow()
  }
  await expect(readDisplayResource(root, "theme.css", "editor", redact)).rejects.toThrow()
  expect((await readDisplayResource(root, "actual.fig", "editor", redact)).bytes.toString()).toBe("actual registered file bytes")
  await expect(readDisplayResource(root, "actual.fig", "editor", async () => "redacted")).rejects.toThrow()
})


it("authorizes generated registered filenames and decodes them once for the actual confined reader without admitting traversal or encoded separators", async () => {
  temporary = await mkdtemp(join(tmpdir(), "lgtm-display-names-"))
  const folder = await realpath(temporary), config = configuration()
  const sessions = makeDisplaySessions(config, () => {})
  const frame = sessions.issue({ kind: "editor", selection: { repoId: "repository" as never } })
  for (const file of ["design.fig", "site design.fig", "草稿.fig", "草稿 design.pen", "draft#1.fig"]) {
    const bytes = Buffer.from(`registered bytes for ${file}`)
    await writeFile(join(folder, file), bytes)
    const privateFile = new URL(frame.editorUrl(file)).searchParams.get("file")!
    expect(sessions.authorize(privateFile)?.id).toBe(frame.id)
    const parsed = displayUrl(privateFile, config.displayOrigin)!
    const path = parsed.path.split("/").slice(4).join("/")
    expect(path).toBe(file)
    expect((await readDisplayResource(folder, path, "editor", async (text) => text)).bytes).toEqual(bytes)
    // The private child receives a single URL encoding of the literal path.
    expect(decodeURIComponent(path.split("/").map(encodeURIComponent).join("/"))).toBe(file)
  }
  for (const path of ["../outside.fig", "%2e%2e/outside.fig", "%2E./outside.fig", "nested%2foutside.fig", "nested%2Foutside.fig", "nested%5coutside.fig", "%252e%252e/outside.fig", "name%00.fig", "name%.fig", "name%FF.fig"]) {
    const raw = frame.base + "files/" + path
    expect(displayUrl(raw, config.displayOrigin)).toBeUndefined()
    expect(sessions.authorize(raw, frame.base)).toBeUndefined()
  }
  for (const file of ["../outside.fig", "nested/file.fig", "name%20.fig", "name\\file.fig"]) expect(() => frame.editorUrl(file)).toThrow()
  await writeFile(join(folder, ".env.fig"), "private")
  const privateName = displayUrl(frame.base + "files/%2eenv.fig", config.displayOrigin)!
  await expect(readDisplayResource(folder, privateName.path.split("/").slice(4).join("/"), "editor", async (text) => text)).rejects.toThrow()
  sessions.revoke(frame.id)
  expect(sessions.authorize(new URL(frame.editorUrl("site design.fig")).searchParams.get("file")!)).toBeUndefined()
})

it("serves typed bounded current TTF resources through the confined reader without admitting design-file access, secrets or links", async () => {
  temporary = await mkdtemp(join(tmpdir(), "lgtm-display-font-"))
  const folder = await realpath(temporary)
  // Synthetic resource bytes test transport identity, not browser font rendering.
  const bytes = Buffer.from([0, 1, 0, 0, 0, 0, 0, 0])
  await writeFile(join(folder, "interface font.ttf"), bytes)
  const font = await readDisplayResource(folder, "interface font.ttf", "mock", async (text) => text)
  expect(font.contentType).toBe("font/ttf")
  expect(font.bytes).toEqual(bytes)
  await expect(readDisplayResource(folder, "interface font.ttf", "editor", async (text) => text)).rejects.toThrow()
  await expect(readDisplayResource(folder, "interface font.ttf", "mock", async () => "redacted")).rejects.toThrow()
  await writeFile(join(folder, "large.ttf"), new Uint8Array(2 * 1024 * 1024 + 1))
  await expect(readDisplayResource(folder, "large.ttf", "mock", async (text) => text)).rejects.toThrow()
  await symlink(join(folder, "interface font.ttf"), join(folder, "linked.ttf"))
  await expect(readDisplayResource(folder, "linked.ttf", "mock", async (text) => text)).rejects.toThrow()
  await expect(readDisplayResource(folder, "../interface font.ttf", "mock", async (text) => text)).rejects.toThrow()
  expect(displayHeaders(configuration(), "editor")["content-security-policy"]).toContain("font-src https://design.example")
})

it("prepares the existing pinned browser/Caddy layout without a pull, network, owner environment or writable repository mount", () => {
  const launch = openPencilLaunch({ image: openPencilImage, folder: "/actual/design", socketDirectory: "/private/socket", name: "lgtm-editor-00000000-0000-0000-0000-000000000000", uid: 1000, gid: 1000 })
  expect(openPencilImage).toBe("lgtm-openpencil:w10b-cb71737-build1")
  expect(launch.args).toContain(openPencilImage)
  expect(launch.args).toContain("--pull=never")
  expect(launch.args).toContain("--read-only")
  expect(launch.args.slice(launch.args.indexOf("--cap-drop"), launch.args.indexOf("--cap-drop") + 4)).toEqual(["--cap-drop", "ALL", "--cap-add", "NET_BIND_SERVICE"])
  expect(launch.args).toContain("type=bind,src=/actual/design,dst=/files,readonly")
  expect(launch.args).toContain("none")
  expect(launch.args).not.toContain("--publish")
  expect(launch.args).not.toContain("--env")
  expect(launch.args).not.toContain("/var/run/docker.sock")
  const config = JSON.parse(launch.stdin)
  expect(config.admin.disabled).toBe(true)
  expect(config.apps.http.servers.editor.listen).toEqual(["unix//run/lgtm/editor.sock|0600"])
  expect(config).not.toHaveProperty("logging")
  expect(() => openPencilLaunch({ image: "latest", folder: "/actual/design", socketDirectory: "/private/socket", name: "bad", uid: 1000, gid: 1000 })).toThrow()
  for (const image of ["lgtm-openpencil:missing", "lgtm-openpencil:cb71737", "sha256:" + "a".repeat(64)]) {
    expect(() => openPencilLaunch({ image, folder: "/actual/design", socketDirectory: "/private/socket", name: "lgtm-editor-00000000-0000-0000-0000-000000000000", uid: 1000, gid: 1000 })).toThrow()
  }
})
