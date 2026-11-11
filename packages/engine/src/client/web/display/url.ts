// Decode URL path segments once, before URL normalization can hide traversal.
// The returned path is a literal filesystem-relative candidate only after its
// session prefix is removed. The confined reader still checks the artifact
// schema, real path, links, resource kind and registered secrets.
export const displayUrl = (raw: string, origin: string): { readonly url: URL; readonly path: string } | undefined => {
  try {
    if (/[\\\x00-\x20\x7f]/u.test(raw) || raw.startsWith("//")) return undefined
    const match = /^(?:https:\/\/[^/?#]+)?(\/[^?#]*)?(?:[?#].*)?$/u.exec(raw)
    if (match === null || !raw.startsWith("/") && !raw.startsWith("https://")) return undefined
    const parts = (match[1] ?? "/").split("/").map((part) => decodeURIComponent(part))
    if (parts.some((part) => part === "." || part === ".." || /[/\\%\x00-\x1f\x7f]/u.test(part))) return undefined
    const url = new URL(raw, origin)
    if (url.origin !== origin) return undefined
    return { url, path: parts.join("/") }
  } catch { return undefined }
}
