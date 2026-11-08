import * as Contracts from "@lgcode/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.doUnmock("@lgcode/contracts"); vi.resetModules(); });

it("1a E2 tools derive new agent-callable piece commands but exclude streams and owner-only commands", async () => {
  const group = RpcGroup.make(
    Rpc.make("read", { payload: { requestId: Contracts.RequestId }, success: Schema.String }),
    Rpc.make("subscribe", { payload: { requestId: Contracts.RequestId }, success: Schema.String, stream: true }),
    Rpc.make("set-secret", { payload: { requestId: Contracts.RequestId }, success: Schema.Void }),
  ).prefix("client.");
  const ownerOnly = new Set(["accounts", "accounts set-secret", "accounts mark-available", "harnesses", "debug.compare-views",
    "client.alerts.list", "client.alerts.dismiss", "client.alerts.settings", "client.alerts.settings.set"]);
  const access = { ...Contracts.commandAccess, ...Object.fromEntries([...ownerOnly].map((name) => [name, ["owner"]])) };
  vi.resetModules();
  vi.doMock("@lgcode/contracts", () => ({ ...Contracts, CommandsRpcGroup: Contracts.CommandsRpcGroup.merge(group), commandAccess: {
    ...access, "client.read": ["owner", "agent"], "client.subscribe": ["owner", "agent"], "client.set-secret": ["owner"],
  } }));
  const loading = import("../src/tools.ts");
  await expect(loading, "The MCP consumer must accept the caller-kind table").resolves.toHaveProperty("toolNames");
  const tools = await loading;
  expect([...tools.toolNames].sort()).toEqual([
    "answer", "ask", "board.acknowledge", "board.channels", "board.close", "board.members",
    "board.open", "board.post", "board.read", "board.status", "client.event", "client.read", "client.roster", "client.snapshot", "client.thread", "compact", "group", "pass-up", "prompt", "release", "resume", "roles.handoff", "roles.orient", "start", "stop", "wait",
  ]);
});
