import { inspect } from "node:util";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import type { RunnerEvent } from "../../src/runner/Runner.ts";
import * as Views from "../../src/views/Views.ts";
import {
  accountFor, deliveryFor, compactFor, echoFile, framesOf, harnessFor, makeRunnerRig, peekEcho, readEcho, removeRunnerRig,
  spawnFor, startPayloadFor, withAcpRunner, withEngine, writeFakeAdapter, type RunnerContext, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { deliveryRow, eventually, pause, tagged } from "../support/routingRig.ts";

// Criterion 6.2, first half (task 6a.2; rows 51, 57; issues 55, 61, 69, 82,
// 83): what the agent streams becomes events in order, and every runner event
// is the runner's own account of its own process.
//
// - Streamed text, plans, tool calls and file changes become `ThreadItem`
//   events, in the order the agent sent them, through the real handler.
// - A successful `session/prompt` reply produces `promptReply` success before
//   that turn's `turnEnded`, both naming the delivery the runner sent.
//   `prompt` returns once the request is sent.
// - A content update after a send produces one `deliveryUpdate` for the
//   current delivery. An `available_commands_update` does not accept it.
// - `agentId`, `incarnation` and `deliveryId` come from the runner's own
//   process table, never from child data (issues 61 and 83).
// - A send whose incarnation is not the live process's is refused and sends
//   nothing (issue 82). Counts compare before and after (issue 55).
// - A malformed or unknown message from one child never ends the stream for
//   another (issue 69's lesson).

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps a missing
// module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

const ofDelivery = (events: ReadonlyArray<RunnerEvent>, deliveryId: string) =>
  events.filter((event) => "deliveryId" in event && event.deliveryId === deliveryId);

// Starts one fake agent on the runner and returns what a test needs to drive it.
const startAgent = (context: RunnerContext, script: Record<string, unknown>, agentId?: string) => Effect.gen(function* () {
  const echo = echoFile(rig);
  const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", script, echo), agentId === undefined ? {} : { agentId });
  yield* context.runner.start(spawn.input);
  return { ...spawn, echo };
});

const turnEndedFor = (deliveryId: string) => (event: RunnerEvent) => event._tag === "turnEnded" && event.deliveryId === deliveryId;

live("U07 stream: a context-only usage_update with used zero is persisted without fabricating request tokens or thread text (catches requiring terminal usage or dropping zero)", () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [[{ step: "raw_frame", frame: JSON.stringify({
    jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}",
      update: { sessionUpdate: "usage_update", used: 0, size: 400_000 } },
  }) }]] }, echoFile(rig));
  return withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "report context only" })));
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
    expect(tagged(rows, "ThreadItem")).toEqual([]);
    expect(tagged(rows, "TurnEnded")).toHaveLength(1);
    expect(tagged(rows, "TurnEnded")[0]).toHaveProperty("usage", { used: 0 });
    expect(context.events.find((event) => event._tag === "turnEnded")).toHaveProperty("usage", { used: 0 });
  }));
});

const entries = [
  { content: "Read the code", priority: "high", status: "completed" },
  { content: "Write the test", priority: "medium", status: "in_progress" },
];
const patch = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n";

live("6.2 stream: text, a plan, a tool call and a file change become thread items in the order the agent sent them (breaks if the runner drops a kind, reorders updates, or the engine writes no thread item for a delivery update)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const turn = [
      { step: "text", text: "first words" },
      { step: "plan", entries },
      { step: "tool_call", toolCallId: "tool-7", title: "List files", kind: "execute", status: "completed", output: "a.txt b.txt" },
      { step: "file_change", toolCallId: "edit-1", path: `${rig.work}/x.ts`, operation: "modify", patch },
      { step: "text", text: "last words" },
    ];
    const account = accountFor("first", { turns: [turn] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (current) => tagged(current, "TurnEnded").length > 0);
      expect(tagged(rows, "TurnEnded")).toHaveLength(1);
      const items = tagged(rows, "ThreadItem").filter((item) => item.agentId === reply.agentId && !item.replay);
      expect(items.map((item) => item.content._tag)).toEqual(["text", "plan", "tool-call", "file-change", "text"]);
      expect(items[0]!.content).toEqual({ _tag: "text", text: "first words" });
      expect(items[1]!.content).toEqual({ _tag: "plan", entries });
      expect(items[2]!.content).toMatchObject({ _tag: "tool-call", callId: "tool-7", title: "List files", status: "completed" });
      expect(JSON.stringify(items[2]!.content)).toContain("a.txt b.txt");
      expect(items[3]!.content).toEqual({ _tag: "file-change", callId: "edit-1", path: `${rig.work}/x.ts`, diff: patch });
      expect(items[4]!.content).toEqual({ _tag: "text", text: "last words" });
      // Every item comes before the turn end.
      const lastItem = Math.max(...rows.filter((row) => row.event._tag === "ThreadItem").map((row) => row.sequence));
      const end = rows.find((row) => row.event._tag === "TurnEnded")!.sequence;
      expect(lastItem).toBeLessThan(end);
    }));
  }));

