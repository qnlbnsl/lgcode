import { lstatSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";

import { makeCredentialRegistry } from "./accounts/credentialSource.ts";
import * as SecretStore from "./accounts/SecretStore.ts";
import { AlertSender } from "./client/alerts/AlertSender.ts";
import { makeCarriers } from "./client/alerts/carriers/index.ts";
import { SecretStore as SecretStoreService } from "./commands/SecretStore.ts";
import { application, listen } from "./api/server.ts";
import { serviceLog } from "./api/serviceLog.ts";
import { prepareStateFolder, stateFolder } from "./api/stateFolder.ts";
import * as CommandHandler from "./commands/CommandHandler.ts";
import { isInferredSecretValue } from "./identity/inferredSecret.ts";
import { redactingLoggerLayer } from "./identity/logger.ts";
import { loadOwnerCredential } from "./identity/ownerCredential.ts";
import { makeRedactor } from "./identity/redactor.ts";
import { takeLock } from "./lock.ts";
import * as EventLog from "./log/EventLog.ts";
import { migrate, migratePieces } from "./log/migrations.ts";
import * as Restart from "./recovery/restart.ts";
import { linuxProcessReader } from "./recovery/orphans.ts";
import * as AcpRunner from "./runner/AcpRunner.ts";
import * as GuardedRunner from "./harnesses/guardedRunner.ts";
import { makeHarnessPrograms, userHarnessPrefix } from "./harnesses/programs.ts";
import { installedHarnessDefaults } from "./runner/harnesses.ts";
import { engineLists, type EngineLists } from "./pieces/lists.ts";
import { drainPieceErrors } from "./pieces/guardPiece.ts";
import type { Runtime } from "./commands/internal.ts";
import * as Views from "./views/Views.ts";
import { serve as serveWeb } from "./client/web/server.ts";
import { boardEnabledAtStartup, withBoardEnabled } from "./board/switch.ts";
import { withinCapacityLimit } from "./roles/stall-watch/switch.ts";
import { capacityHoldCount } from "./routing/deliveries.ts";

const inTemporaryFolder = (folder: string): boolean => {
  try {
    const path = relative(realpathSync(tmpdir()), realpathSync(folder));
    return path !== "" && path !== ".." && !path.startsWith("../") && !isAbsolute(path);
  } catch { return false; }
};

const baseServices = (lists: EngineLists) => Layer.unwrap(Effect.gen(function* () {
  yield* migrate;
  yield* migratePieces(lists.migrations);
  return EventLog.makeLayer(lists).pipe(Layer.provideMerge(Views.makeLayer(lists)));
}));

const pieceFollowers = (lists: EngineLists) => Layer.effectDiscard(Effect.gen(function* () {
  const recovery = yield* Effect.serviceOption(Restart.Restart);
  const customSender = yield* Effect.serviceOption(AlertSender);
  const sender = Option.isSome(customSender) ? customSender.value : makeCarriers(yield* SecretStoreService);
  // Finish a removed batch before observing cancellation, so shutdown cannot
  // discard diagnostics between clearing the pending map and writing its logs.
  const drain = Effect.suspend(() => Effect.forEach(drainPieceErrors(), (entry) =>
    Effect.logError("piece table failed").pipe(Effect.annotateLogs({ ...entry })), { discard: true })).pipe(Effect.uninterruptible);
  // A fork can be cancelled before its first evaluation installs ensuring.
  // Register the final flush in its parent scope before scheduling that fork.
  yield* Effect.addFinalizer(() => drain);
  yield* Effect.forever(drain.pipe(Effect.andThen(Effect.sleep(1_000)))).pipe(Effect.ensuring(drain), Effect.forkScoped);
  for (const [namespace, reactor] of Object.entries(lists.reactors)) {
    if (reactor === undefined) continue;
    // Recovery is awaited outside the restart loop. A normal completion stops
    // the follower; failures restart it after a bounded delay, without a cause.
    const run: Effect.Effect<void, unknown, SqlClient.SqlClient | CommandHandler.CommandHandler | EventLog.EventLog | Views.Views | import("./runner/Runner.ts").Runner | import("./commands/SecretStore.ts").SecretStore> = Effect.suspend(() => reactor as typeof run).pipe(Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
      if (cause.reasons.some((reason) => reason._tag === "Fail" && reason.error instanceof EventLog.LogWriteFailed)) {
        return Effect.logError("piece reactor stopped: database write failed").pipe(Effect.annotateLogs({ namespace }));
      }
      return Effect.logError("piece reactor failed").pipe(Effect.annotateLogs({ namespace }), Effect.andThen(Effect.sleep(1_000)), Effect.andThen(Effect.suspend(() => run)));
    }));
    yield* (Option.isSome(recovery) ? recovery.value.whenReady : Effect.void).pipe(Effect.andThen(run.pipe(Effect.provideService(AlertSender, sender))), Effect.forkScoped);
  }
}));

const handlerServices = (configuration: Pick<Runtime, "home" | "stateFolder" | "pluginRoot" | "harnessDefaults" | "harnessPrograms">, lists: EngineLists) =>
  pieceFollowers(lists).pipe(Layer.provideMerge(CommandHandler.layer({ ...configuration,
    capacityHoldCondition: (id, snapshot) => withinCapacityLimit(snapshot, id, capacityHoldCount(snapshot, id)),
  }, lists)));

// Importing this module never starts the CLI or changes the process environment.
export const buildServices = (configuration: Pick<Runtime, "home" | "stateFolder" | "pluginRoot" | "harnessDefaults" | "harnessPrograms">, lists: EngineLists = engineLists) =>
  handlerServices(configuration, lists).pipe(Layer.provideMerge(baseServices(lists)));

