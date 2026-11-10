// No repository value can choose a frame origin. Only explicit listener
// configuration enters this policy, after exact URL and hostname validation.
export const displayConfiguration = (ownerOrigin: string, displayOrigin: string, port: number) => {
  const owner = new URL(ownerOrigin), display = new URL(displayOrigin)
  if (!Number.isInteger(port) || port < 1 || port > 65535
    || ownerOrigin !== owner.origin || displayOrigin !== display.origin
    || display.protocol !== "https:" || display.hostname === owner.hostname
    || display.username || display.password || owner.username || owner.password
    || !["http:", "https:"].includes(owner.protocol)) throw new Error("isolated display configuration refused")
  return { ownerOrigin: owner.origin, displayOrigin: display.origin, displayHost: display.host, port } as const
}
export type DisplayConfiguration = ReturnType<typeof displayConfiguration>
export const configuredDisplay = (settings: WebSettings, ownerPort: number) => {
  if (!settings.enabled || settings.display === undefined) return undefined
  if (settings.display.port === ownerPort) throw new Error("isolated display listener conflicts with the owner listener")
  const owner = settings.proxyMode ? settings.publicAddress : `http://127.0.0.1:${ownerPort}`
  if (owner === undefined) throw new Error("isolated display owner origin is unavailable")
  return displayConfiguration(owner, settings.display.publicAddress, settings.display.port)
}
export const displayHeaders = (configuration: DisplayConfiguration, kind: "mock" | "editor") => ({
  "content-security-policy": ["default-src 'none'", kind === "editor" ? "sandbox allow-scripts allow-same-origin" : "sandbox allow-scripts", `frame-ancestors ${configuration.ownerOrigin}`,
    "base-uri 'none'", "form-action 'none'", "object-src 'none'", "frame-src 'none'",
    `script-src 'unsafe-inline' ${configuration.displayOrigin}${kind === "editor" ? " 'wasm-unsafe-eval'" : ""}`,
    `style-src 'unsafe-inline' ${configuration.displayOrigin}`, `img-src data: blob: ${configuration.displayOrigin}`,
    `font-src ${configuration.displayOrigin}`, `connect-src ${kind === "editor" ? configuration.displayOrigin : "'none'"}`,
    `worker-src ${kind === "editor" ? "blob:" : "'none'"}`].join("; "),
  "cache-control": "no-store", "referrer-policy": "same-origin", "x-content-type-options": "nosniff",
  // Mock module reads have an opaque Origin; the editor retains only its
  // separate display origin. Neither may supply credentials to this listener.
  "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()"
})
export const displayRequestAllowed = (configuration: DisplayConfiguration, headers: Readonly<Record<string, string | undefined>>, method: string) =>
  (method === "GET" || method === "HEAD") && headers.host === configuration.displayHost && headers.upgrade === undefined
  && headers.cookie === undefined && headers.authorization === undefined
  && headers["x-forwarded-host"] === undefined && headers.forwarded === undefined
import type { WebSettings } from "@lgcode/contracts"
