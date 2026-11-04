import * as RpcSchema from "effect/rpc/RpcSchema"
import * as Schema from "effect/Schema"
import { CommandsRpcGroup, commandAccess } from "@shephrd/contracts"

// The contract test pins the exact derived list, including future piece tools.
export const toolNames = [...CommandsRpcGroup.requests].filter(([name, rpc]) =>
  (commandAccess[name as keyof typeof commandAccess] as ReadonlyArray<string>).includes("agent")
  && !RpcSchema.isStreamSchema(rpc.successSchema) && name !== "accounts set-secret"
).map(([name]) => name).sort()
export type ToolName = typeof toolNames[number]

type JsonObject = Record<string, any>

// The tool's input is the command's payload without the request id, which the
// server makes. A union (answer) merges into one object whose required keys
// are those every branch needs.
const objectRoot = (schema: JsonObject): JsonObject => {
  const branches: Array<JsonObject> = schema.anyOf ?? [schema]
  const properties: JsonObject = {}
  let required: Array<string> | undefined
  for (const branch of branches) {
    for (const [key, value] of Object.entries<JsonObject>(branch.properties ?? {})) {
      if (key === "requestId") continue
      const previous = properties[key]
      properties[key] = previous === undefined ? value
        : previous.enum !== undefined && value.enum !== undefined
          ? { ...previous, enum: [...new Set([...previous.enum, ...value.enum])] }
          : previous
    }
    const keys = (branch.required ?? []).filter((key: string) => key !== "requestId")
    required = required === undefined ? keys : required.filter((key) => keys.includes(key))
  }
  return { type: "object", properties, required: required ?? [], additionalProperties: false }
}

export const inputSchema = (name: ToolName): JsonObject => {
  const rpc = CommandsRpcGroup.requests.get(name)
  if (rpc === undefined) throw new Error(`no ${name} command in the contract`)
  const document = Schema.toJsonSchemaDocument(rpc.payloadSchema as never) as { schema: JsonObject }
  return objectRoot(document.schema)
}

export const descriptions: Record<ToolName, string> = {
  start: "Start a new agent in a folder with a role, harness, account and permission level.",
  prompt: "Send a prompt to an agent.",
  answer: "Answer a permission request (kind permission, id, optionId) or a question (kind question, id, text) held for you.",
  "pass-up": "Pass a permission request or question up to the agent above you.",
  ask: "Ask the agent above you, or the owner, a question.",
  wait: "Wait for agents to settle. With block true the call stays open until the wait is satisfied or cancelled.",
  stop: "Stop an agent.",
  resume: "Resume a stopped or crashed agent; fresh true starts a new session.",
  compact: "Ask an agent to compact its context.",
  group: "Add or remove an agent's group memberships.",
  "roles.orient": "Read your team and role advice.",
  "roles.handoff": "Read a handoff for an agent you may manage."
}
