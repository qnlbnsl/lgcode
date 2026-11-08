import { randomBytes } from "node:crypto";
import type { Caller, Sender } from "@lgcode/contracts";

// Decision rows 38 and 58. A prompt an agent sends to another agent must not
// start with a slash command, after any leading whitespace: every Unicode
// White_Space character, and the invisible format characters (Cf) such as
// U+200B and U+FEFF. The owner's own prompts are never passed through here.
export const escapeLeadingSlash = (text: string): string => text.replace(/^([\p{White_Space}\p{Cf}]*)\//u, "$1\\/");

// Wraps data the engine passes from one agent to another. The marker comes
// from a cryptographic source and is fresh for every envelope, so a closing
// line copied from an earlier envelope cannot end this one. A marker that
// happens to occur in the body or the id is drawn again.
export const envelope = (deliveryId: string, text: string, sender?: Sender): string => {
  let marker = randomBytes(18).toString("base64url");
  while (text.includes(marker) || deliveryId.includes(marker)) marker = randomBytes(18).toString("base64url");
  const label = sender?._tag === "service" ? `Data from service ${sender.service}`
    : sender?._tag === "piece" ? `Data from piece ${sender.namespace}` : "Data from another agent";
  return `${label} [${marker}] (delivery ${deliveryId}):\n${text}\nEnd data [${marker}]`;
};

// A prompt's text as its target receives it: an agent's is escaped and
// wrapped, and the owner's is passed on unchanged.
export const agentText = (sender: Sender, deliveryId: string, text: string): string =>
  sender._tag === "owner" ? text : envelope(deliveryId, escapeLeadingSlash(text), sender);

export const senderOf = (caller: Caller): Sender => caller._tag === "service"
  ? { _tag: "service", service: caller.service } : caller;
