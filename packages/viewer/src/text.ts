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
