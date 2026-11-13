import * as Contracts from "@lgtm/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.doUnmock("@lgtm/contracts"); vi.resetModules(); });

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
  vi.doMock("@lgtm/contracts", () => ({ ...Contracts, CommandsRpcGroup: Contracts.CommandsRpcGroup.merge(group), commandAccess: {
    ...access, "client.read": ["owner", "agent"], "client.subscribe": ["owner", "agent"], "client.set-secret": ["owner"],
  } }));
  const loading = import("../src/tools.ts");
  await expect(loading, "The MCP consumer must accept the caller-kind table").resolves.toHaveProperty("toolNames");
  const tools = await loading;
  expect(Contracts.CommandsRpcGroup.requests.has("project.creation.abandon")).toBe(true);
  expect(Contracts.commandAccess["project.creation.abandon"]).toEqual(["owner"]);
  expect(tools.toolNames).not.toContain("project.creation.abandon");
  expect([...tools.toolNames].sort()).toEqual([
    "answer", "ask", "board.acknowledge", "board.channels", "board.close", "board.members",
    "board.open", "board.post", "board.read", "board.status", "cancel-reply", "client.event", "client.read", "client.roster", "client.snapshot", "client.thread", "compact", "group", "pass-up", "project.changes", "project.commit.files", "project.conflict", "project.context.search", "project.design.read", "project.design.record", "project.diff", "project.git.state", "project.history", "project.mocks.artifact", "project.mocks.read", "project.mocks.record", "project.mocks.screen.read", "project.read", "project.requests", "project.review", "project.review.report", "project.review.status", "project.sprint.complete", "project.sprint.create", "project.sprint.update", "project.stage.set", "project.task.create", "project.task.history", "project.task.note", "project.task.update", "project.team.create", "prompt", "release", "resume", "roles.handoff", "roles.orient", "start", "stop", "wait",
  ]);
});
