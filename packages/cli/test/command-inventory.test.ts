import { CommandsRpcGroup } from "@shephrd/contracts";
import { afterEach, expect, it } from "vitest";
import { matchCommand } from "../src/commands/registry.ts";
import { cleanupUnit7b, finishCli, prepareRoot, startCli } from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

it("X61 (T-6) catches a command recognition or top-level help inventory omitting a request from CommandsRpcGroup", async () => {
  const child = startCli(prepareRoot(), ["--help"]);
  expect(await finishCli(child)).toEqual({ code: 0, signal: null });
  const lines = child.stdout().split("\n");
  // P01 independently invokes every command's help in a real CLI child.
  // Deriving this inventory from the group also protects future RPC additions.
  for (const command of CommandsRpcGroup.requests.keys()) {
    expect(matchCommand([...command.split(" "), "--help"])).toEqual({ command, rest: ["--help"] });
    expect(lines).toContain(`  ${command}`);
    if (command.startsWith("roles.")) {
      expect(matchCommand([...command.split("."), "--help"])).toEqual({ command, rest: ["--help"] });
    }
  }
});
