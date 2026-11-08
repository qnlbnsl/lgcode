import * as Contracts from "@lgcode/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.doUnmock("@lgcode/contracts"); vi.resetModules(); });
const registryWithPiece = async () => {
  const group = RpcGroup.make(Rpc.make("alerts.dismiss", { payload: { requestId: Contracts.RequestId }, success: Schema.Void })).prefix("client.");
  vi.resetModules();
  vi.doMock("@lgcode/contracts", () => ({ ...Contracts, CommandsRpcGroup: Contracts.CommandsRpcGroup.merge(group) }));
  return import("../src/commands/registry.ts");
};

it("1a E10 maps every segment of a three-word piece command to its full RPC name and keeps the remaining arguments", async () => {
  const registry = await registryWithPiece();
  expect(registry.matchCommand(["client", "alerts", "dismiss", "--input", "{}"]))
    .toEqual({ command: "client.alerts.dismiss", rest: ["--input", "{}"] });
  expect(registry.matchCommand(["client", "alerts"])).toBeUndefined();
});

it("FR-099 matches nested installed client settings before their shorter read commands", async () => {
  const registry = await registryWithPiece();
  for (const [words, command] of [
    [["client", "alerts", "settings", "set"], "client.alerts.settings.set"],
    [["client", "web", "settings", "set"], "client.web.settings.set"],
  ] as const) {
    expect(registry.matchCommand([...words, "--input", "{}"]))
      .toEqual({ command, rest: ["--input", "{}"] });
    expect(registry.helpText(command)).toContain(`Usage: lgcode ${words.join(" ")}`);
  }
});

it("1a E10 keeps debug.compare-views and the engine's existing multiword account command", async () => {
  const registry = await registryWithPiece();
  expect(registry.matchCommand(["debug.compare-views", "--help"])).toEqual({ command: "debug.compare-views", rest: ["--help"] });
  expect(registry.matchCommand(["accounts", "set-secret", "primary", "NAME"])).toEqual({ command: "accounts set-secret", rest: ["primary", "NAME"] });
});

it("1a E10 piece help displays the invocable spaced name", async () => {
  const registry = await registryWithPiece();
  expect(registry.helpText("client.alerts.dismiss" as never)).toContain("Usage: lgcode client alerts dismiss");
});
