import { CommandsRpcGroup, ownerOnlyCommands } from "@shephrd/contracts"
import type * as Rpc from "effect/rpc/Rpc"
import type * as RpcGroup from "effect/rpc/RpcGroup"

export type CommandName = Rpc.Tag<RpcGroup.Rpcs<typeof CommandsRpcGroup>>

// The commands the shephrd command recognises are the requests of the RPC
// group, the same list the client builds its methods from; only the
// descriptions below are written here.
export const commandNames: ReadonlyArray<CommandName> = [...CommandsRpcGroup.requests.keys()] as Array<CommandName>

const summaries: Record<CommandName, string> = {
  start: "Start an agent.",
  prompt: "Send a prompt to an agent.",
  answer: "Answer a permission request or a question that was passed to you.",
  "pass-up": "Pass a permission request or a question up to your lead.",
  ask: "Ask your lead a question.",
  wait: "Wait for agents to settle. With --block, hold this process until they do.",
  stop: "Stop an agent.",
  resume: "Resume an agent.",
  compact: "Compact an agent's context.",
  group: "Add an agent to groups, or remove it from them.",
  accounts: "List, add, set, disable or remove accounts.",
  "accounts set-secret": "Store an account's secret, read from standard input.",
  "accounts mark-available": "Mark an account available again.",
  harnesses: "List, set or reset harness settings.",
  subscribe: "Print the event stream from a sequence.",
  "debug.compare-views": "Compare the live views with a rebuild (test services only)."
}

export const isCommand = (name: string): name is CommandName => (commandNames as ReadonlyArray<string>).includes(name)

// The longest command name that opens the arguments: "accounts set-secret"
// before "accounts".
export const matchCommand = (args: ReadonlyArray<string>): { readonly command: CommandName; readonly rest: ReadonlyArray<string> } | undefined => {
  for (const words of [2, 1]) {
    const name = args.slice(0, words).join(" ")
    if (args.length >= words && isCommand(name)) return { command: name, rest: args.slice(words) }
  }
  return undefined
}

export const helpText = (command: CommandName): string => {
  const owner = (ownerOnlyCommands as ReadonlyArray<string>).includes(command)
    ? "This command is for the owner's terminal; an agent's identity is refused.\n" : ""
  if (command === "accounts set-secret") {
    return [
      "Usage: shephrd accounts set-secret <account-id> <env-name>", "",
      summaries[command], owner,
      "Arguments:",
      "  <account-id>  The account the secret belongs to.",
      "  <env-name>    The environment variable the secret becomes for the agent.", "",
      "The secret is read from standard input, never from an argument, and is not echoed.",
      "Pipe it in, or type it at the prompt. One final newline is removed."
    ].join("\n") + "\n"
  }
  const options = [
    "Options:",
    "  --input <json>  The command's payload as one JSON object. A requestId is added when absent.",
    "  --help          Show this help."
  ]
  if (command === "wait") {
    options.splice(1, 0,
      "  --block         Hold this process until the agents settle. Exit 1 if any crashed or stopped,",
      "                  else 2 if any paused or was interrupted, else 0.",
      "  --mode <any|all>  Wait for any one, or for all (default all).",
      "  <agent-id>...   The agents to wait for, with --block or --mode.")
  }
  if (command === "subscribe") options.splice(1, 0, "  --after <n>     Print events after this sequence (default 0).")
  return [`Usage: shephrd ${command} [options]`, "", summaries[command], owner, ...options].join("\n").replace(/\n\n\n/g, "\n\n") + "\n"
}
