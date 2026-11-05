import { RequestId } from "@shephrd/contracts";
import type { BoardView } from "@shephrd/contracts/board/view";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { loadLists, withFixture } from "../support/fixturePiece.ts";
import { freshRequest } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import type { RolesView } from "../../src/roles/view.ts";
import { compareViews } from "../../src/views/compare.ts";
import { Views } from "../../src/views/Views.ts";
import { start, event } from "./fixtures.ts";

// A synthetic collision value, never a real credential.
const marker = "beef";
const roleFileHash = marker.repeat(16);
const instance = () => makeRedactor({ secrets: () => [Redacted.make(marker)], tokenHashes: () => new Set() });
const redact = (event: Record<string, unknown>) => Effect.gen(function* () {
  const redactor = yield* Redactor;
  return yield* redactor.redact(event as never);
}).pipe(Effect.provide(instance().layer));

it("RI01 action subject, notice recipient and post identities survive a registered text collision", async () => {
  const event = {
    _tag: "roles.StallSeen", agentId: "agent-beef", noticeRecipient: "lead-beef", postId: "post-beef",
    triggerSequence: 1, sourceSequence: 2, occurrence: 1, notice: "sent",
  };
  expect(await Effect.runPromise(redact(event))).toEqual(event);
});

it("RI02 a committed role-file reply preserves roleFileHash while generic hash and recipient fields still redact", async () => {
  await withFixture(await loadLists(), () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const log = yield* EventLog;
    const requestId = freshRequest();
    yield* log.append({ _tag: "owner" }, requestId, "a".repeat(64), [], {}, () => ({
      requestId, roleFileHash, hash: marker, recipient: marker,
    }));
    const sql = yield* SqlClient.SqlClient;
    const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`;
    expect(JSON.parse(receipts[0]!.result_json).reply).toEqual({
      requestId, roleFileHash, hash: "[REDACTED]", recipient: "[REDACTED]",
    });
  }), { redactor: instance().layer });
});

it("RI03 only the named role-file identity bypasses redaction; content, advice, role/group names and generic fields remain text", async () => {
  const event = {
    _tag: "roles.RoleFileSet", roleFileHash, content: marker, advice: marker,
    role: `worker:${marker}`, group: marker, hash: marker, recipient: marker,
  };
  expect(await Effect.runPromise(redact(event))).toEqual({
    ...event, roleFileHash, content: "[REDACTED]", advice: "[REDACTED]",
    role: "worker:[REDACTED]", group: "[REDACTED]", hash: "[REDACTED]", recipient: "[REDACTED]",
  });
});

it("RI04 colliding roles events retain SQL identities, receipt envelopes and live joins through rebuild", async () => {
  const lists = await loadLists();
  await withFixture({ ...lists, reactors: {} }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const log = yield* EventLog;
    const requestId = Schema.decodeUnknownSync(RequestId)("request-beef");
    const owner = { _tag: "owner" } as const;
    const lead = { _tag: "agent", agentId: "lead-beef" } as const;
    const content = JSON.stringify({ name: "Team", roles: { builder: { advice: marker, limits: {} } } });
    const events = [
      start("agent-beef"), start("lead-beef"),
      event({ _tag: "board.ChannelOpened", channelId: "channel-beef", kind: "direct", name: "Direct", opener: owner, members: [owner, lead] }),
      event({ _tag: "board.PostWritten", channelId: "channel-beef", postId: "post-beef", author: owner, to: [lead], reply: "none", text: marker }),
      event({ _tag: "roles.RoleFileSet", content, roleFileHash }),
      event({ _tag: "roles.StallSeen", agentId: "agent-beef", noticeRecipient: "lead-beef", postId: "post-beef", stalledPostId: "post-beef",
        triggerSequence: 4, sourceSequence: 4, occurrence: 1, notice: "sent" }),
      event({ _tag: "board.Read", channelId: "channel-beef", reader: lead, postIds: ["post-beef"] }),
    ];
    const batch = yield* log.append(owner, requestId, "a".repeat(64), events, {}, () => ({ requestId, roleFileHash, hash: marker, recipient: marker }));
    expect(batch).toHaveLength(7);
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* sql<{ agent_id: string | null; payload_json: string }>`SELECT agent_id, payload_json FROM events WHERE request_id = ${requestId} ORDER BY sequence`;
    expect(stored).toHaveLength(7);
    const action = JSON.parse(stored[5]!.payload_json);
    expect(stored[5]!.agent_id).toBe("agent-beef");
    expect(action).toMatchObject({ _tag: "roles.StallSeen", agentId: "agent-beef", noticeRecipient: "lead-beef", postId: "post-beef", stalledPostId: "post-beef" });
    expect(JSON.parse(stored[4]!.payload_json)).toEqual({ _tag: "roles.RoleFileSet", roleFileHash,
      content: JSON.stringify({ name: "Team", roles: { builder: { advice: "[REDACTED]", limits: {} } } }) });
    expect(JSON.parse(stored[3]!.payload_json).text).toBe("[REDACTED]");
    const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`;
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0]!.result_json);
    expect(receipt.envelopes).toEqual(batch);
    expect(receipt.envelopes[5]).toMatchObject({ requestId, agentId: "agent-beef", event: action });
    expect(receipt.reply).toEqual({ requestId, roleFileHash, hash: "[REDACTED]", recipient: "[REDACTED]" });
    const live = yield* (yield* Views).snapshot;
    const roles = live.roles as RolesView;
    expect(roles.roleFileHash).toBe(roleFileHash);
    expect(roles.file?.roles.builder?.advice).toBe("[REDACTED]");
    expect(roles.agents["agent-beef"]?.openStall).toMatchObject(action);
    expect(roles.actions).toHaveLength(1);
    expect(roles.actions[0]).toMatchObject({ ...action, noticeRead: true });
    expect(live.agents[action.agentId]?.agentId).toBe("agent-beef");
    expect(live.agents[action.noticeRecipient]?.agentId).toBe("lead-beef");
    expect((live.board as BoardView).posts[action.postId]).toMatchObject({ postId: "post-beef", channelId: "channel-beef", text: "[REDACTED]" });
    expect((yield* compareViews()).differences).toEqual([]);
  }), { redactor: instance().layer });
});