live("6.2 reply order: promptReply success comes before turnEnded and both name the sent delivery, for version 2 (reply after the idle state) and version 1 (reply carries the stop reason) (breaks if turnEnded is emitted at the idle update before the reply, or a turn end names no or another delivery)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    for (const protocolVersion of [2, 1]) {
      const agent = yield* startAgent(context, { protocolVersion, turns: [[{ step: "text", text: `hello v${protocolVersion}` }]] });
      const delivery = deliveryFor(agent.agentId, "go");
      const before = context.events.length;
      yield* context.runner.prompt({ agentId: agent.agentId, incarnation: agent.incarnation, delivery });
      yield* context.waitFor(turnEndedFor(delivery.id), before);
      const own = ofDelivery(context.eventsAfter(before), delivery.id);
      const replies = own.filter((event) => event._tag === "promptReply");
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ agentId: agent.agentId, incarnation: agent.incarnation, outcome: { _tag: "success" } });
      const tags = own.map((event) => event._tag);
      expect(tags.indexOf("promptReply")).toBeLessThan(tags.indexOf("turnEnded"));
      expect(own.filter((event) => event._tag === "turnEnded")).toHaveLength(1);
    }
  })));

live("6.2 prompt returns once the request is sent, not when the turn ends (breaks if prompt waits for the session/prompt reply)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* startAgent(context, { turns: [[{ step: "slow", ms: 1500 }, { step: "text", text: "done" }]] });
    const delivery = deliveryFor(agent.agentId, "go");
    const before = context.events.length;
    const started = Date.now();
    yield* context.runner.prompt({ agentId: agent.agentId, incarnation: agent.incarnation, delivery });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(ofDelivery(context.eventsAfter(before), delivery.id).filter((event) => event._tag === "turnEnded" || event._tag === "promptReply")).toEqual([]);
    yield* readEcho(agent.echo, (echo) => framesOf(echo, "session/prompt").length === 1);
    yield* context.waitFor(turnEndedFor(delivery.id), before);
  })));

live("6.2 content updates: each content update after a send is one deliveryUpdate for that delivery with its text, and an available_commands_update is never a content kind (breaks if updates are batched, attributed to no delivery, or the commands catalogue is reported as a message)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const commands = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${session}","update":{"sessionUpdate":"available_commands_update","availableCommands":[{"type":"command","name":"compact","description":"Compact"}]}}}';
    const agent = yield* startAgent(context, { turns: [[{ step: "raw_frame", frame: commands }, { step: "text", text: "one" }, { step: "text", text: "two" }]] });
    const delivery = deliveryFor(agent.agentId, "go");
    const before = context.events.length;
    yield* context.runner.prompt({ agentId: agent.agentId, incarnation: agent.incarnation, delivery });
    yield* context.waitFor(turnEndedFor(delivery.id), before);
    const updates = ofDelivery(context.eventsAfter(before), delivery.id).filter((event) => event._tag === "deliveryUpdate");
    const messages = updates.filter((event) => event._tag === "deliveryUpdate" && event.kind === "message");
    expect(messages.map((event) => event._tag === "deliveryUpdate" ? event.text : "")).toEqual(["one", "two"]);
    for (const update of updates) {
      expect(update).toMatchObject({ agentId: agent.agentId, incarnation: agent.incarnation, replay: false });
      if (update._tag === "deliveryUpdate" && update.text.includes("compact")) expect(update.kind).toBe("available_commands_update");
    }
  })));

