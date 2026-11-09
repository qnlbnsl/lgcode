import { CommandsRpcGroup, commandAccess, type CallerKind } from "@lgcode/contracts"
import type * as Rpc from "effect/rpc/Rpc"
import type * as RpcGroup from "effect/rpc/RpcGroup"

export type CommandName = Rpc.Tag<RpcGroup.Rpcs<typeof CommandsRpcGroup>> | "client.wait" | "thread.export"

// The commands the lgcode command recognises are the requests of the RPC
// group, the same list the client builds its methods from; only the
// descriptions below are written here.
export const commandNames: ReadonlyArray<CommandName> = [...CommandsRpcGroup.requests.keys()] as Array<CommandName>

const summaries: Record<CommandName, string> = {
  "project.context.search": "Search readable project tasks and files in a registered local project workspace; returns typed references and truncation state.",
  "project.repository.discover": "Discover bounded local repositories inside the workspace folder.",
  "project.branches": "List actual branches of a registered local repository.",
  "project.checkouts": "List actual checkouts of a registered local repository.",
  "project.changes": "Read changed files in a registered workspace in your project.",
  "project.diff": "Read a bounded patch in a registered workspace in your project.",
  "project.history": "Read a bounded commit history in a registered workspace in your project.",
  "project.commit.files": "Read the files changed by a commit in your project.",
  "project.git.state": "Read actual branch, head, sync and merge state in your project.",
  "project.stage": "Stage a changed file in a registered local workspace.",
  "project.unstage": "Unstage a changed file in a registered local workspace.",
  "project.stage.all": "Stage all nonconflicting changed files in a registered workspace.",
  "project.unstage.all": "Unstage all nonconflicting staged files in a registered workspace.",
  "project.discard.plan": "Read the exact file list and fingerprint for confirmed discard.",
  "project.discard": "Discard unstaged changes using a current confirmed plan.",
  "project.commit": "Commit staged changes in a registered workspace.",
  "project.fetch": "Fetch origin for a registered local workspace.",
  "project.pull": "Fast-forward a clean registered local workspace from its upstream.",
  "project.push": "Publish the registered workspace branch to origin.",
  "project.integrate": "Merge a registered team workspace into its clean project workspace.",
  "project.review": "Read actual review evidence against a local base branch in your project.",
  "project.review.open": "Return a verified published GitHub compare URL; no pull request is created.",
  "project.conflict": "Read canonical conflict hunks in a registered workspace in your project.",
  "project.conflict.choose": "Choose a canonical conflict hunk after checking its fingerprint.",
  "project.conflict.resolve": "Resolve canonical conflict hunks from current confirmed choices.",

  "client.alerts.carrier.set": "Change the alert carrier.",
  "client.alerts.carrier.set-token": "Store the carrier token from standard input, after confirming the server.",
  "client.alerts.carrier.clear-token": "Clear the carrier token.",
  "client.alerts.retry": "Retry the displayed failed notification using its generation and attempt.",
  "client.alerts.test": "Send a test through the configured notification service.",
  "client.alerts.prompt.dismiss": "Remember the choice to decline the phone notification offer.",
  "client.alerts.list": "List alerts.",
  "client.alerts.dismiss": "Dismiss an alert.",
  "client.alerts.settings": "Read alert settings.",
  "client.alerts.settings.set": "Change an alert kind's push setting.",
  start: "Start an agent.",
  configure: "Choose an agent's model and/or effort for its next turn. Read client.agent.configuration for acknowledgement or refusal.",
  "client.agent.configuration": "Read an agent's desired and applied configuration and available choices.",
  "client.agent.context": "Read the latest reported context usage, or its unavailable state.",
  prompt: "Send a prompt to an agent.",
  answer: "Answer a permission request or a question that was passed to you.",
  "pass-up": "Pass a permission request or a question up to your lead.",
  ask: "Ask your lead a question.",
  wait: "Wait for agents to settle. With --block, hold this process until they do.",
  "cancel-reply": "Cancel the active reply and keep the agent running.",
  stop: "Stop an agent.",
  resume: "Resume an agent.",
  release: "Release an agent’s capacity hold.",
  compact: "Compact an agent's context.",
  group: "Add an agent to groups, or remove it from them.",
  accounts: "List, add, set, disable or remove accounts.",
  "accounts set-secret": "Store an account's secret, read from standard input.",
  "accounts mark-available": "Mark an account available again.",
  harnesses: "List, set or reset harness settings.",
  subscribe: "Print the event stream from a sequence.",
  "client.web.settings": "Read the web server settings and state.",
  "client.web.settings.set": "Change the web server settings.",
  "debug.compare-views": "Compare the live views with a rebuild (test services only).",
  "client.snapshot": "Read client.snapshot, the current team and its sequence.",
  "client.roster": "Read client.roster, filtered by group, role or parent.",
  "client.requests": "Read the durable request index and answered history.",
  "client.thread": "Read client.thread, one page of an agent's events.",
  "client.event": "Read client.event, a whole event by sequence.",
  "client.sequence": "Read client.sequence, the published views sequence.",
  "client.subscribe": "Follow client.subscribe, a filtered event stream.",
  "client.wait": "Wait for agents using the owner's client helper.",
  "thread.export": "Export a thread to a local file with mode 0600.",
  "board.open": "Open a plain channel or a channel bound to a group.",
  "board.members": "Add or remove members of a plain channel.",
  "board.post": "Write a post in a channel or to a direct target, and request replies when needed.",
  "board.close": "Withdraw an open post.",
  "board.acknowledge": "Mark an addressed post as taken up when you start responding.",
  "board.read": "Read a page of posts and mark the returned posts as read.",
  "board.peek": "Read a channel without advancing any read marks (owner only).",
  "board.channels": "List the channels you can read.",
  "board.status": "Read board counts, reply obligations and delivery status.",
  "board.flush": "Queue a board wake with an agent's unread posts and owed notices.",
  "project.settings": "Read project service defaults.",
  "project.settings.set": "Set the workspace folder, shell, and lead launch defaults.",
  "project.repository.add": "Register an existing local repository.",
  "project.repository.locate": "Record a verified local repository location.",
  "project.repositories": "List registered repositories.",
  "project.workspace.register": "Register an existing local checkout and its actual branch.",
  "project.workspaces": "List registered workspaces.",
  "project.create": "Create a local project and repository checkout, and start its lead.",
  "project.creations": "Read unfinished project creations and their owned folders for recovery.",
  "project.goal.set": "Change a project's goal.",
  "project.archive": "Stop every project agent and archive the project after confirmed stops.",
  "project.restore": "Restore an archived project without launching another lead.",
  "project.rename": "Rename a project within its repository.",
  "project.place": "Assign a stopped project to a registered workspace.",
  "project.preferences.set": "Set a project's preferred shell.",
  "project.stage.set": "Set your project's stage.",
  "project.requests": "Read current and answered project requests as the owner or actual lead.",
  "project.read": "Read a bounded page of project records.",
  "project.team.create": "Create a project team with its group board channel.",
  "project.sprint.create": "Create a sprint with its owner and dependencies.",
  "project.sprint.update": "Update a sprint before completion.",
  "project.sprint.complete": "Complete a sprint with evidence after its tasks and dependencies finish.",
  "project.task.create": "Assign a task to a team and an unfinished sprint.",
  "project.task.update": "Update a task you lead or own.",
  "project.task.note": "Append a timestamped task history note.",
  "project.task.history": "Read a bounded page of task history.",
  "roles.orient": "Read your team and role advice.",
  "roles.handoff": "Read an agent's handoff.",
  "roles.role-file.set": "Load a role file from its content.",
  "roles.role-file.get": "Read the loaded role file and its hash.",
  "roles.settings.get": "Read the sheepdog settings.",
  "roles.settings.set": "Change the sheepdog settings.",
  "roles.snooze": "Snooze a group's team-idle notices.",
  "roles.actions.list": "List the sheepdog's action records.",
  "roles.record": "Record a sheepdog action (service only)."
}

