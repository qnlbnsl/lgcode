import { record, safeJson, safeText } from "./text.ts";

export interface PermissionRequest {
  readonly permissionRequestId: string;
  readonly options: ReadonlyArray<{ readonly id: string }>;
}

export const answerRequest = async (
  client: { readonly answer: (input: { kind: "permission"; id: string; optionId: string }) => Promise<unknown> },
  request: PermissionRequest, optionId: string,
): Promise<void> => {
  if (!request.options.some((option) => option.id === optionId)) throw new Error("Choose an option from this request.");
  await client.answer({ kind: "permission", id: request.permissionRequestId, optionId });
};

export const promptAgent = async (
  client: { readonly prompt: (input: { agentId: string; text: string }) => Promise<unknown> },
  agentId: string, text: string,
): Promise<void> => { await client.prompt({ agentId, text }); };

export interface RequestContextClient {
  readonly event: (input: { sequence: number }) => Promise<{ readonly envelope: { readonly event: unknown } }>;
  readonly thread: (input: { agentId: string; after: number; limit: number }) => Promise<{
    readonly items: ReadonlyArray<{ readonly event: unknown }>;
    readonly next?: number;
  }>;
}
export interface ContextRequest {
  readonly agentId: string;
  readonly sequence: number;
  readonly toolCallId: string;
  readonly inputRedacted?: boolean;
  readonly inputTruncated?: boolean;
}

export const readRequestContext = async (client: RequestContextClient, request: ContextRequest): Promise<string> => {
  const event = record((await client.event({ sequence: request.sequence })).envelope.event);
  const redacted = event.inputRedacted === true || request.inputRedacted === true;
  const truncated = event.inputTruncated === true || request.inputTruncated === true;
  const warnings = [
    ...(redacted ? ["Part of the action's input is hidden, because redaction changed it."] : []),
    ...(truncated ? ["The action's input is cut at 8 KiB."] : []),
  ];
  const parts: Array<string> = [];
  if (event.toolKind !== undefined) parts.push(`Tool kind: ${safeText(String(event.toolKind))}`);
  if (event.locations !== undefined) parts.push(`Locations:\n${safeJson(event.locations)}`);
  if (event.toolInput !== undefined) parts.push(`Input:\n${safeJson(event.toolInput)}`);
  else if (!redacted && !truncated) {
    let after = 0;
    let found = false;
    do {
      const page = await client.thread({ agentId: request.agentId, after, limit: 100 });
      for (const item of page.items) {
        const threadEvent = record(item.event);
        const content = record(threadEvent.content);
        if (threadEvent._tag === "ThreadItem" && (content._tag === "tool-call" || content._tag === "toolCall")
          && (content.callId ?? content.toolCallId) === request.toolCallId) {
          found = true;
          parts.push(safeJson(content));
        }
      }
      if (page.next === undefined) break;
      if (page.next <= after) throw new Error("The thread cursor did not advance.");
      after = page.next;
    } while (true);
    if (!found) warnings.push("The action's input is not visible.");
  }
  return [...parts, ...warnings].join("\n");
};
