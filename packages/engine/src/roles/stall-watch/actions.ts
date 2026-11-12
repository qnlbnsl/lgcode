import type { RolesAction } from "@lgtm/contracts";
import { executeService } from "../../commands/services.ts";
import type { EngineLists } from "../../pieces/lists.ts";
import { stallWatchCaller } from "./notices.ts";
import { actionRequestId, actionSubject } from "./requests.ts";

// The rule decides once, then uses this identity for each retry of its engine
// command. Its subsequent roles.record has a separate deterministic id.
export const callForAction = (
  action: Pick<RolesAction, "_tag" | "agentId" | "triggerSequence" | "noticeRecipient" | "occurrence"> & { readonly group?: string },
  rule: string, command: "prompt" | "compact" | "resume" | "release", payload: Readonly<Record<string, unknown>>, lists: EngineLists,
) => executeService(stallWatchCaller, command, {
  ...payload, agentId: action.agentId,
  requestId: actionRequestId({ rule, subject: actionSubject(action), triggerSequence: action.triggerSequence,
    kind: `${action._tag}.${command}`, recipient: action.noticeRecipient, occurrence: action.occurrence }),
}, lists);
