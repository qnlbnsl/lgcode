// Criterion 7.15 (unit 7a; row 74): the debug RPC group and protocol logging
// stay off when their flags are set but `SHEPHRD_HOME` is outside the
// system's temporary folder, and the service logs when debug is on.
//
// Reading: "the system's temporary folder" is `os.tmpdir()` in the service,
// which reads TMPDIR. No folder is ever made outside /tmp: each case sets the
// service's TMPDIR to one `mkdtemp` folder and puts SHEPHRD_HOME inside a
// different one, so the home is outside the service's temporary folder. The
// comparison is on real paths, so a sibling folder that merely shares the
// temporary folder's name as a prefix, and a home reached through a symbolic
// link inside the temporary folder, are both outside. The service logs the
// fixed text "debug RPC group enabled" when the group is on. Protocol
// logging is observed through a unique prompt text, which only the ACP wire
// log would write.
import { randomBytes } from "node:crypto";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  compareViews, kindOf, makeServiceRoot, ownerClient, startFakeAgent, startService, stopAllServices, turnEnded, waitServing,
  type ServiceRoot,
} from "../support/serviceProcess.ts";

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps the missing
// production modules from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);
afterEach(async () => { await stopAllServices(); });

const enabledLine = "debug RPC group enabled";

// Runs the service with both flags, a flow with a marker prompt, then stops
// it; returns what the debug RPC did and everything the service wrote.
const observe = (root: ServiceRoot, env: Record<string, string>) => Effect.gen(function* () {
  const service = startService(root, { env });
  yield* waitServing(root, service);
  const marker = `protocol-marker-${randomBytes(8).toString("hex")}`;
  const debug = yield* Effect.scoped(Effect.gen(function* () {
    const owner = yield* ownerClient(root);
    const agent = yield* startFakeAgent(root, owner, owner, {
      script: { turns: [[{ step: "text", text: "Done." }, { step: "end_turn", stopReason: "end_turn" }]] }, prompt: marker,
    });
    yield* turnEnded(owner, agent.agentId);
    return kindOf(yield* compareViews(owner));
  }));
  service.child.kill("SIGTERM");
  yield* Effect.promise(() => service.exit);
  const output = service.output();
  return { debug, logged: output.includes(enabledLine), protocol: output.includes(marker) };
});

const both = { SHEPHRD_TEST_DEBUG: "1", SHEPHRD_TEST_PROTOCOL_LOG: "1" };

live("7.15 control: with both flags and SHEPHRD_HOME inside TMPDIR, the debug group is served, its line is logged and protocol logging is on (breaks if the gate refuses a home inside the temporary folder, or the service does not log that debug is on)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    expect(yield* observe(root, { ...both, TMPDIR: root.root })).toEqual({ debug: "success", logged: true, protocol: true });
  }), 120_000);

live("7.15 with both flags but SHEPHRD_HOME in a different temporary folder from TMPDIR, the debug group is not served, nothing says it is on, and protocol logging stays off (breaks if either gate reads only its flag, or compares with /tmp instead of the service's TMPDIR)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const elsewhere = makeServiceRoot("/tmp/sh7x-");
    expect(yield* observe(root, { ...both, TMPDIR: elsewhere.root })).toEqual({ debug: "not served", logged: false, protocol: false });
  }), 120_000);

live("7.15 a home in a sibling folder whose name only starts with TMPDIR's, or reached through a symbolic link inside TMPDIR, is outside (breaks on a string-prefix comparison, or one on the unresolved path)", () =>
  Effect.gen(function* () {
    const temporary = makeServiceRoot("/tmp/sh7p-");
    // The sibling's name extends TMPDIR's own name; it is made beside it, under /tmp.
    const sibling = makeServiceRoot(`${temporary.root}x-`);
    expect(sibling.root.startsWith(temporary.root)).toBe(true);
    expect(yield* observe(sibling, { ...both, TMPDIR: temporary.root })).toEqual({ debug: "not served", logged: false, protocol: false });

    const target = makeServiceRoot("/tmp/sh7l-");
    const link = join(temporary.root, "link");
    symlinkSync(target.root, link);
    mkdirSync(join(target.root, "linked-home"), { mode: 0o700 });
    const throughLink = { ...target, state: join(link, "linked-home", "state"), socket: join(link, "linked-home", "state", "engine.sock") };
    expect(yield* observe(throughLink, { ...both, TMPDIR: temporary.root, SHEPHRD_HOME: throughLink.state }))
      .toEqual({ debug: "not served", logged: false, protocol: false });
  }), 180_000);

live("7.15 the two flags are gated separately: the protocol flag alone does not serve the debug group, and the debug flag alone does not turn on protocol logging (breaks if one flag enables both)", () =>
  Effect.gen(function* () {
    const protocolOnly = makeServiceRoot();
    expect(yield* observe(protocolOnly, { SHEPHRD_TEST_PROTOCOL_LOG: "1", TMPDIR: protocolOnly.root }))
      .toEqual({ debug: "not served", logged: false, protocol: true });
    const debugOnly = makeServiceRoot();
    expect(yield* observe(debugOnly, { SHEPHRD_TEST_DEBUG: "1", TMPDIR: debugOnly.root }))
      .toEqual({ debug: "success", logged: true, protocol: false });
  }), 180_000);
