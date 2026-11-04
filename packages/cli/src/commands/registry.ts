import { CommandsRpcGroup, commandAccess, type CallerKind } from "@shephrd/contracts"
import type * as Rpc from "effect/rpc/Rpc"
import type * as RpcGroup from "effect/rpc/RpcGroup"

export type CommandName = Rpc.Tag<RpcGroup.Rpcs<typeof CommandsRpcGroup>> | "client.wait" | "thread.export"

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
  "debug.compare-views": "Compare the live views with a rebuild (test services only).",
  "client.snapshot": "Read client.snapshot, the current team and its sequence.",
  "client.roster": "Read client.roster, filtered by group, role or parent.",
  "client.thread": "Read client.thread, one page of an agent's events.",
  "client.event": "Read client.event, a whole event by sequence.",
  "client.sequence": "Read client.sequence, the published views sequence.",
  "client.subscribe": "Follow client.subscribe, a filtered event stream.",
  "client.wait": "Wait for agents using the owner's client helper.",
  "thread.export": "Export a thread to a local file with mode 0600."
}

export const isCommand = (name: string): name is CommandName => (commandNames as ReadonlyArray<string>).includes(name)

// The longest command name that opens the arguments: "accounts set-secret"
// before "accounts".
export const matchCommand = (args: ReadonlyArray<string>): { readonly command: CommandName; readonly rest: ReadonlyArray<string> } | undefined => {
  const names: ReadonlyArray<CommandName> = [...commandNames, "client.wait", "thread.export"]
  const direct = names.find((name) => name.includes(".") && args[0] === name)
  if (direct !== undefined) return { command: direct, rest: args.slice(1) }
  const candidates = names.map((command) => ({ command, words: command === "debug.compare-views" ? [command] : command.replaceAll(".", " ").split(" ") }))
    .sort((a, b) => b.words.length - a.words.length)
  for (const { command, words } of candidates) {
    if (words.every((word, index) => args[index] === word)) return { command, rest: args.slice(words.length) }
  }
  return undefined
}

export const helpText = (command: CommandName): string => {
  const access = command in commandAccess ? commandAccess[command as keyof typeof commandAccess] : ["owner"]
  const owner = !(access as ReadonlyArray<CallerKind>).includes("agent")
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
  if (command === "thread.export") return "Usage: shephrd thread export <agent> --out <file>\n\nExport all thread pages to a file on this computer with mode 0600.\n"
  if (command === "wait" || command === "client.wait") {
    options.splice(1, 0,
      "  --block         Hold this process until the agents settle. Exit 1 if any crashed or stopped,",
      "                  else 2 if any paused or was interrupted, else 0.",
      "  --mode <any|all>  Wait for any one, or for all (default all).",
      "  <agent-id>...   The agents to wait for, with --block or --mode.")
  }
  if (command === "subscribe") options.splice(1, 0, "  --after <n>     Print events after this sequence (default 0).")
  return [`Usage: shephrd ${command === "debug.compare-views" ? command : command.replaceAll(".", " ")} [options]`, "", summaries[command], owner, ...options].join("\n").replace(/\n\n\n/g, "\n\n") + "\n"
}
