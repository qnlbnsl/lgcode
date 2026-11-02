import { afterEach, expect, it } from "vitest";
import {
  chunk, cleanupUnit7b, fakeEngine, finishCli, prepareRoot, startCli, succeed,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

const cases = [
  ["C0/DEL", "left\u0000\u0001\u0008\u000b\u000c\u000d\u001f\u007fright\n\t漢字🙂", "leftright\n\t漢字🙂"],
  ["C1", "left\u0080\u0085\u0090\u009b\u009d\u009fright", "leftright"],
  ["CSI and OSC", "left\u001b[2J\u001b[31mred\u001b[0m\u001b]52;c;clipboard-data\u0007right\u001b]0;window-title\u001b\\end", "leftredrightend"],
] as const;

for (const [kind, input, expected] of cases) {
  it(`C01 ${kind} (7.7) catches thread output retaining terminal controls/escape payloads or deleting ordinary Unicode, newline or tab`, async () => {
    const root = prepareRoot();
    const engine = await fakeEngine(root, { onRequest: (frame, socket) => {
      if (frame.tag !== "subscribe") throw new Error("expected subscribe");
      chunk(socket, frame, [{
        sequence: 1, eventId: "thread-event", occurredAt: 1_800_000_000_000,
        caller: { _tag: "agent", agentId: "member" }, agentId: "member",
        event: { _tag: "ThreadItem", agentId: "member", itemId: "item", replay: false, content: { _tag: "text", text: input } },
      }]);
      succeed(socket, frame, undefined);
    } });
    const child = startCli(root, ["subscribe", "--after", "0"]);
    expect(await finishCli(child)).toEqual({ code: 0, signal: null });
    expect(engine.requests).toHaveLength(1);
    expect(child.stdout()).toContain(expected);
    expect(child.stdout()).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    for (const payload of ["clipboard-data", "window-title", "[2J", "[31m"]) expect(child.stdout()).not.toContain(payload);
  });
}
