import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { incarnationOf } from "../support/fakeRunner.ts";
import { headSequence } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually } from "../support/routingRig.ts";
import { unwrap } from "../client/support/readRig.ts";
import {
  budget, finish, handoff, omittedSequences, outcome, prompt, request, rows, runHandoff, sent, spawn, text, updates,
  type Handoff,
} from "./handoffRig.ts";

interface OmissionCursor { readonly after: number; readonly through: number; readonly requestId: string }
interface PagedHandoff extends Handoff { readonly omittedNext?: OmissionCursor }

it("H16 recovers all omissions from 5,000 interleaved items without refusing or losing whole small priority sections", async () =>
  runHandoff(registerRebuildCheck(), (context) => Effect.gen(function* () {
    const lead = yield* spawn(context, undefined, { role: "lead:builder" });
    const worker = yield* spawn(context, lead, { prompt: "SPARSE ORIGINAL BRIEF" });
    const stranger = yield* spawn(context, undefined, { prompt: "UNRELATED BRIEF" });
    const workerDelivery = yield* sent(context, worker);
    const strangerDelivery = yield* sent(context, stranger);
    // Alternate real runner updates. The engine writes and schema-decodes
    // every event; no synthetic log rows bypass its visibility rules.
    for (let index = 0; index < 4_998; index++) {
      for (const [peer, deliveryId, message] of [
        [worker, workerDelivery, `Historical worker item ${index}.`],
        [stranger, strangerDelivery, `UNRELATED ITEM ${index}.`],
      ] as const) {
        yield* context.runner.emit({ _tag: "deliveryUpdate", agentId: peer.agentId, incarnation: incarnationOf(peer.token),
          deliveryId, kind: "message", replay: false, role: "agent", text: message, content: text(message) });
      }
    }
    const historical = yield* eventually(rows(context, worker), (all) =>
      all.filter((row) => row.event._tag === "ThreadItem").length === 4_998);
    expect(historical.filter((row) => row.event._tag === "ThreadItem")).toHaveLength(4_998);
    yield* finish(context, worker);
    const finalDelivery = yield* prompt(context, worker, "SPARSE LATEST QUESTION");
    const latest = yield* updates(context, worker, finalDelivery, [text("SPARSE LATEST ANSWER"), text("SPARSE LATEST DETAIL")]);
    yield* finish(context, worker);
    const all = yield* rows(context, worker);
    expect(all.filter((row) => row.event._tag === "ThreadItem")).toHaveLength(5_000);
    const started = all.find((row) => row.event._tag === "AgentStarted");
    if (started?.event._tag !== "AgentStarted" || started.event.firstPromptDelivery?.content._tag !== "prompt") {
      throw new Error("The public start must record the original brief");
    }
    const originalBrief = started.event.firstPromptDelivery.content.text;
    const expected = historical.filter((row) => row.event._tag === "ThreadItem").map((row) => row.sequence);
    expect(expected.every((sequence, index) => index === 0 || sequence > expected[index - 1]! + 1)).toBe(true);
    const ownerHandoff = yield* handoff(context.owner, worker, "sparse-owner-handoff");
    budget(ownerHandoff.wire);
    expect(ownerHandoff.body.firstPrompt).toBe(originalBrief);
    for (const message of ["SPARSE LATEST QUESTION", "SPARSE LATEST ANSWER", "SPARSE LATEST DETAIL"]) {
      expect(ownerHandoff.body.lastExchange).toContain(message);
    }
    const requestId = "sparse-omission-recovery";
    const first = yield* handoff(lead.client, worker, requestId);
    const check = (wire: unknown, body: PagedHandoff) => {
      budget(wire);
      expect(body.firstPrompt).toBe(originalBrief);
      for (const message of ["SPARSE LATEST ANSWER", "SPARSE LATEST DETAIL"]) expect(body.lastExchange).toContain(message);
      expect(JSON.stringify(body)).not.toContain("UNRELATED");
      expect(body.omitted.length).toBeLessThanOrEqual(64);
    };
    check(first.wire, first.body);
    let cursor = (first.body as PagedHandoff).omittedNext;
    expect(cursor, "a bounded first page must offer complete omission recovery").toBeDefined();
    const replay = yield* handoff(lead.client, worker, requestId);
    expect(replay.body).toEqual(first.body);
    for (const client of [worker.client, stranger.client]) {
      const result = yield* outcome(client, "roles.handoff", { agentId: worker.agentId, requestId, omissions: cursor });
      expect(result._tag, "an omission cursor must confer no additional read rights").toBe("Failure");
    }
    const changedId = yield* outcome(lead.client, "roles.handoff", {
      agentId: worker.agentId, requestId: "a-different-encoded-budget", omissions: cursor,
    });
    expect(changedId._tag, "a continuation must preserve the original selection budget").toBe("Failure");
    const recovered = omittedSequences(first.body);
    // Later activity must not change the original summary or its omission set.
    const laterDelivery = yield* prompt(context, worker, "LATER QUESTION OUTSIDE SNAPSHOT");
    yield* updates(context, worker, laterDelivery, [text("LATER ANSWER OUTSIDE SNAPSHOT")]);
    yield* finish(context, worker);
    const beforeReads = yield* headSequence;
    let pages = 1;
    while (cursor !== undefined) {
      expect(cursor.after).toBe(recovered.at(-1));
      expect(cursor.through).toBeGreaterThanOrEqual(latest.at(-1)!.sequence);
      expect(cursor.requestId).toBe(requestId);
      const wire = yield* request(lead.client, "roles.handoff", { agentId: worker.agentId, requestId, omissions: cursor });
      const body = unwrap(wire) as PagedHandoff;
      check(wire, body);
      expect(body.lastExchange).not.toContain("OUTSIDE SNAPSHOT");
      const page = omittedSequences(body);
      expect(page.length).toBeGreaterThan(0);
      expect(page[0]).toBeGreaterThan(cursor.after);
      recovered.push(...page);
      cursor = body.omittedNext;
      expect(++pages).toBeLessThan(200);
    }
    expect(pages).toBeGreaterThan(1);
    expect(recovered).toEqual(expected);
    expect(yield* headSequence).toBe(beforeReads);
    // Recover the actual content, as the lead does, using the exact references
    // and the public paged thread read. No unrelated agent's content belongs.
    const wanted = new Set(recovered);
    const recoveredTexts: string[] = [];
    let after = 0;
    for (;;) {
      const page = unwrap(yield* request(lead.client, "client.thread", { agentId: worker.agentId, after, limit: 500 }));
      expect(JSON.stringify(page)).not.toContain("UNRELATED");
      for (const row of page.items) {
        if (wanted.has(row.sequence)) {
          expect(row.event).toMatchObject({ _tag: "ThreadItem", content: { _tag: "text" } });
          recoveredTexts.push(row.event.content.text);
        }
      }
      if (page.next === undefined) break;
      expect(page.next).toBeGreaterThan(after);
      after = page.next;
    }
    expect(recoveredTexts).toEqual(Array.from({ length: 4_998 }, (_, index) => `Historical worker item ${index}.`));
    expect(yield* headSequence).toBe(beforeReads);
  })), 300_000);
