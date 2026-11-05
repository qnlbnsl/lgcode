import { toolText, groupThreadItems } from "@shephrd/contracts/thread";
// Remove terminal programs, including their payloads, before rendering data.
// Keep ordinary Unicode, tabs and line breaks for reading tool input and diffs.
export const safeText = (text: string): string => text
  .replace(/(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c|$)/g, "")
  .replace(/(?:\u001b[PX^_]|[\u0090\u0098\u009e\u009f])[^\u001b\u009c]*(?:\u001b\\|\u009c|$)/g, "")
  .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
  .replace(/\u001b[ -/]*[0-~]?/g, "")
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");

export const safeJson = (value: unknown): string => JSON.stringify(value,
  (_key, entry: unknown) => typeof entry === "string" ? safeText(entry) : entry, 2) ?? "null";

export const oneLine = (value: string): string => safeText(value).replace(/\n/g, "\\n").replace(/\t/g, "\\t");

export const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : {};

export const eventText = (value: unknown): string => {
  const event = record(value);
  const content = record(event.content);
  if (event._tag === "ThreadItem" && content._tag === "text" && typeof content.text === "string") return safeText(content.text);
  if (event._tag === "ThreadItem" && content._tag === "tool-call") return safeText([content.title, content.status ?? "pending", typeof content.input === "string" ? toolText(content.input) : "", typeof content.output === "string" ? toolText(content.output) : ""].filter(Boolean).join("\n"));
  return safeJson(value);
};

// Conservative wrapping reserves two cells for non-ASCII code points. This
// keeps every line reachable even in a narrow pane with wide Unicode glyphs.
export const linesFor = (text: string, columns: number): ReadonlyArray<string> => {
  const width = Math.max(4, columns - 4);
  return safeText(text).replace(/\t/g, "    ").split("\n").flatMap((line) => {
    const lines: Array<string> = [];
    let part = "";
    let cells = 0;
    for (const character of line) {
      const size = character.codePointAt(0)! > 127 ? 2 : 1;
      if (cells + size > width) { lines.push(part); part = ""; cells = 0; }
      part += character;
      cells += size;
    }
    lines.push(part);
    return lines;
  });
};

export function threadText(items: ReadonlyArray<import("@shephrd/client").ClientEnvelope>): Array<{ sequence: number; text: string }> {
  const sources = new Map<string, import("@shephrd/contracts").Delivery>();
  for (const { event } of items) {
    const delivery = event._tag === "AgentStarted" ? event.firstPromptDelivery : event._tag === "DeliveryQueued" ? event.delivery : undefined;
    if (delivery !== undefined) sources.set(delivery.id, delivery);
  }
  return groupThreadItems(items).flatMap((item) => {
    const event = item.event;
    if ("deliveryId" in event && sources.has(event.deliveryId as string)
      && (event._tag === "PromptSent" || event._tag.startsWith("Delivery"))) return [];
    const delivery = event._tag === "AgentStarted" ? event.firstPromptDelivery : event._tag === "DeliveryQueued" ? event.delivery : undefined;
    if (delivery !== undefined) {
      const sender = delivery.sender;
      const from = sender._tag === "owner" ? "Owner" : sender._tag === "agent" ? `Agent ${sender.agentId}`
        : sender._tag === "service" ? `Service ${sender.service}` : `Piece ${sender.namespace}`;
      const states = items.flatMap(({ event }) => "deliveryId" in event && event.deliveryId === delivery.id && event._tag.startsWith("Delivery")
        ? [event._tag.slice("Delivery".length)] : []);
      const source = delivery.source === undefined ? [] : [`Source: ${delivery.source._tag}: ${delivery.source.id}`];
      return [{ sequence: item.sequence, text: safeText([`Prompt · From: ${from}`, ...source, "text" in delivery.content ? delivery.content.text : "Compact request", ["Queued", ...states].join(" → ")].join("\n")) }];
    }
    return [{ sequence: item.sequence, text: eventText(event) }];
  });
}
