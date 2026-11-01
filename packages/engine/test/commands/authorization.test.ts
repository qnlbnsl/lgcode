import { mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { it } from "@effect/vitest";
import type { PermissionLevel } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, agentIdOf, agentRow, appendSetup, call, crashAgent, deviceCredential, eventOf, failureOf,
  folderIn, harnessSettings, headSequence, logAfter, makeFakeSecrets, makeRig, ownerCredential, provideRig,
  removeRig, revokeTokens, seedAccount, seedAgent, seedDevice, seedHarness, startPayload, success, viewsWithoutSequence,
  type Credential, type Fakes, type Rig, type SeedState,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { option, requestPermission, standardOptions } from "../support/routingRig.ts";
import * as Views from "../../src/views/Views.ts";

// Criterion 5.3, the lifecycle part (decision rows 24, 27, 35, 56, 65): who may
// call each lifecycle command on an agent in each state, where `start` and
// `resume` may put an agent, and how broad a child's mode may be.
//
// An authenticated caller who is not allowed gets "CommandRefused" and exactly
// one CommandRefused event (row 55). A credential the log no longer accepts
// (a stopped or revoked agent's token, a revoked device) is not a caller at
// all: the command fails and nothing is written.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const withRig = <A, E, R>(body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fakes: Fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      return yield* body(fakes);
    }));
  });

type Expectation = "allowed" | "refused" | "rejected";

// Runs `name` as `credential` and checks one of the three outcomes against
// the log, the views and the runner. "allowed" leaves the check of what the
// command did to lifecycle.test.ts.
const expectOutcome = (
  expectation: Expectation, credential: Credential, name: string, payload: Record<string, unknown>,
  fakes: Fakes,
) => Effect.gen(function* () {
  const views = yield* viewsWithoutSequence;
  const before = yield* headSequence;
  const runnerCallsBefore = fakes.runner.calls.length;
  const outcome = yield* call(credential, name, payload);
  const written = yield* logAfter(before);
  if (expectation === "allowed") {
    expect(failureOf(outcome)).toBeUndefined();
    return written;
  }
  expect(failureOf(outcome)).toBeDefined();
  expect(fakes.runner.calls).toHaveLength(runnerCallsBefore);
  expect(yield* viewsWithoutSequence).toEqual(views);
  if (expectation === "refused") {
    expect(failureOf(outcome)?._tag).toBe("CommandRefused");
    expect(written.map((row) => row.event)).toEqual([
      expect.objectContaining({ _tag: "CommandRefused", command: name, reason: expect.any(String) }),
    ]);
  } else {
    expect(written).toEqual([]);
  }
  return written;
});

// ---------------------------------------------------------------------------
// Every caller kind x every lifecycle command x every state the table allows
// ---------------------------------------------------------------------------

type CallerKind =
  | "owner" | "device" | "parent" | "grandparent" | "sibling" | "child" | "unrelated" | "stopped-parent" | "revoked-token";

const expected: Readonly<Record<CallerKind, Expectation>> = {
  owner: "allowed", device: "allowed", parent: "allowed",
  grandparent: "refused", sibling: "refused", child: "refused", unrelated: "refused",
  "stopped-parent": "rejected", "revoked-token": "rejected",
};

const payloads: Readonly<Record<string, (agentId: string) => Record<string, unknown>>> = {
  prompt: (agentId) => ({ agentId, text: "Run the tests." }),
  compact: (agentId) => ({ agentId }),
  resume: (agentId) => ({ agentId }),
  stop: (agentId) => ({ agentId }),
  group: (agentId) => ({ agentId, add: ["y"], remove: [] }),
};

// The states each command is valid in (the state table of row 24). Authorization
// is checked only where the state table lets the command through, so a refusal
// here is the caller's, not the state's.
const validStates: ReadonlyArray<readonly [string, SeedState]> = [
  ["prompt", "starting"], ["prompt", "working"], ["prompt", "idle"], ["prompt", "paused"], ["prompt", "interrupted"],
  ["compact", "idle"],
  ["resume", "interrupted"], ["resume", "crashed"], ["resume", "stopped"],
  ["stop", "starting"], ["stop", "working"], ["stop", "idle"], ["stop", "paused"], ["stop", "interrupted"], ["stop", "crashed"],
  ...(["starting", "working", "idle", "paused", "interrupted", "crashed", "stopped"] as const).map((state) => ["group", state] as const),
];

