import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, echoFile, framesOf, harnessFor, makeRunnerRig, readEcho, removeRunnerRig, startPayloadFor, withEngine,
  writeFakeAdapter, type Echo, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

// Criterion 6.13 (task 6a.4; rows 35c, 70): a mode change the adapter
// reports is recorded; one above the agent's ceiling is set back with
// `session/set_config_option` (`mode`) and recorded as refused. A mode the
// harness settings do not know counts as above every ceiling (fail closed).
//
// The agent starts at "ask", which the harness maps to the mode `default`.
// The fake agent reports a change with a `config_option_update` (its
// `mode_change` step), as both pinned adapters do.

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGCODE_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

// Every requirement is provided inside the test; the cast keeps a missing
// module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

const modeSets = (echo: Echo) => framesOf(echo, "session/set_config_option")
  .filter((frame) => frame.params.configId === "mode").map((frame) => frame.params.value as string);

// Starts an "ask" agent whose first turn reports `mode`, and waits for the turn to end.
const reportMode = (mode: string) => Effect.gen(function* () {
  const echo = echoFile(rig);
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [[{ step: "mode_change", configId: "mode", value: mode }, { step: "text", text: "changed" }]] }, echo);
  return { echo, harness, account };
});

live("6.13 above the ceiling: a reported change to full is set back to the ceiling's mode with set_config_option and recorded as ModeRefused (breaks if the runner ignores adapter mode reports, records them without setting back, or sets back with session/set_mode)", () =>
  Effect.gen(function* () {
    const { echo, harness, account } = yield* reportMode("full-access");
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (current) => tagged(current, "ModeRefused").length > 0 && tagged(current, "TurnEnded").length > 0);
      const refused = tagged(rows, "ModeRefused");
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({ agentId: reply.agentId, mode: "full-access", ceiling: "ask" });
      expect(refused[0]!.reason.length).toBeGreaterThan(0);
      const seen = yield* readEcho(echo, (current) => modeSets(current).length >= 2);
      expect(modeSets(seen)).toEqual(["default", "default"]);
      expect(framesOf(seen, "session/set_mode")).toEqual([]);
      expect(tagged(rows, "ModeChanged").filter((event) => event.level === "full")).toEqual([]);
    }));
  }));

live("6.13 within the ceiling: a reported change to read-only is recorded as ModeChanged with its level and is not set back (breaks if every change is refused, or a lower mode is reverted)", () =>
  Effect.gen(function* () {
    const { echo, harness, account } = yield* reportMode("read-only");
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (current) => tagged(current, "ModeChanged").length > 0 && tagged(current, "TurnEnded").length > 0);
      // Recording the starting mode itself is allowed (the fourth case).
      expect(tagged(rows, "ModeChanged").filter((event) => event.mode !== "default")).toEqual([{ _tag: "ModeChanged", agentId: reply.agentId, mode: "read-only", level: "read-only" }]);
      expect(tagged(rows, "ModeRefused")).toEqual([]);
      expect(modeSets(yield* readEcho(echo))).toEqual(["default"]);
    }));
  }));

live("6.13 unknown mode: a reported mode the harness settings do not name is refused and set back (breaks if an unmapped mode is treated as within the ceiling)", () =>
  Effect.gen(function* () {
    const { echo, harness, account } = yield* reportMode("yolo-unlisted");
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (current) => tagged(current, "ModeRefused").length > 0 && tagged(current, "TurnEnded").length > 0);
      expect(tagged(rows, "ModeRefused")[0]).toMatchObject({ mode: "yolo-unlisted", ceiling: "ask" });
      const seen = yield* readEcho(echo, (current) => modeSets(current).length >= 2);
      expect(modeSets(seen).at(-1)).toBe("default");
    }));
  }));

live("6.13 the runner's own starting mode is not reported back as a change (breaks if the set_config_option reply or its config_option_update for the starting mode writes ModeChanged or ModeRefused)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [[{ step: "text", text: "plain turn" }]] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (current) => tagged(current, "TurnEnded").length > 0);
      expect(tagged(rows, "ModeRefused")).toEqual([]);
      expect(tagged(rows, "ModeChanged").filter((event) => event.mode !== "default")).toEqual([]);
    }));
  }));
