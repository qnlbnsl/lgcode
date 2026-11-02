import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { agentEnvironment, cleanupUnit7b, fakeEngine, loadClient, prepareRoot } from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

it("X51 (T-5) catches allowing a user-owned writable sticky ancestor under the root-only temporary-folder exception", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const ancestor = join(root.root, "user-sticky");
  const privateFolder = join(ancestor, "private");
  mkdirSync(ancestor, { mode: 0o700 });
  mkdirSync(privateFolder, { mode: 0o700 });
  chmodSync(ancestor, 0o1777);
  expect(lstatSync(ancestor).uid).toBe(process.getuid!());
  expect(lstatSync(ancestor).uid).not.toBe(0);
  const socketPath = join(privateFolder, "engine.sock");
  const peer = await fakeEngine(root, { socketPath });
  const exit = await Effect.runPromiseExit(Effect.scoped(connect({ environment: { ...agentEnvironment(root), SHEPHERD_SOCKET: socketPath } })));
  expect.soft(Exit.isFailure(exit), "a writable user-owned ancestor must be refused").toBe(true);
  if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toMatch(/writable|ancestor|above the socket/i);
  expect(peer.upgrades).toHaveLength(0);
});

it("X52 (T-5 control, issue 174) catches rejecting a safe private socket beneath root-owned sticky /tmp", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const temporaryFolder = lstatSync("/tmp");
  expect(temporaryFolder.uid).toBe(0);
  expect(temporaryFolder.mode & 0o1000).toBe(0o1000);
  const peer = await fakeEngine(root);
  const exit = await Effect.runPromiseExit(Effect.scoped(connect({ environment: agentEnvironment(root) })));
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(peer.upgrades).toHaveLength(1);
});