live("6.2 acceptance: an available_commands_update alone leaves the delivery sent; the reply then accepts it (breaks if the commands catalogue accepts a delivery, row 51)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const commands = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${session}","update":{"sessionUpdate":"available_commands_update","availableCommands":[{"type":"command","name":"compact","description":"Compact"}]}}}';
    const account = accountFor("first", { turns: [[{ step: "raw_frame", frame: commands }, { step: "slow", ms: 1500 }]] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const sent = yield* eventually(readLog, (rows) => tagged(rows, "DeliverySent").length > 0);
      const deliveryId = tagged(sent, "DeliverySent")[0]!.deliveryId;
      yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.kind === "available_commands_update");
      yield* pause(200);
      expect((yield* deliveryRow(deliveryId))?.status).toBe("sent");
      const rows = yield* eventually(readLog, (current) => tagged(current, "TurnEnded").length > 0);
      expect(tagged(rows, "DeliveryAccepted").map((event) => event.deliveryId)).toEqual([deliveryId]);
    }));
  }));

live("6.2 identity (issues 61, 83): a child that writes another agent's id, an old incarnation and a forged delivery id into its frames changes nothing; every event carries the runner's own records (breaks if the runner reads agentId, incarnation or deliveryId from child data)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const victim = yield* startAgent(context, { turns: [] });
    const forged = JSON.stringify({ agentId: victim.agentId, incarnation: victim.incarnation, deliveryId: "forged-delivery" });
    const frame = `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"\${session}","agentId":"${victim.agentId}","incarnation":"${victim.incarnation}","deliveryId":"forged-delivery","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":${JSON.stringify(forged)}},"_meta":${forged}}}}`;
    const forger = yield* startAgent(context, { turns: [[{ step: "raw_frame", frame }, { step: "text", text: forged }]] });
    const delivery = deliveryFor(forger.agentId, "go");
    const before = context.events.length;
    yield* context.runner.prompt({ agentId: forger.agentId, incarnation: forger.incarnation, delivery });
    yield* context.waitFor(turnEndedFor(delivery.id), before);
    const after = context.eventsAfter(before);
    expect(after.filter((event) => event.agentId === victim.agentId)).toEqual([]);
    expect(after.filter((event) => "deliveryId" in event && event.deliveryId === "forged-delivery")).toEqual([]);
    for (const event of after) {
      expect(event.agentId).toBe(forger.agentId);
      expect(event.incarnation).toBe(forger.incarnation);
      if ("deliveryId" in event) expect(event.deliveryId).toBe(delivery.id);
    }
    // The scripted text step always arrives; the raw frame is valid ACP with extra fields.
    expect(after.filter((event) => event._tag === "deliveryUpdate" && event.kind === "message").length).toBeGreaterThanOrEqual(1);
  })));

live("6.2 stale sends (issue 82): prompt and compact with an incarnation that is not the live process's fail with RunnerRejected and send nothing to the child (breaks if the runner ignores the incarnation, or checks it after writing to the child)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* startAgent(context, { turns: [] });
    yield* readEcho(agent.echo, (echo) => framesOf(echo, "session/new").length === 1);
    const promptsBefore = framesOf(peekEcho(agent.echo)!, "session/prompt").length;
    const stale = "0".repeat(64);
    const prompt = yield* context.runner.prompt({ agentId: agent.agentId, incarnation: stale, delivery: deliveryFor(agent.agentId, "stale") }).pipe(Effect.result);
    const compact = yield* context.runner.compact({ agentId: agent.agentId, incarnation: stale, delivery: compactFor(agent.agentId) }).pipe(Effect.result);
    for (const result of [prompt, compact]) {
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure._tag).toBe("RunnerRejected");
    }
    yield* pause(300);
    expect(framesOf(peekEcho(agent.echo)!, "session/prompt").length - promptsBefore).toBe(0);
    // A later run of the same agent refuses the earlier run's incarnation.
    yield* context.runner.stop({ agentId: agent.agentId });
    const second = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { turns: [] }, echoFile(rig)), { agentId: agent.agentId });
    yield* context.runner.start(second.input);
    const old = yield* context.runner.prompt({ agentId: agent.agentId, incarnation: agent.incarnation, delivery: deliveryFor(agent.agentId, "old") }).pipe(Effect.result);
    expect(old._tag).toBe("Failure");
  })));

