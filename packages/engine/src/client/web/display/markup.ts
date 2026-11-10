import { parse, type DefaultTreeAdapterTypes } from "parse5"
import { displaySessionParameter } from "./sessions.ts"
import { displayUrl } from "./url.ts"

const unavailable = () => new Error("recorded resource address unavailable")
const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

// A delivery representation only: the caller has already verified the actual
// recorded artifact. This never writes files, issues authority or executes HTML.
// Nested CSS/module URLs and dynamic script-created URLs are not transformed.
export const scopeMockMarkup = (text: string, route: string, origin: string, token: string): string => {
  const selected = displayUrl(route, origin)
  if (selected === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable()
  const address = (reference: string): string | undefined => {
    if (reference === "" || reference.startsWith("#") || reference.startsWith("//")) return undefined
    if (/[\\\x00-\x1f\x7f]/u.test(reference) || reference !== reference.trim()) throw unavailable()
    // Check raw segments before URL normalization can conceal traversal. Only
    // a leading ./ is ordinary relative addressing; .. remains refused.
    const encoded = reference.replaceAll(" ", "%20")
    const relative = encoded.replace(/^(?:\.\/)+/u, "")
    const resolved = new URL(encoded, selected.url)
    if (resolved.protocol !== "https:" || resolved.origin !== origin || resolved.username || resolved.password) return undefined
    const raw = encoded.startsWith("/") || encoded.startsWith("https://") ? encoded
      : encoded.startsWith("?") ? selected.url.pathname + encoded
      : selected.url.pathname.slice(0, selected.url.pathname.lastIndexOf("/") + 1) + relative
    const checked = displayUrl(raw, origin)
    if (checked === undefined || checked.url.href !== resolved.href || checked.url.searchParams.has(displaySessionParameter)
      || checked.path === "/session" || checked.path.startsWith("/session/") || checked.path === "/api" || checked.path.startsWith("/api/")) throw unavailable()
    return `/session/${token}${checked.url.pathname}${checked.url.search}${checked.url.hash}`
  }
  let ambiguous = false
  const document = parse(text, { sourceCodeLocationInfo: true, onParseError: (error) => { if (error.code === "duplicate-attribute") ambiguous = true } })
  if (ambiguous) throw unavailable()
  const edits: Array<{ start: number; end: number; text: string }> = []
  const nodes: DefaultTreeAdapterTypes.Node[] = [document]
  while (nodes.length > 0) {
    const node = nodes.pop()!
    if ("childNodes" in node) nodes.push(...node.childNodes)
    if ("content" in node) nodes.push(node.content)
    if (!("tagName" in node) || node.namespaceURI !== "http://www.w3.org/1999/xhtml") continue
    const name = node.tagName === "script" || node.tagName === "img" ? "src"
      : node.tagName === "link" && node.attrs.find((attr) => attr.name === "rel")?.value.toLowerCase().split(/\s+/u).includes("stylesheet") ? "href" : undefined
    const attribute = name === undefined ? undefined : node.attrs.find((attr) => attr.name === name)
    if (attribute === undefined) continue
    const scoped = address(attribute.value)
    if (scoped === undefined) continue
    const location = node.sourceCodeLocation?.attrs?.[attribute.name]
    if (location === undefined || location.startOffset < 0 || location.endOffset > text.length || location.endOffset <= location.startOffset) throw unavailable()
    edits.push({ start: location.startOffset, end: location.endOffset, text: `${attribute.name}="${escapeAttribute(scoped)}"` })
  }
  edits.sort((a, b) => b.start - a.start)
  let boundary = text.length, result = text
  for (const edit of edits) {
    if (edit.end > boundary) throw unavailable()
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
    boundary = edit.start
  }
  return result
}
