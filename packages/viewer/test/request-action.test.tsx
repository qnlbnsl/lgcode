import { expect, it, vi } from "vitest";
import * as viewer from "../src/index.ts";

type RequestView = {
  readonly readRequestContext: (client: {
    readonly event: (input: { readonly sequence: number }) => Promise<{ readonly envelope: { readonly event: unknown } }>;
    readonly thread: (input: { readonly agentId: string; readonly after: number; readonly limit: number }) => Promise<{ readonly items: ReadonlyArray<{ readonly event: unknown }> }>;
  }, request: {
    readonly agentId: string;
    readonly sequence: number;
    readonly toolCallId: string;
    readonly input?: unknown;
    readonly inputRedacted?: boolean;
    readonly inputTruncated?: boolean;
  }) => Promise<string>;
};

const requestView = viewer as unknown as RequestView;

it("R81 catches answering before reading the request event and showing its action input", async () => {
  expect(typeof requestView.readRequestContext, "viewer must read request context before answer").toBe("function");
  const order: Array<string> = [];
  const event = vi.fn(async () => {
    order.push("event");
    return { envelope: { event: { _tag: "PermissionRequested", toolInput: { command: "remove temp files" } } } };
  });
  const thread = vi.fn(async () => ({ items: [] }));

  const context = await requestView.readRequestContext({ event, thread }, {
    agentId: "worker-1", sequence: 14, toolCallId: "tool-1", input: { command: "remove temp files" },
  });

  expect(order).toEqual(["event"]);
  expect(event).toHaveBeenCalledWith({ sequence: 14 });
  expect(context).toContain("remove temp files");
});

it("R82 catches omitting matching thread tool items when a request has no input", async () => {
  expect(typeof requestView.readRequestContext, "viewer must read request context before answer").toBe("function");
  const event = vi.fn(async () => ({ envelope: { event: { _tag: "PermissionRequested" } } }));
  const thread = vi.fn(async () => ({ items: [
    { event: { _tag: "ThreadItem", content: { _tag: "toolCall", toolCallId: "other", title: "Unrelated" } } },
    { event: { _tag: "ThreadItem", content: { _tag: "toolCall", toolCallId: "tool-1", title: "Write config", rawInput: { path: "settings.json" } } } },
  ] }));

  const context = await requestView.readRequestContext({ event, thread }, {
    agentId: "worker-1", sequence: 14, toolCallId: "tool-1",
  });

  expect(thread).toHaveBeenCalledWith({ agentId: "worker-1", after: 0, limit: 100 });
  expect(context).toContain("Write config");
  expect(context).toContain("settings.json");
  expect(context).not.toContain("Unrelated");
});

it("R83 catches missing the fixed warning when request input is hidden or cut", async () => {
  expect(typeof requestView.readRequestContext, "viewer must read request context before answer").toBe("function");
  const event = vi.fn(async () => ({ envelope: { event: { _tag: "PermissionRequested" } } }));
  const thread = vi.fn(async () => ({ items: [] }));

  const redacted = await requestView.readRequestContext({ event, thread }, {
    agentId: "worker-1", sequence: 14, toolCallId: "tool-1", inputRedacted: true,
  });
  const truncated = await requestView.readRequestContext({ event, thread }, {
    agentId: "worker-1", sequence: 14, toolCallId: "tool-1", inputTruncated: true,
  });

  expect(redacted).toContain("Part of the action's input is hidden");
  expect(truncated).toContain("The action's input is cut at 8 KiB.");
});

it("R84 catches agent-controlled terminal sequences reaching the pane output", async () => {
  const unsafe = "left\u001b[2J\u001b]52;c;clipboard-data\u0007right";
  const safe = unsafe.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").replace(/\[2J|\]52;c;clipboard-data/g, "");
  expect(typeof requestView.readRequestContext, "viewer must expose request text through its safe renderer").toBe("function");
  const event = vi.fn(async () => ({ envelope: { event: { _tag: "PermissionRequested", toolInput: { note: unsafe } } } }));
  const thread = vi.fn(async () => ({ items: [] }));

  const context = await requestView.readRequestContext({ event, thread }, {
    agentId: "worker-1", sequence: 14, toolCallId: "tool-1", input: { note: unsafe },
  });

  expect(context).toContain(safe);
  expect(context).not.toContain("clipboard-data");
  expect(context).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
});