live("6.2 malformed child data: garbage, an unknown method and a malformed update from one child never end the event stream for another agent (breaks if one child's decode failure ends the runner's shared stream)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const bad = yield* startAgent(context, { turns: [[
      { step: "raw_frame", frame: "{not json at all" },
      { step: "raw_frame", frame: '{"jsonrpc":"2.0","method":"x/unknown_method","params":{"a":1}}' },
      { step: "raw_frame", frame: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${session}","update":{"sessionUpdate":"agent_message_chunk","content":42}}}' },
      { step: "raw_frame", frame: '{"jsonrpc":"2.0","id":"x","result":{"unexpected":true}}' },
    ]] });
    const good = yield* startAgent(context, { turns: [[{ step: "slow", ms: 500 }, { step: "text", text: "still here" }]] });
    const before = context.events.length;
    const goodDelivery = deliveryFor(good.agentId, "go");
    yield* context.runner.prompt({ agentId: bad.agentId, incarnation: bad.incarnation, delivery: deliveryFor(bad.agentId, "go") }).pipe(Effect.ignore);
    yield* context.runner.prompt({ agentId: good.agentId, incarnation: good.incarnation, delivery: goodDelivery });
    yield* context.waitFor(turnEndedFor(goodDelivery.id), before);
    expect(ofDelivery(context.eventsAfter(before), goodDelivery.id).some((event) => event._tag === "deliveryUpdate" && event.text === "still here")).toBe(true);
  })));

// A content update whose text and tool input carry the secret and the token
// written as JSON \u escapes, inside escaped quotes.
const escapedLeak = (name: string) =>
  `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"\${session}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"quoted \\"\${env-u:${name}}\\" end"}}}}`;
const escapedToolLeak = (name: string) =>
  `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"\${session}","update":{"sessionUpdate":"tool_call_update","toolCallId":"leak-${name}","title":"Run","kind":"execute","status":"completed","rawInput":{"command":"echo \\"\${env-u:${name}}\\""},"content":[{"type":"content","content":{"type":"text","text":"out \\u0022\${env-u:${name}}\\u0022"}}]}}}`;

live("6.2 secrets (rows 36, 57): an account secret and the agent token written to stderr, in an error reply, and JSON-escaped inside content and tool updates never reach a stored event, the views or a log line (breaks if the runner logs stderr or replies raw, re-encodes escaped text past the redactor, or the service logger is installed after the runner)", () =>
  Effect.gen(function* () {
    const secret = "sk-ant-api03-PLANTEDSTREAMSECRET0123456789abcdef";
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [
      [
        { step: "stderr", text: "stderr leak ${env:PLANTED_API_KEY} and ${env:SHEPHRD_TOKEN}" },
        { step: "raw_frame", frame: escapedLeak("PLANTED_API_KEY") },
        { step: "raw_frame", frame: escapedLeak("SHEPHRD_TOKEN") },
        { step: "raw_frame", frame: escapedToolLeak("PLANTED_API_KEY") },
        { step: "raw_frame", frame: escapedToolLeak("SHEPHRD_TOKEN") },
      ],
      [{ step: "rpc_error", message: "reply leak ${env:PLANTED_API_KEY} and ${env:SHEPHRD_TOKEN}" }],
    ] }, echo, { PLANTED_API_KEY: "secret:planted-stream" });
    const written: Array<string> = [];
    const original = { out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) };
    const spies = [
      vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: Array<any>) => { written.push(String(chunk)); return original.out(chunk as string, ...rest); }) as typeof process.stdout.write),
      vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown, ...rest: Array<any>) => { written.push(String(chunk)); return original.err(chunk as string, ...rest); }) as typeof process.stderr.write),
    ];
    // Review F-2: the console methods are watched too, whether or not they reach the process streams.
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
    return yield* withEngine(rig, { harness, accounts: [account], secrets: { "secret:planted-stream": secret } }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "first turn" })));
      yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
      success(yield* call(ownerCredential, "prompt", { agentId: reply.agentId, text: "second turn" }));
      yield* eventually(readLog, (rows) => tagged(rows, "DeliveryReturned").length + tagged(rows, "TurnEnded").length >= 2);
      yield* pause(300);
      const token = (yield* readEcho(echo)).env.SHEPHRD_TOKEN!;
      expect(token.startsWith("shp_a_")).toBe(true);
      // The leaks did reach the runner, so their absence below is redaction.
      expect(context.events.some((event) => event._tag === "deliveryUpdate" && event.kind === "message")).toBe(true);
      const sql = yield* SqlClient.SqlClient;
      const stored = (yield* sql<{ payload_json: string }>`SELECT payload_json FROM events`).map((row) => row.payload_json).join("\n");
      const views = JSON.stringify(yield* (yield* Views.Views).snapshot);
      const consoled = consoleSpies.flatMap((spy) => spy.mock.calls.map((args) => args.map((arg) => typeof arg === "string" ? arg : inspect(arg, { depth: 20 })).join(" "))).join("\n");
      for (const [where, text] of [["events", stored], ["views", views], ["log lines", context.logLines.join("\n")], ["process output", written.join("")], ["console", consoled]] as const) {
        expect(text.includes(secret), `${where} contain the account secret`).toBe(false);
        expect(text.includes(token), `${where} contain the agent token`).toBe(false);
      }
      for (const spy of [...spies, ...consoleSpies]) spy.mockRestore();
    }));
  }));

