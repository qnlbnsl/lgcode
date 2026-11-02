// Unit 7a fix round 1, ruling 5 (criterion 7.1; row 54): the service checks
// the socket path's length before it creates or changes any folder, so a
// home whose socket path is over 100 bytes leaves nothing behind. Every case
// runs the real service as a child process (`packages/engine/src/service.ts`).
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { makeServiceRoot, startService, stopAllServices, type ServiceProcess } from "../support/serviceProcess.ts";

// These cases never open an event log in this process; the service owns it.
registerRebuildCheck({ noLog: true });

const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);

afterEach(async () => { await stopAllServices(); });

const failedToStart = (service: ServiceProcess) => Effect.gen(function* () {
  const exit = yield* Effect.promise(() => Promise.race([
    service.exit,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20_000)),
  ]));
  if (exit === undefined) return yield* Effect.die(new Error(`The service kept running; output:\n${service.output()}`));
  return exit;
});

// A home under `parent` whose socket path (`<home>/engine.sock`) is `bytes` long.
const homeFor = (parent: string, bytes: number) =>
  join(parent, "s".repeat(bytes - Buffer.byteLength(`${parent}/`) - Buffer.byteLength("/engine.sock")));

live("fix1 T-4 ruling 5: a missing home whose socket path is over 100 bytes is refused, and neither the home nor its missing parent exists afterwards (breaks if the state folder is created before the socket path's length is checked)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const parent = join(root.root, "missing-parent");
    const home = homeFor(parent, 120);
    expect(Buffer.byteLength(join(home, "engine.sock"))).toBe(120);
    expect(existsSync(parent)).toBe(false);
    const service = startService(root, { env: { SHEPHERD_HOME: home } });
    const exit = yield* failedToStart(service);
    expect(exit.signal).toBeNull();
    expect(exit.code).not.toBe(0);
    expect(service.output()).toContain("socket path exceeds 100 bytes");
    expect(existsSync(home), "the too-long state folder was created").toBe(false);
    expect(existsSync(parent), "the too-long state folder's parent was created").toBe(false);
  }), 60_000);

live("fix1 T-4 ruling 5: an existing 0700 home whose socket path is over 100 bytes is refused, and its mode and contents are unchanged (breaks if the refusal path changes the folder, or creates the lock, credential or database before the check)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const home = homeFor(root.root, 120);
    mkdirSync(home, { mode: 0o700 });
    writeFileSync(join(home, "keep.txt"), "unchanged", { mode: 0o600 });
    const service = startService(root, { env: { SHEPHERD_HOME: home } });
    const exit = yield* failedToStart(service);
    expect(exit.code).not.toBe(0);
    expect(service.output()).toContain("socket path exceeds 100 bytes");
    expect((lstatSync(home).mode & 0o7777).toString(8)).toBe("700");
    expect(readdirSync(home)).toEqual(["keep.txt"]);
    expect(readFileSync(join(home, "keep.txt"), "utf8")).toBe("unchanged");
  }), 60_000);
