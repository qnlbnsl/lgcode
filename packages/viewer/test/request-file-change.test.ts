import { expect, it, vi } from "vitest";
import { readRequestContext, type RequestContextClient } from "../src/actions.ts";

const request = { agentId: "worker-1", sequence: 14, toolCallId: "edit-1" };
const permission = {
  envelope: { event: { _tag: "PermissionRequested", toolKind: "edit", locations: [{ path: "settings.json" }] } },
};
const item = (itemId: string, content: unknown) => ({
  event: { _tag: "ThreadItem", agentId: "worker-1", itemId, content, replay: false },
});

it("FR-005 shows correlated file changes in thread order across pages after reading the request", async () => {
  const order: Array<string> = [];
  const client: RequestContextClient = {
    event: async ({ sequence }) => {
      expect(sequence).toBe(14);
      order.push("request");
      return permission;
    },
    thread: async ({ agentId, after, limit }) => {
      expect(agentId).toBe("worker-1");
      expect(limit).toBe(100);
      order.push(`thread:${after}`);
      if (after === 0) return { items: [
        item("unrelated", { _tag: "file-change", callId: "edit-2", path: "settings.json", diff: "unrelated edit" }),
        item("diff-1", { _tag: "file-change", callId: "edit-1", path: "settings.json", diff: "-first\n+second" }),
      ], next: 10 };
      expect(after).toBe(10);
      return { items: [
        item("tool-update", { _tag: "tool-call", callId: "edit-1", title: "Edit settings", status: "pending" }),
        item("diff-2", { _tag: "file-change", callId: "edit-1", path: "other.json", diff: "-third\n+fourth" }),
      ] };
    },
  };

  const context = await readRequestContext(client, request);

  expect(order).toEqual(["request", "thread:0", "thread:10"]);
  expect(context).toContain("Tool kind: edit");
  expect(context).toContain("settings.json");
  expect(context).toContain("-first\\n+second");
  expect(context).toContain("other.json");
  expect(context).toContain("-third\\n+fourth");
  expect(context.indexOf("-first")).toBeLessThan(context.indexOf("Edit settings"));
  expect(context.indexOf("Edit settings")).toBeLessThan(context.indexOf("-third"));
  expect(context).not.toContain("unrelated edit");
  expect(context).not.toContain("The action's input is not visible.");
});

it("FR-005 accepts a matching diff as the only action input without a missing-input warning", async () => {
  const context = await readRequestContext({
    event: async () => permission,
    thread: async () => ({ items: [item("diff-1", {
      _tag: "file-change", callId: "edit-1", path: "settings.json", diff: "-old\n+new",
    })] }),
  }, request);

  expect(context).toContain("-old\\n+new");
  expect(context).not.toContain("The action's input is not visible.");
});

it.each([
  { label: "another call on the same path", itemId: "diff-other", callId: "edit-2" },
  { label: "an old uncorrelated diff whose item id equals the call id", itemId: "edit-1" },
])("FR-005 keeps the missing-input warning for $label", async ({ itemId, ...fields }) => {
  const context = await readRequestContext({
    event: async () => permission,
    thread: async () => ({ items: [item(itemId, {
      _tag: "file-change", ...("callId" in fields ? { callId: fields.callId } : {}),
      path: "settings.json", diff: "unrelated edit",
    })] }),
  }, request);

  expect(context).toContain("settings.json");
  expect(context).not.toContain("unrelated edit");
  expect(context).toContain("The action's input is not visible.");
});

it.each([
  { inputRedacted: true, warning: "Part of the action's input is hidden, because redaction changed it." },
  { inputTruncated: true, warning: "The action's input is cut at 8 KiB." },
])("FR-005 retains the partial-input warning: $warning", async ({ warning, ...flags }) => {
  const thread = vi.fn(async () => ({ items: [item("diff-1", {
    _tag: "file-change", callId: "edit-1", path: "settings.json", diff: "partial edit",
  })] }));
  const context = await readRequestContext({
    event: async () => ({ envelope: { event: { ...permission.envelope.event, ...flags } } }), thread,
  }, request);

  expect(context).toContain(warning);
  expect(context).not.toContain("partial edit");
  expect(thread).not.toHaveBeenCalled();
});
