import { out } from "./output.ts"
import { sanitize } from "./sanitize.ts"

interface WaitReply {
  readonly outcome: "opened" | "satisfied" | "request-held" | "cancelled"
  readonly members: ReadonlyArray<{ readonly agentId: string; readonly reason: string }>
}

// Row 62's exit code for a settled wait: 1 when any member crashed or was
// stopped, else 2 when any is paused or was interrupted, else 0. The whole
// member list decides, never its first or last entry. Row 26: a held request
// or question routed to the caller exits 2, because the caller must answer.
export const reportWait = (reply: WaitReply): number => {
  switch (reply.outcome) {
    case "opened":
      out(`wait opened for ${reply.members.length} member${reply.members.length === 1 ? "" : "s"}\n`)
      return 0
    case "request-held":
      out("request held: a member is holding a permission or question request for you; answer it, then wait again\n")
      return 2
    case "cancelled":
      process.stderr.write("wait cancelled\n")
      return 1
    case "satisfied": {
      for (const member of reply.members) out(`${sanitize(member.agentId)} ${member.reason}\n`)
      const reasons = reply.members.map((member) => member.reason)
      if (reasons.some((reason) => reason === "crashed" || reason === "stopped")) return 1
      if (reasons.some((reason) => reason === "paused" || reason === "interrupted")) return 2
      return 0
    }
  }
}
