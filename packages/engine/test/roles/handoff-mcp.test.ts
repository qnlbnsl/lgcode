import * as Effect from "effect/Effect";
import { chmodSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { cleanupUnit7b, mcpPeer, startCli, type McpReply } from "../../../testing/test/support/unit7b.ts";
import { incarnationOf } from "../support/fakeRunner.ts";
import { headSequence, stateOf } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually } from "../support/routingRig.ts";
import { unwrap } from "../client/support/readRig.ts";
import { budget, finish, omittedSequences, prompt, rows, runHandoff, sent, spawn, text, updates, type Handoff } from "./handoffRig.ts";

interface OmissionCursor { readonly after: number; readonly through: number; readonly requestId: string }
interface PagedHandoff extends Handoff { readonly omittedNext?: OmissionCursor }

afterEach(cleanupUnit7b);

const toolData = (reply: McpReply): string => {
  expect(reply.error).toBeUndefined();
  expect(reply.result?.isError ?? false, "the real MCP tool must accept the omission continuation").toBe(false);
  expect(reply.result?.content).toHaveLength(1);
  expect(reply.result.content[0].type).toBe("text");
  return reply.result.content[0].text as string;
};

it("H17 recovers every sparse omission through the real MCP tool without losing the original selection or current authorization", async () =>
  runHandoff(registerRebuildCheck(), (context) => Effect.gen(function* () {
    const lead = yield* spawn(context, undefined, { role: "lead:builder" });
    const worker = yield* spawn(context, lead, { prompt: "MCP ORIGINAL BRIEF" });
    const stranger = yield* spawn(context, undefined, { prompt: "UNRELATED BRIEF" });
    const workerDelivery = yield* sent(context, worker);
    const strangerDelivery = yield* sent(context, stranger);
    // More than two full omission pages, with every history item separated
    // by a different agent's real runner update and stored global sequence.
    for (let index = 0; index < 150; index++) {
      for (const [peer, deliveryId, message] of [
        [worker, workerDelivery, `MCP historical item ${index}.`],
        [stranger, strangerDelivery, `UNRELATED ITEM ${index}.`],
      ] as const) {
        yield* context.runner.emit({ _tag: "deliveryUpdate", agentId: peer.agentId, incarnation: incarnationOf(peer.token),
          deliveryId, kind: "message", replay: false, role: "agent", text: message, content: text(message) });
      }
    }
    const historical = yield* eventually(rows(context, worker), (all) =>
      all.filter((row) => row.event._tag === "ThreadItem").length === 150);
    const expected = historical.filter((row) => row.event._tag === "ThreadItem").map((row) => row.sequence);
    expect(expected).toHaveLength(150);
    expect(expected.every((sequence, index) => index === 0 || sequence > expected[index - 1]! + 1)).toBe(true);
    yield* finish(context, worker);
    const latestDelivery = yield* prompt(context, worker, "MCP LATEST QUESTION");
    yield* updates(context, worker, latestDelivery, [text("MCP LATEST ANSWER"), text("MCP LATEST DETAIL")]);
    yield* finish(context, worker);
    const started = historical.find((row) => row.event._tag === "AgentStarted");
    if (started?.event._tag !== "AgentStarted" || started.event.firstPromptDelivery?.content._tag !== "prompt") {
      throw new Error("The public start must record the original brief");
    }
    const originalBrief = started.event.firstPromptDelivery.content.text;
    // The production client checks these permissions, unlike the direct
    // engine test client. No socket-security seam is used here.
    chmodSync(context.rig.stateFolder, 0o700);
    const root = { root: context.rig.root, home: context.rig.home, state: context.rig.stateFolder,
      socket: context.socket, work: context.rig.work, bin: context.rig.root };
    const child = startCli(root, ["mcp"], {
      PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: context.rig.home,
      SHEPHRD_HOME: context.rig.stateFolder, SHEPHRD_SOCKET: context.socket, SHEPHRD_TOKEN: lead.token,
    });
    // Stop and await the connector before the engine scope and rig disappear,
    // including on the expected pre-fix failing assertion.
    yield* Effect.addFinalizer(() => Effect.promise(cleanupUnit7b));
    const peer = mcpPeer(child);
    yield* Effect.promise(() => peer.initialize());
    const inventory = yield* Effect.promise(() => peer.request("tools/list"));
    const tool = inventory.result.tools.find((tool: any) => tool.name === "roles.handoff");
    expect(tool).toBeDefined();
    expect(tool.inputSchema.properties.requestId, "agents cannot supply the outer request identifier").toBeUndefined();
    const call = (name: string, args: Record<string, unknown>) => Effect.promise(() =>
      peer.request("tools/call", { name, arguments: args }));
    const firstData = toolData(yield* call("roles.handoff", { agentId: worker.agentId }));
    const first = unwrap({ data: firstData }) as PagedHandoff;
    expect(first.firstPrompt).toBe(originalBrief);
    expect(first.lastExchange).toContain("MCP LATEST ANSWER");
    expect(first.lastExchange).toContain("MCP LATEST DETAIL");
    expect(firstData).not.toContain("UNRELATED");
    expect(first.omitted.length).toBeLessThanOrEqual(64);
    let cursor = first.omittedNext;
    expect(cursor, "the first tool reply must offer further exact omission pages").toBeDefined();
    const originalId = cursor!.requestId;
    const originalThrough = cursor!.through;
    budget({ requestId: originalId, data: firstData });
    const recovered = omittedSequences(first);
    const laterDelivery = yield* prompt(context, worker, "LATER QUESTION OUTSIDE SNAPSHOT");
    yield* updates(context, worker, laterDelivery, [text("LATER ANSWER OUTSIDE SNAPSHOT")]);
    yield* finish(context, worker);
    const beforeReads = yield* headSequence;
    let pages = 1;
    while (cursor !== undefined) {
      expect(cursor.after).toBe(recovered.at(-1));
      expect(cursor.requestId).toBe(originalId);
      expect(cursor.through).toBe(originalThrough);
      const data = toolData(yield* call("roles.handoff", { agentId: worker.agentId, omissions: cursor }));
      budget({ requestId: originalId, data });
      const body = unwrap({ data }) as PagedHandoff;
      expect(body).toMatchObject({ agentId: worker.agentId, firstPrompt: originalBrief,
        lastExchange: first.lastExchange, recent: first.recent });
      expect(data).not.toContain("UNRELATED");
      expect(data).not.toContain("OUTSIDE SNAPSHOT");
      expect(body.omitted.length).toBeLessThanOrEqual(64);
      const page = omittedSequences(body);
      expect(page.length).toBeGreaterThan(0);
      expect(page[0]).toBeGreaterThan(cursor.after);
      recovered.push(...page);
      cursor = body.omittedNext;
      expect(++pages).toBeLessThan(10);
    }
    expect(pages).toBe(3);
    expect(recovered).toEqual(expected);
    const wanted = new Set(recovered);
    const texts: string[] = [];
    let after = 0;
    for (;;) {
      const data = toolData(yield* call("client.thread", { agentId: worker.agentId, after, limit: 500 }));
      expect(data).not.toContain("UNRELATED");
      const page = unwrap({ data });
      for (const row of page.items) if (wanted.has(row.sequence)) {
        expect(row.event).toMatchObject({ _tag: "ThreadItem", content: { _tag: "text" } });
        texts.push(row.event.content.text);
      }
      if (page.next === undefined) break;
      expect(page.next).toBeGreaterThan(after);
      after = page.next;
    }
    expect(texts).toEqual(Array.from({ length: 150 }, (_, index) => `MCP historical item ${index}.`));
    expect(yield* headSequence).toBe(beforeReads);
    // Changing the current holder must take effect even on an already-open
    // connector holding a previously successful continuation cursor.
    const leadDelivery = yield* prompt(context, lead, "Manage recovery.");
    yield* context.runner.emit({ _tag: "promptReply", agentId: lead.agentId, incarnation: incarnationOf(lead.token),
      deliveryId: leadDelivery, outcome: { _tag: "pause", reason: "out-of-usage", error: "Simulated provider limit." } });
    expect(yield* eventually(stateOf(lead.agentId), (state) => state === "paused")).toBe("paused");
    const refused = yield* call("roles.handoff", { agentId: worker.agentId, omissions: first.omittedNext });
    expect(refused.error).toBeUndefined();
    expect(refused.result?.isError).toBe(true);
    expect(JSON.stringify(refused.result)).toContain("the engine refused the command");
  })), 60_000);
