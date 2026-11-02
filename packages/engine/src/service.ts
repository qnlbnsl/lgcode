import { lstatSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@shepherd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";

import * as SecretStore from "./accounts/SecretStore.ts";
import { application, listen } from "./api/server.ts";
import { serviceLog } from "./api/serviceLog.ts";
import { prepareStateFolder, stateFolder } from "./api/stateFolder.ts";
import * as CommandHandler from "./commands/CommandHandler.ts";
import { redactingLoggerLayer } from "./identity/logger.ts";
import { loadOwnerCredential } from "./identity/ownerCredential.ts";
import { makeRedactor } from "./identity/redactor.ts";
import { takeLock } from "./lock.ts";
import * as EventLog from "./log/EventLog.ts";
import { migrate } from "./log/migrations.ts";
import * as Restart from "./recovery/restart.ts";
import { linuxProcessReader } from "./recovery/orphans.ts";
import * as AcpRunner from "./runner/AcpRunner.ts";
import * as Views from "./views/Views.ts";

// Capture the inherited token for redaction, then erase it before building
// anything capable of spawning a child. It is never a service identity.
const inheritedToken = process.env.SHEPHERD_TOKEN;
delete process.env.SHEPHERD_TOKEN;
process.umask(0o077);

const inTemporaryFolder = (folder: string): boolean => {
  try {
    const path = relative(realpathSync(tmpdir()), realpathSync(folder));
    return path !== "" && path !== ".." && !path.startsWith("../") && !isAbsolute(path);
  } catch { return false; }
};

const program = Effect.scoped(Effect.gen(function* () {
  const folder = yield* Effect.try({ try: () => {
    const path = stateFolder(process.env);
    prepareStateFolder(path);
    return path;
  }, catch: (error) => error instanceof Error ? error : new Error("state folder refused") });
  const lock = yield* takeLock(folder);
  if (lock === undefined) { process.stdout.write("already running\n"); return; }
  // A detached launcher needs evidence of which child won the lock, rather
  // than inferring it from timing the losing child's exit. This is an
  // inherited parent/child channel, never a second listener.
  if (process.send !== undefined) process.send({ _tag: "ShepherdLockAcquired" }, () => { if (process.connected) process.disconnect?.(); });
  const socketPath = join(folder, "engine.sock");
  yield* Effect.try({ try: () => {
    try {
      if (!lstatSync(socketPath).isSocket()) throw new Error("socket path is not a socket");
      unlinkSync(socketPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }, catch: () => new Error("stale socket removal failed") });
  const listener = yield* listen(socketPath);
  const ownerCredential = yield* loadOwnerCredential(folder);
  const debug = process.env.SHEPHERD_TEST_DEBUG === "1" && inTemporaryFolder(folder);
  const protocolLog = process.env.SHEPHERD_TEST_PROTOCOL_LOG === "1" && inTemporaryFolder(folder);
  const databasePath = join(folder, "events.sqlite");
  // Enable WAL before the copied client's reader worker can first open it.
  yield* Effect.try({ try: () => {
    const database = new DatabaseSync(databasePath);
    try { database.exec("PRAGMA journal_mode=WAL"); } finally { database.close(); }
  }, catch: () => new Error("database initialization failed") });
  return yield* Effect.gen(function* () {
    yield* migrate;
    const registry = yield* Effect.acquireRelease(Effect.sync(() => new DatabaseSync(databasePath, { readOnly: true })), (database) => Effect.sync(() => database.close()));
    const inheritedSecrets = [ownerCredential, ...[inheritedToken, ...Object.entries(process.env)
      .filter(([name]) => /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name)).map(([, value]) => value)]
      .filter((value): value is string => value !== undefined && value.length > 0).map((value) => Redacted.make(value))];
    const redactor = makeRedactor({
      secrets: () => {
        try {
          const values: unknown = JSON.parse(readFileSync(join(folder, "secrets.json"), "utf8"));
          return [...inheritedSecrets, ...Object.values(values as Record<string, unknown>).filter((value): value is string => typeof value === "string").map((value) => Redacted.make(value))];
        } catch { return inheritedSecrets; }
      },
      tokenHashes: () => new Set((registry.prepare("SELECT token_hash FROM agent_tokens UNION SELECT token_hash FROM devices").all() as Array<{ token_hash: string }>).map((row) => row.token_hash)),
    });
    const configuration = { home: process.env.HOME ?? folder, stateFolder: folder, pluginRoot: fileURLToPath(new URL("../../..", import.meta.url)) };
    const base = EventLog.layer.pipe(Layer.provideMerge(Views.layer));
    const runner = AcpRunner.layer({ socketPath, stateFolder: folder, environment: { ...process.env }, protocolLog }).pipe(
      Layer.provideMerge(SecretStore.layer({ stateFolder: folder })),
    );
    const recovery = Restart.layer(configuration).pipe(Layer.provideMerge(Layer.merge(base, runner)));
    const services = CommandHandler.layer(configuration).pipe(Layer.provideMerge(recovery), Layer.provideMerge(redactor.layer));
    return yield* Effect.gen(function* () {
      if (debug) yield* Effect.logInfo("debug RPC group enabled");
      yield* listener.install(yield* application({ ownerCredential, debug }));
      yield* (yield* Restart.Restart).recover;
      // A retained row never grants authority unless its identity is still
      // live. Remove dead or replaced identities after recovery has swept
      // them, keeping the operational table bounded across restarts.
      if (process.platform === "linux") {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ id: number; group_id: number; boot_id: string; start_time: string; user_id: number; executable: string }>`SELECT * FROM processes`;
        const boot = linuxProcessReader.bootId();
        for (const row of rows) {
          const facts = linuxProcessReader.facts(row.group_id);
          if (row.boot_id !== boot || facts === undefined || facts.startTime !== row.start_time || facts.userId !== row.user_id || facts.executable !== row.executable) yield* sql`DELETE FROM processes WHERE id = ${row.id}`;
        }
      }
      yield* Effect.never;
    }).pipe(
      // Close request scopes while the handler, runner and database are still
      // available, so a disconnected blocking wait can commit cancellation.
      Effect.ensuring(listener.close),
      Effect.provide(services), Effect.provide(NodeServices.layer),
      Effect.provide(redactingLoggerLayer(redactor, serviceLog(protocolLog, (line) => process.stdout.write(`${line}\n`)))),
    );
  }).pipe(Effect.provide(SqliteClient.layer({ filename: databasePath, readerWorker: true })));
}));

// A graceful signal interrupts the whole scoped program. Finalizers close
// connections and adapters before releasing the lifetime lock.
const fiber = Effect.runFork(program);
const stop = () => fiber.interruptUnsafe();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
const result = await Effect.runPromise(Fiber.await(fiber));
process.removeListener("SIGTERM", stop);
process.removeListener("SIGINT", stop);
if (Exit.isFailure(result) && !result.cause.reasons.every((reason) => reason._tag === "Interrupt")) {
  // Startup failures contain fixed service-owned categories only. Never
  // serialize a cause: the underlying database may quote stored data.
  const allowed = ["state folder is a symbolic link", "state folder mode is not 0700", "state folder is owned by another user", "state folder is not a directory", "socket path exceeds 100 bytes"];
  const message = result.cause.reasons.flatMap((reason) => reason._tag === "Fail" && reason.error instanceof Error ? [reason.error.message] : []).find((value) => allowed.includes(value));
  process.stderr.write(`${message ?? "service failed"}\n`);
  process.exitCode = 1;
}
