import { it } from "@effect/vitest";
import { HarnessSettings } from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, call, failureOf, harnessSettings, headSequence, logAfter, makeFakeSecrets, makeRig, ownerCredential,
  provideRig, readLog, removeRig, seedAccount, seedAgent, startPayload, success, type Fakes, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Fix round 1, N-1 with A16 (owner choices, 2026-11-03): the service loads the
// harness defaults itself on its first start, `harnesses reset` loads them
// again on the owner's request, and an empty model or effort list means "not
// checked", never "refuse".

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPRD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const decode = Schema.decodeUnknownSync(HarnessSettings);
const defaultClaude = decode(harnessSettings("first", { adapterPath: "/opt/adapters/claude", models: [], efforts: [] }));
const defaultCodex = decode(harnessSettings("second", { adapterPath: "/opt/adapters/codex", models: [], efforts: [] }));
const defaults = Effect.succeed([defaultClaude, defaultCodex] as ReadonlyArray<HarnessSettings>);

// One service start: a new layer over the same database file.
const serviceStart = <A, E, R>(
  options: { readonly defaults?: Effect.Effect<ReadonlyArray<HarnessSettings>> },
  body: (fakes: Fakes) => Effect.Effect<A, E, R>,
) => Effect.gen(function* () {
  const fakes: Fakes = {
    runner: yield* makeFakeRunner(), secrets: makeFakeSecrets(),
    ...(options.defaults === undefined ? {} : { harnessDefaults: options.defaults }),
  };
  return yield* provideRig(rig, fakes, Effect.gen(function* () {
    yield* registerRebuildCheck();
    return yield* body(fakes);
  }));
});

const listed = Effect.gen(function* () {
  return success(yield* call(ownerCredential, "harnesses", { operation: "list" })).harnesses as ReadonlyArray<HarnessSettings>;
});
const harnessEvents = readLog.pipe(Effect.map((rows) => rows.filter((row) => row.event._tag === "HarnessChanged")));

it.effect("N-1 first start: catches a service that leaves a fresh state folder with no harness settings, so the first start is refused", () =>
  serviceStart({ defaults }, (fakes) => Effect.gen(function* () {
    // No `harnesses set` anywhere in this test.
    expect(yield* listed).toEqual([defaultClaude, defaultCodex]);
    const events = yield* harnessEvents;
    expect(events.map((row) => row.caller)).toEqual([{ _tag: "owner" }, { _tag: "owner" }]);
    yield* seedAccount("primary", "first");
    const { model: _model, effort: _effort, ...withoutConfiguration } = startPayload(rig);
    const reply = success(yield* call(ownerCredential, "start", withoutConfiguration));
    expect(typeof reply.agentId).toBe("string");
    expect(fakes.runner.callsOf("start")).toHaveLength(1);
  })).pipe(Effect.orDie));

it.effect("N-1 first start: catches a first start that loads nothing for the harnesses it cannot find, or fails on them", () =>
  serviceStart({ defaults: Effect.succeed([defaultClaude]) }, () => Effect.gen(function* () {
    expect(yield* listed).toEqual([defaultClaude]);
  })).pipe(Effect.orDie));

it.effect("N-1 restart: catches a later start that loads the defaults over settings that already exist", () =>
  Effect.gen(function* () {
    const edited = decode(harnessSettings("first", { adapterPath: "/opt/adapters/edited", adapterArguments: ["--edited"], models: [], efforts: [] }));
    yield* serviceStart({ defaults }, () => Effect.gen(function* () {
      success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: edited }));
    }));
    const before = yield* serviceStart({ defaults }, () => headSequence);
    // The defaults now differ and the owner's edit stands.
    const changed = Effect.succeed([decode({ ...defaultClaude, adapterPath: "/opt/adapters/other" })] as ReadonlyArray<HarnessSettings>);
    yield* serviceStart({ defaults: changed }, () => Effect.gen(function* () {
      expect(yield* headSequence).toBe(before);
      expect(yield* harnessEvents).toHaveLength(3);
      expect(yield* listed).toEqual([edited, defaultCodex]);
    }));
  }).pipe(Effect.orDie));

