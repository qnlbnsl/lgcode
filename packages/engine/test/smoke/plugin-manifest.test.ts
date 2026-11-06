// Issue 11: Herdr 0.9.3 requires title, not name, on an action.
// Reference shape: the sibling Herdr Synapse herdr-plugin.toml, read 2026-11-01.
// No TOML parser is installed; inspect the same array-of-tables form used by
// the frozen workspace manifest tests, allowing multiline command arrays.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const text = readFileSync(fileURLToPath(new URL("../../../../plugins/herdr/herdr-plugin.toml", import.meta.url)), "utf8");
const sections: Array<{ kind: string; body: string }> = [];
for (const line of text.split("\n")) {
  const header = /^\s*\[\[?([\w.-]+)\]\]?\s*(?:#.*)?$/.exec(line);
  if (header?.[1] !== undefined) sections.push({ kind: header[1], body: "" });
  else {
    const section = sections.at(-1);
    if (section !== undefined) section.body += `${line}\n`;
  }
}
const entries = sections.filter(({ kind }) => kind === "actions" || kind === "panes");

describe("Herdr plugin entry schema", () => {
  it.each(["id", "title"])("gives every action and pane a nonempty %s (breaks if Herdr cannot deserialize or label an entry)", (key) => {
    for (const [index, entry] of entries.entries()) {
      expect(entry.body, `${entry.kind} entry ${index}: missing ${key}`).toMatch(
        new RegExp(`^\\s*${key}\\s*=\\s*(?:"[^"\\n]+"|'[^'\\n]+')\\s*(?:#.*)?$`, "m"),
      );
    }
  });

  it("gives every action and pane a command (breaks if Herdr has no executable to launch)", () => {
    for (const entry of entries) {
      expect(entry.body, entry.kind).toMatch(/^\s*command\s*=\s*\[\s*(?:"[^"\n]+"|'[^'\n]+')/m);
    }
  });

  it("gives every action contexts (breaks if Herdr cannot place the action in its menus)", () => {
    for (const entry of entries.filter(({ kind }) => kind === "actions")) {
      expect(entry.body).toMatch(/^\s*contexts\s*=\s*\[\s*(?:"[^"\n]+"|'[^'\n]+')/m);
    }
  });

  it("never substitutes name for an action's title (breaks if the rejected issue 11 manifest shape returns)", () => {
    for (const entry of entries.filter(({ kind }) => kind === "actions")) {
      expect(entry.body).not.toMatch(/^\s*(?:name|"name"|'name')\s*=/m);
    }
  });
});
