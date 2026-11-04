// Keep navigation on the static index document. The web server serves files,
// and does not rewrite arbitrary application paths to index.html.
export const threadHref = (agentId: string, subject?: string) =>
  `/#/thread/${encodeURIComponent(agentId)}${subject === undefined ? "" : `?subject=${encodeURIComponent(subject)}`}`

export function threadLocation(href: string): { agentId?: string; subject?: string } {
  const url = new URL(href)
  const route = url.hash.startsWith("#/") ? new URL(url.hash.slice(1), url.origin) : url
  const match = /^\/threads?\/([^/]+)\/?$/.exec(route.pathname)
  if (match === null) return {}
  try {
    const agentId = decodeURIComponent(match[1]!)
    const subject = route.searchParams.get("subject") ?? url.searchParams.get("subject") ?? undefined
    return { agentId, ...(subject === undefined ? {} : { subject }) }
  } catch { return {} }
}