it.effect("N-1 restart: catches a start that loads the defaults beside settings the owner wrote by hand", () =>
  Effect.gen(function* () {
    // The first service start has no defaults to load; the owner sets one.
    yield* serviceStart({}, () => Effect.gen(function* () {
      success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: defaultCodex }));
    }));
    yield* serviceStart({ defaults }, () => Effect.gen(function* () {
      expect(yield* listed).toEqual([defaultCodex]);
      expect(yield* harnessEvents).toHaveLength(1);
    }));
  }).pipe(Effect.orDie));

it.effect("N-1 reset: catches a reset that does not restore the defaults after an edit, or that touches a harness the defaults do not name", () =>
  serviceStart({ defaults }, () => Effect.gen(function* () {
    const edited = decode({ ...defaultClaude, adapterPath: "/opt/adapters/edited", defaultPermission: "full" });
    const custom = decode(harnessSettings("custom", { adapterPath: "/opt/adapters/custom" }));
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: edited }));
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: custom }));
    expect(yield* listed).toContainEqual(edited);
    const before = yield* headSequence;
    const reply = success(yield* call(ownerCredential, "harnesses", { operation: "reset" }));
    expect(reply.harnesses).toEqual([defaultClaude, defaultCodex, custom]);
    expect(yield* listed).toEqual([defaultClaude, defaultCodex, custom]);
    expect((yield* logAfter(before)).map((row) => row.event._tag)).toEqual(["HarnessChanged", "HarnessChanged"]);
  })).pipe(Effect.orDie));

it.effect("N-1 reset: catches a reset that succeeds on a service that has no defaults to load", () =>
  serviceStart({}, () => Effect.gen(function* () {
    const before = yield* headSequence;
    expect(failureOf(yield* call(ownerCredential, "harnesses", { operation: "reset" }))?.reason).toBe("harness defaults are unavailable");
    expect((yield* logAfter(before)).map((row) => row.event._tag)).toEqual(["CommandRefused"]);
  })).pipe(Effect.orDie));

it.effect("N-1 reset: catches a reset an agent can run", () =>
  serviceStart({ defaults }, () => Effect.gen(function* () {
    const { token } = yield* seedAgent({ id: "lead" });
    const before = yield* headSequence;
    expect(failureOf(yield* call(agentCredential(token), "harnesses", { operation: "reset" }))?._tag).toBe("CommandRefused");
    expect((yield* logAfter(before)).map((row) => row.event._tag)).toEqual(["CommandRefused"]);
  })).pipe(Effect.orDie));

it.effect("A16 empty lists: catches a start that refuses a model or an effort because the harness lists none", () =>
  serviceStart({}, (fakes) => Effect.gen(function* () {
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: defaultClaude }));
    yield* seedAccount("primary", "first");
    const reply = success(yield* call(ownerCredential, "start", startPayload(rig, { model: "any-model-at-all", effort: "any-effort" })));
    expect(typeof reply.agentId).toBe("string");
    const started = fakes.runner.callsOf("start")[0]?.input;
    expect(started?.model).toBe("any-model-at-all");
    expect(started?.effort).toBe("any-effort");
  })).pipe(Effect.orDie));

it.effect("A16 filled lists: catches a start that accepts a model the harness does not list", () =>
  serviceStart({}, (fakes) => Effect.gen(function* () {
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: decode(harnessSettings("first", { models: ["listed"], efforts: ["high"] })) }));
    yield* seedAccount("primary", "first");
    expect(failureOf(yield* call(ownerCredential, "start", startPayload(rig, { model: "unlisted", effort: "high" })))?._tag).toBe("CommandRefused");
    expect(fakes.runner.callsOf("start")).toHaveLength(0);
  })).pipe(Effect.orDie));
