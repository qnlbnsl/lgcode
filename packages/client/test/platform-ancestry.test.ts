// T-7 was added by engine-lead in board request 1132: version 1 is Linux only.
import { afterEach, expect, it, vi } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { outsideAdapters } from "../../engine/src/api/ancestry.ts";
import { withViews } from "../../engine/test/support/withViews.ts";
import { agentEnvironment, cleanupUnit7b, fakeEngine, loadClient, prepareRoot } from "../../testing/test/support/unit7b.ts";
import { ancestryHeaders } from "../src/ancestry.ts";

// Invoke the real ancestry reader with the intended last platform argument.
// The wrapper changes only the default for this file's connect() call, so the
// public connection path must handle the real unsupported-platform refusal.
vi.mock("../src/ancestry.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ancestry.ts")>();
  const headers = real.ancestryHeaders as (pid: number, platform?: NodeJS.Platform) => Record<string, string>;
  return { ...real, ancestryHeaders: (pid = process.pid, platform: NodeJS.Platform = "darwin") => headers(pid, platform) };
});

afterEach(cleanupUnit7b);

it("X71 (T-7 client) catches reading Linux ancestry on darwin and upgrading instead of refusing the unsupported platform", async () => {
  const message = "the process ancestry check runs on Linux only in this version";
  const headers = ancestryHeaders as (pid: number, platform?: NodeJS.Platform) => Record<string, string>;
  expect.soft(() => headers(process.pid, "darwin")).toThrowError(message);
  const connect = await loadClient();
  const root = prepareRoot();
  const peer = await fakeEngine(root);
  const exit = await Effect.runPromiseExit(Effect.scoped(connect({ environment: agentEnvironment(root) })));
  expect.soft(Exit.isFailure(exit), "connect must fail on the real darwin ancestry refusal").toBe(true);
  if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(message);
  expect(peer.upgrades, "the unsupported-platform refusal must precede the WebSocket upgrade").toHaveLength(0);
});

it("X72 (T-7 engine) catches granting an owner an outside-adapter identity on darwin when no adapter rows exist", async () => {
  const root = prepareRoot();
  // The new optional parameter is deliberately typed here before the builder
  // adds it. The old implementation runs and ignores it, exposing true rather
  // than failing because a module or fixture is missing.
  const outside = outsideAdapters as (chain: string | undefined, group: string | undefined, platform?: NodeJS.Platform) => ReturnType<typeof outsideAdapters>;
  const decisions = await Effect.runPromise(withViews(root.state, Effect.gen(function* () {
    // Real migrations create an empty process table. A Linux control proves
    // missing SQL services or malformed input cannot manufacture a false.
    const linux = yield* outside("12345:67890", "12345", "linux");
    const darwin = yield* outside("12345:67890", "12345", "darwin");
    return { linux, darwin };
  })));
  expect(decisions.linux).toBe(true);
  expect(decisions.darwin, "the Linux-only engine must fail closed on darwin").toBe(false);
});
