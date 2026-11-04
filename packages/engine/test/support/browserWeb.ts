// Browser tests use the real unit 5 listener, command handler and database.
// The page is a static fixture because the login form belongs to unit 7a.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { buildServices } from "../../src/service.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { makeFakeRunner } from "./fakeRunner.ts";
import { makeFakeSecrets, makeRig, removeRig } from "./handlerRig.ts";
import { registerRebuildCheck } from "./rebuildCheck.ts";

export const unusedPort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as import("node:net").AddressInfo).port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

export const withBrowserWeb = async (body: (ctx: { origin: string; password: string }) => Promise<void>): Promise<void> => {
  const moduleUrl = new URL("../../src/client/web/server.ts", import.meta.url);
  assert(existsSync(moduleUrl), "Unit 5 must implement client/web/server.ts before a real browser can log in");
  const { serve } = await import(/* @vite-ignore */ moduleUrl.href) as {
    serve: (options: unknown) => Effect.Effect<unknown, unknown, any>;
  };
  const rig = makeRig(); const previousHome = process.env.SHEPHRD_HOME;
  process.env.SHEPHRD_HOME = rig.stateFolder;
  const password = randomBytes(32).toString("base64url"); const port = await unusedPort();
  const staticRoot = join(rig.root, "page"); mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, "index.html"), '<!doctype html><title>Shephrd browser fixture</title><main>Shephrd</main><script src="/app.js" defer></script>');
  writeFileSync(join(staticRoot, "app.js"), 'document.querySelector("main").dataset.ready = "yes";');
  try {
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner();
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck();
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } });
        yield* Effect.promise(() => body({ origin: `http://127.0.0.1:${port}`, password }));
      });
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text),
      }));
      return yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer));
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped);
    await Effect.runPromise(program as Effect.Effect<void, unknown, never>);
  } finally {
    if (previousHome === undefined) delete process.env.SHEPHRD_HOME; else process.env.SHEPHRD_HOME = previousHome;
    removeRig(rig);
  }
};
