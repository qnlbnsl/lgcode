import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type Client } from "@shephrd/client";
import { permissionForOptionKind, type EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { allowOnce, check, type AgentRef } from "./flow.ts";
import { authRefused, compactions, exactCommand, exitCodeOf, mcpAskInput, receivedUserText, scanTokens, sessionFiles, slashReceipt } from "./probeEvidence.ts";
import { ALWAYS_ALLOW_PROMPT, fill, PROBE_MCP_PROMPT, REMOVED_VARIABLES_PROMPT, RESTART_ACTIVE_PROMPT, RESTART_PENDING_PROMPT, RESTART_PREPARE_PROMPT, SHELL_COMMANDS, SLASH_DOWN_PROMPT, SLASH_RECEIVER_PROMPT, SLASH_UP_PROMPT, STATE_READ_PROMPT } from "./prompts.ts";
import type { Observation, ProbeAgents, ProbeDriver, ProbeId } from "./probes.ts";
import { processesNaming, type LiveService } from "./service.ts";
import { eventsUntil, head, requestId, since, tagged, type LeakSource } from "./support.ts";

export const CORE_CONFIG = { shell_environment_policy: { inherit: "core" } } as const;
export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const probeCommands = (state: string, node = process.execPath, cli = fileURLToPath(new URL("../../../cli/src/bin.ts", import.meta.url))) => ({
  removedVariables: fill(SHELL_COMMANDS.removedVariables, { STATE: shellQuote(state), NODE: shellQuote(node), CLI: shellQuote(cli) }),
  stateRead: fill(SHELL_COMMANDS.stateRead, { CANARY: shellQuote(join(state, "live-canary")) }),
  alwaysAllow: SHELL_COMMANDS.alwaysAllow,
});

interface Tool { _tag: string; callId: string; title: string; status: string; input?: string; output?: string }
interface Permission { permissionRequestId: string; toolCallId: string; holder: { _tag: string }; description: string; options: ReadonlyArray<{ id: string; kind: string; level: string; persistent: boolean }> }
const event = <T>(row: EventEnvelope): T => row.event as unknown as T;
const tools = (rows: ReadonlyArray<EventEnvelope>, agent: AgentRef): ReadonlyArray<Tool> => tagged(rows, "ThreadItem", agent.agentId)
  .map((row) => event<{ content: Tool }>(row).content).filter((content) => content._tag === "tool-call");
const mergedTools = (rows: ReadonlyArray<EventEnvelope>, agent: AgentRef): ReadonlyArray<Tool> => {
  const byId = new Map<string, Tool>();
  for (const tool of tools(rows, agent)) {
    const previous = byId.get(tool.callId);
    byId.set(tool.callId, { ...previous, ...tool, title: tool.title || previous?.title || "",
      output: [previous?.output, tool.output].filter(Boolean).join("\n") });
  }
  return [...byId.values()];
};
const both = (outcome: string, detail: string): ReadonlyArray<Observation> => ["claude", "codex"].map((harness) => ({ harness, outcome, detail }));

export interface LiveProbeOptions {
  readonly service: () => LiveService;
  readonly restart: () => Effect.Effect<void, unknown>;
  readonly openOwner: () => Effect.Effect<Client, unknown, Scope.Scope>;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly agentTimeout: number;
  readonly engineTimeout: number;
  readonly secrets: Set<string>;
  readonly captureOutput?: (source: LeakSource) => void;
}

// All model-dependent observations are collected here. The outcome gates and
// step list in probes.ts are shared with the fake driver. A model's assertion
// is never sufficient evidence of a read, shell execution, tool call or reload.
export const liveProbeDriver = (options: LiveProbeOptions): ProbeDriver => {
  const allTokens = new Set<string>();
  const arguments_ = new Map<string, LeakSource>();
  const tokens = new Map<string, string>();
  const restartAndConnectCli = () => Effect.gen(function* () {
    yield* options.restart();
    const cli = fileURLToPath(new URL("../../../cli/src/bin.ts", import.meta.url));
    const args = [cli, "accounts", "--input", '{"operation":"list"}'];
    const result = yield* Effect.tryPromise((signal) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, args, { signal, env: { SHEPHRD_HOME: options.service().state, TMPDIR: "/tmp" }, stdio: ["ignore", "pipe", "pipe"] });
      arguments_.set(`cli:${child.pid}`, { label: `arguments of run CLI process ${child.pid}`, text: [process.execPath, ...args].join("\0") });
      let output = "";
      for (const stream of [child.stdout!, child.stderr!]) stream.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
      child.once("error", () => reject(new Error("restart CLI connection could not start or was cancelled")));
      child.once("close", (code) => resolve({ code, output }));
    }));
    options.captureOutput?.({ label: "the restart CLI connection output", text: result.output });
    yield* check(result.code === 0, `the restarted service's CLI connection failed (exit ${String(result.code)})`);
  });
  const commands = probeCommands(options.service().state);
  const commandInFolder = (tool: Tool, command: string, folder: string): boolean => {
    if (!exactCommand(tool.input, command)) return false;
    try {
      const input = JSON.parse(tool.input!);
      for (const key of ["cwd", "workdir"]) {
        if (input[key] === undefined) continue;
        if (typeof input[key] !== "string") return false;
        const path = resolve(folder, input[key]);
        if (path !== folder && !path.startsWith(folder + "/")) return false;
      }
      return true;
    } catch { return false; }
  };
  const canary = randomBytes(24).toString("hex");
  let agents: ProbeAgents;
  let coreObserved = false;
  const members = () => [{ harness: "claude", agent: agents.lead, folder: options.service().work },
    { harness: "codex", agent: agents.worker, folder: join(options.service().work, "project") }];

  const snapshot = (): void => {
    const service = options.service();
    for (const pid of processesNaming(service.root, [], [service.pid])) {
      try {
        const args = readFileSync(`/proc/${pid}/cmdline`, "utf8");
        // Do not retain secrets in a public observation or report.
        arguments_.set(`${pid}:${args}`, { label: `arguments of run process ${pid}`, text: args });
        const environment = Object.fromEntries(readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").map((entry) => {
          const at = entry.indexOf("="); return [entry.slice(0, at), entry.slice(at + 1)];
        }));
        if (environment.SHEPHRD_SOCKET !== join(service.state, "engine.sock") || !environment.SHEPHRD_TOKEN) continue;
        if (readlinkSync(`/proc/${pid}/cwd`) === join(service.work, "project")) {
          try { if (JSON.parse(environment.CODEX_CONFIG ?? "null")?.shell_environment_policy?.inherit === "core") coreObserved = true; } catch { /* Missing or malformed configuration is not evidence. */ }
        }
        const token = environment.SHEPHRD_TOKEN;
        allTokens.add(token); options.secrets.add(token);
        const folder = readlinkSync(`/proc/${pid}/cwd`);
        for (const member of members()) if (folder === member.folder) tokens.set(member.agent.agentId, token);
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw new Error(`run process ${pid} could not be inspected`);
      }
    }
  };
  const agentClient = (agent: AgentRef) => Effect.gen(function* () {
    snapshot();
    const token = tokens.get(agent.agentId);
    yield* check(token !== undefined, `not attempted: no live process token for agent ${agent.agentId}`);
    return yield* connect({ environment: { SHEPHRD_SOCKET: join(options.service().state, "engine.sock"), SHEPHRD_TOKEN: token! }, attempts: 1 });
  });
  const filesFor = (harness: string, agent: AgentRef, rows: ReadonlyArray<EventEnvelope>): ReadonlyArray<string> => {
    const ids = new Set(tagged(rows, "SessionOpened", agent.agentId).map((row) => event<{ session: { sessionId: string } }>(row).session.sessionId));
    const environment = options.environment;
    const home = environment.HOME;
    if (home === undefined) throw new Error("not attempted: session home is unknown");
    const directory = harness === "claude" ? join(environment.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "projects")
      : join(environment.CODEX_HOME ?? join(home, ".codex"), "sessions");
    return [...new Set([...ids].flatMap((id) => sessionFiles(directory, id)))];
  };
  const sessionText = (harness: string, agent: AgentRef, rows: ReadonlyArray<EventEnvelope>): string => {
    const files = filesFor(harness, agent, rows);
    if (files.length === 0) throw new Error(`not attempted: no ${harness} session file found by this run's session ids`);
    return files.map((path) => readFileSync(path, "utf8")).join("\n");
  };

  // Answer only the exact tool input for this probe. An unrelated request is
  // denied and recorded as a failure, even if the intended command later ran.
  const turn = (owner: Client, agent: AgentRef, text: string, allowed: (tool: Tool) => boolean, persistent = false) => Effect.gen(function* () {
    const mark = yield* head(owner);
    const scope = yield* Scope.Scope;
    const unexpected: string[] = [];
    const asked: Permission[] = [];
    const watcher = yield* (owner.subscribe({ requestId: requestId(), after: mark } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
      Stream.filter((row) => row.agentId === agent.agentId && row.event._tag === "PermissionRequested"),
      Stream.runForEach((row) => Effect.gen(function* () {
        const request = event<Permission>(row);
        asked.push(request);
        const history = yield* since(owner, mark);
        const tool = mergedTools(history, agent).find((candidate) => candidate.callId === request.toolCallId);
        const matches = tool !== undefined && allowed(tool);
        // Moving a request through a real parent is not automatic approval.
        if (request.holder._tag !== "owner") {
          const parent = agent.agentId === agents.worker.agentId ? agents.lead : undefined;
          if (parent !== undefined) {
            const client = yield* agentClient(parent);
            yield* client["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id: request.permissionRequestId } } as never);
          }
        }
        const selected = matches ? persistent ? request.options.find((option) => option.kind === "allow_always" && option.persistent)?.id
          : allowOnce(request.options) : undefined;
        const denied = request.options.find((option) => option.kind.startsWith("reject"))?.id;
        if (!matches) unexpected.push(`denied unexpected request ${request.permissionRequestId}`);
        if (persistent && request.holder._tag !== "owner") unexpected.push("persistent option held by agent");
        yield* check(selected !== undefined || denied !== undefined, "permission request has no safe answer");
        yield* owner.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: selected ?? denied! } as never);
      })), Effect.forkIn(scope),
    );
    const reply = yield* (owner.prompt({ requestId: requestId(), agentId: agent.agentId, text } as never) as Effect.Effect<{ deliveryId: string }, unknown>);
    const sent = yield* eventsUntil(owner, mark, "the probe delivery to be sent", (row) => row.event._tag === "DeliverySent" && event<{ deliveryId: string }>(row).deliveryId === reply.deliveryId, options.agentTimeout);
    const afterSent = sent.at(-1)!.sequence;
    yield* eventsUntil(owner, afterSent, "the probe turn to end (not attempted if no tool was used)", (row) => row.agentId === agent.agentId && row.event._tag === "TurnEnded", options.agentTimeout);
    yield* Fiber.interrupt(watcher);
    snapshot();
    yield* check(unexpected.length === 0, unexpected.join("; "));
    const rows = yield* since(owner, mark);
    yield* check(mergedTools(rows, agent).every((tool) => allowed(tool)), "unexpected tool call observed; only the named probe input is allowed");
    return { rows, asked, deliveryId: reply.deliveryId };
  });

  const askInput = (_agent: AgentRef, marker: string) => (tool: Tool): boolean => mcpAskInput(tool.input, tool.title, marker);
  const askedBy = (rows: ReadonlyArray<EventEnvelope>, agent: AgentRef, marker: string): boolean =>
    tagged(rows, "QuestionAsked", agent.agentId).some((row) => event<{ text: string }>(row).text === marker
      && row.caller?._tag === "agent" && row.caller.agentId === agent.agentId);

  const observe = (id: ProbeId, given: ProbeAgents): Effect.Effect<ReadonlyArray<Observation>, unknown, Scope.Scope> => Effect.gen(function* () {
    agents = given;
    const owner = yield* options.openOwner();
    snapshot();
    if (id === "fixture-evidence") {
      return yield* Effect.sync(() => ["claude", "codex"].map((harness) => {
        const path = fileURLToPath(new URL(`../../../testing/fixtures/${harness}.ndjson`, import.meta.url));
        const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        const header = rows[0];
        const categories = [...new Set(rows.flatMap((row) => row.frame?.result?.configOptions ?? []).map((entry: { category?: string }) => entry.category).filter(Boolean))];
        const version = header?.metadata?.protocolVersion;
        return { harness, outcome: typeof version === "number" && categories.includes("model") && categories.includes("thought_level") ? "cited" : "missing fixture",
          detail: `${path}:1; adapter ${String(header.version)}, ACP ${String(version)}; categories ${categories.join(",")}; existing evidence, no new adapter session` };
      }));
    }
    if (id === "sandbox-mcp") {
      const results: Observation[] = [];
      for (const { harness, agent } of members()) {
        const marker = "lcp-mcp-" + randomBytes(8).toString("hex");
        const result = yield* turn(owner, agent, fill(PROBE_MCP_PROMPT, { MARKER: marker }), askInput(agent, marker));
        results.push({ harness, outcome: askedBy(result.rows, agent, marker) ? "succeeds" : "not attempted", detail: "authenticated QuestionAsked event with the agent as caller, via its MCP ask tool" });
      }
      return results;
    }
    if (id === "permission-kinds") {
      const rows = yield* since(owner, 0);
      return members().map(({ harness, agent }) => {
        const asked = tagged(rows, "PermissionRequested", agent.agentId).map((row) => event<Permission>(row));
        const kinds = asked.flatMap((request) => request.options);
        const valid = kinds.length > 0 && kinds.every((option) => {
          const scale = permissionForOptionKind(option.kind);
          const modeRaise = harness === "claude" && /^exit-plan-(?:clear-)?(?:bypass|auto)$/.test(option.id);
          return option.level === (modeRaise ? "full" : scale.level) && option.persistent === (modeRaise || scale.persistent);
        });
        return { harness, outcome: valid ? "recorded" : "not attempted", detail: kinds.map((option) => `${option.id}/${option.kind}: ${option.level}, persistent=${String(option.persistent)}`).join("; ") || "no observed permission options" };
      });
    }
    if (id === "removed-variables" || id === "state-read") {
      if (id === "state-read") writeFileSync(join(options.service().state, "live-canary"), canary, { mode: 0o600, flag: "wx" });
      const command = id === "removed-variables" ? commands.removedVariables : commands.stateRead;
      const results: Observation[] = [];
      for (const { harness, agent } of members()) {
        const result = yield* turn(owner, agent, fill(id === "removed-variables" ? REMOVED_VARIABLES_PROMPT : STATE_READ_PROMPT, { COMMAND: command }), (tool) => exactCommand(tool.input, command));
        const executed = mergedTools(result.rows, agent).filter((tool) => exactCommand(tool.input, command) && ["completed", "failed"].includes(tool.status));
        const output = executed.map((tool) => tool.output ?? "").join("\n");
        let outcome = "not attempted";
        if (id === "removed-variables") {
          if (executed.length > 0 && (harness !== "codex" || coreObserved)) outcome = authRefused(output, exitCodeOf(output)) ? "refused by ancestry check" : exitCodeOf(output) === 0 ? "acts as owner" : "no ancestry refusal observed";
        } else if (executed.length > 0) {
          outcome = output.includes(canary) ? "no mechanism: the agent read the canary file"
            : /(?:denied|not permitted|permission|refused)/i.test(output) ? "refused" : "not attempted";
        }
        results.push({ harness, outcome, detail: id === "state-read" ? `exact canary command; completed tool calls=${executed.length}; SECURITY.md:51 lists no default deny-read rule`
          : `exact command; completed tool calls=${executed.length}; ${harness === "codex" ? 'run process CODEX_CONFIG observed with shell_environment_policy.inherit="core" (SEC-PB-8)' : "both Shephrd variables removed (SEC-PB-5)"}` });
      }
      return results;
    }
    if (id === "slash-up" || id === "slash-down") {
      const target = id === "slash-up" ? members()[0]! : members()[1]!;
      const sender = id === "slash-up" ? agents.worker : agents.lead;
      const payload = id === "slash-up" ? SLASH_UP_PROMPT : SLASH_DOWN_PROMPT;
      yield* turn(owner, target.agent, SLASH_RECEIVER_PROMPT, () => false);
      const beforeRows = yield* since(owner, 0);
      const compactBefore = compactions(sessionText(target.harness, target.agent, beforeRows));
      const client = yield* agentClient(sender);
      const mark = yield* head(owner);
      const reply = id === "slash-up" ? yield* Effect.gen(function* () {
        const asked = yield* (client.ask({ requestId: requestId(), text: payload } as never) as Effect.Effect<{ questionId: string }, unknown>);
        const seen = yield* eventsUntil(owner, mark, "child question delivery", (row) => row.event._tag === "QuestionAsked" && event<{ questionId: string }>(row).questionId === asked.questionId, options.agentTimeout);
        return { deliveryId: event<{ deliveryId: string }>(seen.at(-1)!).deliveryId };
      }) : yield* (client.prompt({ requestId: requestId(), agentId: target.agent.agentId, text: payload } as never) as Effect.Effect<{ deliveryId: string }, unknown>);
      const sent = yield* eventsUntil(owner, mark, "slash data delivery", (row) => row.event._tag === "DeliverySent" && event<{ deliveryId: string }>(row).deliveryId === reply.deliveryId, options.agentTimeout);
      const rows = yield* eventsUntil(owner, sent.at(-1)!.sequence, "slash receiver turn", (row) => row.agentId === target.agent.agentId && row.event._tag === "TurnEnded", options.agentTimeout);
      const text = sessionText(target.harness, target.agent, yield* since(owner, 0));
      const compacted = tagged(rows, "TurnEnded", target.agent.agentId).some((row) => event<{ compact: boolean }>(row).compact)
        || compactions(text) !== compactBefore || tagged(rows, "CommandRefused").some((row) => event<{ command: string }>(row).command === "compact");
      return both(slashReceipt(receivedUserText(text), reply.deliveryId, payload, compacted), `${sender.agentId} -> ${target.agent.agentId}; received user session content; delivery ${reply.deliveryId}; compaction boundaries unchanged=${String(!compacted)}`);
    }
    if (id === "always-allow") {
      const agent = agents.lead;
      const path = join(options.service().work, ".claude", "settings.local.json");
      const settings = (): { permissions?: { allow?: string[] } } => {
        const actual = realpathSync(path);
        if (!actual.startsWith(options.service().work + "/")) throw new Error("settings file is outside the run's work folder");
        try { return JSON.parse(readFileSync(path, "utf8")); }
        catch { throw new Error("local settings JSON cannot be inspected; content is not printed"); }
      };
      let before: { permissions?: { allow?: string[] } };
      try { before = settings(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; before = {}; }
      const result = yield* turn(owner, agent, fill(ALWAYS_ALLOW_PROMPT, { COMMAND: commands.alwaysAllow }), (tool) => commandInFolder(tool, commands.alwaysAllow, options.service().work), true);
      let after: { permissions?: { allow?: string[] } };
      try { after = settings(); } catch { return both("not attempted", "settings.local.json was not written after always allow"); }
      const offered = result.asked.flatMap((request) => request.options);
      const persistent = offered.filter((option) => option.persistent && option.kind === "allow_always");
      const scopes = (after.permissions?.allow ?? []).filter((rule) => !(before.permissions?.allow ?? []).includes(rule));
      const safe = result.asked.length > 0 && result.asked.every((request) => request.holder._tag === "owner") && persistent.length === 1 && scopes.length > 0;
      return [
        { harness: "claude", outcome: safe ? "scopes recorded; persistent options routed to owner" : "not attempted", detail: `${path}; ${offered.map((option) => `${option.id}: ${option.kind}, persistent=${String(option.persistent)}, scope=${option.persistent ? JSON.stringify(scopes) : "one request; no saved rule selected"}`).join("; ")}; saved scopes=${JSON.stringify(scopes)}` },
        { harness: "codex", outcome: "not applicable (criterion names Claude only)", detail: "SEC-PB-4 specifies only claude-agent-acp 0.99.1; no persistent answer sent to Codex" },
      ];
    }
    if (id === "reload") {
      const markers = new Map<string, string>();
      for (const { agent } of members()) {
        const marker = "lcp-reloaded-" + randomBytes(8).toString("hex");
        markers.set(agent.agentId, marker);
        yield* turn(owner, agent, fill(RESTART_PREPARE_PROMPT, { MARKER: marker }), () => false);
      }
      snapshot();
      const oldTokens = new Map(tokens);
      const activeMark = yield* head(owner);
      // A sleeping exact command keeps both turns working. The second kill
      // below separately tests replay receipts, without confusing a re-send
      // with a carry-on turn (PB-A11).
      for (const { agent } of members()) {
        yield* owner.prompt({ requestId: requestId(), agentId: agent.agentId,
          text: fill(RESTART_ACTIVE_PROMPT, { COMMAND: SHELL_COMMANDS.restartHold, MARKER: markers.get(agent.agentId)! }) } as never);
        yield* eventsUntil(owner, activeMark, "the exact restart hold command (not attempted if declined)", (row) => {
          if (row.agentId !== agent.agentId || row.event._tag !== "ThreadItem") return false;
          const tool = event<{ content: Tool }>(row).content;
          return tool._tag === "tool-call" && exactCommand(tool.input, SHELL_COMMANDS.restartHold);
        }, options.agentTimeout);
      }
      const activeRows = yield* since(owner, activeMark);
      yield* check(members().every(({ agent }) => !tagged(activeRows, "TurnEnded", agent.agentId).length), "not attempted: a hold turn ended before SIGKILL");
      yield* restartAndConnectCli();
      const carriedOwner = yield* options.openOwner();
      const activeScope = yield* Scope.Scope;
      const restartUnexpected: string[] = [];
      const activeApprovals = yield* (carriedOwner.subscribe({ requestId: requestId(), after: activeRows.at(-1)!.sequence } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
        Stream.filter((row) => row.event._tag === "PermissionRequested"),
        Stream.runForEach((row) => Effect.gen(function* () {
          const agent = members().find((member) => member.agent.agentId === row.agentId)?.agent;
          if (agent === undefined) return;
          const request = event<Permission>(row);
          const history = yield* since(carriedOwner, activeMark);
          const tool = mergedTools(history, agent).find((candidate) => candidate.callId === request.toolCallId);
          const ok = tool !== undefined && askInput(agent, markers.get(agent.agentId)!)(tool);
          if (request.holder._tag !== "owner" && agent.agentId === agents.worker.agentId) {
            const parent = yield* agentClient(agents.lead);
            yield* parent["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id: request.permissionRequestId } } as never);
          }
          if (!ok) restartUnexpected.push(`denied unexpected restart request ${request.permissionRequestId}`);
          const optionId = ok ? allowOnce(request.options) : request.options.find((option) => option.kind.startsWith("reject"))?.id;
          yield* check(optionId !== undefined, "carry-on permission has no safe answer");
          yield* carriedOwner.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: optionId! } as never);
        })), Effect.forkIn(activeScope),
      );
      const firstPhase = new Map<string, { refused: boolean; called: boolean }>();
      for (const { agent } of members()) {
        const token = oldTokens.get(agent.agentId);
        yield* check(token !== undefined, "not attempted: old token was not captured");
        const old = yield* Effect.exit(Effect.scoped(connect({ environment: { SHEPHRD_SOCKET: join(options.service().state, "engine.sock"), SHEPHRD_TOKEN: token! }, attempts: 1 })));
        const refused = Exit.isFailure(old) && String(old.cause).includes("401");
        yield* check(refused, "old token accepted or authentication refusal not observed after restart");
        const history = yield* eventsUntil(carriedOwner, activeMark, "a real MCP ask call during the carry-on", (row) =>
          row.agentId === agent.agentId && row.event._tag === "QuestionAsked" && event<{ text: string }>(row).text === markers.get(agent.agentId)!, options.agentTimeout);
        const carry = tagged(history, "DeliveryQueued").find((row) => {
          const delivery = event<{ delivery: { id: string; target: string; content: { _tag: string } } }>(row).delivery;
          return delivery.target === agent.agentId && delivery.content._tag === "carry-on";
        });
        const carryId = carry === undefined ? undefined : event<{ delivery: { id: string } }>(carry).delivery.id;
        const sent = carryId === undefined ? undefined : history.find((row) => row.event._tag === "DeliverySent" && event<{ deliveryId: string }>(row).deliveryId === carryId);
        const called = carry !== undefined && sent !== undefined && askedBy(history.filter((row) => row.sequence > sent.sequence), agent, markers.get(agent.agentId)!);
        yield* check(called, "not attempted: authenticated tool call was not made in a carry-on turn");
        firstPhase.set(agent.agentId, { refused, called });
        yield* eventsUntil(carriedOwner, sent!.sequence, "carry-on turn to settle before the replay probe", (row) => row.agentId === agent.agentId && row.event._tag === "TurnEnded", options.agentTimeout);
      }
      yield* Fiber.interrupt(activeApprovals);
      snapshot();
      const mark = yield* head(carriedOwner);
      const pending = new Map<string, string>();

      // These calls use the run's peer agent identities, so the engine itself
      // supplies the same escaped data envelope that it uses for an MCP prompt.
      for (const { agent } of members()) {
        const peer = yield* agentClient(agent.agentId === agents.lead.agentId ? agents.worker : agents.lead);
        const reply = agent.agentId === agents.lead.agentId ? yield* Effect.gen(function* () {
          const asked = yield* (peer.ask({ requestId: requestId(), text: RESTART_PENDING_PROMPT } as never) as Effect.Effect<{ questionId: string }, unknown>);
          const seen = yield* eventsUntil(carriedOwner, mark, "pending restart question", (row) => row.event._tag === "QuestionAsked" && event<{ questionId: string }>(row).questionId === asked.questionId, options.agentTimeout);
          return { deliveryId: event<{ deliveryId: string }>(seen.at(-1)!).deliveryId };
        }) : yield* (peer.prompt({ requestId: requestId(), agentId: agent.agentId, text: RESTART_PENDING_PROMPT } as never) as Effect.Effect<{ deliveryId: string }, unknown>);
        pending.set(agent.agentId, reply.deliveryId);
        yield* eventsUntil(carriedOwner, mark, "pending restart delivery", (row) => row.event._tag === "DeliverySent" && event<{ deliveryId: string }>(row).deliveryId === reply.deliveryId, options.agentTimeout);
      }
      const atCrash = yield* since(carriedOwner, mark);
      // A model that answered before the kill provides no replay receipt test.
      yield* check([...pending.values()].every((id) => !atCrash.some((row) => row.event._tag === "DeliveryAccepted" && event<{ deliveryId: string }>(row).deliveryId === id)), "not attempted: restart deliveries were already accepted before SIGKILL");
      yield* restartAndConnectCli();
      const fresh = yield* options.openOwner();
      // No broad permission subscription survives a restart. Only the known
      // ask tool may be approved for each carry-on turn.
      const scope = yield* Scope.Scope;
      const approval = yield* (fresh.subscribe({ requestId: requestId(), after: atCrash.at(-1)!.sequence } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
        Stream.filter((row) => row.event._tag === "PermissionRequested"),
        Stream.runForEach((row) => Effect.gen(function* () {
          const agent = members().find((member) => member.agent.agentId === row.agentId)?.agent;
          if (agent === undefined) return;
          const request = event<Permission>(row);
          const history = yield* since(fresh, mark);
          const tool = mergedTools(history, agent).find((candidate) => candidate.callId === request.toolCallId);
          const ok = tool !== undefined && askInput(agent, markers.get(agent.agentId)!)(tool);
          if (request.holder._tag !== "owner" && agent.agentId === agents.worker.agentId) {
            const parent = yield* agentClient(agents.lead);
            yield* parent["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id: request.permissionRequestId } } as never);
          }
          if (!ok) restartUnexpected.push(`denied unexpected restart request ${request.permissionRequestId}`);
          const optionId = ok ? allowOnce(request.options) : request.options.find((option) => option.kind.startsWith("reject"))?.id;
          yield* check(optionId !== undefined, "carry-on permission has no safe answer");
          yield* fresh.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: optionId! } as never);
        })), Effect.forkIn(scope),
      );
      const results: Observation[] = [];
      for (const { harness, agent } of members()) {
        const token = oldTokens.get(agent.agentId);
        yield* check(token !== undefined, "not attempted: old token was not captured");
        const old = yield* Effect.exit(Effect.scoped(connect({ environment: { SHEPHRD_SOCKET: join(options.service().state, "engine.sock"), SHEPHRD_TOKEN: token! }, attempts: 1 })));
        const refused = Exit.isFailure(old) && String(old.cause).includes("401");
        const sentAgain = yield* eventsUntil(fresh, mark, "reloaded replay or carry-on delivery to be sent", (row) =>
          row.agentId === agent.agentId && row.event._tag === "DeliverySent", options.agentTimeout);
        yield* eventsUntil(fresh, sentAgain.at(-1)!.sequence, "reloaded replay turn to end", (row) => row.agentId === agent.agentId && row.event._tag === "TurnEnded", options.agentTimeout);
        const history = yield* since(fresh, mark);
        const session = tagged(history, "SessionOpened", agent.agentId)[0];
        const receipt = history.find((row) => row.event._tag === "DeliveryAccepted" && row.agentId === agent.agentId && event<{ deliveryId: string }>(row).deliveryId === pending.get(agent.agentId));
        const requeued = history.find((row) => row.event._tag === "DeliveryRequeued" && row.agentId === agent.agentId && event<{ deliveryId: string }>(row).deliveryId === pending.get(agent.agentId));
        const duringRecovery = receipt !== undefined && session !== undefined && receipt.sequence > session.sequence && receipt.requestId === session.requestId
          && !history.some((row) => row.event._tag === "DeliverySent" && event<{ deliveryId: string }>(row).deliveryId === pending.get(agent.agentId) && row.sequence > session.sequence);
        const replay = duringRecovery ? "found" : requeued !== undefined ? "re-send on restart" : "not attempted";
        const outcome = !refused ? "old token accepted or refusal not observed" : session === undefined || !firstPhase.get(agent.agentId)?.called ? "not attempted" : `old token refused; tool succeeds; ${replay}`;
        results.push({ harness, outcome, detail: `SIGKILL own service, owner socket and actual CLI reconnected (PB-A8); ${agent.agentId}, delivery ${pending.get(agent.agentId)}; reload=${String(session !== undefined)}, carry-on tool succeeded in first restart=${String(firstPhase.get(agent.agentId)?.called)}` });
      }
      yield* Fiber.interrupt(approval);
      yield* check(restartUnexpected.length === 0, restartUnexpected.join("; "));
      snapshot();
      return results;
    }
    // PB-A4 / SEC-PB-1: scan only files selected by this run's sessions and
    // arguments sampled from processes belonging to this run. Never print text.
    const rows = yield* since(owner, 0);
    return members().map(({ harness, agent }) => {
      const scan = scanTokens([...allTokens], filesFor(harness, agent, rows), [...arguments_.values()]);
      return { harness, outcome: scan.leaks.length === 0 && scan.arguments > 0 ? "not found" : scan.leaks.length > 0 ? "token found" : "not attempted",
        detail: `session files=${scan.files}, process argument snapshots=${scan.arguments}; paths=${scan.paths.join(",")}${scan.leaks.length > 0 ? `; ${scan.leaks.join("; ")}` : ""}` };
    });
  });
  return { observe };
};
