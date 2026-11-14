import { constants } from "node:fs"
import { open } from "node:fs/promises"
import * as Effect from "effect/Effect"
import { UsageError } from "./parse.ts"

// Read at most the limit plus one byte, including if a file grows after stat.
// The local path never enters the engine request or an operating-system command.
export const readMockEditorExport = (path: string) => Effect.tryPromise({ try: async () => {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await file.stat(), limit = 512 * 1024
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw new Error()
    const bytes = Buffer.alloc(limit + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, length)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    if (length < 1 || length > limit) throw new Error()
    return bytes.subarray(0, length).toString("base64")
  } finally { await file.close() }
}, catch: () => new UsageError("mock editor export must be a local file of at most 512 KiB") })
