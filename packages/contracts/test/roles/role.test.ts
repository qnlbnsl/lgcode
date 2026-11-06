import * as Contracts from "../../src/index.ts";
import { expect, it } from "vitest";

interface ParsedRole {
  readonly kind: "orchestrator" | "lead" | "worker";
  readonly name?: string;
  readonly flags: ReadonlyArray<string>;
}
const parse = (text: string): ParsedRole => {
  const { parseRole } = Contracts as unknown as { parseRole: (text: string) => ParsedRole };
  expect(parseRole, "1a must export parseRole through @sheprd/contracts").toBeTypeOf("function");
  return parseRole(text);
};

it("R01 preserves a named worker's kind and team-defined name", () => {
  expect(parse("worker:builder")).toMatchObject({ kind: "worker", name: "builder", flags: [] });
});

it.each(["", "chef", "chef:builder"])("R02/R03 falls back to worker and flags unknown kind %j", (text) => {
  const role = parse(text);
  expect(role.kind).toBe("worker");
  expect(role.flags).toContain("unknown-kind");
});

it.each(["orchestrator", "lead", "worker"] as const)("R04 accepts the bare %s kind without an unknown-kind warning", (kind) => {
  expect(parse(kind)).toMatchObject({ kind, flags: [] });
});

it.each([
  ["orchestrator:coordinator", "orchestrator", "coordinator"],
  ["lead:api", "lead", "api"],
  ["worker:test-writer", "worker", "test-writer"],
])("R05 parses the team-defined name in %s without a built-in team vocabulary", (text, kind, name) => {
  expect(parse(text)).toMatchObject({ kind, name, flags: [] });
});

it.each([
  ["orchestrator", [/lead/i]],
  ["lead", [/start/i, /wait/i, /answer/i, /worker/i, /board\.acknowledge/]],
  ["worker", [/report/i, /lead/i, /not start/i, /not ask the owner/i, /board\.acknowledge/]],
] as const)("R06 supplies the generic %s advice, including the board acknowledgement rule", (kind, required) => {
  const advice = (Contracts as unknown as { roleAdvice: Record<string, string> }).roleAdvice;
  expect(advice, "1a must export the advice for each kind").toBeDefined();
  expect(advice[kind]).toBeTypeOf("string");
  for (const phrase of required) expect(advice[kind]).toMatch(phrase);
});
