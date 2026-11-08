import { randomUUID } from "node:crypto"
import { type CommandName } from "./registry.ts"

export class UsageError extends Error {}

export interface Parsed {
  readonly help: boolean
  readonly payload: Record<string, unknown> | undefined
  // wait --block: hold this process until the wait settles
  readonly block: boolean
  readonly out?: string
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

// RPC commands take their whole non-secret payload as --input JSON. wait and
// subscribe also take short forms. The local thread export takes only an agent
// and --out, so its destination never becomes part of an RPC payload.
export const parseArguments = (command: CommandName, args: ReadonlyArray<string>): Parsed => {
  let help = false
  let input: Record<string, unknown> | undefined
  let block = false
  let mode: string | undefined
  let after: string | undefined
  let out: string | undefined
  const isWait = command === "wait" || command === "client.wait"
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
    else if (isWait && flag === "--block") block = true
    else if (isWait && flag === "--mode") mode = value()
    else if (command === "subscribe" && flag === "--after") after = value()
    else if (command === "thread.export" && flag === "--out") out = value()
    else if ((isWait || command === "thread.export") && !arg.startsWith("-")) members.push(arg)
    else throw new UsageError(`unexpected argument ${JSON.stringify(arg.slice(0, 40))}; see lgcode ${command} --help`)
  }
  if (help) return { help, payload: undefined, block }
  if (command === "thread.export") {
    if (input !== undefined) throw new UsageError("thread export does not accept --input; use thread export <agent> --out <file>")
    if (members.length !== 1 || out === undefined || out.trim().length === 0) throw new UsageError("thread export needs one agent id and --out <file>")
    return { help, block, out, payload: { agentId: members[0] } }
  }
  const short = block || mode !== undefined || after !== undefined || members.length > 0
  if (input !== undefined && short) throw new UsageError("use either --input or the short options, not both")
  if (input !== undefined) {
    return { help, block: isWait && input.block === true, payload: { requestId: randomUUID(), ...input } }
  }
  if (isWait) {
    if (members.length === 0) throw new UsageError("wait needs --input, or at least one agent id")
    if (mode !== undefined && mode !== "any" && mode !== "all") throw new UsageError("--mode must be any or all")
    return { help, block, payload: { requestId: randomUUID(), members, mode: mode ?? "all", block } }
  }
  if (command === "subscribe") {
    const sequence = Number(after ?? "0")
    if (!Number.isInteger(sequence) || sequence < 0) throw new UsageError("--after must be a whole number from 0")
    return { help, block, payload: { requestId: randomUUID(), after: sequence } }
  }
  if (command === "client.alerts.carrier.clear-token") return { help, block, payload: { requestId: randomUUID() } }
  throw new UsageError(`${command} needs --input '<JSON payload>'; see lgcode ${command} --help`)
}
