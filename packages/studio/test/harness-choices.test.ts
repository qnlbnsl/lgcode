import { readFileSync } from "node:fs";
import { harnessChoicesSource } from "../scripts/harnessChoices.ts";
import { expect, it } from "vitest";
import { mapAccounts, mapHarnesses } from "../src/git.ts";
import type { Account, HarnessSettings } from "@lgtm/contracts";
const harness = { id: "first", runMode: "acp", models: ["stale"], efforts: ["stale"] } as unknown as HarnessSettings;
it("uses discovered IDs and labels, and carries plain reasons instead of stale configured models", () => {
  const result = mapHarnesses([harness], [{ harnessId: harness.id, models: { source: "negotiated", options: [{ id: "reported", label: "Reported model" }] }, efforts: { source: "unavailable", options: [] }, effortReason: "This harness did not report effort choices." }]);
  expect(result.first).toMatchObject({ models: ["reported"], efforts: [], modelLabels: { reported: "Reported model" }, effortReason: "This harness did not report effort choices." });
  expect(mapHarnesses([harness], [{ harnessId: harness.id, models: { source: "unavailable", options: [] }, efforts: { source: "unavailable", options: [] }, reason: "No account is registered for this harness." }]).first).toMatchObject({ models: [], reason: "No account is registered for this harness." });
});

it("keeps subscription choices on their exact account instead of borrowing another account's models", () => {
  const accounts = ["one", "two"].map((id) => ({ id, harness: harness.id }) as Account);
  const rows = mapAccounts(accounts, [], [harness], undefined, [
    { harnessId: harness.id, accountId: accounts[0]!.id, models: { source: "negotiated", options: [{ id: "one-model", label: "One model" }] }, efforts: { source: "unavailable", options: [] } },
    { harnessId: harness.id, accountId: accounts[1]!.id, models: { source: "unavailable", options: [] }, efforts: { source: "unavailable", options: [] }, reason: "Sign in to this harness account to see its models." }
  ]);
  expect(rows[0]).toMatchObject({ models: ["one-model"], modelLabels: { "one-model": "One model" } });
  expect(rows[1]).toMatchObject({ models: [], reason: "Sign in to this harness account to see its models." });
});

for (const [path, needle] of [
  ["js/ui.js", "...(liveMode.on ? a.models || [] : h.models).map"],
  ["js/ui.js", "...(liveMode.on ? a.efforts || [] : h.efforts).map"],
  ["js/screens/messages.js", "...(live.on ? a.models || [] : h.models).map"],
] as const) it(`fails the build if a choices patch no longer matches ${path}: ${needle}`, () => {
  const source = readFileSync(`${process.cwd()}/design/mock/${path}`, "utf8");
  expect(() => harnessChoicesSource(path, source.replaceAll(needle!, "changed-upstream"))).toThrow();
});
