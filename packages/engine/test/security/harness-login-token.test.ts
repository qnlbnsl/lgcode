import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { it } from "@effect/vitest";
import type { EventEnvelope } from "@lgcode/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, echoFile, harnessFor, makeRunnerRig, removeRunnerRig, spawnFor, withAcpRunner, writeFakeAdapter,
} from "../support/acpRunnerRig.ts";
import {
  captureServiceOutput, channelSteps, configureLoginAccount, inspectBoundaries, loginForms, marker,
  observeOwner, plantedLogin, plantLogin, readableText, rowsIn, startLoginAgent,
} from "../support/harnessLoginRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  alive, makeServiceRoot, ownerClient, peekEcho, requestId, startService, stopAllServices, waitFor, waitServing,
  type ServiceRoot,
} from "../support/serviceProcess.ts";

// The event log lives in a real service child. Each test also calls its
// debug comparison RPC, which checks the live views against a rebuild.
registerRebuildCheck({ noLog: true });
let root: ServiceRoot;
beforeEach(() => {
  root = makeServiceRoot("/tmp/sh-b1-");
  for (const [name, value] of Object.entries({
    HOME: root.home, LGCODE_HOME: root.state, XDG_STATE_HOME: join(root.root, "xdg"),
    CODEX_HOME: join(root.home, ".codex"), CLAUDE_CONFIG_DIR: join(root.root, "claude-config"),
  })) vi.stubEnv(name, value);
});
afterEach(async () => { await stopAllServices(); vi.unstubAllEnvs(); });

const serviceOptions = () => ({ env: {
  CODEX_HOME: undefined, CLAUDE_CONFIG_DIR: join(root.root, "claude-config"),
  LGCODE_TEST_DEBUG: "1", LGCODE_TEST_PROTOCOL_LOG: "1",
} });

const noLeaks = (boundaries: Record<string, string>, tokens: ReadonlyArray<string>) => {
  for (const [boundary, output] of Object.entries(boundaries)) {
    for (const [index, token] of tokens.entries()) {
      for (const [form, value] of Object.entries(loginForms(token))) {
        expect.soft(output.includes(value), `${boundary}: token ${index + 1} (${form}) leaked`).toBe(false);
      }
    }
  }
};

const positiveControls = (boundaries: Record<string, string>, storedThread: string) => {
  // All retained channels have a non-secret prefix in the very same output
  // as each secret. The ignored thought variant is observed at the protocol
  // logger, rather than pretending it became a thread item (issue 227).
  for (const [boundary, text] of Object.entries(boundaries)) {
    for (const form of Object.keys(loginForms(plantedLogin))) {
      for (const channel of ["text", "split", "tool"]) {
        expect(boundary === "events.payload_json" ? storedThread : text, `${boundary}: missing positive control`).toContain(`B1:${channel}:${form}`);
      }
    }
  }
  expect(boundaries["service stdout/stderr"]).toContain("B1:thought:raw:before");
};

for (const store of ["shared home", "shadow home", "Claude config override"] as const) {
  it.live(`B1 R1 ${store}: file-backed login leaves never reach the event table, live thread, owner stream or service logs through text, split text, thought or tool output in six encodings`, () => Effect.scoped(Effect.gen(function* () {
    const harness = store === "Claude config override" ? "claude" : "codex";
    const accountId = store === "shadow home" ? "secondary" : harness;
    const path = store === "Claude config override" ? join(root.root, "claude-config", ".credentials.json")
      : store === "shadow home" ? join(root.state, "providers", "codex", "secondary", "shadow", "auth.json")
        : join(root.home, ".codex", "auth.json");
    plantLogin(path, plantedLogin, harness);
    // If the fixture did not change the encodings, a raw-only check could
    // silently masquerade as the required six independent forms.
    expect(new Set(Object.values(loginForms(plantedLogin))).size).toBe(7);
    const service = startService(root, serviceOptions());
    yield* waitServing(root, service);
    const owner = yield* ownerClient(root);
    const echo = yield* configureLoginAccount(root, owner, { harness, accountId,
      variables: harness === "claude" ? { CLAUDE_CONFIG_DIR: dirname(path) } : {},
      script: { turns: [channelSteps()] },
    });
    const received: Array<EventEnvelope> = [];
    yield* observeOwner(owner, received, accountId);
    const { agentId } = yield* startLoginAgent(root, owner, harness, accountId);
    yield* waitFor("all login output committed and delivered live", () => received.some((event) => event.agentId === agentId && event.event._tag === "TurnEnded"));
    const child = yield* waitFor("the scripted file-reading adapter", () => peekEcho(echo));
    expect(child.env.HOME).toBe(root.home);
    if (harness === "codex") expect(child.env.CODEX_HOME ?? join(child.env.HOME!, ".codex")).toBe(dirname(path));
    else expect(child.env.CLAUDE_CONFIG_DIR).toBe(dirname(path));
    const observed = yield* inspectBoundaries(root, owner, received, service, agentId);
    expect(observed.comparison).toMatchObject({ equal: true, differences: [], sequence: observed.head });
    positiveControls(observed.boundaries, observed.storedThread);
    noLeaks(observed.boundaries, [plantedLogin]);
    service.child.kill("SIGTERM");
    yield* Effect.promise(() => service.exit);
    // Include output written during finalization, and the exact bytes saved
    // to the rig's captured service log, not just the pre-shutdown snapshot.
    const captured = captureServiceOutput(root, service);
    noLeaks({ "flushed service log/stdout/stderr": captured + "\n" + captured.split("\n").map((line) => readableText(line)).join("\n") }, [plantedLogin]);
  })), 90_000);
}