// Review of fe4adcd, F-1 (PB-A2): the runner reads the child's stderr all the
// time, so a child that writes a lot of it never blocks on a full pipe.
live("6.2 stderr drain (review F-1): an agent that writes 10,000,000 bytes of stderr and then streams text still delivers the text and ends its turn (breaks if the runner stops reading the child's stderr, so the child blocks on a full pipe and the turn never ends)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* startAgent(context, { turns: [[{ type: "stderr_flood", bytes: 10_000_000 }, { step: "text", text: "after flood" }]] });
    const delivery = deliveryFor(agent.agentId, "go");
    const before = context.events.length;
    yield* context.runner.prompt({ agentId: agent.agentId, incarnation: agent.incarnation, delivery });
    yield* context.waitFor(turnEndedFor(delivery.id), before);
    const own = ofDelivery(context.eventsAfter(before), delivery.id);
    const text = own.flatMap((event) => event._tag === "deliveryUpdate" && event.kind === "message" ? [event.text] : []).join("");
    expect(text).toBe("after flood");
    expect(own.filter((event) => event._tag === "turnEnded")).toHaveLength(1);
  })));

// Review of fe4adcd, F-9: a turn is over once its turnEnded is emitted, so
// content the agent sends afterwards belongs to no delivery. A text chunk
// alone stays in the redactor's carry until the next flush, so a plan update
// follows it and flushes the carry; neither may become a thread item.
live("6.2 late content (review F-9): a text chunk the agent sends after its turn ended, after the version 1 prompt reply or after the version 2 idle state, writes no thread item and emits no deliveryUpdate (breaks if the runner keeps the ended turn as the current one and gives later content its delivery)", () =>
  Effect.gen(function* () {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const accounts = ([1, 2] as const).map((protocolVersion) => accountFor("first", { protocolVersion, turns: [[
      { step: "text", text: `in turn v${protocolVersion}` },
      { step: "text_after_turn", text: `late chunk v${protocolVersion}`, ms: 300,
        plan: [{ content: `late plan v${protocolVersion}`, priority: "low", status: "pending" }] },
    ]] }, echoFile(rig), {}, `account-v${protocolVersion}`));
    return yield* withEngine(rig, { harness, accounts }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      for (const account of accounts) {
        success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { name: `Late ${account.id}`, prompt: "go" })));
      }
      yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 2);
      // Each late chunk leaves its agent 300 ms after the idle state.
      yield* pause(1200);
      const rows = yield* readLog;
      expect(tagged(rows, "TurnEnded")).toHaveLength(2);
      const items = JSON.stringify(tagged(rows, "ThreadItem"));
      expect(items).toContain("in turn v1");
      expect(items).toContain("in turn v2");
      expect(items).not.toContain("late chunk");
      expect(items).not.toContain("late plan");
      // No deliveryUpdate follows an agent's own turnEnded.
      for (const ended of context.events.filter((event) => event._tag === "turnEnded")) {
        const after = context.events.slice(context.events.indexOf(ended) + 1);
        expect(after.filter((event) => event._tag === "deliveryUpdate" && event.agentId === ended.agentId)).toEqual([]);
      }
    }));
  }));
