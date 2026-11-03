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
import { authRefused, canaryDenied, compactions, exactCommand, exitCodeOf, fixtureEvidence, foregroundCommand, mcpAskDiscovery, mcpAskInput, receivedUserText, scanTokens, sessionFiles, shellIdentityAbsent, shellIdentityStatus, slashReceipt } from "./probeEvidence.ts";
import { ALWAYS_ALLOW_PROMPT, fill, PROBE_MCP_PROMPT, REMOVED_VARIABLES_PROMPT, RESTART_ACTIVE_PROMPT, RESTART_PENDING_PROMPT, RESTART_PREPARE_PROMPT, SHELL_COMMANDS, SLASH_DOWN_PROMPT, SLASH_RECEIVER_PROMPT, SLASH_UP_PROMPT, STATE_READ_PROMPT } from "./prompts.ts";
import { ADAPTER_CANCELLED, type Observation, type ProbeAgents, type ProbeDriver, type ProbeId } from "./probes.ts";
import { apply, emptyViews } from "../../src/views/apply.ts";
import { oneLine } from "./reporter.ts";
import { processesNaming, type LiveService } from "./service.ts";
import { eventsUntil, head, readOwnerCredentialFrom, redactSecrets, redactShapes, requestId, since, tagged, type LeakSource } from "./support.ts";

export const CORE_CONFIG = { shell_environment_policy: { inherit: "core" } } as const;
export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const probeCommands = (state: string, node = process.execPath, cli = fileURLToPath(new URL("../../../cli/src/bin.ts", import.meta.url))) => ({
  removedVariables: fill(SHELL_COMMANDS.removedVariables, { STATE: shellQuote(state), NODE: shellQuote(node), CLI: shellQuote(cli) }),
  restartHold: fill(SHELL_COMMANDS.restartHold, { NODE: shellQuote(node) }),
  stateRead: fill(SHELL_COMMANDS.stateRead, { CANARY: shellQuote(join(state, "live-canary")) }),
  alwaysAllow: SHELL_COMMANDS.alwaysAllow,
});

