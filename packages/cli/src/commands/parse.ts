import { randomUUID } from "node:crypto"
import { type CommandName } from "./registry.ts"

export class UsageError extends Error {}

export interface Parsed {
  readonly help: boolean
  readonly payload: Record<string, unknown> | undefined
  // wait --block: hold this process until the wait settles
  readonly block: boolean
}

const takeValue = (args: ReadonlyArray<string>, index: number, flag: string): string => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`)
  return value
}

const object = (text: string): Record<string, unknown> => {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new UsageError("--input is not valid JSON") }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UsageError("--input must be a JSON object")
  return value as Record<string, unknown>
}

// Every non-secret command takes its whole payload as --input JSON. wait and
// subscribe also take the short forms their help shows.
export const parseArguments = (command: CommandName, args: ReadonlyArray<string>): Parsed => {
  let help = false
  let input: Record<string, unknown> | undefined
  let block = false
  let mode: string | undefined
  let after: string | undefined
  const members: Array<string> = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined]
    const value = (): string => {
      if (inline !== undefined) return inline
      const next = takeValue(args, index, flag)
      index++
      return next
    }
    if (flag === "--help" || flag === "-h") help = true
    else if (flag === "--input") input = object(value())
    else if (command === "wait" && flag === "--block") block = true
    else if (command === "wait" && flag === "--mode") mode = value()
    else if (command === "subscribe" && flag === "--after") after = value()
    else if (command === "wait" && !arg.startsWith("-")) members.push(arg)
    else throw new UsageError(`unexpected argument ${JSON.stringify(arg.slice(0, 40))}; see shepherd ${command} --help`)
  }
  if (help) return { help, payload: undefined, block }
  const short = block || mode !== undefined || after !== undefined || members.length > 0
  if (input !== undefined && short) throw new UsageError("use either --input or the short options, not both")
  if (input !== undefined) {
    return { help, block: command === "wait" && input.block === true, payload: { requestId: randomUUID(), ...input } }
  }
  if (command === "wait") {
    if (members.length === 0) throw new UsageError("wait needs --input, or at least one agent id")
    if (mode !== undefined && mode !== "any" && mode !== "all") throw new UsageError("--mode must be any or all")
    return { help, block, payload: { requestId: randomUUID(), members, mode: mode ?? "all", block } }
  }
  if (command === "subscribe") {
    const sequence = Number(after ?? "0")
    if (!Number.isInteger(sequence) || sequence < 0) throw new UsageError("--after must be a whole number from 0")
    return { help, block, payload: { requestId: randomUUID(), after: sequence } }
  }
  throw new UsageError(`${command} needs --input '<JSON payload>'; see shepherd ${command} --help`)
}
