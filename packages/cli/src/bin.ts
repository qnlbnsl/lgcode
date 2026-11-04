import { readFileSync } from "node:fs"
import * as Effect from "effect/Effect"
import { UsageError, parseArguments } from "./commands/parse.ts"
import { err, out } from "./commands/output.ts"
import { commandNames, helpText, matchCommand } from "./commands/registry.ts"
import { runCommand } from "./commands/run.ts"
import { setCarrierToken } from "./commands/carrierToken.ts"
import { setSecret } from "./commands/setSecret.ts"
import { serveDetach } from "./serve.ts"

const version = (): string =>
  (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version

const usage = (): string => [
  "Usage: shephrd <command> [options]", "",
  "Commands:",
  ...commandNames.map((name) => `  ${name}`),
  "  client wait --block <agent-id>...",
  "  thread export <agent-id> --out <file>",
  "  serve --detach",
  "  mcp", "",
  "Run shephrd <command> --help for a command's options.",
  "--version prints the version."
].join("\n") + "\n"

const main = (argv: ReadonlyArray<string>, environment: Readonly<Record<string, string | undefined>>): Effect.Effect<number> =>
  Effect.gen(function* () {
    const [first] = argv
    if (first === undefined || first === "--help" || first === "-h" || first === "help") { out(usage()); return 0 }
    if (first === "--version" || first === "-V") { out(`${version()}\n`); return 0 }
    if (first === "serve") {
      if (argv.includes("--help")) { out("Usage: shephrd serve --detach\n\nStart the engine service in the background, or report that it is already running.\n"); return 0 }
      if (argv.length !== 2 || argv[1] !== "--detach") { err("usage: shephrd serve --detach\n"); return 2 }
      return yield* serveDetach({ environment: environment as Record<string, string | undefined> }).pipe(
        Effect.map((result) => {
          out(result.outcome === "started" ? `started (pid ${result.pid})\n` : "already running\n")
          return 0
        }),
        Effect.catch((error) => Effect.sync(() => { err(`shephrd: ${error.message}\n`); return 1 }))
      )
    }
    if (first === "mcp") {
      if (argv.includes("--help")) { out("Usage: shephrd mcp\n\nServe Shephrd's agent commands to the calling agent over standard input and output.\nThe identity comes from SHEPHRD_SOCKET and SHEPHRD_TOKEN; no argument carries a credential.\n"); return 0 }
      if (argv.length > 1) { err("usage: shephrd mcp (takes no arguments; the agent token comes from SHEPHRD_TOKEN)\n"); return 2 }
      const { runMcp } = yield* Effect.promise(() => import("@shephrd/mcp"))
      return yield* runMcp({ environment })
    }
    const matched = matchCommand(argv)
    if (matched === undefined) { err(`shephrd: unknown command ${JSON.stringify(first.slice(0, 40))}; see shephrd --help\n`); return 2 }
    const { command, rest } = matched
    if (rest.includes("--help") || rest.includes("-h")) { out(helpText(command)); return 0 }
    if (command === "client.alerts.carrier.set-token") return yield* setCarrierToken(rest, environment)
    if (command === "accounts set-secret") return yield* setSecret(rest, environment)
    let parsed
    try { parsed = parseArguments(command, rest) } catch (error) {
      if (error instanceof UsageError) { err(`shephrd: ${error.message}\n`); return 2 }
      throw error
    }
    return yield* runCommand(command, parsed, environment)
  })

const exit = (code: number): void => {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)))
}

const fiber = Effect.runFork(main(process.argv.slice(2), process.env))
let signalCode: number | undefined
for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
  process.once(signal, () => {
    if (signalCode !== undefined) return
    signalCode = code
    // Interrupting closes the connection, which cancels a blocking wait.
    fiber.interruptUnsafe()
  })
}
fiber.addObserver((result) => {
  // A defect carries no message here: it could hold request text.
  if (result._tag !== "Success" && signalCode === undefined) err("shephrd: the command stopped unexpectedly\n")
  exit(signalCode ?? (result._tag === "Success" ? result.value : 1))
})
