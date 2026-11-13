import { randomUUID } from "node:crypto"
import { connect } from "@lgtm/client"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { err, out } from "./output.ts"

// Both lines are consumed by one reader, including when a pipe supplies them
// in one chunk. Raw terminal input hides the token and is restored on cancel.
const readInput = Effect.callback<string, string>((resume) => {
  const stdin = process.stdin
  let text = ""; let confirmed = false; let skipLineFeed = false; let done = false
  const wasRaw = stdin.isRaw
  const cleanup = () => {
    stdin.removeListener("data", data); stdin.removeListener("end", end); stdin.removeListener("error", error)
    if (stdin.isTTY) { stdin.setRawMode(wasRaw); err("\n") }
    stdin.pause()
  }
  const finish = (result: Effect.Effect<string, string>) => {
    if (done) return
    done = true; cleanup(); resume(result)
  }
  const data = (chunk: Buffer | string) => {
    for (const character of chunk.toString()) {
      if (skipLineFeed && character === "\n") { skipLineFeed = false; continue }
      skipLineFeed = character === "\r"
      if (character === "\u0003") { finish(Effect.fail("cancelled")); return }
      if (stdin.isTTY && (character === "\u007f" || character === "\b")) { text = text.slice(0, -1); continue }
      if (character === "\r" || character === "\n") {
        if (!confirmed) {
          if (text.trim().toLowerCase() !== "yes") { finish(Effect.succeed("")); return }
          confirmed = true; text = ""; err("Token (input is hidden): "); continue
        }
        finish(Effect.succeed(text)); return
      }
      text += character
    }
  }
  const end = () => finish(Effect.succeed(confirmed ? text : ""))
  const error = () => finish(Effect.fail("standard input failed"))
  if (stdin.isTTY) stdin.setRawMode(true)
  stdin.on("data", data); stdin.once("end", end); stdin.once("error", error); stdin.resume()
  return Effect.sync(() => { if (!done) { done = true; cleanup() } })
})

export const setCarrierToken = (args: readonly string[], environment: Readonly<Record<string, string | undefined>>): Effect.Effect<number> => {
  if (args.length > 1 || (args[0] !== undefined && args[0] !== "email" && args[0] !== "ntfy")) {
    err("set-token accepts only an optional carrier name, ntfy or email; provide its secret on standard input\n")
    return Effect.succeed(2)
  }
  return Effect.scoped(Effect.gen(function* () {
    const client = yield* connect({ environment })
    const settings = yield* client["client.alerts.settings"]({ requestId: randomUUID() } as never)
    const name = args[0] ?? "ntfy"
    const carrier = name === "ntfy" ? settings.carrier : settings.carriers?.find((entry) => entry.name === name)?.carrier
    if (!carrier || carrier._tag === "none") { err("Set a carrier server before setting its secret.\n"); return 2 }
    const origin = carrier._tag === "email" ? JSON.stringify([carrier.host, carrier.port, carrier.security, carrier.username]) : carrier.server
    out(carrier._tag === "email" ? `Current email server: ${carrier.host}:${carrier.port} (${carrier.security}), user ${carrier.username}\n`
      : `Current carrier server: ${origin}\n`)
    err("Confirm this server by typing yes, then enter the password or token on the next line: ")
    const value = yield* readInput
    if (value.length === 0) { err("Token unchanged.\n"); return 2 }
    yield* client["client.alerts.carrier.set-token"]({ requestId: randomUUID(), ...(name === "email" ? { name } : {}), origin, nonce: randomUUID(), value: Redacted.make(value, { label: "secret value" }) } as never)
    out("Carrier token stored.\n")
    return 0
  })).pipe(Effect.catchCause(() => Effect.sync(() => { err("Carrier token could not be stored.\n"); return 1 })))
}