// One world per case. `target` is the agent under test: its parent is
// `parent`, whose parent is `boss`. `orphan` is parented by `dead`, a stopped
// agent, and `revoked-target` by `keeper`, whose token has been revoked.
const world = (state: SeedState) => Effect.gen(function* () {
  const boss = yield* seedAgent({ id: "boss" });
  const parent = yield* seedAgent({ id: "parent", parent: "boss" });
  yield* seedAgent({ id: "target", parent: "parent", state });
  const sibling = yield* seedAgent({ id: "sibling", parent: "parent" });
  const child = yield* seedAgent({ id: "kid", parent: "target" });
  const unrelated = yield* seedAgent({ id: "unrelated" });
  const dead = yield* seedAgent({ id: "dead", parent: "boss", state: "stopped" });
  yield* seedAgent({ id: "orphan", parent: "dead", state });
  const keeper = yield* seedAgent({ id: "keeper", parent: "boss" });
  yield* seedAgent({ id: "revoked-target", parent: "keeper", state });
  yield* revokeTokens(agentIdOf("keeper"));
  const device = yield* seedDevice();
  const credentials: Record<CallerKind, readonly [Credential, string]> = {
    owner: [ownerCredential, "target"],
    device: [deviceCredential(device.credential), "target"],
    parent: [agentCredential(parent.token), "target"],
    grandparent: [agentCredential(boss.token), "target"],
    sibling: [agentCredential(sibling.token), "target"],
    child: [agentCredential(child.token), "target"],
    unrelated: [agentCredential(unrelated.token), "target"],
    "stopped-parent": [agentCredential(dead.token), "orphan"],
    "revoked-token": [agentCredential(keeper.token), "revoked-target"],
  };
  return credentials;
});

const kinds = Object.keys(expected) as ReadonlyArray<CallerKind>;

for (const [command, state] of validStates) {
  for (const kind of kinds) {
    it.effect(`5.3 ${command} on a ${state} agent as ${kind}: catches ${kind} being ${expected[kind] === "allowed" ? "refused" : "allowed"}`, () =>
      withRig((fakes) => Effect.gen(function* () {
        const credential = (yield* world(state))[kind];
        const written = yield* expectOutcome(expected[kind], credential[0], command, payloads[command]!(credential[1]), fakes);
        if (expected[kind] !== "allowed") return;
        // The caller is recorded on the events it wrote: a device as the owner (row 24), an agent as itself.
        const callers = new Set(written.map((row) => JSON.stringify(row.caller)));
        expect(callers).toEqual(new Set([JSON.stringify(kind === "parent" ? { _tag: "agent", agentId: "parent" } : { _tag: "owner" })]));
      })).pipe(Effect.orDie));
  }
}

it.effect("5.3 revoked device: catches a device credential that still works after the device is revoked", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    const device = yield* seedDevice();
    yield* appendSetup([eventOf({ _tag: "DeviceRevoked", deviceId: device.deviceId })], { revokeDevices: [device.deviceId] });
    yield* expectOutcome("rejected", deviceCredential(device.credential), "stop", { agentId: "agent-a" }, fakes);
  })).pipe(Effect.orDie));

it.effect("5.3 forged credentials: catches an agent token or device credential that was never issued being treated as a caller", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    yield* expectOutcome("rejected", agentCredential("shp_a_" + "0".repeat(40)), "stop", { agentId: "agent-a" }, fakes);
    yield* expectOutcome("rejected", deviceCredential("shp_d_" + "0".repeat(40)), "stop", { agentId: "agent-a" }, fakes);
    yield* expectOutcome("rejected", agentCredential("not a token"), "stop", { agentId: "agent-a" }, fakes);
  })).pipe(Effect.orDie));

