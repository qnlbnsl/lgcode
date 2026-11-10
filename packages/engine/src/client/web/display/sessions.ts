import { randomBytes, randomUUID } from "node:crypto"
import { isRepositoryArtifactPath } from "@lgcode/contracts"
import type { MockDisplaySelection, DesignDisplaySelection } from "../../../project/display.ts"
import type { DisplayConfiguration } from "./policy.ts"
import { displayUrl } from "./url.ts"

type Selection = { readonly kind: "mock"; readonly selection: MockDisplaySelection }
  | { readonly kind: "editor"; readonly selection: DesignDisplaySelection }
type Entry = { readonly id: string; readonly token: string; readonly expiresAt: number; readonly target: Selection }
export const displaySessionParameter = "__lgcode_display_session"
const tokenPattern = /^[A-Za-z0-9_-]{43}$/

// Only the authenticated owner open handler may issue these private sessions.
// A token grants one verified project source/design folder, never owner API or
// cookie authority. It is registered before a URL containing it is returned.
export const makeDisplaySessions = (configuration: DisplayConfiguration, registerSecret: (secret: string) => void, now: () => number = Date.now) => {
  const entries = new Map<string, Entry>()
  const get = (token: string | undefined) => {
    const entry = token === undefined ? undefined : entries.get(token)
    return entry !== undefined && entry.expiresAt > now() ? entry : undefined
  }
  const tokenIn = (url: URL) => {
    if (url.origin !== configuration.displayOrigin) return undefined
    const query = url.searchParams.getAll(displaySessionParameter)
    if (query.length > 0) return query.length === 1 && tokenPattern.test(query[0]!) ? query[0] : undefined
    const part = url.pathname.split("/")
    return part[1] === "session" && tokenPattern.test(part[2] ?? "") ? part[2] : undefined
  }
  return {
    issue(target: Selection) {
      for (const [token, entry] of entries) if (entry.expiresAt <= now()) entries.delete(token)
      if (entries.size >= 8) throw new Error("close an existing display before opening another")
      const token = randomBytes(32).toString("base64url"), id = randomUUID()
      registerSecret(token)
      const entry = { id, token, target, expiresAt: now() + 10 * 60_000 }
      entries.set(token, entry)
      const base = `${configuration.displayOrigin}/session/${token}/`
      return { id, expiresAt: entry.expiresAt, base,
        mockUrl(route: string) {
          const url = new URL(route, configuration.displayOrigin)
          if (!route.startsWith("/") || route.startsWith("//") || url.origin !== configuration.displayOrigin || url.searchParams.has(displaySessionParameter)) throw new Error("recorded display route refused")
          url.searchParams.set(displaySessionParameter, token)
          return url.href
        },
        editorUrl(file: string) {
          if (!isRepositoryArtifactPath(file) || file.includes("/")) throw new Error("registered display filename refused")
          const url = new URL("/", configuration.displayOrigin)
          url.searchParams.set("file", new URL(`files/${encodeURIComponent(file)}`, base).href)
          return url.href
        } }
    },
    authorize(raw: string, referrer?: string) {
      try {
        const parsed = displayUrl(raw, configuration.displayOrigin)
        if (parsed === undefined) return undefined
        const { url, path } = parsed
        if (path === "/api" || path.startsWith("/api/")) return undefined
        const direct = tokenIn(url)
        // A malformed or expired explicit session never borrows a different
        // frame's Referrer. Root-relative assets may use the same-origin
        // Referrer from their already authorized frame or stylesheet.
        if (path.startsWith("/session/") || url.searchParams.has(displaySessionParameter)) return get(direct)
        const parent = referrer === undefined ? undefined : displayUrl(referrer, configuration.displayOrigin)?.url
        return get(parent === undefined ? undefined : tokenIn(parent))
      } catch { return undefined }
    },
    revoke(id: string) { for (const [token, entry] of entries) if (entry.id === id) entries.delete(token) },
    revokeAll() { entries.clear() }
  }
}
