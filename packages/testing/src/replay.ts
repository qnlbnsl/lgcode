import { readFile } from "node:fs/promises"
import { isDeepStrictEqual } from "node:util"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
import { decodeProviderReplayNdjson } from "@shepherd/t3-provider-testing/replayTranscript"
import * as Effect from "effect/Effect"

class ReplayParseError extends Error {
  readonly lineNumber: number
  constructor(lineNumber: number) { super(`Invalid replay at line ${lineNumber}`); this.lineNumber = lineNumber }
}

export const parseReplay = (text: string) => decodeProviderReplayNdjson(text).pipe(
  Effect.mapError((error) => new ReplayParseError("lineNumber" in error ? error.lineNumber : 1))
)

// Replace in string values, including path suffixes, without interpreting frame text as code.
function materialize(value: unknown, workspace: string): unknown {
  if (typeof value === "string") return value.replaceAll("<workspace>", workspace)
  if (Array.isArray(value)) return value.map((item) => materialize(item, workspace))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, workspace)]))
  }
  return value
}

async function play() {
  const file = process.argv[2]
  const workspaceIndex = process.argv.indexOf("--workspace")
  if (file === undefined || workspaceIndex < 0 || process.argv[workspaceIndex + 1] === undefined) {
    throw new Error("Usage: replay.ts <fixture> --workspace <folder>")
  }
  const workspace = process.argv[workspaceIndex + 1]!
  const text = await readFile(file, "utf8")
  const transcript = await Effect.runPromise(parseReplay(text))
  const lineNumbers = text.split(/\r?\n/).flatMap((line, index) => line.trim() ? [index + 1] : []).slice(1)
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const frames = input[Symbol.asyncIterator]()
  try {
    for (const [index, entry] of transcript.entries.entries()) {
      if (entry.type === "runtime_exit") {
        if (entry.status !== "success") throw new Error(`Replay failed at entry ${lineNumbers[index]}`)
        return
      }
      if (entry.type === "emit_inbound") {
        if (entry.afterMs) await new Promise((resolve) => setTimeout(resolve, entry.afterMs))
        await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(materialize(entry.frame, workspace)) + "\n", (error) => error ? reject(error) : resolve()))
      } else {
        const next = await frames.next()
        let matches = false
        try { matches = !next.done && isDeepStrictEqual(JSON.parse(next.value), materialize(entry.frame, workspace)) } catch { /* No raw frame in errors. */ }
        if (!matches) {
          // Labels are untrusted recorded text; print only known harmless protocol labels.
          const label = ["initialize", "new session"].includes(entry.label ?? "") ? ` (${entry.label})` : ""
          throw new Error(`Replay mismatch at entry ${lineNumbers[index]}${label}`)
        }
      }
    }
  } finally { input.close(); process.stdin.pause() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  play().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Replay failed"
    // Effect's failure wrapper retains only our safe parser error.
    const line = /Invalid replay at line \d+/.exec(message)?.[0]
    process.stderr.write((line ?? (/^Replay (mismatch|failed) at entry \d+/.test(message) ? message : "Unable to replay fixture")) + "\n")
    process.exitCode = 1
  })
}
