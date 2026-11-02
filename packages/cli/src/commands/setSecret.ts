import { randomUUID } from "node:crypto"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { connect } from "@shepherd/client"
import { UsageError } from "./parse.ts"
import { describeFailure, err, out } from "./output.ts"

const minimum = 16

// The secret is read from standard input only, never an argument, and a
// terminal does not echo it: raw mode, characters read one by one.
const readSecret = (): Promise<string> => new Promise((resolve, reject) => {
  const stdin = process.stdin
  if (stdin.isTTY !== true) {
    const chunks: Array<Buffer> = []
    stdin.on("data", (chunk: Buffer) => chunks.push(chunk))
    stdin.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    stdin.once("error", reject)
    return
  }
  process.stderr.write("Secret (input is hidden): ")
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding("utf8")
  let value = ""
  const finish = (action: () => void) => {
    stdin.setRawMode(false)
    stdin.pause()
    stdin.removeListener("data", onData)
    process.stderr.write("\n")
    action()
  }
  const onData = (text: string) => {
    for (const character of text) {
      if (character === "\r" || character === "\n" || character === "\u0004") return finish(() => resolve(value))
      if (character === "\u0003") return finish(() => reject(new UsageError("cancelled")))
      if (character === "\u007f" || character === "\b") value = value.slice(0, -1)
      else value += character
    }
  }
  stdin.on("data", onData)
})

export const setSecret = (
  args: ReadonlyArray<string>, environment: Readonly<Record<string, string | undefined>>
): Effect.Effect<number> => Effect.gen(function* () {
  if (args.length !== 2) {
    err("accounts set-secret takes <account-id> <env-name>; the secret is read from standard input, never from an argument\n")
    return 2
  }
  const [accountId, name] = args as [string, string]
  const text = yield* Effect.tryPromise({ try: readSecret, catch: (error) => error }).pipe(Effect.option)
  if (text._tag === "None") { err("the secret could not be read from standard input\n"); return 2 }
  // One final newline belongs to the pipe, not to the secret.
  const secret = text.value.replace(/\r?\n$/, "")
  if (secret.length < minimum) { err(`the secret must be at least ${minimum} characters\n`); return 2 }
  return yield* Effect.scoped(Effect.gen(function* () {
    const client = yield* connect({ environment })
    yield* client["accounts set-secret"]({
      requestId: randomUUID(), accountId, name, nonce: randomUUID(), value: Redacted.make(secret, { label: "secret value" })
    } as never)
    out(`secret stored for ${accountId}\n`)
    return 0
  })).pipe(Effect.catchCause((cause) => Effect.sync(() => {
    // The secret never reaches a message: report only the refusal's reason.
    const failure = cause.reasons.find((reason) => reason._tag === "Fail")
    err(`${describeFailure(failure !== undefined ? (failure as { error: unknown }).error : undefined)}\n`)
    return 1
  })))
})