export const isCommand = (name: string): name is CommandName => (commandNames as ReadonlyArray<string>).includes(name)

// The longest command name that opens the arguments: "accounts set-secret"
// before "accounts".
export const matchCommand = (args: ReadonlyArray<string>): { readonly command: CommandName; readonly rest: ReadonlyArray<string> } | undefined => {
  const names: ReadonlyArray<CommandName> = [...commandNames, "client.wait", "thread.export"]
  const candidates = names.flatMap((command) => [
    { command, words: command.split(" ") },
    { command, words: command === "debug.compare-views" ? [command] : command.replaceAll(".", " ").split(" ") },
  ])
    .sort((a, b) => b.words.length - a.words.length)
  for (const { command, words } of candidates) {
    if (words.every((word, index) => args[index] === word)) return { command, rest: args.slice(words.length) }
  }
  return undefined
}

export const helpText = (command: CommandName): string => {
  const access: ReadonlyArray<CallerKind> = command in commandAccess ? commandAccess[command as keyof typeof commandAccess] : ["owner"]
  const callers = `Allowed callers: ${access.join(", ")}.\n` + (access.length === 1 && access[0] === "owner"
    ? "This command is for the owner's terminal; an agent's identity is refused.\n" : "")
  if (command === "accounts set-secret") {
    return [
      "Usage: lgcode accounts set-secret <account-id> <env-name>", "",
      summaries[command], callers,
      "Arguments:",
      "  <account-id>  The account the secret belongs to.",
      "  <env-name>    The environment variable the secret becomes for the agent.", "",
      "The secret is read from standard input, never from an argument, and is not echoed.",
      "Pipe it in, or type it at the prompt. One final newline is removed."
    ].join("\n") + "\n"
  }
  if (command === "client.alerts.carrier.set-token") return [
    "Usage: lgcode client alerts carrier set-token", "       lgcode client.alerts.carrier.set-token", "", summaries[command], callers,
    "Takes no arguments. Type yes to confirm the displayed server, then supply the token on standard input.",
    "The token is never echoed or accepted in --input."
  ].join("\n") + "\n"
  const options = [
    "Options:",
    "  --input <json>  The command's payload as one JSON object. A requestId is added when absent.",
    "  --help          Show this help."
  ]
  if (command === "thread.export") return `Usage: lgcode thread export <agent> --out <file>\n\nExport all thread pages to a file on this computer with mode 0600.\n${callers}\nUse the positional agent and --out; --input is not supported.\n`
  if (command === "wait" || command === "client.wait") {
    options.splice(1, 0,
      "  --block         Hold this process until the agents settle. Exit 1 if any crashed or stopped,",
      "                  else 2 if any paused or was interrupted, else 0.",
      "  --mode <any|all>  Wait for any one, or for all (default all).",
      "  <agent-id>...   The agents to wait for, with --block or --mode.")
  }
  if (command === "subscribe") options.splice(1, 0, "  --after <n>     Print events after this sequence (default 0).")
  const invocation = command === "debug.compare-views" ? command : command.replaceAll(".", " ")
  const usage = [`Usage: lgcode ${invocation} [options]`]
  if (invocation !== command) usage.push(`       lgcode ${command} [options]`)
  return [...usage, "", summaries[command], callers, ...options].join("\n").replace(/\n\n\n/g, "\n\n") + "\n"
}
