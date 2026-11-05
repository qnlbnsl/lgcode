import { afterEach, expect, it } from "vitest";
import { cleanupUnit7b, finishCli, prepareRoot, startCli } from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

it.each([
  { command: "roles.record", words: ["roles", "record"], allowed: "service", ownerTerminal: false },
  { command: "roles.orient", words: ["roles", "orient"], allowed: "agent", ownerTerminal: false },
  { command: "roles.handoff", words: ["roles", "handoff"], allowed: "owner, agent", ownerTerminal: false },
  { command: "roles.settings.get", words: ["roles", "settings", "get"], allowed: "owner", ownerTerminal: true },
  { command: "release", words: ["release"], allowed: "owner, agent, service", ownerTerminal: false },
])("FR-027 $command help states actual caller kinds without claiming owner-terminal access for a service", async ({ words, allowed, ownerTerminal }) => {
  const child = startCli(prepareRoot(), [...words, "--help"]);
  expect(await finishCli(child)).toEqual({ code: 0, signal: null });
  expect(child.stdout()).toContain(`Allowed callers: ${allowed}.`);
  expect(child.stdout().includes("This command is for the owner's terminal")).toBe(ownerTerminal);
});