it.effect("5.3 device token as agent token: catches a credential of one kind being accepted as the other", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    const device = yield* seedDevice();
    yield* expectOutcome("rejected", agentCredential(device.credential), "stop", { agentId: "agent-a" }, fakes);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// Rights pass up the ancestor chain (decision row 27)
// ---------------------------------------------------------------------------

// leaf's parent is mid, mid's parent is grand, grand's parent is great, great's is the owner.
type ChainCase = {
  readonly grand: SeedState; readonly mid: SeedState;
  readonly great: Expectation; readonly grandExpected: Expectation; readonly midExpected: Expectation;
};
const chainCases: ReadonlyArray<ChainCase> = [
  // The parent is idle or working: the parent holds the rights and no ancestor does.
  { grand: "idle", mid: "idle", great: "refused", grandExpected: "refused", midExpected: "allowed" },
  { grand: "idle", mid: "working", great: "refused", grandExpected: "refused", midExpected: "allowed" },
  // The parent is not idle or working: the nearest ancestor that is, holds them.
  { grand: "idle", mid: "starting", great: "refused", grandExpected: "allowed", midExpected: "refused" },
  { grand: "idle", mid: "paused", great: "refused", grandExpected: "allowed", midExpected: "refused" },
  { grand: "idle", mid: "interrupted", great: "refused", grandExpected: "allowed", midExpected: "refused" },
  { grand: "idle", mid: "crashed", great: "refused", grandExpected: "allowed", midExpected: "rejected" },
  { grand: "idle", mid: "stopped", great: "refused", grandExpected: "allowed", midExpected: "rejected" },
  { grand: "working", mid: "paused", great: "refused", grandExpected: "allowed", midExpected: "refused" },
  // Two ancestors out of play: it passes to the next.
  { grand: "paused", mid: "paused", great: "allowed", grandExpected: "refused", midExpected: "refused" },
  { grand: "stopped", mid: "crashed", great: "allowed", grandExpected: "rejected", midExpected: "rejected" },
  { grand: "interrupted", mid: "starting", great: "allowed", grandExpected: "refused", midExpected: "refused" },
];

for (const row of chainCases) {
  for (const who of ["great", "grand", "mid"] as const) {
    const want = { great: row.great, grand: row.grandExpected, mid: row.midExpected }[who];
    it.effect(`5.3 rights up (row 27), grand ${row.grand}, mid ${row.mid}: catches ${who} being ${want === "allowed" ? "refused" : "allowed"} on a prompt to the idle leaf`, () =>
      withRig((fakes) => Effect.gen(function* () {
        const great = yield* seedAgent({ id: "great" });
        const grand = yield* seedAgent({ id: "grand", parent: "great", state: row.grand });
        const mid = yield* seedAgent({ id: "mid", parent: "grand", state: row.mid });
        yield* seedAgent({ id: "leaf", parent: "mid" });
        const token = { great, grand, mid }[who].token;
        yield* expectOutcome(want, agentCredential(token), "prompt", { agentId: "leaf", text: "Go." }, fakes);
      })).pipe(Effect.orDie));
  }
}

it.effect("5.3 rights up: catches the owner losing the rights when every ancestor is out of play", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "grand", state: "paused" });
    yield* seedAgent({ id: "mid", parent: "grand", state: "crashed" });
    yield* seedAgent({ id: "leaf", parent: "mid" });
    yield* expectOutcome("allowed", ownerCredential, "prompt", { agentId: "leaf", text: "Go." }, fakes);
  })).pipe(Effect.orDie));

it.effect("5.3 rights up: catches the rights being decided once at start instead of by the parent's state at the time of the command", () =>
  withRig((fakes) => Effect.gen(function* () {
    const grand = yield* seedAgent({ id: "grand" });
    const mid = yield* seedAgent({ id: "mid", parent: "grand" });
    yield* seedAgent({ id: "leaf", parent: "mid" });
    yield* expectOutcome("refused", agentCredential(grand.token), "prompt", { agentId: "leaf", text: "Go." }, fakes);
    yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: "mid", state: { _tag: "paused", reason: "limit", midTurn: false } })]);
    yield* expectOutcome("allowed", agentCredential(grand.token), "prompt", { agentId: "leaf", text: "Go." }, fakes);
    yield* expectOutcome("refused", agentCredential(mid.token), "prompt", { agentId: "leaf", text: "Go." }, fakes);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// Owner-only commands
// ---------------------------------------------------------------------------

const ownerOnly: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["accounts", { operation: "list" }],
  ["accounts", { operation: "add", account: { id: "extra", harness: "first", enabled: true } }],
  ["accounts", { operation: "set", account: { id: "primary", harness: "first", displayName: "Other", enabled: true } }],
  ["accounts", { operation: "disable", accountId: "spare" }],
  ["accounts", { operation: "remove", accountId: "spare" }],
  ["accounts set-secret", { accountId: "primary", name: "API_KEY", nonce: "nonce-1", value: Redacted.make("owner-only-secret-0123456789") }],
  ["accounts mark-available", { accountId: "primary" }],
  ["harnesses", { operation: "list" }],
  ["harnesses", { operation: "set", harness: harnessSettings("first", { adapterArguments: ["--changed"] }) }],
];

for (const [name, payload] of ownerOnly) {
  const label = `${name} ${String(payload["operation"] ?? "")}`.trim();
  const ownerOnlyWorld = Effect.gen(function* () {
    yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: "spare", account: { id: "spare", harness: "first", enabled: true } })]);
    const agent = yield* seedAgent({ id: "agent-a" });
    const dead = yield* seedAgent({ id: "agent-dead", state: "stopped" });
    const device = yield* seedDevice();
    const revoked = yield* seedDevice("Old phone");
    yield* appendSetup([eventOf({ _tag: "DeviceRevoked", deviceId: revoked.deviceId })], { revokeDevices: [revoked.deviceId] });
    return { agent, dead, device, revoked };
  });
  const cases: ReadonlyArray<readonly [string, Expectation, (w: Effect.Success<typeof ownerOnlyWorld>) => Credential]> = [
    ["the owner", "allowed", () => ownerCredential],
    ["a device", "allowed", (w) => deviceCredential(w.device.credential)],
    ["an agent", "refused", (w) => agentCredential(w.agent.token)],
    ["a stopped agent's token", "rejected", (w) => agentCredential(w.dead.token)],
    ["a revoked device", "rejected", (w) => deviceCredential(w.revoked.credential)],
  ];
  for (const [who, want, credential] of cases) {
    it.effect(`5.3 owner-only ${label} as ${who}: catches ${who} being ${want === "allowed" ? "refused" : "allowed"}`, () =>
      withRig((fakes) => Effect.gen(function* () {
        const w = yield* ownerOnlyWorld;
        yield* expectOutcome(want, credential(w), name, payload, fakes);
      })).pipe(Effect.orDie));
  }
}

