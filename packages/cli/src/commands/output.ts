import type { EventEnvelope } from "@shepherd/contracts"
import { sanitize, sanitizeJson } from "./sanitize.ts"

export const out = (text: string): void => { process.stdout.write(text) }
export const err = (text: string): void => { process.stderr.write(sanitize(text)) }

// One line per event. Thread text is printed as text; everything else as JSON.
export const formatEvent = (envelope: EventEnvelope): string => {
  const event = envelope.event
  if (event._tag === "ThreadItem" && event.content._tag === "text") {
    return `${envelope.sequence} ${event.agentId}: ${sanitize(event.content.text)}\n`
  }
  return `${envelope.sequence} ${event._tag} ${sanitizeJson(event)}\n`
}

export const describeFailure = (error: unknown): string => {
  const tagged = error as { _tag?: string; reason?: unknown; message?: unknown } | null
  if (tagged?._tag === "CommandError" && typeof tagged.reason === "string") return `the engine refused the command: ${tagged.reason}`
  if (tagged?._tag === "ClientError" && typeof tagged.message === "string") return tagged.message
  if (tagged?._tag === "RpcClientError") return "the connection to the engine failed"
  return typeof tagged?.message === "string" ? tagged.message.split("\n")[0]!.slice(0, 300) : "the command failed"
}
