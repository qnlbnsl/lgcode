import { realpath } from "node:fs/promises"
import { extname } from "node:path"
import { isRepositoryArtifactPath } from "@lgtm/contracts"
import { fingerprint } from "../../../project/artifacts.ts"
import { filePath, smallFile } from "../../../project/git/paths.ts"

const types: Readonly<Record<string, readonly [string, number]>> = {
  ".css": ["text/css; charset=utf-8", 256 * 1024],
  ".js": ["text/javascript; charset=utf-8", 256 * 1024],
  ".mjs": ["text/javascript; charset=utf-8", 256 * 1024],
  ".svg": ["image/svg+xml", 256 * 1024],
  ".png": ["image/png", 2 * 1024 * 1024],
  ".jpg": ["image/jpeg", 2 * 1024 * 1024],
  ".jpeg": ["image/jpeg", 2 * 1024 * 1024],
  ".webp": ["image/webp", 2 * 1024 * 1024],
  ".gif": ["image/gif", 2 * 1024 * 1024],
  ".woff": ["font/woff", 2 * 1024 * 1024],
  ".woff2": ["font/woff2", 2 * 1024 * 1024],
  ".ttf": ["font/ttf", 2 * 1024 * 1024],
  ".fig": ["application/octet-stream", 1024 * 1024],
  ".pen": ["application/octet-stream", 1024 * 1024]
}

// The caller supplies an engine-verified, canonical registered source or design
// folder, never a browser filesystem root. One folder boundary serves all its
// admitted resources. There is no per-file authority or directory enumeration.
export const readDisplayResource = async (folder: string, path: string, kind: "mock" | "editor", redact: (text: string) => Promise<string>) => {
  if (!isRepositoryArtifactPath(path) || await realpath(folder) !== folder) throw new Error("display resource unavailable")
  const extension = extname(path).toLowerCase(), type = types[extension]
  if (type === undefined || (kind === "editor") !== [".fig", ".pen"].includes(extension)) throw new Error("display resource unavailable")
  const bytes = await smallFile(await filePath(folder, path), type[1])
  // Refuse a registered secret even in a nominally binary file; do not mutate
  // bytes or claim that a redacted asset still has its original fingerprint.
  const text = new TextDecoder().decode(bytes)
  if (await redact(text) !== text) throw new Error("display resource unavailable")
  return { bytes, contentType: type[0], fingerprint: fingerprint(bytes) }
}
