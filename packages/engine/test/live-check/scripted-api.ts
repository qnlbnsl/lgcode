// A controlled API boundary for the real live-check runner and flow. Events
// follow the public contract; no production flow or step assertion is mocked.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@sheprd/client";
import type { EventEnvelope, HarnessSettings } from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { liveConfig, liveFolders } from "../../scripts/live/driver.ts";
import type { RecordResults } from "../../scripts/live/recording.ts";
import type { RunDeps } from "../../scripts/live/run.ts";
import type { LiveService } from "../../scripts/live/service.ts";

export interface Faults {
  step?: string;
  repeatAnswerAccepted?: boolean;
  wideAccepted?: boolean;
  duplicateWake?: boolean;
  leak?: "event" | "reply" | "output";
  secret?: string;
  hangAnswer?: boolean;
  // The worker's thread shows nothing before the permission is asked for.
  noThreadItem?: boolean;
  workerEndsWithoutPermission?: boolean;
}

export const cleanRecordings = (): RecordResults => ["claude", "codex"].map((harness) => ({
  harness, status: "recorded", file: `${harness}.ndjson`, workspace: "/tmp/recorded-workspace", droppedExtensionFrames: 0,
}));

export const scriptedApi = (fault: Faults = {}) => {
  const root = realpathSync(mkdtempSync("/tmp/sh8ct-"));
  const home = join(root, "home");
  const state = join(root, "state");
  const work = join(root, "work");
  const outputDirectory = join(root, "fixtures");
  for (const path of [home, state, work, join(outputDirectory, "errors")]) mkdirSync(path, { recursive: true });
  // Synthetic credential, never an account or a token from the invoking shell.
  const credential = Buffer.from("owner-credential-for-live-check-test");
  writeFileSync(join(state, "owner-credential"), credential);
  const secret = fault.secret ?? credential.toString("base64url");
  const lines: string[] = [];
  const replies: string[] = [];
  const calls: string[] = [];
  const answers: Array<{ connection: number; input: unknown }> = [];
  const starts: Array<{ folder: string; prompt: string; model?: string; effort?: string }> = [];
  const events: EventEnvelope[] = [];
  const owner = { _tag: "owner" };
  const lead = { _tag: "agent", agentId: "lead" };
  let active = false;
  let connection = 0;
  let answerCount = 0;
  let stopCount = 0;
  let removeCount = 0;
  // Brand casts belong at this fake transport boundary, just as decoded JSON
  // gets branded at the real transport boundary. Payloads include every field.
  const emit = (event: Record<string, unknown>, caller = owner): void => {
    events.push({
      sequence: events.length + 1, eventId: `event-${events.length + 1}`, occurredAt: 1_800_000_000_000,
      caller, requestId: `request-${events.length + 1}`,
      ...(typeof event.agentId === "string" ? { agentId: event.agentId } : {}), event,
    } as unknown as EventEnvelope);
  };
  const queueWake = (id: string): void => emit({ _tag: "DeliveryQueued", delivery: {
    id, target: "lead", sender: owner, content: { _tag: "prompt", text: "Wait finished" }, source: { _tag: "wait", id: "wait" },
  } });
  const begin = (): void => {
    active = true;
    emit({ _tag: "AgentStarted", agentId: "lead", name: "Lead", role: "lead", groups: [], parent: owner,
      harness: "claude", account: "claude", permission: "edit", folder: liveFolders(work).lead, runMode: "acp" });
    if (!fault.wideAccepted && fault.step !== "wide-start") emit({ _tag: "CommandRefused", command: "start", reason: "permission exceeds ceiling" }, lead);
    emit({ _tag: "AgentStarted", agentId: "worker", name: "Worker", role: "worker", groups: ["auth"], parent: lead,
      harness: "codex", account: "codex", permission: fault.step === "worker-start" || fault.wideAccepted ? "full" : "ask",
      folder: liveFolders(work).worker, runMode: "acp", firstPromptDelivery: {
        id: "first", target: "worker", sender: fault.step === "session" ? owner : lead,
        content: { _tag: "prompt", text: "Write hello.txt" },
      } }, lead);
    emit({ _tag: "SessionOpened", agentId: "worker", session: { _tag: "acp", sessionId: "session" }, protocolVersion: 1, reloadable: false });
    emit({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: "first" });
    if (fault.workerEndsWithoutPermission) {
      emit({ _tag: "ThreadItem", agentId: "worker", itemId: "refused", replay: false, content: { _tag: "text", text: "the workspace is read-only" } });
      emit({ _tag: "TurnEnded", agentId: "worker", compact: false });
      return;
    }
    if (fault.step === "live-view") emit({ _tag: "TurnEnded", agentId: "worker", compact: false });
    if (!fault.noThreadItem) emit({ _tag: "ThreadItem", agentId: "worker", itemId: "progress", replay: false, content: { _tag: "text", text: "writing hello.txt" } });
    emit({ _tag: "PermissionRequested", agentId: "worker", permissionRequestId: "permission", holder: fault.step === "routed" ? owner : lead,
      deliveryId: "permission-delivery", toolCallId: "edit-file", description: "Write hello.txt", settingsWrite: false,
      options: [{ id: "allow-once", name: "Allow once", kind: "allow_once", level: "ask", persistent: false }] });
    emit({ _tag: "WaitOpened", agentId: "lead", waitId: "wait", members: ["worker"], mode: "all", blocking: false }, lead);
    emit({ _tag: "PermissionMoved", agentId: "worker", permissionRequestId: "permission", from: fault.step === "pass-up" ? owner : lead,
      to: owner, deliveryId: "owner-permission" }, lead);
    emit({ _tag: "OwnerNeeded", agentId: "worker", reason: "permission", subject: { _tag: "permission", id: "permission" } });
  };
  const finish = (): void => {
    emit({ _tag: "PermissionAnswered", agentId: "worker", permissionRequestId: "permission", answeredBy: owner, answer: { _tag: "selected", optionId: "allow-once" } });
    emit({ _tag: "TurnEnded", agentId: "worker", compact: false });
    emit({ _tag: "WaitSatisfied", agentId: "lead", waitId: "wait", members: [{ agentId: "worker", reason: "settled" }] });
    queueWake("wake");
    emit({ _tag: "DeliveryAccepted", agentId: "lead", deliveryId: "wake" });
    emit({ _tag: "TurnEnded", agentId: "lead", compact: false });
    if (fault.duplicateWake || fault.step === "wake") queueWake("second-wake");
    if (fault.leak === "event") emit({ _tag: "ThreadItem", agentId: "worker", itemId: "leak", replay: false, content: { _tag: "text", text: secret } });
  };
  const makeClient = (id: number): Client => ({
    harnesses: (input: { requestId: string }) => Effect.succeed({ requestId: input.requestId, harnesses: [] }),
    accounts: (input: { requestId: string }) => Effect.succeed({ requestId: input.requestId, accounts: [] }),
    start: (input: { requestId: string; prompt: string; folder: string; model?: string; effort?: string }) => Effect.suspend(() => {
      calls.push("start");
      starts.push({ folder: input.folder, prompt: input.prompt, ...(input.model === undefined ? {} : { model: input.model }), ...(input.effort === undefined ? {} : { effort: input.effort }) });
      if (fault.step === "lead") return Effect.fail(new Error("lead could not start"));
      calls.push(`prompt:${input.prompt}`);
      begin();
      return Effect.succeed({ requestId: input.requestId, agentId: "lead" });
    }),
    subscribe: (input: { after: number }) => Stream.fromIterable(events.filter((event) => event.sequence > input.after)).pipe(Stream.concat(Stream.never)),
    "debug.compare-views": (input: { requestId: string }) => Effect.succeed({ requestId: input.requestId, sequence: active ? events.length : 0, equal: fault.step !== "final", differences: fault.step === "final" ? ["lost view"] : [] }),
    answer: (input: { requestId: string }) => Effect.suspend((): Effect.Effect<unknown, unknown> => {
      answers.push({ connection: id, input });
      if (fault.hangAnswer) return Effect.never;
      if (fault.step === "owner-answer") return Effect.fail(new Error("owner connection failed"));
      answerCount += 1;
      if (answerCount > 1 && !fault.repeatAnswerAccepted) return Effect.fail({ _tag: "CommandError", requestId: input.requestId, reason: "already answered" });
      finish();
      const reply = { requestId: input.requestId, ...(fault.leak === "reply" ? { leaked: secret } : {}) };
      replies.push(JSON.stringify(reply));
      return Effect.succeed(reply);
    }),
  }) as unknown as Client;
  const service: LiveService = {
    root, state, work, pid: 999_999_998, logFile: join(root, "service.log"),
    output: () => fault.leak === "output" ? secret : "", exited: () => fault.step === "service",
    stop: async () => { stopCount += 1; calls.push("stopped"); return []; },
    remove: () => { removeCount += 1; calls.push("removed"); },
  };
  const deps: RunDeps = {
    probes: { observe: (id) => Effect.succeed(["claude", "codex"].map((harness) => ({ harness, outcome: fault.step === id ? "not attempted" : ({
      "sandbox-mcp": "succeeds", "permission-kinds": "recorded",
      "removed-variables": "refused by ancestry check", "state-read": "no mechanism: the agent read the canary file",
      "slash-up": "escaped; no command", "slash-down": "escaped; no command",
      "always-allow": "scopes recorded; persistent options routed to owner",
      "reload": "old token refused; tool succeeds; found", "token-scan": "not found",
    })[id], detail: "controlled adapter boundary; not real-adapter evidence" }))) },
    write: (line) => { lines.push(line); },
    environment: { HOME: home, SHEPRD_HOME: state, XDG_STATE_HOME: join(root, "xdg"), CODEX_HOME: join(root, "codex") },
    hook: {
      environment: { SHEPRD_HOME: state },
      listServices: () => fault.step === "startup-hook" ? [] : [{ pid: 42, environment: { SHEPRD_HOME: state } }],
      lockExists: () => false, answers: async () => true, sleep: async () => undefined,
    },
    startService: () => { calls.push("service"); return service; },
    connectOwner: () => Effect.succeed(makeClient(connection++)),
    harnessSettings: async () => fault.step === "setup" ? [] : ["claude", "codex"].map((id) => ({
      id: id as HarnessSettings["id"], runMode: "acp", adapterPath: join(root, "never-launch-an-adapter"), adapterArguments: [],
      permissionMapping: { "read-only": "read-only", ask: "ask", edit: "edit", full: "full" }, reportedModes: [],
      defaultPermission: "ask", models: ["haiku", "gpt-6-luna"], efforts: ["low"], denyReadMechanism: { _tag: "none" },
    }) satisfies HarnessSettings),
    record: async () => { calls.push("record"); return fault.step === "recording" ? [] : cleanRecordings(); },
    outputDirectory, config: { ...liveConfig({}), agentTimeout: 60, totalTimeout: 10_000 }, clock: Date.now,
    engineTimeout: 60, settle: 1, serveTimeout: 100,
  };
  return { root, home, state, work, secret, lines, replies, calls, answers, starts, events, deps, service, emit,
    get stopCount() { return stopCount; }, get removeCount() { return removeCount; },
    dispose: () => { rmSync(root, { recursive: true, force: true }); },
  };
};
