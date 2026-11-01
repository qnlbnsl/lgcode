import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, compactFor, deliveryFor, echoFile, framesOf, harnessFor, makeRunnerRig, peekEcho, promptTexts, readEcho,
  removeRunnerRig, spawnFor, withAcpRunner, writeFakeAdapter, type RunnerContext, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { pause } from "../support/routingRig.ts";

// Criterion 6.4 (task 6a.4; rows 51, 67, 69): `compact` sends the harness's
// compact command when the adapter advertises it, and is refused with a
// reason when it does not. The advertisement is the adapter's latest
// `available_commands_update`; the first harness's adapter sends one during
// its first turn (packages/testing/fixtures/claude.ndjson, entry 13), with
// both `compact` and `autocompact`.

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps a missing
// module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

// The adapter's command catalogue as the first harness's adapter sends it.
const catalogue = (names: ReadonlyArray<string>) => ({
  step: "raw_frame",
  frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}", update: {
    sessionUpdate: "available_commands_update",
    availableCommands: names.map((name) => ({ type: "command", name, description: `The ${name} command`, ...(name === "compact" ? { input: { type: "text", hint: "<optional custom summarization instructions>" } } : {}) })),
  } } }),
});

// Starts an agent, runs one turn per entry of `turns` to completion, and
// returns the agent with its echo file.
const prepared = (context: RunnerContext, turns: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>) => Effect.gen(function* () {
  const echo = echoFile(rig);
  const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { turns: [...turns, [{ step: "text", text: "compacted" }]] }, echo));
  yield* context.runner.start(spawn.input);
  for (const _ of turns) {
    const delivery = deliveryFor(spawn.agentId, "go");
    const before = context.events.length;
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id, before);
  }
  yield* readEcho(echo, (current) => framesOf(current, "session/prompt").length === turns.length);
  return { ...spawn, echo };
});

live("6.4 advertised: compact sends the harness's /compact command as a prompt, and the turn's reply and end name the compact delivery (breaks if compact sends nothing, sends the delivery's own text, or reports the turn under another delivery)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* prepared(context, [[catalogue(["autocompact", "compact", "review"])]]);
    const delivery = compactFor(agent.agentId);
    const before = context.events.length;
    yield* context.runner.compact({ agentId: agent.agentId, incarnation: agent.incarnation, delivery });
    yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id, before);
    expect(promptTexts(yield* readEcho(agent.echo)).at(-1)).toBe("/compact");
    const reply = context.eventsAfter(before).find((event) => event._tag === "promptReply");
    expect(reply).toMatchObject({ deliveryId: delivery.id, outcome: { _tag: "success" } });
  })));

live("6.4 not advertised: compact is refused with a reason and nothing is sent to the child (breaks if the runner sends /compact to an adapter that never offered it)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* prepared(context, [[{ step: "text", text: "no catalogue" }]]);
    const prompts = framesOf(peekEcho(agent.echo)!, "session/prompt").length;
    const result = yield* context.runner.compact({ agentId: agent.agentId, incarnation: agent.incarnation, delivery: compactFor(agent.agentId) }).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("RunnerRejected");
      expect(result.failure.reason.length).toBeGreaterThan(0);
    }
    yield* pause(300);
    expect(framesOf(peekEcho(agent.echo)!, "session/prompt").length - prompts).toBe(0);
  })));

live("6.4 exact name: an adapter that offers only autocompact has no compact command, so compact is refused (breaks if commands are matched by substring)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* prepared(context, [[catalogue(["autocompact", "compact-history"])]]);
    const prompts = framesOf(peekEcho(agent.echo)!, "session/prompt").length;
    const result = yield* context.runner.compact({ agentId: agent.agentId, incarnation: agent.incarnation, delivery: compactFor(agent.agentId) }).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    yield* pause(300);
    expect(framesOf(peekEcho(agent.echo)!, "session/prompt").length - prompts).toBe(0);
  })));

live("6.4 latest catalogue: a later available_commands_update without compact withdraws it (breaks if the runner adds to the commands it saw instead of replacing them)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* prepared(context, [[catalogue(["compact"])], [catalogue(["review"])]]);
    const result = yield* context.runner.compact({ agentId: agent.agentId, incarnation: agent.incarnation, delivery: compactFor(agent.agentId) }).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
  })));

live("6.4 compact returns once the command is sent, not when its turn ends (breaks if compact waits for the reply)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", {
      turns: [[catalogue(["compact"])], [{ step: "slow", ms: 1500 }]],
    }, echo));
    yield* context.runner.start(spawn.input);
    const first = deliveryFor(spawn.agentId, "go");
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery: first });
    yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === first.id);
    const delivery = compactFor(spawn.agentId);
    const before = context.events.length;
    const started = Date.now();
    yield* context.runner.compact({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(context.eventsAfter(before).filter((event) => event._tag === "turnEnded")).toEqual([]);
    yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id, before);
  })));