it.effect("5.3 owner-only: catches an agent's set-secret leaving the value in the secret store", () =>
  withRig((fakes) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-a" });
    yield* expectOutcome("refused", agentCredential(agent.token), "accounts set-secret", {
      accountId: "primary", name: "API_KEY", nonce: "nonce-1", value: Redacted.make("refused-secret-0123456789"),
    }, fakes);
    expect(fakes.secrets.stored.size).toBe(0);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// start: who, and the folder and mode ceilings of unit 5a
// ---------------------------------------------------------------------------

it.effect("5.3 start as owner: catches an owner-started agent being held to the folder ceiling (row 65)", () =>
  withRig((fakes) => Effect.gen(function* () {
    for (const folder of [rig.outside, rig.home, rig.stateFolder, rig.pluginRoot, rig.root]) {
      const written = yield* expectOutcome("allowed", ownerCredential, "start", startPayload(rig, { folder }), fakes);
      expect(written.map((row) => row.event).find((event) => event._tag === "AgentStarted")).toMatchObject({ folder, parent: { _tag: "owner" } });
    }
  })).pipe(Effect.orDie));

it.effect("5.3 start as device: catches a device's start recorded with a parent other than the owner", () =>
  withRig((fakes) => Effect.gen(function* () {
    const device = yield* seedDevice();
    const written = yield* expectOutcome("allowed", deviceCredential(device.credential), "start", startPayload(rig, { prompt: "Go." }), fakes);
    expect(written.map((row) => row.event).find((event) => event._tag === "AgentStarted")).toMatchObject({ parent: { _tag: "owner" } });
    expect(written.every((row) => row.caller._tag === "owner")).toBe(true);
  })).pipe(Effect.orDie));

for (const state of ["idle", "working"] as const) it.effect(`5.3 start as a ${state} agent: catches an agent being unable to start a child, or the child's parent and first-prompt sender being recorded as the owner`, () =>
  withRig((fakes) => Effect.gen(function* () {
    const parentFolder = folderIn(rig, "parent");
    const boss = yield* seedAgent({ id: "boss", state, folder: parentFolder });
    const written = yield* expectOutcome("allowed", agentCredential(boss.token), "start", startPayload(rig, {
      folder: parentFolder, permission: "ask", prompt: "Take the tests.",
    }), fakes);
    const events = written.map((row) => row.event);
    expect(events.find((event) => event._tag === "AgentStarted")).toMatchObject({ parent: { _tag: "agent", agentId: "boss" } });
    const views = yield* Views.Views;
    const deliveries = Object.values((yield* views.snapshot).deliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.sender).toEqual({ _tag: "agent", agentId: "boss" });
  })).pipe(Effect.orDie));

it.effect("5.3 start with a stopped or revoked token: catches a start by an agent whose token is no longer valid", () =>
  withRig((fakes) => Effect.gen(function* () {
    const dead = yield* seedAgent({ id: "dead", state: "stopped", folder: folderIn(rig, "parent") });
    yield* expectOutcome("rejected", agentCredential(dead.token), "start", startPayload(rig, { folder: folderIn(rig, "parent") }), fakes);
    const keeper = yield* seedAgent({ id: "keeper", folder: folderIn(rig, "parent") });
    yield* revokeTokens(agentIdOf("keeper"));
    yield* expectOutcome("rejected", agentCredential(keeper.token), "start", startPayload(rig, { folder: folderIn(rig, "parent") }), fakes);
  })).pipe(Effect.orDie));

const directory = (path: string): string => { mkdirSync(path, { recursive: true }); return path; };

// The linked-worktree layout of the 5a tests: two folders that share one git
// common directory, neither inside the other.
const linkedWorktrees = (parent: string) => {
  const common = directory(join(rig.root, "repository", ".git"));
  const linked = directory(join(rig.outside, "linked"));
  for (const [name, folder] of [["parent", parent], ["linked", linked]] as const) {
    const gitdir = directory(join(common, "worktrees", name));
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(gitdir, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(folder, ".git"), `gitdir: ${relative(folder, gitdir)}\n`);
    writeFileSync(join(gitdir, "gitdir"), `${join(folder, ".git")}\n`);
  }
  writeFileSync(join(common, "HEAD"), "ref: refs/heads/main\n");
  return linked;
};

it.effect("5.3 start folder (row 65): catches an agent-started child outside its starter's folder being allowed, or one inside it being refused", () =>
  withRig((fakes) => Effect.gen(function* () {
    const parentFolder = folderIn(rig, "parent");
    const boss = yield* seedAgent({ id: "boss", folder: parentFolder });
    const inside = folderIn(rig, "parent", "feature");
    const real = folderIn(rig, "parent", "real");
    symlinkSync(real, join(parentFolder, "link-inside"));
    symlinkSync(rig.outside, join(parentFolder, "link-outside"));
    const sibling = directory(`${parentFolder}-other`);

    const accepted = [parentFolder, inside, join(parentFolder, "link-inside"), linkedWorktrees(parentFolder)];
    for (const folder of accepted) {
      const written = yield* expectOutcome("allowed", agentCredential(boss.token), "start", startPayload(rig, { folder }), fakes);
      const started = written.map((row) => row.event).find((event) => event._tag === "AgentStarted");
      // The stored folder is the checked real path, not the spelling asked for (row 65).
      expect(started).toMatchObject({ folder: folder === join(parentFolder, "link-inside") ? real : folder });
    }
    for (const folder of [rig.outside, sibling, join(parentFolder, "link-outside")]) {
      const before = Object.keys((yield* (yield* Views.Views).snapshot).agents).length;
      const written = yield* expectOutcome("refused", agentCredential(boss.token), "start", startPayload(rig, { folder }), fakes);
      expect(written.map((row) => row.event._tag)).not.toContain("AgentStarted");
      expect(Object.keys((yield* (yield* Views.Views).snapshot).agents)).toHaveLength(before);
      // A refusal names no path (SECURITY.md rule 6).
      expect(JSON.stringify(written)).not.toContain(rig.root);
    }
  })).pipe(Effect.orDie));

it.effect("5.3 start folder: catches a folder that is, is inside, or contains home, the state folder or the plugin root being allowed to an agent", () =>
  withRig((fakes) => Effect.gen(function* () {
    // This starter's own folder contains everything, so containment alone would let each of these through.
    const wide = yield* seedAgent({ id: "wide", folder: rig.root });
    const refused = [
      rig.home, join(rig.home, "sub"), rig.stateFolder, join(rig.stateFolder, "sub"), rig.pluginRoot,
      join(rig.pluginRoot, "sub"), rig.root,
    ];
    for (const folder of refused) {
      directory(folder);
      const written = yield* expectOutcome("refused", agentCredential(wide.token), "start", startPayload(rig, { folder }), fakes);
      expect(written.map((row) => row.event._tag)).not.toContain("AgentStarted");
      expect(JSON.stringify(written)).not.toContain(rig.root);
    }
    yield* expectOutcome("allowed", agentCredential(wide.token), "start", startPayload(rig, { folder: rig.work }), fakes);
  })).pipe(Effect.orDie));

const modes = ["read-only", "ask", "edit", "full"] as const;
for (const starter of modes) {
  for (const requested of modes) {
    const allowed = modes.indexOf(requested) <= modes.indexOf(starter);
    it.effect(`5.3 start mode (row 35): catches a child asking for ${requested} being ${allowed ? "refused" : "allowed"} under a starter with ${starter}`, () =>
      withRig((fakes) => Effect.gen(function* () {
        const parentFolder = folderIn(rig, "parent");
        const boss = yield* seedAgent({ id: "boss", folder: parentFolder, permission: starter });
        const written = yield* expectOutcome(allowed ? "allowed" : "refused", agentCredential(boss.token), "start",
          startPayload(rig, { folder: parentFolder, permission: requested }), fakes);
        if (!allowed) expect(written.map((row) => row.event._tag)).not.toContain("AgentStarted");
      })).pipe(Effect.orDie));
  }
}

it.effect("5.3 start mode: catches the owner being held to a mode ceiling", () =>
  withRig((fakes) => Effect.gen(function* () {
    for (const permission of modes) yield* expectOutcome("allowed", ownerCredential, "start", startPayload(rig, { permission }), fakes);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// resume: the ceiling is checked again against the agent's starter
// ---------------------------------------------------------------------------

it.effect("5.3 resume folder (row 65): catches a resume that skips the ceiling when the agent's folder now resolves outside its starter's", () =>
  withRig((fakes) => Effect.gen(function* () {
    const parentFolder = folderIn(rig, "parent");
    const boss = yield* seedAgent({ id: "boss", folder: parentFolder });
    const childFolder = folderIn(rig, "parent", "child");
    yield* seedAgent({ id: "kid", parent: "boss", folder: childFolder });
    yield* crashAgent("kid");
    yield* expectOutcome("allowed", agentCredential(boss.token), "resume", { agentId: "kid" }, fakes);
    expect(fakes.runner.callsOf("load")[0]?.input.folder).toBe(childFolder);

    // The folder is swapped for a link to somewhere outside, after the first check.
    yield* crashAgent("kid");
    fakes.runner.reset();
    mkdirSync(join(rig.root, "moved"));
    renameSync(childFolder, join(rig.root, "moved", "old-child"));
    symlinkSync(rig.outside, childFolder);
    const written = yield* expectOutcome("refused", agentCredential(boss.token), "resume", { agentId: "kid" }, fakes);
    expect(JSON.stringify(written)).not.toContain(rig.root);
    // The starter's ceiling stands when the owner resumes: it is not loosened by who asks.
    yield* expectOutcome("refused", ownerCredential, "resume", { agentId: "kid" }, fakes);
  })).pipe(Effect.orDie));

it.effect("5.3 resume --fresh folder: catches the fresh path skipping the ceiling the other path applies", () =>
  withRig((fakes) => Effect.gen(function* () {
    const parentFolder = folderIn(rig, "parent");
    yield* seedAgent({ id: "boss", folder: parentFolder });
    const childFolder = folderIn(rig, "parent", "child");
    yield* seedAgent({ id: "kid", parent: "boss", folder: childFolder });
    yield* crashAgent("kid");
    renameSync(childFolder, join(rig.root, "old-child"));
    symlinkSync(rig.outside, childFolder);
    yield* expectOutcome("refused", ownerCredential, "resume", { agentId: "kid", fresh: true }, fakes);
    expect((yield* agentRow("kid"))?.state._tag).toBe("crashed");
  })).pipe(Effect.orDie));

it.effect("5.3 resume of an owner-started agent: catches the ceiling being applied to a folder the owner chose", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "kid", folder: rig.home });
    yield* crashAgent("kid");
    yield* expectOutcome("allowed", ownerCredential, "resume", { agentId: "kid" }, fakes);
    expect(fakes.runner.callsOf("load")[0]?.input.folder).toBe(rig.home);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// Unit 5c: answer, pass-up and ask (rows 27, 35, 51, 56)
// ---------------------------------------------------------------------------

// boss -> holder -> asker (working), with `kid` a second child of the holder
// and `sibling` a second child of the boss. The asker has asked for a
// permission and asked a question; the holder holds both. `dead` is stopped
// and `keeper`'s token has been revoked.
type RoutingCaller =
  | "owner" | "device" | "holder" | "ancestor" | "sibling" | "child" | "asker" | "unrelated" | "stopped" | "revoked-token";

const routingWorld = (fakes: Fakes) => Effect.gen(function* () {
  const boss = yield* seedAgent({ id: "boss" });
  const holder = yield* seedAgent({ id: "holder", parent: "boss" });
  const asker = yield* seedAgent({ id: "asker", parent: "holder", state: "working" });
  const kid = yield* seedAgent({ id: "kid", parent: "holder" });
  const sibling = yield* seedAgent({ id: "sibling", parent: "boss" });
  const unrelated = yield* seedAgent({ id: "unrelated" });
  const dead = yield* seedAgent({ id: "dead", parent: "boss", state: "stopped" });
  const keeper = yield* seedAgent({ id: "keeper", parent: "boss" });
  yield* revokeTokens(agentIdOf("keeper"));
  const device = yield* seedDevice();
  const permission = yield* requestPermission(fakes.runner, asker);
  const questionId: string = success(yield* call(agentCredential(asker.token), "ask", { text: "Which branch?" })).questionId;
  expect(permission.row.holder).toEqual({ _tag: "agent", agentId: "holder" });
  expect((yield* (yield* Views.Views).snapshot).questions[questionId]?.holder).toEqual({ _tag: "agent", agentId: "holder" });
  const credentials: Record<RoutingCaller, Credential> = {
    owner: ownerCredential,
    device: deviceCredential(device.credential),
    holder: agentCredential(holder.token),
    ancestor: agentCredential(boss.token),
    sibling: agentCredential(sibling.token),
    child: agentCredential(kid.token),
    asker: agentCredential(asker.token),
    unrelated: agentCredential(unrelated.token),
    stopped: agentCredential(dead.token),
    "revoked-token": agentCredential(keeper.token),
  };
  return { credentials, permissionId: permission.id, questionId };
});

// Only the holder or the owner may answer or pass up (row 27). Anyone with a
// live token may ask, for itself; the owner has no one to ask.
const holderOnly: Readonly<Record<RoutingCaller, Expectation>> = {
  owner: "allowed", device: "allowed", holder: "allowed",
  ancestor: "refused", sibling: "refused", child: "refused", asker: "refused", unrelated: "refused",
  stopped: "rejected", "revoked-token": "rejected",
};
const anyLiveAgent: Readonly<Record<RoutingCaller, Expectation>> = {
  owner: "refused", device: "refused", holder: "allowed",
  ancestor: "allowed", sibling: "allowed", child: "allowed", asker: "allowed", unrelated: "allowed",
  stopped: "rejected", "revoked-token": "rejected",
};
// Where each caller's own question goes, by the holder rule.
const askHolder: Partial<Record<RoutingCaller, string | undefined>> = {
  holder: "boss", ancestor: undefined, sibling: "boss", child: "holder", asker: "holder", unrelated: undefined,
};
const callerId: Partial<Record<RoutingCaller, string>> = {
  holder: "holder", ancestor: "boss", sibling: "sibling", child: "kid", asker: "asker", unrelated: "unrelated",
};
const recordedAs = (kind: RoutingCaller) =>
  kind === "owner" || kind === "device" ? { _tag: "owner" } : { _tag: "agent", agentId: callerId[kind] };

type RoutingWorld = Effect.Success<ReturnType<typeof routingWorld>>;
const routingCommands: ReadonlyArray<{
  readonly label: string;
  readonly name: string;
  readonly expected: Readonly<Record<RoutingCaller, Expectation>>;
  readonly payload: (world: RoutingWorld) => Record<string, unknown>;
  // What an allowed command must have done, checked against the views.
  readonly check: (world: RoutingWorld, kind: RoutingCaller, reply: Record<string, unknown> | undefined) => Effect.Effect<void, never, Views.Views>;
}> = [
  {
    label: "answer (permission)", name: "answer", expected: holderOnly,
    payload: (world) => ({ kind: "permission", id: world.permissionId, optionId: "once" }),
    check: (world, kind) => Effect.gen(function* () {
      const row = (yield* (yield* Views.Views).snapshot).requests[world.permissionId];
      expect(row).toMatchObject({ status: "answered", answeredBy: recordedAs(kind) });
    }),
  },
  {
    label: "answer (question)", name: "answer", expected: holderOnly,
    payload: (world) => ({ kind: "question", id: world.questionId, text: "Use main." }),
    check: (world, kind) => Effect.gen(function* () {
      const row = (yield* (yield* Views.Views).snapshot).questions[world.questionId];
      expect(row).toMatchObject({ status: "answered", answeredBy: recordedAs(kind) });
    }),
  },
  {
    label: "pass-up (permission)", name: "pass-up", expected: holderOnly,
    payload: (world) => ({ subject: { _tag: "permission", id: world.permissionId } }),
    check: (world) => Effect.gen(function* () {
      expect((yield* (yield* Views.Views).snapshot).requests[world.permissionId]).toMatchObject({
        status: "open", holder: { _tag: "agent", agentId: "boss" },
      });
    }),
  },
  {
    label: "pass-up (question)", name: "pass-up", expected: holderOnly,
    payload: (world) => ({ subject: { _tag: "question", id: world.questionId } }),
    check: (world) => Effect.gen(function* () {
      expect((yield* (yield* Views.Views).snapshot).questions[world.questionId]).toMatchObject({
        status: "open", holder: { _tag: "agent", agentId: "boss" },
      });
    }),
  },
  {
    label: "ask", name: "ask", expected: anyLiveAgent,
    payload: () => ({ text: "May I go on?" }),
    check: (_world, kind, reply) => Effect.gen(function* () {
      const row = (yield* (yield* Views.Views).snapshot).questions[String(reply?.["questionId"])];
      const holder = askHolder[kind];
      expect(row).toMatchObject({
        status: "open", agentId: callerId[kind],
        holder: holder === undefined ? { _tag: "owner" } : { _tag: "agent", agentId: holder },
      });
    }),
  },
];

for (const command of routingCommands) {
  for (const kind of Object.keys(command.expected) as ReadonlyArray<RoutingCaller>) {
    const want = command.expected[kind];
    it.live(`5.3 ${command.label} as ${kind}: catches ${kind} being ${want === "allowed" ? "refused" : "allowed"}`, () =>
      withRig((fakes) => Effect.gen(function* () {
        const world = yield* routingWorld(fakes);
        const before = yield* headSequence;
        const outcome = yield* call(world.credentials[kind], command.name, command.payload(world));
        const reply = outcome._tag === "Success" ? outcome.success as Record<string, unknown> : undefined;
        const written = yield* logAfter(before);
        if (want === "allowed") {
          expect(failureOf(outcome)).toBeUndefined();
          yield* command.check(world, kind, reply);
          expect(new Set(written.map((row) => JSON.stringify(row.caller)))).toEqual(new Set([JSON.stringify(recordedAs(kind))]));
          return;
        }
        expect(failureOf(outcome)).toBeDefined();
        if (want === "refused") {
          expect(failureOf(outcome)?._tag).toBe("CommandRefused");
          expect(written.map((row) => row.event)).toEqual([
            expect.objectContaining({ _tag: "CommandRefused", command: command.name, reason: expect.any(String) }),
          ]);
        } else {
          expect(written).toEqual([]);
        }
        const views = (yield* (yield* Views.Views).snapshot);
        expect(views.requests[world.permissionId]).toMatchObject({ status: "open", holder: { _tag: "agent", agentId: "holder" } });
        expect(views.questions[world.questionId]).toMatchObject({ status: "open", holder: { _tag: "agent", agentId: "holder" } });
        expect(fakes.runner.callsOf("answerPermission")).toEqual([]);
      })).pipe(Effect.orDie));
  }
}

// Rights pass up (row 27) to the holder's nearest idle or working ancestor
// while the holder itself cannot act. A holder is left interrupted only during
// restart recovery (row 52 step 6), before holders are re-evaluated.
type RightsCase = { readonly grand: SeedState; readonly allowed: "grand" | "great" };
for (const row of [{ grand: "idle", allowed: "grand" }, { grand: "paused", allowed: "great" }] satisfies ReadonlyArray<RightsCase>) {
  for (const subject of ["permission", "question"] as const) {
    for (const who of ["great", "grand"] as const) {
      const want: Expectation = who === row.allowed ? "allowed" : "refused";
      it.live(`5.3 rights up for answer (row 27), grand ${row.grand}, ${subject}: catches ${who} being ${want === "allowed" ? "refused" : "allowed"} to answer for an interrupted holder, as for a prompt`, () =>
        withRig((fakes) => Effect.gen(function* () {
          const great = yield* seedAgent({ id: "great" });
          const grand = yield* seedAgent({ id: "grand", parent: "great" });
          yield* seedAgent({ id: "holder", parent: "grand" });
          const asker = yield* seedAgent({ id: "asker", parent: "holder", state: "working" });
          const id = subject === "permission"
            ? (yield* requestPermission(fakes.runner, asker)).id
            : String(success(yield* call(agentCredential(asker.token), "ask", { text: "Which branch?" })).questionId);
          yield* appendSetup([eventOf({ _tag: "AgentInterrupted", agentId: "holder", previous: "idle" })]);
          if (row.grand !== "idle") yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: "grand", state: { _tag: "paused", reason: "limit", midTurn: false } })]);
          const token = { great, grand }[who].token;
          const payload = subject === "permission"
            ? { kind: "permission", id, optionId: "once" }
            : { kind: "question", id, text: "Use main." };
          yield* expectOutcome(want, agentCredential(token), "answer", payload, fakes);
        })).pipe(Effect.orDie));
    }
  }
}

// The answerer's own ceiling (rows 35b, 56): an agent may choose an option
// only at or below its own mode, and never one that persists beyond the
// session or has a kind Shepherd does not know; the owner may choose any.
const ceilingOptions = [
  ...standardOptions,
  option("sticky", "allow_once", "ask", true),
  option("forever", "allow_forever", "ask"),
];
const askWithCeilingOptions = (fakes: Fakes, holderMode: PermissionLevel) => Effect.gen(function* () {
  const holder = yield* seedAgent({ id: "holder", permission: holderMode });
  const asker = yield* seedAgent({ id: "asker", parent: "holder", state: "working" });
  const { id } = yield* requestPermission(fakes.runner, asker, { options: ceilingOptions });
  return { holder, id };
});

for (const optionId of ["always", "never", "sticky", "forever"] as const) {
  it.live(`5.3 persistent or unknown option ${optionId} (row 56): catches an agent answerer with full mode allowed to choose it, or the owner refused`, () =>
    withRig((fakes) => Effect.gen(function* () {
      const { holder, id } = yield* askWithCeilingOptions(fakes, "full");
      yield* expectOutcome("refused", agentCredential(holder.token), "answer", { kind: "permission", id, optionId }, fakes);
      expect(fakes.runner.callsOf("answerPermission")).toEqual([]);
      yield* expectOutcome("allowed", ownerCredential, "answer", { kind: "permission", id, optionId }, fakes);
      expect(fakes.runner.callsOf("answerPermission").map((entry) => entry.input.optionId)).toEqual([optionId]);
    })).pipe(Effect.orDie));
}

const optionLevels = [["reject", "read-only"], ["once", "ask"], ["once-edit", "edit"], ["once-full", "full"]] as const;
for (const holderMode of modes) {
  for (const [optionId, level] of optionLevels) {
    const allowed = modes.indexOf(level) <= modes.indexOf(holderMode);
    it.live(`5.3 option above the answerer's mode (row 35b): catches a holder in mode ${holderMode} being ${allowed ? "refused" : "allowed"} the ${level} option`, () =>
      withRig((fakes) => Effect.gen(function* () {
        const { holder, id } = yield* askWithCeilingOptions(fakes, holderMode);
        yield* expectOutcome(allowed ? "allowed" : "refused", agentCredential(holder.token), "answer", { kind: "permission", id, optionId }, fakes);
        expect(fakes.runner.callsOf("answerPermission").map((entry) => entry.input.optionId)).toEqual(allowed ? [optionId] : []);
        if (!allowed) yield* expectOutcome("allowed", ownerCredential, "answer", { kind: "permission", id, optionId }, fakes);
      })).pipe(Effect.orDie));
  }
}
