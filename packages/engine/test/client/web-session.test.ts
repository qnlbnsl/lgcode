import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { connected, eventually, login, post, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

const tokenFrom = (cookie: string): Buffer => {
  const text = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  return /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64url");
};
const filesIn = (root: string): string[] => readdirSync(root).flatMap((name) => {
  const path = join(root, name); const stat = lstatSync(path);
  return stat.isDirectory() ? filesIn(path) : stat.isFile() ? [path] : [];
});

it("5.6 memory-only token: catches per-login rotation, a short token, or a token written to a file or database", async () => withWeb((ctx) => Effect.gen(function* () {
  const first = yield* login(ctx);
  const second = yield* login(ctx);
  expect(first.cookie === second.cookie, "login rotated the engine's one session").toBe(true);
  const token = tokenFrom(first.cookie);
  expect(token.byteLength).toBe(32);
  const text = first.cookie.slice(first.cookie.indexOf("=") + 1);
  for (const path of filesIn(ctx.rig.root)) {
    const data = readFileSync(path);
    expect(data.includes(token) || data.includes(text), "session token reached a persistent file").toBe(false);
  }
})));

it("5.6 logout: catches leaving either connection open or allowing an old cookie to reconnect", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx);
  const one = yield* connected(ctx, cookie);
  const two = yield* connected(ctx, cookie);
  expect((yield* Effect.promise(() => post(ctx, "/api/logout", undefined, { Cookie: cookie }))).status).toBe(204);
  yield* eventually(() => [one.readyState, two.readyState], (states) => states.every((s) => s === 3), "logout left a web connection open");
  expect((yield* Effect.promise(() => post(ctx, "/api/session", undefined, { Cookie: cookie }))).status).toBe(401);
  const next = yield* login(ctx);
  expect(next.cookie === cookie, "logout reused the old token").toBe(false);
  expect((yield* Effect.promise(() => post(ctx, "/api/session", undefined, { Cookie: next.cookie }))).status).toBe(204);
})));

it("5.6 no expiry: catches adding a time-to-live or renewal requirement to the session", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx);
  yield* TestClock.adjust(365 * 24 * 60 * 60 * 1_000);
  expect((yield* Effect.promise(() => post(ctx, "/api/session", undefined, { Cookie: cookie }))).status).toBe(204);
}), { clock: true }));