it.live("B1 R2: an unreadable enabled login store refuses the launch with a fixed reason before spawning any adapter", () => Effect.gen(function* () {
  const rig = makeRunnerRig();
  const path = join(rig.home, ".codex", "auth.json");
  plantLogin(path, plantedLogin);
  chmodSync(path, 0o000);
  try {
    expect(() => readFileSync(path)).toThrow(expect.objectContaining({ code: "EACCES" }));
    const echo = echoFile(rig);
    const harness = harnessFor("codex", writeFakeAdapter(rig));
    const account = accountFor("codex", { turns: [] }, echo, {}, "codex");
    yield* withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
      const spawn = yield* spawnFor(rig, harness, account);
      const result = yield* Effect.exit(context.runner.start(spawn.input));
      expect.soft(Exit.isFailure(result), "launch must be refused").toBe(true);
      if (Exit.isFailure(result)) {
        const error = Cause.findErrorOption(result.cause);
        expect(error).toMatchObject({ _tag: "Some", value: { _tag: "RunnerRejected", reason: "account credentials cannot be inspected" } });
        expect(JSON.stringify(result)).not.toContain(path);
      }
      // This file is written at adapter entry, before it handles any ACP
      // frame. An empty event stream alone would not prove no process ran.
      expect.soft(existsSync(echo), "adapter entry must never run").toBe(false);
      expect.soft(context.events, "refusal must not publish process/session events").toEqual([]);
    }));
  } finally { chmodSync(path, 0o600); removeRunnerRig(rig); }
}), 60_000);

it.live("B1 R3: a running adapter's refreshed token and its original token in the last output before exit remain redacted through refresh and final stream flush", () => Effect.scoped(Effect.gen(function* () {
  const path = join(root.home, ".codex", "auth.json");
  // Neither token contains the other. Redacting a retained prefix must not
  // make a stale registry appear to have discovered the refreshed token.
  const refreshed = 'R3-renewed-+/"\\ fresh-漢࿿-longer-credential-value';
  const gate = join(root.root, "refresh-gate");
  plantLogin(path, plantedLogin);
  const service = startService(root, serviceOptions());
  yield* waitServing(root, service);
  const owner = yield* ownerClient(root);
  const finalStderr = Object.keys(loginForms(plantedLogin)).map((form) => `B1:final:${form}:before ${marker(form, "whole", "original")} :after`).join("\n");
  const echo = yield* configureLoginAccount(root, owner, { harness: "codex", accountId: "codex", script: {
    turns: [[
      { step: "text", text: "B1:running-before-refresh\n" + ".".repeat(512) },
      { step: "wait_for_file", path: gate },
      ...channelSteps(),
      { step: "text", text: `B1:last-text:before ${marker("raw", "whole", "original")} :after` },
      { step: "stderr_part", text: finalStderr },
      { step: "crash", exitCode: 3 },
    ]],
  } });
  const received: Array<EventEnvelope> = [];
  yield* observeOwner(owner, received, "codex");
  const { agentId } = yield* startLoginAgent(root, owner, "codex", "codex");
  const child = yield* waitFor("adapter running before refresh", () => peekEcho(echo));
  yield* waitFor("pre-refresh text committed", () => rowsIn(root).some((row) => row.payload_json.includes("B1:running-before-refresh")));
  // A different size makes this a deterministic stat change without relying
  // on the filesystem's timestamp resolution or an arbitrary sleep.
  plantLogin(path, refreshed);
  writeFileSync(gate, "continue");
  yield* waitFor("final process output flushed into the owner's events", () => received.some((event) => event.agentId === agentId && event.event._tag === "AgentCrashed"));
  expect(alive(child.pid), "the actual adapter must have exited").toBe(false);
  // Challenge the service registry after the original process (and its
  // per-process secrets) is gone. This account event must still be redacted
  // even though the active login file now contains only the refreshed token.
  const listing = yield* owner.accounts({ requestId: requestId(), operation: "list" } as never);
  const account = listing.accounts.find((candidate) => candidate.id === "codex")!;
  yield* owner.accounts({ requestId: requestId(), operation: "set", account: {
    ...account, displayName: "B1:retained-after-exit " + Object.values(loginForms(plantedLogin)).join(" | "),
  } } as never);
  const retained = yield* waitFor("retention challenge received by the owner after exit", () => received.find((event) =>
    event.event._tag === "AccountChanged" && event.event.account?.displayName?.startsWith("B1:retained-after-exit")));
  expect(rowsIn(root).some((row) => row.payload_json.includes("B1:retained-after-exit"))).toBe(true);
  noLeaks({ "owner account event after adapter exit": JSON.stringify(retained) + "\n" + readableText(retained) }, [plantedLogin]);
  const observed = yield* inspectBoundaries(root, owner, received, service, agentId);
  expect(observed.comparison).toMatchObject({ equal: true, differences: [], sequence: observed.head });
  positiveControls(observed.boundaries, observed.storedThread);
  for (const [boundary, text] of Object.entries(observed.boundaries)) {
    if (boundary === "service stdout/stderr") continue;
    expect(text, `${boundary}: final stderr was not flushed`).toContain("B1:final:raw:before");
    expect(text, `${boundary}: final text was dropped`).toContain("B1:last-text:before");
  }
  noLeaks(observed.boundaries, [plantedLogin, refreshed]);
  service.child.kill("SIGTERM");
  yield* Effect.promise(() => service.exit);
  const captured = captureServiceOutput(root, service);
  noLeaks({ "flushed service output": captured + "\n" + captured.split("\n").map((line) => readableText(line)).join("\n") }, [plantedLogin, refreshed]);
})), 90_000);
