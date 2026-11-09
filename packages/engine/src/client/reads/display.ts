import type { EventEnvelope } from "@lgcode/contracts";

export const encodedBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
export const cutUtf8 = (value: string, budget: number): string => {
  let bytes = 0;
  let result = "";
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > budget) break;
    result += char; bytes += size;
  }
  return result;
};
export const cutGroups = (groups: ReadonlyArray<string>): string[] => {
  const result: string[] = []; let remaining = 128;
  for (const group of groups.slice(0, 8)) {
    const cut = cutUtf8(group, remaining);
    if (cut.length === 0 && group.length > 0) break;
    result.push(cut); remaining -= Buffer.byteLength(cut);
  }
  return result;
};
const toolKinds = new Set(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"]);
const optionKinds = new Set(["allow_once", "allow_always", "reject_once", "reject_always"]);
export const display = (envelope: EventEnvelope) => {
  const event = envelope.event;
  if (event._tag !== "PermissionRequested" && event._tag !== "QuestionAsked") return undefined;
  const options = event._tag === "PermissionRequested" ? event.options : [];
  const result = {
    preview: cutUtf8(event._tag === "PermissionRequested" ? event.description : event.text, 512),
    options: [] as Array<(typeof options)[number]>, optionCount: options.length,
    ...(event._tag === "PermissionRequested" ? {
      settingsWrite: event.settingsWrite, inputAvailable: event.toolInput !== undefined,
      ...(event.inputRedacted === undefined ? {} : { inputRedacted: event.inputRedacted }),
      ...(event.inputTruncated === undefined ? {} : { inputTruncated: event.inputTruncated }),
      ...(event.toolKind === undefined ? {} : { toolKind: toolKinds.has(event.toolKind) ? event.toolKind : "unknown" }),
    } : {
      ...Object.fromEntries(["title", "recommendation", "proposedAnswer", "taskId", "sprintId"].flatMap((key) => {
        const value = event[key as keyof typeof event];
        // References stay whole. An oversized reference requires client.event.
        return typeof value !== "string" || (["taskId", "sprintId"].includes(key) && Buffer.byteLength(value) > 128)
          ? [] : [[key, cutUtf8(value, key === "title" ? 256 : 512)]];
      })),
    }),
    bytes: encodedBytes(envelope),
  };
  if (encodedBytes(result) > 4096) return undefined;
  for (const option of options) {
    if (result.options.length === 8) break;
    if (Buffer.byteLength(option.id) > 128) continue;
    const bounded = { ...option, name: cutUtf8(option.name, 128), kind: optionKinds.has(option.kind) ? option.kind : "unknown" };
    if (encodedBytes({ ...result, options: [...result.options, bounded] }) <= 4096) result.options.push(bounded);
  }
  return result;
};