const program = (inheritedToken: string | undefined, webPassword: Redacted.Redacted<string> | undefined) => Effect.scoped(Effect.gen(function* () {
  const lists = withBoardEnabled(engineLists, boardEnabledAtStartup(process.env));
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
  if (process.send !== undefined) process.send({ _tag: "LgtmLockAcquired" }, () => { if (process.connected) process.disconnect?.(); });
  const socketPath = join(folder, "engine.sock");
  yield* Effect.try({ try: () => {
    try {
      if (!lstatSync(socketPath).isSocket()) throw new Error("socket path is not a socket");
      unlinkSync(socketPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }, catch: () => new Error("stale socket removal failed") });
  const listener = yield* listen(socketPath);
  const ownerCredential = yield* loadOwnerCredential(folder);
  const debug = process.env.LGTM_TEST_DEBUG === "1" && inTemporaryFolder(folder);
  const protocolLog = process.env.LGTM_TEST_PROTOCOL_LOG === "1" && inTemporaryFolder(folder);
  const databasePath = join(folder, "events.sqlite");
  // Enable WAL before the copied client's reader worker can first open it.
  yield* Effect.try({ try: () => {
    const database = new DatabaseSync(databasePath);
    try { database.exec("PRAGMA journal_mode=WAL"); } finally { database.close(); }
  }, catch: () => new Error("database initialization failed") });
  return yield* Effect.gen(function* () {
    yield* migrate;
    const registry = yield* Effect.acquireRelease(Effect.sync(() => new DatabaseSync(databasePath, { readOnly: true })), (database) => Effect.sync(() => database.close()));
    // Explicit credentials keep every nonempty value. Only values inferred
    // from inherited variable names need A4's length and scalar-value gate.
    const explicitSecrets = [ownerCredential, ...(webPassword === undefined ? [] : [webPassword]), ...[inheritedToken]
      .filter((value): value is string => value !== undefined && value.length > 0).map((value) => Redacted.make(value))];
    const inheritedSecrets = Object.entries(process.env)
      .filter(([name]) => /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name))
      .map(([, value]) => value)
      .filter(isInferredSecretValue)
      .map((value) => Redacted.make(value));
    // Issue 223: the harness login stores the runner opens, re-read live.
    const credentials = makeCredentialRegistry();
    const redactor = makeRedactor({
      secrets: () => {
        const known = [...explicitSecrets, ...inheritedSecrets, ...credentials.secrets()];
        try {
          const values: unknown = JSON.parse(readFileSync(join(folder, "secrets.json"), "utf8"));
          return [...known, ...Object.values(values as Record<string, unknown>).filter((value): value is string => typeof value === "string").map((value) => Redacted.make(value))];
        } catch { return known; }
      },
      tokenHashes: () => new Set((registry.prepare("SELECT token_hash FROM agent_tokens").all() as Array<{ token_hash: string }>).map((row) => row.token_hash)),
    });
    const managedRoot = userHarnessPrefix(process.env.HOME ?? folder);
    const harnessPath = (process.env.PATH ?? "").split(delimiter).filter((path) => isAbsolute(path) && resolve(path) !== managedRoot && !resolve(path).startsWith(managedRoot + "/")).join(delimiter);
    const configuration = { home: process.env.HOME ?? folder, stateFolder: folder, pluginRoot: fileURLToPath(new URL("../../..", import.meta.url)),
      harnessDefaults: installedHarnessDefaults(harnessPath),
      harnessPrograms: makeHarnessPrograms({ home: process.env.HOME ?? folder, path: harnessPath, stateFolder: folder, credentials }) };
    const base = baseServices(lists);
    const runnerEnvironment: NodeJS.ProcessEnv = { ...process.env, PATH: harnessPath };
    // Bundled adapters resolve their own vendor runtimes. Do not implicitly
    // select a mutable managed install through PATH or a service override.
    delete runnerEnvironment.CODEX_PATH; delete runnerEnvironment.CLAUDE_CODE_EXECUTABLE;
    const rawRunner = AcpRunner.layer({ socketPath, stateFolder: folder, environment: runnerEnvironment, protocolLog, credentials }).pipe(
      Layer.provideMerge(SecretStore.layer({ stateFolder: folder })),
    );
    const runner = GuardedRunner.layer(configuration).pipe(Layer.provideMerge(rawRunner));
    const recovery = Restart.layer(configuration).pipe(Layer.provideMerge(Layer.merge(base, runner)));
    const services = handlerServices(configuration, lists).pipe(Layer.provideMerge(recovery), Layer.provideMerge(redactor.layer));
    return yield* Effect.gen(function* () {
      if (debug) yield* Effect.logInfo("debug RPC group enabled");
      yield* listener.install(yield* application({ ownerCredential, debug, lists }));
      const web = yield* serveWeb({ password: webPassword, lists, staticRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)),
        studioRoot: fileURLToPath(new URL("../../studio/dist", import.meta.url)),
        registerSecret: (secret) => { explicitSecrets.push(secret); } });
      yield* Effect.addFinalizer(() => web.close);
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
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const inheritedToken = process.env.LGTM_TOKEN;
  const webPassword = process.env.LGTM_WEB_PASSWORD === undefined ? undefined : Redacted.make(process.env.LGTM_WEB_PASSWORD);
  delete process.env.LGTM_WEB_PASSWORD;
  delete process.env.LGTM_TOKEN;
  process.umask(0o077);
  const fiber = Effect.runFork(program(inheritedToken, webPassword));
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
}
