import { randomUUID } from "node:crypto";
import { readlinkSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePermission, DeliveryId, Event, type PermissionLevel, type SessionReference } from "@shepherd/contracts";
import { AcpClient, layerChildProcess } from "@shepherd/t3-effect-acp/client";
import { AcpRequestError } from "@shepherd/t3-effect-acp/errors";
import type { AgentCapabilities } from "@shepherd/t3-effect-acp/schema-v1";
import { mergeProviderInstanceEnvironment } from "@shepherd/t3-provider-instance/instanceEnvironment";
import { HomeDirectory } from "@shepherd/t3-provider-instance/HostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner, makeHandle, type ChildProcessHandle } from "effect/process/ChildProcessSpawner";
import { withCodexHome } from "../accounts/shadowHome.ts";
import { SecretStore } from "../commands/SecretStore.ts";
import { folderForSpawn } from "../identity/ceiling.ts";
import { sha256Hex } from "../identity/credential.ts";
import { makeRedactor } from "../identity/redactor.ts";
import { Redactor } from "../log/Redactor.ts";
import { makeStderrTail, stderrTailLines } from "../recovery/crash.ts";
import { buildBaseEnvironment } from "./baseEnvironment.ts";
import { classifyError } from "./classify.ts";
import { compactPrompt } from "./compact.ts";
import { setConfig, type ConfigOption } from "./config.ts";
import { denyArguments } from "./denyRead.ts";
import { reportedLevel } from "./modes.ts";
import { makePermissionHold, mapPermissionOption, settingsWrite } from "./permissions.ts";
import { resetTimeFromError } from "./resetTime.ts";
import { Runner, RunnerRejected, type ReplayItem, type RunnerEvent, type SessionInfo } from "./Runner.ts";
import { translate } from "./translate.ts";

export interface AcpRunnerOptions {
  readonly socketPath: string;
  readonly stateFolder: string;
  readonly environment: Record<string, string | undefined>;
  readonly classifyError?: (input: { harness: string; text: string }) => "out-of-usage" | "signed-out" | undefined;
}
type Spawn = Parameters<Runner["Service"]["start"]>[0];
type Send = Parameters<Runner["Service"]["prompt"]>[0];
type Hold = Effect.Success<ReturnType<typeof makePermissionHold>>;
interface Turn {
  readonly deliveryId: Send["delivery"]["id"];
  replied: boolean;
  idle: boolean;
  ended: boolean;
  text: string;
  error?: string;
  resetAt?: number;
}
interface Process {
  readonly input: Spawn;
  readonly incarnation: string;
  readonly scope: Scope.Closeable;
  readonly child: ChildProcessHandle;
  readonly client: AcpClient["Service"];
  readonly secrets: Array<Redacted.Redacted<string>>;
  readonly holds: Map<string, Hold>;
  readonly responses: Map<string, Deferred.Deferred<void, RunnerRejected>>;
  // Issue 154: the redacted replay of this spawn's load, returned with it.
  readonly replay: Array<ReplayItem>;
  sessionId: string;
  version: number;
  capabilities?: AgentCapabilities;
  loading: boolean;
  ready: boolean;
  stopped: boolean;
  dead: boolean;
  mode: string;
  options: ReadonlyArray<ConfigOption>;
  commands: ReadonlyArray<{ name: string }>;
  message?: {
    readonly id: string;
    readonly role: "user" | "agent" | undefined;
    readonly pending: Array<{ readonly length: number; readonly event: Extract<RunnerEvent, { _tag: "deliveryUpdate" }> }>;
    released: string;
  };
  turn?: Turn;
  sent?: Deferred.Deferred<void, RunnerRejected>;
}
const rejected = (reason: string) => new RunnerRejected({ reason });
const recordTurnError = (turn: Turn, error: unknown) => {
  turn.error = JSON.stringify(error);
  const resetAt = resetTimeFromError(error);
  if (resetAt === undefined) delete turn.resetAt;
  else turn.resetAt = resetAt;
};

