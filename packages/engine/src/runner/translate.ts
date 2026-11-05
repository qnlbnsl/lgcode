import type { Event } from "@shephrd/contracts";

type Content = Extract<Event, { _tag: "ThreadItem" }>["content"];
export interface Translated {
  readonly kind: "message" | "plan" | "tool-call" | "file-change";
  // Issue 144: the speaker of a message chunk.
  readonly role?: "user" | "agent";
  readonly text: string;
  readonly content: Content;
}
const record = (value: unknown): Record<string, any> | undefined => typeof value === "object" && value !== null ? value as Record<string, any> : undefined;

// Terminal output and exits are correlated and streamed through the redactor
// by terminal.ts before this stateless translator handles the tool report.
// ACP has open unions. Unknown variants are data to ignore; known variants
// are checked again at the event boundary before they reach the writer.
export const translate = (value: unknown, replay: boolean): ReadonlyArray<Translated> => {
  const update = record(value);
  if (update === undefined) return [];
  if (update.sessionUpdate === "agent_message_chunk" || (replay && update.sessionUpdate === "user_message_chunk")) {
    const content = record(update.content);
    return content?.type === "text" && typeof content.text === "string"
      ? [{ kind: "message", role: update.sessionUpdate === "user_message_chunk" ? "user" : "agent", text: content.text, content: { _tag: "text", text: content.text } }] : [];
  }
  const entries = update.sessionUpdate === "plan" ? update.entries
    : update.sessionUpdate === "plan_update" && update.plan?.type === "items" ? update.plan.entries : undefined;
  if (Array.isArray(entries)) return [{ kind: "plan", text: JSON.stringify(entries), content: { _tag: "plan", entries } }];
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return [];
  const correlation = typeof update.toolCallId === "string" && update.toolCallId !== "" ? { callId: update.toolCallId } : {};
  const content = Array.isArray(update.content) ? update.content : [];
  const diffs: Translated[] = content.flatMap((part: any) => {
    if (part?.type !== "diff") return [];
    if (typeof part.path === "string") return [{ kind: "file-change" as const, text: part.newText ?? "", content: { _tag: "file-change" as const, ...correlation, path: part.path, diff: part.newText ?? "" } }];
    return (part.changes ?? []).filter((change: any) => typeof change.path === "string").map((change: any) => ({
      kind: "file-change" as const, text: part.patch?.text ?? "", content: { _tag: "file-change" as const, ...correlation, path: change.path, diff: part.patch?.text ?? "" },
    }));
  });
  if (diffs.length > 0) return diffs;
  if (typeof update.toolCallId !== "string" || update.toolCallId === "") return [];
  return [{ kind: "tool-call", text: JSON.stringify(update), content: {
    _tag: "tool-call", callId: update.toolCallId, title: typeof update.title === "string" ? update.title : "",
    status: ["pending", "in_progress", "completed", "failed"].includes(update.status) ? update.status : "pending",
    ...(update.rawInput === undefined ? {} : { input: JSON.stringify(update.rawInput) }),
    output: update.rawOutput === undefined ? JSON.stringify(content) : JSON.stringify(update.rawOutput),
  } }];
};