interface Tool { _tag: string; callId: string; title: string; status: string; input?: string; output?: string }
interface Permission { permissionRequestId: string; toolCallId: string; holder: { _tag: string }; description: string; options: ReadonlyArray<{ id: string; kind: string; level: string; persistent: boolean; destination?: string }> }
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
  const agentTokens = new Map<string, Set<string>>();
  const agentArguments = new Map<string, Map<string, LeakSource>>();
  const agentEnvironments = new Map<string, Map<number, ReadonlyArray<string>>>();
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
  let coreConfigured = false;
  const members = () => [{ harness: "claude", agent: agents.lead, folder: options.service().work },
    { harness: "codex", agent: agents.worker, folder: join(options.service().work, "project") }];

  const snapshot = (): ReadonlySet<string> => {
    const capturedAgents = new Set<string>();
    const service = options.service();
    for (const pid of processesNaming(service.root, [], [service.pid])) {
      try {
        const args = readFileSync(`/proc/${pid}/cmdline`, "utf8");
        // Do not retain secrets in a public observation or report.
        arguments_.set(`${pid}:${args}`, { label: `arguments of run process ${pid}`, text: args });
        const rawEnvironment = readFileSync(`/proc/${pid}/environ`, "utf8");
        const environment = Object.fromEntries(rawEnvironment.split("\0").filter(Boolean).map((entry) => {
          const at = entry.indexOf("="); return [entry.slice(0, at), entry.slice(at + 1)];
        }));
        if (environment.SHEPHRD_SOCKET !== join(service.state, "engine.sock") || !environment.SHEPHRD_TOKEN) continue;
        if (readlinkSync(`/proc/${pid}/cwd`) === join(service.work, "project")) {
          try { if (JSON.parse(environment.CODEX_CONFIG ?? "null")?.shell_environment_policy?.inherit === "core") coreConfigured = true; } catch { /* Missing or malformed configuration is not evidence. */ }
        }
        const token = environment.SHEPHRD_TOKEN;
        allTokens.add(token); options.secrets.add(token);
        const folder = readlinkSync(`/proc/${pid}/cwd`);
        for (const member of members()) if (folder === member.folder) {
          const id = member.agent.agentId;
          capturedAgents.add(id);
          tokens.set(id, token);
          const captured = agentTokens.get(id) ?? new Set<string>();
          captured.add(token); agentTokens.set(id, captured);
          const argv = agentArguments.get(id) ?? new Map<string, LeakSource>();
          if (args.length > 0) argv.set(`${pid}:${args}`, { label: `arguments of ${member.harness} run process ${pid}`, text: args });
          agentArguments.set(id, argv);
          // Identity values belong in the private token set, never a log or
          // the public scan result. Retain only variable names as coverage.
          const environments = agentEnvironments.get(id) ?? new Map<number, ReadonlyArray<string>>();
          if (rawEnvironment.length > 0) environments.set(pid, Object.keys(environment));
          agentEnvironments.set(id, environments);
        }
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw new Error(`run process ${pid} could not be inspected`);
      }
    }
    return capturedAgents;
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
  const sessionText = (harness: string, agent: AgentRef, rows: ReadonlyArray<EventEnvelope>, attempted = false): string => {
    const files = filesFor(harness, agent, rows);
    if (files.length === 0) throw new Error(`${attempted ? "attempted; failed" : "not attempted"}: no ${harness} session file found by this run's session ids`);
    return files.map((path) => readFileSync(path, "utf8")).join("\n");
  };

  // Answer only the exact tool input for this probe. An unrelated request is
  // denied and recorded as a failure, even if the intended command later ran.
  const turn = (owner: Client, agent: AgentRef, text: string, allowed: (tool: Tool) => boolean, persistent = false) => Effect.gen(function* () {
    const mark = yield* head(owner);
    const scope = yield* Scope.Scope;
    const unexpected: string[] = [];
    const asked: Permission[] = [];
    const rejected = new Set<string>();
    const chosen: Array<{ request: Permission; optionId: string; destination?: string }> = [];
    let noSafePersistent = false;
    const watcher = yield* (owner.subscribe({ requestId: requestId(), after: mark } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
      Stream.filter((row) => row.agentId === agent.agentId && row.event._tag === "PermissionRequested"),
      Stream.runForEach((row) => Effect.gen(function* () {
        const request = event<Permission>(row);
        asked.push(request);
        const history = yield* since(owner, mark);
        const tool = mergedTools(history, agent).find((candidate) => candidate.callId === request.toolCallId);
        const matches = tool !== undefined && allowed(tool);
        // Moving a request through a real parent is not automatic approval.
        if (!persistent && request.holder._tag !== "owner") {
          const parent = agent.agentId === agents.worker.agentId ? agents.lead : undefined;
          if (parent !== undefined) {
            const client = yield* agentClient(parent);
            yield* client["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id: request.permissionRequestId } } as never);
          }
        }
        // Destination is absent from today's public PermissionOption contract
        // and adapter wire request. Do not infer it from an id or label. A
        // real run must fail honestly until that destination is verifiable.
        const safe = persistent && request.holder._tag === "owner" ? request.options.find((option) => option.kind === "allow_always" && option.persistent
          && (option.destination === "localSettings" || option.destination === "session")) : undefined;
        const selected = matches ? persistent ? safe?.id : allowOnce(request.options) : undefined;
        const denied = request.options.find((option) => option.kind.startsWith("reject"))?.id;
        if (!matches) unexpected.push(`denied unexpected request ${request.permissionRequestId}`);
        if (persistent && request.holder._tag !== "owner") unexpected.push("persistent option held by agent");
        if (persistent && matches && safe === undefined) noSafePersistent = true;
        if (selected === undefined) rejected.add(request.toolCallId);
        else chosen.push({ request, optionId: selected, ...(persistent ? { destination: safe!.destination } : {}) });
        yield* check(selected !== undefined || denied !== undefined, "permission request has no safe answer");
        yield* owner.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: selected ?? denied! } as never);
      })), Effect.forkIn(scope),
    );
    const reply = yield* (owner.prompt({ requestId: requestId(), agentId: agent.agentId, text } as never) as Effect.Effect<{ deliveryId: string }, unknown>);
    const sent = yield* eventsUntil(owner, mark, "the probe delivery to be sent", (row) => row.event._tag === "DeliverySent" && event<{ deliveryId: string }>(row).deliveryId === reply.deliveryId, options.agentTimeout);
    const afterSent = sent.at(-1)!.sequence;
    yield* eventsUntil(owner, afterSent, "the probe turn to end", (row) => row.agentId === agent.agentId && row.event._tag === "TurnEnded", options.agentTimeout);
    yield* Fiber.interrupt(watcher);
    snapshot();
    yield* check(unexpected.length === 0, unexpected.join("; "));
    const rows = yield* since(owner, mark);
    yield* check(mergedTools(rows, agent).every((tool) => allowed(tool)), "unexpected tool call observed; only the named probe input is allowed");
    return { rows, asked, rejected, chosen, noSafePersistent, deliveryId: reply.deliveryId };
  });

  const askInput = (_agent: AgentRef, marker: string) => (tool: Tool): boolean => mcpAskInput(tool.input, tool.title, marker);
  const askedBy = (rows: ReadonlyArray<EventEnvelope>, agent: AgentRef, marker: string): boolean =>
    tagged(rows, "QuestionAsked", agent.agentId).some((row) => event<{ text: string }>(row).text === marker
      && row.caller?._tag === "agent" && row.caller.agentId === agent.agentId);

  const toolErrors = (calls: ReadonlyArray<Tool>): string => {
    const secrets = [...allTokens, ...options.secrets];
    try { secrets.push(...readOwnerCredentialFrom(options.service().state)); }
    catch { /* Synthetic boundaries have no owner credential; final checks it in a real run. */ }
    return oneLine(redactShapes(redactSecrets(calls.map((tool) => `${tool.status}: ${tool.output || "no error output"}`).join("; "), secrets)), 300);
  };
  const unavailable: NonNullable<ProbeDriver["unavailable"]> = (id, given) => Effect.gen(function* () {
    agents = given;
    if (options.service().exited()) return "the run's service is not up";
    // A bounded real socket round-trip, not just a PID check. An unavailable
    // service prevents this probe; it is not evidence of an adapter failure.
    const reached = yield* Effect.exit(Effect.scoped(Effect.gen(function* () {
      const owner = yield* options.openOwner();
      return yield* since(owner, 0);
    })).pipe(Effect.timeoutOrElse({ duration: options.engineTimeout, orElse: () => Effect.fail(new Error("readiness timed out")) })));
    if (Exit.isFailure(reached)) return "the run's service did not answer the readiness check";
    const history = reached.value;
    if (id === "permission-kinds") return undefined; // Reads existing log evidence only.
    const live = snapshot();
    const state = history.reduce(apply, emptyViews());
    const needed = id === "always-allow" ? [given.lead] : [given.lead, given.worker];
    for (const agent of needed) {
      if (!live.has(agent.agentId)) return `agent ${agent.agentId} has no live process in this run`;
      const lifecycle = state.agents[agent.agentId]?.state._tag;
      if (lifecycle !== "idle") return `agent ${agent.agentId} is ${lifecycle ?? "unknown"}, not idle`;
    }
    return undefined;
  });

  const observe = (id: ProbeId, given: ProbeAgents): Effect.Effect<ReadonlyArray<Observation>, unknown, Scope.Scope> => Effect.gen(function* () {
    agents = given;
    const owner = yield* options.openOwner();
    snapshot();
    if (id === "sandbox-mcp") {
      // PB-A10 already has real evidence. Cite it beside the MCP observation
      // without adding another probe or opening another model session.
      const citations = new Map(["claude", "codex"].map((harness) => {
        const path = fileURLToPath(new URL(`../../../testing/fixtures/${harness}.ndjson`, import.meta.url));
        return [harness, fixtureEvidence(readFileSync(path, "utf8"), harness, path)] as const;
      }));
      const results: Observation[] = [];
      for (const { harness, agent } of members()) {
        const marker = "lcp-mcp-" + randomBytes(8).toString("hex");
        const result = yield* turn(owner, agent, fill(PROBE_MCP_PROMPT, { MARKER: marker }), (tool) => askInput(agent, marker)(tool) || (harness === "claude" && mcpAskDiscovery(tool)));
        yield* check(mergedTools(result.rows, agent).filter(mcpAskDiscovery).length <= 1, "unexpected repeated ask discovery");
        const calls = mergedTools(result.rows, agent).filter(askInput(agent, marker));
        const failed = calls.find((tool) => tool.status === "failed");
        const question = tagged(result.rows, "QuestionAsked").some((row) => event<{ text: string }>(row).text === marker);
        const cancelled = failed !== undefined && /user cancelled MCP tool call/i.test(failed.output ?? "") && !question
          && !tagged(result.rows, "PermissionRequested", agent.agentId).some((row) => event<Permission>(row).toolCallId === failed.callId);
        const outcome = askedBy(result.rows, agent, marker) ? "succeeds" : calls.length === 0 ? "not attempted"
          : cancelled ? ADAPTER_CANCELLED : "attempted; failed";
        results.push({ harness, outcome, detail: `${outcome === "succeeds" ? "authenticated QuestionAsked event with the agent as caller, via its MCP ask tool" : `exact ask tool calls=${calls.length}; errors=${toolErrors(calls)}`}; ${citations.get(harness)}` });
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
        return { harness, outcome: valid ? "recorded" : asked.length > 0 ? "attempted; failed" : "not attempted", detail: kinds.map((option) => `${option.id}/${option.kind}: ${option.level}, persistent=${String(option.persistent)}`).join("; ") || "no observed permission options" };
      });
    }
    if (id === "removed-variables" || id === "state-read") {
      if (id === "state-read") writeFileSync(join(options.service().state, "live-canary"), canary, { mode: 0o600, flag: "wx" });
      const command = id === "removed-variables" ? commands.removedVariables : commands.stateRead;
      const results: Observation[] = [];
      for (const { harness, agent } of members()) {
        const result = yield* turn(owner, agent, fill(id === "removed-variables" ? REMOVED_VARIABLES_PROMPT : STATE_READ_PROMPT, { COMMAND: command }), (tool) => exactCommand(tool.input, command));
        const attempted = mergedTools(result.rows, agent).filter((tool) => exactCommand(tool.input, command));
        const executed = attempted.filter((tool) => ["completed", "failed"].includes(tool.status) && !result.rejected.has(tool.callId));
        const output = executed.map((tool) => tool.output ?? "").join("\n");
        let outcome = attempted.length > 0 ? "attempted; failed" : "not attempted";
        if (id === "removed-variables") {
          if (executed.length > 0) {
            // Owner success remains a failure even if environment evidence is
            // missing; never obscure the security break behind not attempted.
            outcome = exitCodeOf(output) === 0 ? "acts as owner" : !authRefused(output, exitCodeOf(output)) ? "no ancestry refusal observed"
              : harness === "codex" && (!coreConfigured || !shellIdentityAbsent(output)) ? "attempted; failed" : "refused by ancestry check";
          }
        } else if (executed.length > 0) {
          outcome = output.includes(canary) ? "no mechanism: the agent read the canary file"
            : executed.some((tool) => tool.status === "failed" && canaryDenied(tool.output ?? "", join(options.service().state, "live-canary"))) ? "refused" : "attempted; failed";
        }
        const detail = id === "state-read" ? `exact canary command; completed tool calls=${executed.length}; SECURITY.md:51 lists no default deny-read rule`
          : `exact command; completed tool calls=${executed.length}; ${harness === "codex" ? `core inheritance configured=${String(coreConfigured)}; shell identity variable names=${shellIdentityStatus(output)} (SEC-PB-8)` : "both Shephrd variables removed (SEC-PB-5)"}`;
        results.push({ harness, outcome, detail: `${detail}${outcome === "attempted; failed" ? `; errors=${toolErrors(attempted)}` : ""}` });
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
      const text = sessionText(target.harness, target.agent, yield* since(owner, 0), true);
      const compacted = tagged(rows, "TurnEnded", target.agent.agentId).some((row) => event<{ compact: boolean }>(row).compact)
        || compactions(text) !== compactBefore || tagged(rows, "CommandRefused").some((row) => event<{ command: string }>(row).command === "compact");
      const receipt = slashReceipt(receivedUserText(text), reply.deliveryId, payload, compacted);
      const observation = { harness: target.harness, outcome: receipt === "not attempted" ? "attempted; failed" : receipt, detail: `${sender.agentId} -> ${target.agent.agentId}; ${target.harness} receiver only; received its own user session content; delivery ${reply.deliveryId}; compaction boundaries unchanged=${String(!compacted)}` };
      const notApplicable = id === "slash-up" ? { harness: "codex", outcome: "not applicable (no codex parent receiver in this team)", detail: "SEC-PB-2 observes Claude upward only; Codex is the child, whose downward receive path is checked in SEC-PB-7" }
        : { harness: "claude", outcome: "not applicable (no claude child receiver in this team)", detail: "SEC-PB-7 observes Codex downward only; Claude is the parent, whose upward receive path is checked in SEC-PB-2" };
      return id === "slash-up" ? [observation, notApplicable] : [notApplicable, observation];
    }
    if (id === "always-allow") {
      const agent = agents.lead;
      const path = join(options.service().work, ".claude", "settings.local.json");
      const rows = (outcome: string, detail: string): ReadonlyArray<Observation> => [
        { harness: "claude", outcome, detail },
        { harness: "codex", outcome: "not applicable (criterion names Claude only)", detail: "SEC-PB-4 specifies only claude-agent-acp 0.99.1; no persistent answer sent to Codex" },
      ];
      try {
        const directory = realpathSync(join(options.service().work, ".claude"));
        yield* check(directory.startsWith(options.service().work + "/"), "local settings directory is outside the run's work folder");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const settings = (): { permissions?: { allow?: string[] } } => {
        const actual = realpathSync(path);
        if (!actual.startsWith(options.service().work + "/")) throw new Error("settings file is outside the run's work folder");
        try { return JSON.parse(readFileSync(path, "utf8")); }
        catch { throw new Error("local settings JSON cannot be inspected; content is not printed"); }
      };
      let before: { permissions?: { allow?: string[] } };
      try { before = settings(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; before = {}; }
      const result = yield* turn(owner, agent, fill(ALWAYS_ALLOW_PROMPT, { COMMAND: commands.alwaysAllow }), (tool) => commandInFolder(tool, commands.alwaysAllow, options.service().work), true);
      if (result.noSafePersistent) return rows("no safe persistent option offered", "persistent destination absent or outside localSettings/session; rejected before answering always; current public permission contract does not expose the destination");
      const calls = mergedTools(result.rows, agent);
      const failureOutcome = calls.length > 0 ? "attempted; failed" : "not attempted";
      if (calls.length > 0 && result.asked.length === 0) return rows("no persistent permission request observed",
        `exact command observed; permission requests=0; chosen options=0; no always-allow answer was sent; saved scope is unproven; errors=${toolErrors(calls)}`);
      let after: { permissions?: { allow?: string[] } };
      try { after = settings(); } catch { return rows(failureOutcome, `settings.local.json was not written after always allow; errors=${toolErrors(mergedTools(result.rows, agent))}`); }
      const offered = result.asked.flatMap((request) => request.options);
      const persistent = offered.filter((option) => option.persistent && option.kind === "allow_always");
      const scopes = (after.permissions?.allow ?? []).filter((rule) => !(before.permissions?.allow ?? []).includes(rule));
      const safe = result.asked.length > 0 && result.asked.every((request) => request.holder._tag === "owner") && persistent.length === 1
        && result.chosen.length === result.asked.length && result.chosen.every((choice) => choice.destination === "localSettings" || choice.destination === "session") && scopes.length > 0;
      return rows(safe ? "scopes recorded; persistent options routed to owner" : failureOutcome, `${path}; ${offered.map((option) => `${option.id}: ${option.kind}, persistent=${String(option.persistent)}, destination=${option.destination ?? "unknown"}, scope=${option.persistent ? JSON.stringify(scopes) : "one request; no saved rule selected"}`).join("; ")}; saved scopes=${JSON.stringify(scopes)}`);
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
          text: fill(RESTART_ACTIVE_PROMPT, { COMMAND: commands.restartHold, MARKER: markers.get(agent.agentId)! }) } as never);
        const held = yield* eventsUntil(owner, activeMark, "the exact restart hold command (not attempted if declined)", (row) => {
          if (row.agentId === agent.agentId && row.event._tag === "TurnEnded") return true;
          if (row.agentId !== agent.agentId || row.event._tag !== "ThreadItem") return false;
          const tool = event<{ content: Tool }>(row).content;
          return tool._tag === "tool-call" && foregroundCommand(tool.input, commands.restartHold);
        }, options.agentTimeout);
        yield* check(held.at(-1)?.event._tag !== "TurnEnded",
          `not attempted: ${agent.agentId === agents.lead.agentId ? "claude" : "codex"} ended its hold turn without the exact restart command`);
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
        yield* check(called, "attempted; failed: authenticated tool call was not made in a carry-on turn");
        firstPhase.set(agent.agentId, { refused, called });
        yield* eventsUntil(carriedOwner, sent!.sequence, "carry-on turn to settle before the replay probe", (row) => row.agentId === agent.agentId && row.event._tag === "TurnEnded", options.agentTimeout);
      }
      yield* Fiber.interrupt(activeApprovals);
      snapshot();
      const secondTokens = new Map(tokens);
      yield* check(members().every(({ agent }) => secondTokens.has(agent.agentId) && secondTokens.get(agent.agentId) !== oldTokens.get(agent.agentId)), "not attempted: first-reload tokens were not captured before the second restart");
      const mark = yield* head(carriedOwner);
      const pending = new Map<string, string>();
      const pendingText = fill(RESTART_PENDING_PROMPT, { COMMAND: commands.restartHold });

      // These calls use the run's peer agent identities, so the engine itself
      // supplies the same escaped data envelope that it uses for an MCP prompt.
      for (const { agent } of members()) {
        const peer = yield* agentClient(agent.agentId === agents.lead.agentId ? agents.worker : agents.lead);
        const reply = agent.agentId === agents.lead.agentId ? yield* Effect.gen(function* () {
          const asked = yield* (peer.ask({ requestId: requestId(), text: pendingText } as never) as Effect.Effect<{ questionId: string }, unknown>);
          const seen = yield* eventsUntil(carriedOwner, mark, "pending restart question", (row) => row.event._tag === "QuestionAsked" && event<{ questionId: string }>(row).questionId === asked.questionId, options.agentTimeout);
          return { deliveryId: event<{ deliveryId: string }>(seen.at(-1)!).deliveryId };
        }) : yield* (peer.prompt({ requestId: requestId(), agentId: agent.agentId, text: pendingText } as never) as Effect.Effect<{ deliveryId: string }, unknown>);
        pending.set(agent.agentId, reply.deliveryId);
        yield* eventsUntil(carriedOwner, mark, "pending restart delivery", (row) => row.event._tag === "DeliverySent" && event<{ deliveryId: string }>(row).deliveryId === reply.deliveryId, options.agentTimeout);
      }
      const atCrash = yield* since(carriedOwner, mark);
      // A model that answered before the kill provides no replay receipt test.
      yield* check([...pending.values()].every((id) => !atCrash.some((row) => row.event._tag === "DeliveryAccepted" && event<{ deliveryId: string }>(row).deliveryId === id)), "not attempted: restart deliveries were already accepted before SIGKILL");
      yield* restartAndConnectCli();
      const fresh = yield* options.openOwner();
      // Only the known ask tool and one exact replayed hold per agent may
      // be approved after the second restart. Never persist an approval.
      const replayedHolds = new Set<string>();
      const scope = yield* Scope.Scope;
      const approval = yield* (fresh.subscribe({ requestId: requestId(), after: atCrash.at(-1)!.sequence } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
        Stream.filter((row) => row.event._tag === "PermissionRequested"),
        Stream.runForEach((row) => Effect.gen(function* () {
          const agent = members().find((member) => member.agent.agentId === row.agentId)?.agent;
          if (agent === undefined) return;
          const request = event<Permission>(row);
          const history = yield* since(fresh, mark);
          const tool = mergedTools(history, agent).find((candidate) => candidate.callId === request.toolCallId);
          const hold = tool !== undefined && foregroundCommand(tool.input, commands.restartHold);
          const once = allowOnce(request.options.filter((option) => !option.persistent));
          const ok = once !== undefined && tool !== undefined && (askInput(agent, markers.get(agent.agentId)!)(tool)
            || (hold && !replayedHolds.has(agent.agentId)));
          if (ok && hold) replayedHolds.add(agent.agentId);
          if (request.holder._tag !== "owner" && agent.agentId === agents.worker.agentId) {
            const parent = yield* agentClient(agents.lead);
            yield* parent["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id: request.permissionRequestId } } as never);
          }
          if (!ok) restartUnexpected.push(`denied unexpected restart request ${request.permissionRequestId}`);
          const optionId = ok ? once : request.options.find((option) => option.kind.startsWith("reject"))?.id;
          yield* check(optionId !== undefined, "carry-on permission has no safe answer");
          yield* fresh.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: optionId! } as never);
        })), Effect.forkIn(scope),
      );
      const results: Observation[] = [];
      for (const { harness, agent } of members()) {
        const token = secondTokens.get(agent.agentId);
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
        // Recheck the complete interval after reconnect: content can accept a
        // delivery between the pre-kill snapshot and the actual SIGKILL.
        const earlyAcceptance = session !== undefined && history.some((row) => row.event._tag === "DeliveryAccepted" && row.agentId === agent.agentId
          && event<{ deliveryId: string }>(row).deliveryId === pending.get(agent.agentId) && row.sequence < session.sequence);
        const duringRecovery = receipt !== undefined && session !== undefined && receipt.sequence > session.sequence && receipt.requestId === session.requestId
          && !history.some((row) => row.event._tag === "DeliverySent" && event<{ deliveryId: string }>(row).deliveryId === pending.get(agent.agentId) && row.sequence > session.sequence);
        const replay = duringRecovery ? "found" : requeued !== undefined ? "re-send on restart" : "attempted; failed";
        const outcome = !refused ? "old token accepted or refusal not observed" : earlyAcceptance ? "attempted; failed: pending delivery accepted before reload (restart race)"
          : session === undefined || !firstPhase.get(agent.agentId)?.called || replay === "attempted; failed" ? "attempted; failed" : `old token refused; tool succeeds; ${replay}`;
        results.push({ harness, outcome, detail: `SIGKILL own service, owner socket and actual CLI reconnected (PB-A8); ${agent.agentId}, delivery ${pending.get(agent.agentId)}; reload=${String(session !== undefined)}, carry-on tool succeeded in first restart=${String(firstPhase.get(agent.agentId)?.called)}; each restart checks its immediately preceding token; second kill follows DeliverySent; any content acceptance winning that race fails, never counts as replay` });
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
      const ownTokens = agentTokens.get(agent.agentId);
      const ownArguments = [...(agentArguments.get(agent.agentId)?.values() ?? [])];
      const environments = [...(agentEnvironments.get(agent.agentId)?.values() ?? [])].filter((names) => names.length > 0);
      if (!ownTokens?.size || ownArguments.length === 0 || environments.length === 0) return { harness, outcome: "not attempted",
        detail: `own agent tokens=${ownTokens?.size ?? 0}, process argument snapshots=${ownArguments.length}, environment snapshots=${environments.length}; each harness requires its own evidence` };
      const scan = scanTokens([...allTokens], filesFor(harness, agent, rows), [...ownArguments, ...arguments_.values()]);
      return { harness, outcome: scan.leaks.length === 0 ? "not found" : "token found",
        detail: `session files=${scan.files}, own agent tokens=${ownTokens.size}, process argument snapshots=${ownArguments.length}, environment snapshots=${environments.length}; additional run argument snapshots=${arguments_.size}; environment variable names inspected privately, identity values retained only for scanning; paths=${scan.paths.join(",")}${scan.leaks.length > 0 ? `; ${scan.leaks.join("; ")}` : ""}` };
    });
  });
  return { observe, unavailable };
};