export const layer = (configuration: AcpRunnerOptions) => Layer.effect(Runner, Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner;
  const secrets = yield* SecretStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const lifetime = yield* Effect.scope;
  const suppliedRedactor = yield* Effect.serviceOption(Redactor);
  const processes = new Map<string, Process>();
  const fallback = makeRedactor({ secrets: () => [...processes.values()].flatMap((entry) => entry.secrets), tokenHashes: () => new Set() });
  const redactText = (text: string) => Option.isSome(suppliedRedactor)
    ? suppliedRedactor.value.redactText(fallback.redactText(text)) : Effect.sync(() => fallback.redactText(text));
  const events = yield* Queue.unbounded<RunnerEvent>();
  const redactChunk = (itemId: string, text: string, final: boolean) => Effect.gen(function* () {
    // Resolved spawn credentials are covered even before the service's
    // registry sees them. Each redactor retains its own bounded carry.
    let clean = fallback.redactChunk(itemId, text, final);
    if (Option.isSome(suppliedRedactor) && suppliedRedactor.value.redactChunk !== undefined) {
      clean = yield* suppliedRedactor.value.redactChunk(itemId, clean, final);
    }
    return yield* redactText(clean);
  });
  const threadContent = Event.pipe(Schema.toTaggedUnion("_tag")).cases.ThreadItem.fields.content;
  const emit = (event: RunnerEvent) => Queue.offer(events, event).pipe(Effect.asVoid);
  // Records one replayed update for the load's result. Breaks in a row are
  // kept as one, so a long replay of other content stays small.
  const noteReplay = (entry: Process, item: ReplayItem) => {
    if (item._tag === "break" && entry.replay.at(-1)?._tag === "break") return;
    entry.replay.push(item);
  };
  // Keep the redactor's raw carry bounded, retaining only event metadata
  // while its window is pending. Short, unchanged chunks keep their original
  // boundaries; replacement text may span them, but never contains raw data.
  const drainMessages = (entry: Process, final: boolean) => Effect.gen(function* () {
    const buffer = entry.message;
    if (buffer === undefined) return;
    if (final) buffer.released += yield* redactChunk(buffer.id, "", true);
    while (buffer.pending.length > 0) {
      const first = buffer.pending[0]!;
      if (!final && buffer.released.length < first.length && buffer.pending.length <= 1024) break;
      buffer.pending.shift();
      const length = final && buffer.pending.length === 0 ? buffer.released.length : Math.min(first.length, buffer.released.length);
      const text = buffer.released.slice(0, length);
      buffer.released = buffer.released.slice(length);
      if (entry.turn !== undefined) entry.turn.text += text;
      if (first.event.replay) noteReplay(entry, first.event.role === "user" ? { _tag: "user", text } : { _tag: "break" });
      yield* emit({ ...first.event, text, content: { _tag: "text", text } });
    }
    if (final) delete entry.message;
  });
  const identity = (entry: Process) => ({ agentId: entry.input.agentId, incarnation: entry.incarnation });
  const live = (agentId: string, incarnation?: string) => Effect.suspend(() => {
    const entry = processes.get(agentId);
    return entry === undefined || entry.dead || entry.stopped || !entry.ready || (incarnation !== undefined && incarnation !== entry.incarnation)
      ? Effect.fail(rejected("agent process is not live")) : Effect.succeed(entry);
  });
  const finish = (entry: Process, turn: Turn) => Effect.gen(function* () {
    if (turn.ended || !turn.replied || !turn.idle || entry.stopped || entry.dead) return;
    turn.ended = true;
    yield* drainMessages(entry, true);
    const clean = yield* redactText(turn.error ?? turn.text);
    const harness = entry.input.harness.id;
    // Only the recorded cursor adapter reports usage exhaustion as a
    // successful text reply. Agent prose cannot establish a signed-out error.
    const candidate = turn.error !== undefined || harness === "cursor"
      ? (configuration.classifyError ?? classifyError)({ harness, text: clean }) : undefined;
    const classification = turn.error !== undefined || candidate === "out-of-usage" ? candidate : undefined;
    yield* emit({ _tag: "promptReply", ...identity(entry), deliveryId: turn.deliveryId,
      outcome: classification !== undefined ? { _tag: "pause", reason: classification, error: clean,
        ...(classification === "out-of-usage" && turn.error !== undefined && turn.resetAt !== undefined ? { resetAt: turn.resetAt } : {}) }
        : turn.error !== undefined ? { _tag: "error", error: clean } : { _tag: "success" } });
    if (entry.turn === turn) delete entry.turn;
    yield* emit({ _tag: "turnEnded", ...identity(entry), deliveryId: turn.deliveryId });
  });
  const setMode = (entry: Process, permission: PermissionLevel) => Effect.gen(function* () {
    const mode = entry.input.harness.permissionMapping[permission];
    entry.mode = mode;
    entry.options = yield* setConfig(entry.client, entry.sessionId, entry.options, "mode", mode, entry.version);
  });
  const close = (entry: Process) => Effect.gen(function* () {
    entry.stopped = true;
    yield* drainMessages(entry, true);
    if (entry.sent !== undefined) yield* Deferred.fail(entry.sent, rejected("agent process stopped"));
    for (const delivered of entry.responses.values()) yield* Deferred.fail(delivered, rejected("permission answer delivery failed"));
    entry.responses.clear();
    if (processes.get(entry.input.agentId) === entry) processes.delete(entry.input.agentId);
    // The detached process group belongs to this spawn. Children cannot
    // retain the protocol pipes or a permission hold after it is stopped.
    yield* Effect.sync(() => { try { process.kill(-Number(entry.child.pid), "SIGKILL"); } catch { /* already gone */ } });
    yield* Scope.close(entry.scope, Exit.void);
    entry.holds.clear();
    entry.secrets.length = 0;
  });
  // Issue 103: the duplicate-process check and the reservation are one
  // synchronous step, and the reservation lasts until the process is
  // registered or the spawn has failed, so two setups for one agent can never
  // both reach the spawn, even from a caller that bypasses the send lanes.
  const reserved = new Set<string>();
  const spawn = (input: Spawn, session?: SessionReference): Effect.Effect<SessionInfo, RunnerRejected> => Effect.suspend(() => {
    if (processes.has(input.agentId) || reserved.has(input.agentId)) return Effect.fail(rejected("agent already has a process"));
    reserved.add(input.agentId);
    return spawnReserved(input, session).pipe(Effect.ensuring(Effect.sync(() => { reserved.delete(input.agentId); })));
  });
  const spawnReserved = (input: Spawn, session?: SessionReference): Effect.Effect<SessionInfo, RunnerRejected> => Effect.gen(function* () {
    if (session !== undefined && session._tag !== "acp") return yield* rejected("session is not an ACP session");
    const harness = input.harness;
    if (harness.runMode !== "acp" || !isAbsolute(harness.adapterPath) || resolve(harness.adapterPath) !== harness.adapterPath) return yield* rejected("adapter path is not resolved");
    if ((input.model !== undefined && harness.models.length > 0 && !harness.models.includes(input.model))
      || (input.effort !== undefined && harness.efforts.length > 0 && !harness.efforts.includes(input.effort))) return yield* rejected("configuration is not recorded");
    const startingMode = harness.permissionMapping[input.permission];
    if (harness.reportedModes.length > 0 && !harness.reportedModes.some((mode) => mode.id === startingMode)) return yield* rejected("mode is not recorded");
    const resolvedSecrets = [input.token];
    const variables: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.account.environment ?? {})) {
      if (name.startsWith("HERDR_") || name.startsWith("SHEPHERD_")) continue;
      if (value.startsWith("secret:")) {
        const secret = yield* secrets.resolve(value);
        if (secret === undefined) return yield* rejected("account secret is unavailable");
        resolvedSecrets.push(secret);
        variables[name] = Redacted.value(secret);
      } else variables[name] = value;
    }
    if (harness.id === "codex") {
      const homed = yield* withCodexHome({ stateFolder: configuration.stateFolder, home: configuration.environment.HOME ?? input.folder, accountId: input.account.id, variables }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideService(Path.Path, pathService),
        Effect.mapError(() => rejected("account home cannot be prepared")),
      );
      Object.assign(variables, homed);
    }
    const base = buildBaseEnvironment({ parent: configuration.environment, accountVariables: variables,
      shepherdSocket: configuration.socketPath, shepherdToken: Redacted.value(input.token) });
    const environment = yield* mergeProviderInstanceEnvironment(Object.entries(variables).map(([name, value]) => ({ name, value, sensitive: input.account.environment?.[name]?.startsWith("secret:") ?? false })), base).pipe(
      Effect.provideService(HomeDirectory, configuration.environment.HOME ?? input.folder),
    );
    const args = yield* Effect.try({ try: () => [...harness.adapterArguments, ...denyArguments(harness, input.folder, configuration.stateFolder, environment)], catch: () => rejected("deny rule cannot be resolved") });
    const scope = yield* Scope.fork(lifetime);
    let entry: Process | undefined;
    return yield* Effect.gen(function* () {
      // No asynchronous work separates the final grant check from spawn.
      const folder = yield* folderForSpawn(input.grant, session === undefined ? "start" : "reload").pipe(Effect.mapError(() => rejected("folder grant is no longer valid")));
      if (folder !== input.folder) return yield* rejected("spawn folder differs from grant");
      const grantedIdentity = yield* Effect.try({ try: () => statSync(folder, { bigint: true }), catch: () => rejected("spawn folder cannot be checked") });
      const child = yield* spawner.spawn(ChildProcess.make(harness.adapterPath, args, { cwd: folder, env: environment, extendEnv: false, detached: true, stdin: { stream: "pipe", endOnDone: false } })).pipe(
        Scope.provide(scope), Effect.mapError(() => rejected("adapter spawn failed")),
      );
      yield* Scope.addFinalizer(scope, Effect.sync(() => { try { process.kill(-Number(child.pid), "SIGKILL"); } catch { /* gone */ } }));
      const checkChildFolder = Effect.gen(function* () {
        yield* folderForSpawn(input.grant, session === undefined ? "start" : "reload").pipe(Effect.mapError(() => rejected("folder grant is no longer valid")));
        if (process.platform !== "linux") return;
        const valid = yield* Effect.try({ try: () => {
          const actual = statSync(`/proc/${child.pid}/cwd`, { bigint: true });
          return readlinkSync(`/proc/${child.pid}/cwd`) === folder && actual.dev === grantedIdentity.dev && actual.ino === grantedIdentity.ino;
        }, catch: () => rejected("spawn folder cannot be checked") });
        if (!valid) return yield* rejected("spawn folder was redirected");
      });
      yield* checkChildFolder;
      // Stderr is consumed continuously and never forwarded to service stdio.
      // The local carry covers spawn credentials even before registration.
      const stderrRedactor = makeRedactor({ secrets: () => resolvedSecrets, tokenHashes: () => new Set() });
      const stderrTail = yield* makeStderrTail({ maxLines: stderrTailLines,
        redactChunk: (id, text, final) => redactChunk(id, stderrRedactor.redactChunk(id, text, final), final),
      });
      yield* Scope.addFinalizer(scope, stderrTail.finish().pipe(Effect.asVoid));
      const stderrReader = yield* child.stderr.pipe(Stream.decodeText, Stream.runForEach(stderrTail.push), Effect.catch(() => Effect.void), Effect.forkIn(scope));
      // A write acknowledgement is separate from the eventual prompt reply.
      // Keep stdin open between writes; each sink run waits for the actual
      // process pipe, so callers return only after their frame was written.
      const transportHandle = makeHandle({ ...child, stdin: Sink.forEach((chunk: Uint8Array) =>
        Stream.make(chunk).pipe(Stream.run(child.stdin), Effect.tap(() => Effect.gen(function* () {
          for (const line of new TextDecoder().decode(chunk).split("\n")) {
            if (line.trim() === "") continue;
            let frame: { method?: string };
            try { frame = JSON.parse(line); } catch { continue; }
            if (frame.method === "session/prompt" && entry?.sent !== undefined) yield* Deferred.succeed(entry.sent, undefined);
          }
        }))),
      ) });
      const context = yield* Layer.build(layerChildProcess(transportHandle, {
        logIncoming: true, logOutgoing: false,
        // Protocol logging is observed only to emit this fixed diagnostic;
        // the logger never forwards frame payloads, methods or request ids.
        logger: (event) => event.stage === "decode_failed" ? Effect.logWarning("adapter frame dropped: malformed") : Effect.void,
        onIncomingRequest: (_id, method) => method === "session/request_permission" ? Effect.void : Effect.logWarning("adapter request refused: unsupported"),
        onOutgoingResponse: (id) => Effect.gen(function* () {
          const delivered = entry?.responses.get(id);
          if (delivered === undefined) return;
          entry?.responses.delete(id);
          yield* Deferred.succeed(delivered, undefined);
        }),
        onOutgoingResponseFailure: (id) => Effect.gen(function* () {
          const delivered = entry?.responses.get(id);
          if (delivered === undefined) return;
          entry?.responses.delete(id);
          yield* Deferred.fail(delivered, rejected("permission answer delivery failed"));
          yield* Effect.logWarning("permission answer delivery failed");
          // A committed answer whose response failed must not leave a live
          // child holding a request the log already considers answered.
          try { if (entry !== undefined) process.kill(-Number(entry.child.pid), "SIGKILL"); } catch { /* gone */ }
        }),
      })).pipe(Scope.provide(scope));
      const client = Context.get(context, AcpClient);
      const processEntry: Process = { input, incarnation: sha256Hex(Redacted.value(input.token)), scope, child, client, secrets: resolvedSecrets,
        holds: new Map(), responses: new Map(), replay: [], sessionId: session?._tag === "acp" ? session.sessionId : "", version: 0,
        loading: session !== undefined, ready: false, stopped: false, dead: false, mode: startingMode, options: [], commands: [] };
      entry = processEntry;
      processes.set(input.agentId, processEntry);
      yield* Scope.addFinalizer(scope, Effect.gen(function* () {
        // Stop the producer before flushing and releasing its credentials.
        yield* Fiber.interrupt(stderrReader);
        yield* stderrTail.finish();
        yield* drainMessages(processEntry, true);
      }).pipe(Effect.ensuring(Effect.sync(() => {
        processEntry.secrets.length = 0;
        if (processes.get(input.agentId) === processEntry) processes.delete(input.agentId);
      }))));
      yield* client.handleSessionUpdate((notification) => Effect.gen(function* () {
        const current = processEntry;
        if (current.dead || current.stopped || (current.sessionId !== "" && notification.sessionId !== current.sessionId)) return;
        const update = notification.update as Record<string, any>;
        if (update.sessionUpdate === "available_commands_update") {
          current.commands = Array.isArray(update.availableCommands) ? update.availableCommands.filter((command: any) => command !== null && typeof command === "object" && typeof command.name === "string") : [];
          if (current.turn !== undefined) yield* emit({ _tag: "deliveryUpdate", ...identity(current), deliveryId: current.turn.deliveryId,
            kind: "available_commands_update", replay: current.loading, text: "" });
          return;
        }
        if (update.sessionUpdate === "config_option_update" || update.sessionUpdate === "current_mode_update") {
          if (Array.isArray(update.configOptions)) current.options = update.configOptions;
          const mode = update.currentModeId ?? current.options.find((option) => option.category === "mode")?.currentValue;
          if (current.ready && !current.loading && typeof mode === "string" && mode !== current.mode) {
            const level = reportedLevel(harness, mode, input.permission);
            if (level !== undefined) current.mode = mode;
            const safeMode = yield* redactText(mode);
            yield* emit({ _tag: "modeReported", ...identity(current), mode: safeMode, ...(level === undefined ? {} : { level }), ceiling: input.permission });
          }
          return;
        }
        if (update.sessionUpdate === "state_update" && update.state === "idle") {
          yield* drainMessages(current, true);
          if (current.turn !== undefined) {
            current.turn.idle = true;
            // ACP v2 puts the prompt's terminal error in its idle update;
            // the raw request reply is only an acknowledgement.
            if (update.error !== undefined) recordTurnError(current.turn, update.error);
            yield* finish(current, current.turn);
          }
          return;
        }
        const translatedUpdates = translate(update, current.loading);
        if (current.turn === undefined && !current.loading) {
          if (translatedUpdates.length > 0) yield* Effect.logWarning("adapter content dropped: no active turn");
          return;
        }
        for (const translated of translatedUpdates) {
          const deliveryId = current.turn?.deliveryId ?? Schema.decodeUnknownSync(DeliveryId)(`replay-${randomUUID()}`);
          if (translated.kind === "message") {
            // Issue 144: one speaker per buffer, so redacted text released
            // across chunk boundaries never moves from one speaker to another.
            if (current.message !== undefined && current.message.role !== translated.role) yield* drainMessages(current, true);
            current.message ??= { id: randomUUID(), role: translated.role, pending: [], released: "" };
            current.message.pending.push({ length: translated.text.length, event: {
              _tag: "deliveryUpdate", ...identity(current), deliveryId, kind: "message", replay: current.loading,
              ...(translated.role === undefined ? {} : { role: translated.role }), text: "",
            } });
            current.message.released += yield* redactChunk(current.message.id, translated.text, false);
            yield* drainMessages(current, false);
            continue;
          }
          yield* drainMessages(current, true);
          const text = yield* redactText(translated.text);
          // Redact string leaves, including JSON unicode escapes decoded by ACP.
          const clean = (value: unknown): Effect.Effect<unknown> => typeof value === "string" ? redactText(value)
            : Array.isArray(value) ? Effect.forEach(value, clean)
            : value !== null && typeof value === "object" ? Effect.forEach(Object.entries(value), ([key, value]) => clean(value).pipe(Effect.map((value) => [key, value] as const))).pipe(Effect.map(Object.fromEntries))
            : Effect.succeed(value);
          const content = yield* clean(translated.content).pipe(Effect.flatMap(Schema.decodeUnknownEffect(threadContent)),
            Effect.mapError(() => rejected("adapter content is malformed")));
          if (current.turn !== undefined) current.turn.text += text;
          if (current.loading) noteReplay(current, { _tag: "break" });
          yield* emit({ _tag: "deliveryUpdate", ...identity(current), deliveryId,
            kind: translated.kind, replay: current.loading, text, content });
        }
      }).pipe(Effect.catch(() => Effect.logWarning("adapter update dropped: malformed"))));
      yield* client.handleRequestPermission((request, context) => Effect.gen(function* () {
        yield* drainMessages(processEntry, true);
        const tool = request.toolCall;
        if ((processEntry.sessionId !== "" && request.sessionId !== processEntry.sessionId)
          || (yield* redactText(tool.toolCallId)) !== tool.toolCallId) return yield* AcpRequestError.invalidParams("Permission request refused");
        for (const option of request.options) {
          if ((yield* redactText(option.optionId)) !== option.optionId) return yield* AcpRequestError.invalidParams("Permission option refused");
        }
        const hold = yield* makePermissionHold(request.options);
        processEntry.holds.set(hold.id, hold);
        processEntry.responses.set(context.requestId, hold.delivered);
        const description = yield* redactText(tool.title ?? "Permission requested");
        const mapped = yield* Effect.forEach(request.options, (option) => Effect.gen(function* () {
          return mapPermissionOption(harness.id, { ...option, name: yield* redactText(option.name), kind: yield* redactText(option.kind) });
        }));
        yield* emit({ _tag: "permissionRequested", ...identity(processEntry), permissionRequestId: hold.id,
          toolCallId: tool.toolCallId, description, options: mapped, settingsWrite: settingsWrite((tool.locations ?? []).map((location) => location.path), folder, environment.CLAUDE_CONFIG_DIR) });
        return { outcome: yield* Deferred.await(hold.answer) };
      }));
      const initialized = yield* client.agent.initialize({ protocolVersion: 2, clientInfo: { name: "shepherd", version: "0.0.1" }, clientCapabilities: {} }).pipe(Effect.mapError(() => rejected("adapter initialization failed")));
      processEntry.version = initialized.protocolVersion;
      if (initialized.agentCapabilities !== undefined) processEntry.capabilities = initialized.agentCapabilities;
      const mcpServers = [{ type: "stdio" as const, name: "shepherd", command: process.execPath, args: [fileURLToPath(new URL("../../../cli/src/bin.ts", import.meta.url)), "mcp"],
        env: [{ name: "SHEPHERD_SOCKET", value: configuration.socketPath }, { name: "SHEPHERD_TOKEN", value: Redacted.value(input.token) }] }];
      // Row 66 and issue 93: reload only through a method this peer
      // advertised at initialize, `session/load` first, else `session/resume`.
      const loads = processEntry.capabilities?.loadSession === true;
      const resumes = processEntry.capabilities?.sessionCapabilities?.resume !== undefined && processEntry.capabilities?.sessionCapabilities?.resume !== null;
      if (session !== undefined && !loads && !resumes) return yield* rejected("adapter cannot reload");
      const opened = yield* (session === undefined ? client.agent.createSession({ cwd: folder, mcpServers })
        : loads ? client.agent.loadSession({ sessionId: session.sessionId, cwd: folder, mcpServers })
        : client.agent.resumeSession({ sessionId: session.sessionId, cwd: folder, mcpServers })).pipe(Effect.mapError(() => rejected("adapter session failed")));
      if ("sessionId" in opened && typeof opened.sessionId === "string") processEntry.sessionId = opened.sessionId;
      if (processEntry.sessionId === "" || (yield* redactText(processEntry.sessionId)) !== processEntry.sessionId) return yield* rejected("adapter session identifier refused");
      yield* checkChildFolder;
      yield* drainMessages(processEntry, true);
      processEntry.loading = false;
      processEntry.options = (opened.configOptions ?? []) as ReadonlyArray<ConfigOption>;
      if (input.model !== undefined) processEntry.options = yield* setConfig(client, processEntry.sessionId, processEntry.options, "model", input.model, processEntry.version);
      if (input.effort !== undefined) processEntry.options = yield* setConfig(client, processEntry.sessionId, processEntry.options, "thought_level", input.effort, processEntry.version);
      yield* setMode(processEntry, input.permission);
      processEntry.ready = true;
      yield* child.exitCode.pipe(Effect.result, Effect.flatMap((result) => Effect.gen(function* () {
        processEntry.dead = true;
        // Descendants must not keep stderr open after their adapter exits.
        yield* Effect.sync(() => { try { process.kill(-Number(child.pid), "SIGKILL"); } catch { /* gone */ } });
        // A helper in another session can inherit this pipe even after the
        // adapter's own group is gone. It must not postpone the crash event.
        const drained = yield* Fiber.join(stderrReader).pipe(Effect.timeoutOption(2_000));
        if (Option.isNone(drained)) yield* Fiber.interrupt(stderrReader);
        const stderr = yield* stderrTail.finish();
        yield* drainMessages(processEntry, true);
        if (processEntry.sent !== undefined) yield* Deferred.fail(processEntry.sent, rejected("agent process exited"));
        for (const delivered of processEntry.responses.values()) yield* Deferred.fail(delivered, rejected("permission answer delivery failed"));
        processEntry.responses.clear();
        processEntry.holds.clear();
        if (!processEntry.stopped) {
          // Effect's Node spawner reports signal exits as a PlatformError
          // whose original cause holds this fixed message (4.0.5).
          const cause = result._tag === "Failure" ? result.failure.cause : undefined;
          const signal = cause instanceof Error ? /^Process interrupted due to receipt of signal: '(SIG[A-Z0-9]+)'$/.exec(cause.message)?.[1] ?? null : null;
          yield* emit({ _tag: "exited", ...identity(processEntry), exitCode: result._tag === "Success" ? Number(result.success) : null, signal, stderr });
          if (processes.get(input.agentId) === processEntry) processes.delete(input.agentId);
          // Close from the parent scope so the watcher never interrupts itself.
          yield* close(processEntry).pipe(Effect.forkIn(lifetime));
        }
      })), Effect.forkIn(scope));
      // Every replayed update was flushed into `replay` before loading ended.
      const replay = session === undefined ? {} : { replay: processEntry.replay.splice(0) };
      return { session: { _tag: "acp" as const, sessionId: processEntry.sessionId }, protocolVersion: initialized.protocolVersion,
        reloadable: loads || resumes, ...replay };
    }).pipe(Effect.onExit((exit) => Exit.isFailure(exit) ? entry === undefined ? Scope.close(scope, Exit.void) : close(entry) : Effect.void));
  });
  const send = (input: Send, compact: boolean) => Effect.gen(function* () {
    const entry = yield* live(input.agentId, input.incarnation);
    if (input.delivery.target !== input.agentId || (!compact && input.delivery.content._tag !== "prompt" && input.delivery.content._tag !== "carry-on")) return yield* rejected("delivery does not match send");
    if (entry.turn !== undefined && !entry.turn.ended) return yield* rejected("agent already has a turn");
    const text = compact ? yield* compactPrompt(entry.commands) : input.delivery.content._tag === "prompt" || input.delivery.content._tag === "carry-on" ? input.delivery.content.text : "";
    const turn: Turn = { deliveryId: input.delivery.id, replied: false, idle: false, ended: false, text: "" };
    entry.turn = turn;
    const sent = yield* Deferred.make<void, RunnerRejected>();
    entry.sent = sent;
    // The raw request preserves the protocol reply separately from v2's idle
    // notice; AcpClient.agent.prompt deliberately combines the two.
    yield* entry.client.raw.request("session/prompt", { sessionId: entry.sessionId, prompt: [{ type: "text", text }] }).pipe(
      Effect.result, Effect.flatMap((reply) => Effect.gen(function* () {
        if (reply._tag === "Failure") yield* Deferred.fail(sent, rejected("prompt send failed"));
        if (entry.stopped || entry.dead) return;
        const response = reply._tag === "Success" ? reply.success as { error?: unknown } : undefined;
        const error = reply._tag === "Failure" ? reply.failure : response?.error;
        if (error !== undefined) recordTurnError(turn, error);
        turn.replied = true;
        if (entry.version === 1 || reply._tag === "Failure") turn.idle = true;
        yield* finish(entry, turn);
      })), Effect.forkIn(entry.scope, { startImmediately: true }),
    );
    yield* Deferred.await(sent).pipe(Effect.ensuring(Effect.sync(() => { if (entry.sent === sent) delete entry.sent; })));
  });
  return Runner.of({
    start: (input) => spawn(input), load: (input) => spawn(input, input.session),
    prompt: (input) => send(input, false), compact: (input) => send(input, true),
    cancel: ({ agentId }) => Effect.gen(function* () {
      const entry = yield* live(agentId);
      yield* entry.client.agent.cancel({ sessionId: entry.sessionId }).pipe(Effect.mapError(() => rejected("cancel failed")));
      const holds = [...entry.holds.values()];
      entry.holds.clear();
      for (const hold of holds) yield* Deferred.succeed(hold.answer, { outcome: "cancelled" });
      for (const hold of holds) yield* Deferred.await(hold.delivered);
    }),
    answerPermission: ({ agentId, requestId, optionId }) => Effect.gen(function* () {
      const entry = yield* live(agentId);
      const hold = entry.holds.get(requestId);
      if (hold === undefined || !hold.options.has(optionId)) return yield* rejected("permission answer is not offered");
      entry.holds.delete(requestId);
      yield* Deferred.succeed(hold.answer, { outcome: "selected", optionId });
      yield* Deferred.await(hold.delivered);
    }),
    setMode: ({ agentId, permission }) => Effect.gen(function* () {
      const entry = yield* live(agentId);
      if (comparePermission(permission, entry.input.permission) > 0) return yield* rejected("mode exceeds permission ceiling");
      yield* setMode(entry, permission).pipe(Effect.tapError(() => entry.child.kill({ killSignal: "SIGKILL" }).pipe(Effect.catch(() => Effect.void))));
    }),
    stop: ({ agentId }) => Effect.gen(function* () { const entry = processes.get(agentId); if (entry !== undefined) yield* close(entry); }),
    capabilities: { loadSession: true, resumeSession: true, setModeConfigOption: true },
    events: Stream.fromQueue(events),
  });
}));
