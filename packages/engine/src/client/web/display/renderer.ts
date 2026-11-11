import * as Effect from "effect/Effect"
import type { Input } from "../../../commands/internal.ts"
import { mockDisplay, componentDisplay } from "../../../project/display.ts"
import { displayHeaders, displayRequestAllowed, type DisplayConfiguration } from "./policy.ts"
import { readDisplayResource } from "./resources.ts"
import { displaySessionParameter, type makeDisplaySessions } from "./sessions.ts"
import { displayUrl } from "./url.ts"
import { scopeMockMarkup } from "./markup.ts"

export type DisplayResponse = { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array }
const empty = (status: number): DisplayResponse => ({ status, headers: { "cache-control": "no-store" }, body: new Uint8Array() })

// This is an engine response handler, not another mock process. The owner
// listener must authorize session issuance; the isolated listener calls only
// this handler, with no owner headers or API forwarding.
export const makeMockRenderer = (options: {
  readonly configuration: DisplayConfiguration
  readonly sessions: ReturnType<typeof makeDisplaySessions>
  readonly input: () => Promise<Input>
}) => async (request: { readonly url: string; readonly method: string; readonly headers: Readonly<Record<string, string | undefined>> }): Promise<DisplayResponse> => {
  const { configuration, sessions } = options
  if (!displayRequestAllowed(configuration, request.headers, request.method)) return empty(403)
  const session = sessions.authorize(request.url, request.headers.referer)
  if (session === undefined) return empty(401)
  if (session.target.kind === "editor") return empty(404)
  try {
    const input = await options.input()
    const current = session.target.kind === "component"
      ? await Effect.runPromise(componentDisplay(input, session.target.selection))
      : await Effect.runPromise(mockDisplay(input, session.target.selection))
    const parsed = displayUrl(request.url, configuration.displayOrigin)
    if (parsed === undefined) return empty(404)
    const { url } = parsed
    url.searchParams.delete(displaySessionParameter)
    const selected = new URL(current.route, configuration.displayOrigin)
    const parts = url.pathname.split("/")
    if (parts[1] === "session") url.pathname = "/" + parts.slice(3).join("/")
    const headers = displayHeaders(configuration, "mock")
    if (url.pathname === selected.pathname && url.searchParams.toString() === selected.searchParams.toString()) {
      const text = current.contentType.startsWith("text/html") ? scopeMockMarkup(current.text, current.route, configuration.displayOrigin, session.token, session.target.kind === "component") : current.text
      if (sessions.authorize(request.url, request.headers.referer)?.id !== session.id) return empty(401)
      return { status: 200, headers: { ...headers, "content-type": current.contentType }, body: request.method === "HEAD" ? new Uint8Array() : Buffer.from(text) }
    }
    // Retain the existing redirect for an explicitly authorized root request.
    // Delivered HTML's direct resources already carry scope and need no
    // Referrer. Nested root URLs in CSS/modules remain unsupported.
    if (parts[1] !== "session") {
      const prefix = `/session/${session.token}`
      const location = new URL(prefix + url.pathname + url.search, configuration.displayOrigin)
      return { status: 307, headers: { ...headers, location: location.href }, body: new Uint8Array() }
    }
    const resource = await readDisplayResource(current.folder, parsed.path.split("/").slice(3).join("/"), "mock", (text) => Effect.runPromise(input.runtime.log.redactText(text)))
    if (sessions.authorize(request.url, request.headers.referer)?.id !== session.id) return empty(401)
    return { status: 200, headers: { ...headers, "content-type": resource.contentType }, body: request.method === "HEAD" ? new Uint8Array() : resource.bytes }
  } catch {
    // Do not serialize repository values, requests, private URLs or failures.
    return empty(404)
  }
}
