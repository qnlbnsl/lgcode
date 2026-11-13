import { gitReviewSample } from "../../contracts/test/gitReviewFixtures.ts";
import { CommandsRpcGroup, commandAccess, ownerOnlyCommands } from "@lgtm/contracts";
import { afterEach, expect, it } from "vitest";
import { action, roleFile, roleFileContent, roleFileHash } from "../../contracts/test/roles/fixtures.ts";
import {
  agentEnvironment, assertNoSecrets, chunk, cleanupUnit7b, fakeEngine, finishCli, mcpPeer, prepareRoot, serviceEnvironment, startCli, succeed, token,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

const commandWords = (command: string) => command === "debug.compare-views" ? [command] : command.replaceAll(".", " ").split(" ");
const invocations = [...CommandsRpcGroup.requests.keys()].flatMap((command) => [
  { command, words: commandWords(command), form: "spaced" },
  ...(command.includes(".") && command !== "debug.compare-views" ? [{ command, words: [command], form: "dotted" }] : []),
]);

// Inventory comes from the RPC group, never from a second CLI-maintained list.
for (const { command, words, form } of invocations) {
  it(`P01 ${command} ${form} (7.5) catches omitting this RPC's lgtm subcommand/help registration`, async () => {
    const child = startCli(prepareRoot(), [...words, "--help"]);
    expect(await finishCli(child)).toEqual({ code: 0, signal: null });
    expect(child.stdout()).toMatch(/usage|options|arguments/i);
    expect(child.stdout()).toContain(words.join(" "));
    expect(child.stdout()).not.toContain("not built yet");
    assertNoSecrets(child, [token]);
  });
}

// Full payload parity has a compact escape hatch: every non-secret RPC accepts
// --input JSON. Friendly wait/subscribe flags are separately exercised.
for (const { command, words, form } of invocations) {
  if (command === "accounts set-secret" || command === "client.alerts.carrier.set-token") continue; // Dedicated tests check stdin-only dispatch.
  it(`P03 ${command} ${form} catches a registered CLI command dispatching the wrong RPC or dropping payload fields`, async () => {
    const root = prepareRoot();
    const payloads: Record<string, Record<string, unknown>> = {
      "client.alerts.retry": { alertId: "alert-1", generation: 7, attempt: 2 },
      "client.alerts.test": {}, "client.alerts.prompt.dismiss": {},
      "client.alerts.list": { after: 0, limit: 1, status: "open" },
      "client.alerts.dismiss": { alertId: "alert-1" },
      "client.alerts.settings": {},
      "client.alerts.settings.set": { kind: "approval", push: false },
      "client.alerts.carrier.set": { carrier: { _tag: "ntfy", server: "https://push.example", topic: "owner_alerts" } },
      "client.alerts.carrier.clear-token": {},
      "client.alerts.carrier.remove": { name: "email" },
      start: { name: "Parity agent", role: "worker", harness: "fake", account: { _tag: "any" }, permission: "ask", folder: root.work, groups: ["review"], model: "small", effort: "low", prompt: "Check parity." },
      configure: { agentId: "member", model: "small", effort: "low" },
      "client.harness.choices": { harnessId: "fake", accountId: "account", model: "small", refresh: true },
      "client.agent.configuration": { agentId: "member" },
      "client.agent.context": { agentId: "member" },
      prompt: { agentId: "member", text: "A prompt with spaces." },
      answer: { kind: "question", id: "question", text: "The answer." },
      "pass-up": { subject: { _tag: "question", id: "question" } },
      ask: { text: "A question?" },
      wait: { members: ["member"], mode: "all", block: false },
      "cancel-reply": { agentId: "member" }, release: { agentId: "member" }, stop: { agentId: "member" }, resume: { agentId: "member", fresh: true }, compact: { agentId: "member" },
      group: { agentId: "member", add: ["review"], remove: ["build"] },
      accounts: { operation: "list" }, "accounts mark-available": { accountId: "account" },
      "client.alerts.quiet.set": { quiet: { enabled: true, start: "22:00", end: "07:00", timeZone: "America/Chicago", failureOverride: true } },
      "client.alerts.carrier.enabled.set": { name: "email", enabled: false },
      "client.web.settings": {},
      "client.web.settings.set": { settings: { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false } },
      harnesses: { operation: "list" }, subscribe: { after: 100 }, "debug.compare-views": {},
      "client.snapshot": {}, "client.roster": { group: "review", role: "worker", parent: "lead" },
      "client.thread": { agentId: "member", after: 100, limit: 500 },
      "client.requests": { after: 0, limit: 20, status: "answered" }, "client.event": { sequence: 101 }, "client.sequence": {},
      "client.subscribe": { after: 100, filter: { agents: ["member"], kinds: ["TurnEnded"] } },
      "board.open": { name: "Review", group: "review", anchorAgentId: "member" },
      "board.members": { channelId: "channel", add: ["member"], remove: ["former"] },
      "board.post": { channelId: "channel", text: "Which option?", to: [{ _tag: "agent", agentId: "member" }], reply: "all", replyTo: "earlier-post" },
      "board.close": { postId: "post" },
      "board.acknowledge": { postId: "post" },
      "board.read": { channelId: "channel", after: "cursor", limit: 20 },
      "board.peek": { channelId: "channel", after: "cursor", limit: 20 },
      "board.channels": { after: "cursor", limit: 20 },
      "board.status": { agentId: "member" },
      "board.flush": { agentId: "member" },
      "project.creation.abandon": { creationRequestId: "creation" },
      "project.repository.discover": {},
      "project.branches": {"repoId": "repo"},
      "project.checkouts": {"repoId": "repo"},
      "project.stage": {"worktreeId": "workspace", "projectId": "project", "path": "src/app.ts"},
      "project.unstage": {"worktreeId": "workspace", "projectId": "project", "path": "src/app.ts"},
      "project.stage.all": {"worktreeId": "workspace", "projectId": "project"},
      "project.unstage.all": {"worktreeId": "workspace", "projectId": "project"},
      "project.discard.plan": {"worktreeId": "workspace", "projectId": "project", "paths": ["src/app.ts"]},
      "project.discard": {"worktreeId": "workspace", "projectId": "project", "plan": {"fingerprint": "fingerprint", "paths": ["src/app.ts"]}, "confirmed": true},
      "project.commit": {"worktreeId": "workspace", "projectId": "project", "message": "Commit real changes"},
      "project.fetch": {"worktreeId": "workspace", "projectId": "project"},
      "project.pull": {"worktreeId": "workspace", "projectId": "project"},
      "project.push": {"worktreeId": "workspace", "projectId": "project"},
      "project.integrate": {"worktreeId": "workspace", "projectId": "project", "destinationId": "project-workspace", "expectedHead": "abc123"},
      "project.update": {worktreeId: "workspace", destinationId: "base", expectedHead: "abc123"},
      "project.merge.abort": {worktreeId: "workspace", expectedHead: "abc123", expectedMergeHead: "def456", confirmed: true},
      "project.conflict.resolved": {worktreeId: "workspace"},
      "project.conflict.reopen": {worktreeId: "workspace", path: "src/app.ts", expectedHead: "abc123", expectedMergeHead: "def456", fingerprint: "fingerprint", confirmed: true},
      "project.review.decline": {worktreeId: "workspace", projectId: "project", reviewId: "review", expectedHead: "abc123", expectedBaseHead: "def456", reason: "Add coverage."},
      "project.review.report": {worktreeId: "workspace", projectId: "project", head: "abc123", kind: "tests", status: "failed", summary: "Actual report", threadAgentId: "lead", threadSequence: 1},
      "project.review.prepare": {worktreeId: "workspace", projectId: "project", destinationId: "base"},
      "project.review.status": {worktreeId: "workspace", projectId: "project"},
      "project.review.approve": {worktreeId: "workspace", projectId: "project", reviewId: "review", expectedHead: "abc123", expectedBaseHead: "def456", confirmed: true, decision: "approve_without_evidence"},
      "project.conflict.choose": {"worktreeId": "workspace", "projectId": "project", "selection": {"path": "src/app.ts", "head": "abc123", "fingerprint": "fingerprint", "choices": ["ours"]}, "hunk": 0, "choice": "both"},
      "project.conflict.resolve": {"worktreeId": "workspace", "projectId": "project", "selection": {"path": "src/app.ts", "head": "abc123", "fingerprint": "fingerprint", "choices": ["ours"]}},
      "project.changes": {"worktreeId": "workspace", "projectId": "project"},
      "project.diff": {"worktreeId": "workspace", "projectId": "project", "path": "src/app.ts", "staged": true},
      "project.history": {"worktreeId": "workspace", "projectId": "project", "limit": 20},
      "project.commit.files": {"worktreeId": "workspace", "projectId": "project", "commit": "abc123"},
      "project.git.state": {"worktreeId": "workspace", "projectId": "project", "target": "main"},
      "project.review": {"worktreeId": "workspace", "projectId": "project", "base": "main"},
      "project.conflict": {"worktreeId": "workspace", "projectId": "project", "path": "src/app.ts"},
      "project.setup": {}, "project.setup.discover": {}, "project.setup.advance": { step: "found" }, "project.setup.complete": { projectId: "project" },
      "project.placement.preview": { name: "Console", goal: "Plan", machineId: "local", repository: { _tag: "new", name: "New" } },
      "project.mocks.record": { projectId: "project", expectedRevision: "before", bundle: { sources: [], screens: [], scenarios: [], draftedFields: [], components: [] } },
      "project.mocks.read": { projectId: "project", after: "before", limit: 1 },
      "project.mocks.artifact": { projectId: "project", revisionId: "before", sourceId: "source" },
      "project.mocks.approve": { projectId: "project", revisionId: "before" },
      "project.design.record": { projectId: "project", design: { repoId: "repo", worktreeId: "workspace", file: "design/actual.fig", components: [] } },
      "project.design.read": { repoId: "repo", projectId: "project", revisionId: "before" },
      "project.settings": {},
      "project.settings.set": { settings: { workspaceFolder: root.work, shell: "zsh" } },
      "project.repository.add": { name: "Product", path: root.work, machineId: "local" },
      "project.repository.locate": { repoId: "repo", machineId: "local", path: root.work },
      "project.repositories": { after: "repo", limit: 20 },
      "project.workspace.register": { repoId: "repo", machineId: "local", branch: "main", path: root.work, checkout: "main" },
      "project.workspaces": { repoId: "repo", after: "workspace", limit: 20 },
      "project.create": { repository: { _tag: "existing", repoId: "repo" }, name: "Console", goal: "Track work", machineId: "local", useWorktree: true },
      "project.creations": { limit: 20 },
      "project.context.search": { projectId: "project", worktreeId: "workspace", query: "file", limit: 20 },
      "project.goal.set": { projectId: "project", goal: "New goal" },
      "project.archive": { projectId: "project" },
      "project.restore": { projectId: "project" },
      "project.rename": { projectId: "project", name: "Renamed" },
      "project.place": { projectId: "project", worktreeId: "workspace" },
      "project.preferences.set": { projectId: "project", shell: "zsh" },
      "project.stage.set": { projectId: "project", stage: "build" },
      "project.read": { projectId: "project", collection: "tasks", after: "task", limit: 20 },
      "project.team.create": { projectId: "project", name: "Build", worktreeId: "workspace", stage: "build", area: "Console" },
      "project.sprint.create": { projectId: "project", label: "SP-01", name: "Foundation", goal: "Store work", phase: "Build", owner: "lead", needs: [] },
      "project.sprint.update": { projectId: "project", sprintId: "sprint", phase: "Review", needs: [] },
      "project.sprint.complete": { projectId: "project", sprintId: "sprint", completion: "verified", evidence: "Tests passed at abc123" },
      "project.task.create": { projectId: "project", title: "Work", owner: "member", teamId: "team", sprintId: "sprint", state: "queue", worktreeId: "workspace" },
      "project.task.update": { projectId: "project", taskId: "task", state: "review", note: "Ready" },
      "project.task.note": { projectId: "project", taskId: "task", title: "Handoff", detail: "Review it" },
      "project.requests": { projectId: "project", status: "open", after: "1", limit: 20 },
      "project.task.history": { projectId: "project", taskId: "task", after: "0", limit: 20 },
      "roles.orient": {}, "roles.handoff": { agentId: "member" },
      "roles.role-file.set": { content: roleFileContent }, "roles.role-file.get": {},
      "roles.settings.get": {}, "roles.settings.set": { settings: { stallWatch: true, limits: { stallMinutes: 10 } } },
      "roles.snooze": { group: "review", until: 1_900_000_000_000 },
      "roles.actions.list": { agentId: "member", after: 100, limit: 20 },
      "roles.record": { action: { _tag: "roles.StallSeen", ...action, agentId: "member" } },
    };
    expect(payloads[command], "new RPC needs a command dispatch fixture").toBeDefined();
    const payload = { requestId: `parity-${command}`, ...payloads[command] };
    let expectedReply: unknown;
    const engine = await fakeEngine(root, { onRequest: (frame, socket) => {
      const base = { requestId: frame.payload.requestId };
      const replies: Record<string, unknown> = {
        "client.alerts.retry": { ...base, accepted: true }, "client.alerts.test": { ...base, accepted: false, reason: "token missing" },
        "client.alerts.list": { ...base, items: [], next: 10 },
        "client.alerts.settings": { ...base, kinds: [{ kind: "approval", push: false }], carrier: { _tag: "none" }, tokenSet: false },
        start: { ...base, agentId: "member" }, prompt: { ...base, deliveryId: "delivery" },
        "client.harness.choices": { ...base, harnessId: "fake", accountId: "account", models: { source: "negotiated", options: [{ id: "small", label: "Small" }] }, efforts: { source: "negotiated", options: [{ id: "low" }] } },
        "client.agent.configuration": { ...base, agentId: "member", configuration: { desired: { model: "small", effort: "low" }, applied: { model: "small", effort: "low" }, status: "applied" },
          models: { source: "negotiated", options: [{ id: "small", label: "Small" }] }, efforts: { source: "configured", options: [{ id: "low" }] } },
        "client.agent.context": { ...base, agentId: "member", context: { _tag: "available", used: 25, window: 100, percent: 25, reportedAt: 1_800_000_000_000, model: "small" } },
        compact: { ...base, deliveryId: "delivery" }, ask: { ...base, questionId: "question" },
        wait: { ...base, waitId: "wait", members: [{ agentId: "member", reason: "settled" }], outcome: "satisfied" },
        accounts: { ...base, accounts: [] }, harnesses: { ...base, harnesses: [] },
        "client.web.settings": { ...base, enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false, serverState: "running" },
        "debug.compare-views": { ...base, sequence: 100, equal: true, differences: [] },
        "client.snapshot": { ...base, sequence: 100, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 },
        "client.roster": { ...base, agents: [] }, "client.thread": { ...base, items: [] },
        "client.requests": { ...base, sequence: 100, items: [] },
        "client.sequence": { ...base, sequence: 100 },
        "client.event": { ...base, envelope: { sequence: 101, eventId: "parity-event", occurredAt: 1_800_000_000_000, caller: { _tag: "owner" }, agentId: "member", event: { _tag: "TurnEnded", agentId: "member", compact: false } } },
        "board.open": { ...base, channelId: "channel" },
        "board.members": { ...base, memberCount: 1 },
        "board.post": { ...base, postId: "post" },
        "board.close": { ...base, postId: "post", outcome: "withdrawn" },
        "board.acknowledge": { ...base, postId: "post" },
        "board.read": { ...base, data: `Data from another agent [boundary] (delivery read):\n${JSON.stringify({ items: [{ text: '"\\\n\t🐑' }] })}\nEnd data [boundary]` },
        "board.peek": { ...base, items: [], next: "next-cursor" },
        "board.channels": { ...base, items: [], next: "next-cursor" },
        "board.status": { ...base, agentId: "member", unread: 1, incomingOpen: 1, ownOpen: 0, owed: 0, failedCompletions: 0, wakeQueued: true, wakeSent: false, holdsUnsettled: false, holdsIncoming: true, sequence: 100, disabled: false },
        "board.flush": { ...base, wakeId: "wake" },
        "project.repository.discover": { ...base, result: { items: [], truncated: false } },
        "project.branches": { ...base, result: { items: [], truncated: false } },
        "project.checkouts": { ...base, result: { items: [], truncated: false } },
        "project.changes": { ...base, result: { items: [], truncated: false } },
        "project.history": { ...base, result: { items: [], truncated: false } },
        "project.commit.files": { ...base, result: { items: [], truncated: false } },
        "project.diff": { ...base, result: { patch: "patch", additions: 1, deletions: 0, binary: false, truncated: false } },
        "project.git.state": { ...base, result: { head: "abc123", branch: "feature", upstream: null, mergeHead: null, ahead: 0, behind: 0, pending: 0, pendingSince: null } },
        "project.discard.plan": { ...base, result: { fingerprint: "fingerprint", paths: ["src/app.ts"] } },
        "project.commit": { ...base, result: { head: "abc123" } },
        "project.integrate": { ...base, result: { head: "abc123" } },
        "project.update": { ...base, result: { head: "abc123" } },
        "project.conflict.resolved": { ...base, result: { items: [{ path: "src/app.ts", fingerprint: "fingerprint" }], truncated: false } },
        "project.review.decline": { ...base, result: { ...gitReviewSample, outcome: "sent_back", reason: "Add coverage.", decidedAt: 2000 } },
        "project.review.prepare": { ...base, result: { review: gitReviewSample, comparison: { head: "abc123", baseHead: "def456", branch: "feature", base: "main", commits: { items: [], truncated: false }, files: { items: [], truncated: false }, diff: { patch: "", additions: 0, deletions: 0, binary: false, truncated: false } } } },
        "project.review.status": { ...base, result: { review: gitReviewSample, evidence: gitReviewSample.evidence } },
        "project.review.approve": { ...base, result: { ...gitReviewSample, outcome: "merged", decision: "approve_without_evidence", mergeHead: "abc123", decidedAt: 2000 } },
        "project.conflict": { ...base, result: { path: "src/app.ts", head: "abc123", fingerprint: "fingerprint", choices: ["ours"], ours: "ours", base: "base", theirs: "theirs", segments: [] } },
        "project.conflict.choose": { ...base, result: { path: "src/app.ts", head: "abc123", fingerprint: "fingerprint", choices: ["ours"], ours: "ours", base: "base", theirs: "theirs", segments: [] } },
        "project.review": { ...base, result: { head: "abc123", baseHead: "def456", branch: "feature", base: "main", commits: { items: [], truncated: false }, files: { items: [], truncated: false }, diff: { patch: "", additions: 0, deletions: 0, binary: false, truncated: false } } },
        "project.setup": { ...base, setup: { step: "found" } },
        "project.setup.discover": { ...base, result: { state: "available", repositories: [], truncated: false, harnesses: [] } },
        "project.placement.preview": { ...base, result: { repositoryPath: root.work, path: root.work, branch: "main", checkout: "main", reserved: false } },
        "project.mocks.record": { ...base, revisionId: "revision" },
        "project.design.record": { ...base, revisionId: "revision" },
        "project.design.read": { ...base, result: { _tag: "unavailable", reason: "repository design is not registered" } },
        "project.mocks.read": { ...base, items: [] },
        "project.mocks.artifact": { ...base, result: { _tag: "unavailable", reason: "artifact unavailable" } },
        "project.settings": { ...base, settings: { workspaceFolder: root.work, shell: "zsh" } },
        "project.repository.add": { ...base, repoId: "repo" },
        "project.creations": { ...base, items: [] },
        "project.context.search": { ...base, result: { items: [], truncated: false } },
        "project.repositories": { ...base, items: [], next: "repo" },
        "project.workspace.register": { ...base, worktreeId: "workspace" },
        "project.workspaces": { ...base, items: [], next: "workspace" },
        "project.create": { ...base, projectId: "project" },
        "project.read": { ...base, data: "Data from another agent [project-boundary] (delivery read):\n{\"items\":[]}\nEnd data [project-boundary]" },
        "project.team.create": { ...base, teamId: "team", channelId: "channel", group: "team:project/team" },
        "project.sprint.create": { ...base, sprintId: "sprint" },
        "project.task.create": { ...base, taskId: "task" },
        "project.requests": { ...base, data: "Data from piece project [requests] (delivery read):\n{\"items\":[]}\nEnd data [requests]" },
        "project.task.history": { ...base, data: "Data from another agent [history-boundary] (delivery read):\n{\"items\":[]}\nEnd data [history-boundary]" },
        "roles.orient": { ...base, name: "Member", kind: "worker", advice: "Report to your lead." },
        "roles.handoff": { ...base, agentId: "member", text: "Continue the assigned work." },
        "roles.role-file.set": { ...base, roleFileHash }, "roles.role-file.get": { ...base, file: roleFile, roleFileHash },
        "roles.settings.get": { ...base, settings: { stallWatch: true, limits: { stallMinutes: 10 } } },
        "roles.settings.set": base, "roles.snooze": base,
        "roles.actions.list": { ...base, items: [] },
        "roles.record": { ...base, sequence: 101 },
      };
      if (frame.tag === "subscribe" || frame.tag === "client.subscribe") {
        chunk(socket, frame, [{ sequence: 101, eventId: "parity-event", occurredAt: 1_800_000_000_000,
          caller: { _tag: "agent", agentId: "member" }, agentId: "member", event: { _tag: "TurnEnded", agentId: "member", compact: false } }]);
        succeed(socket, frame, undefined);
      } else {
        expectedReply = replies[frame.tag] ?? base;
        succeed(socket, frame, expectedReply);
      }
    } });
    const environment = (commandAccess[command as keyof typeof commandAccess] as ReadonlyArray<string>).includes("agent") ? agentEnvironment(root) : serviceEnvironment(root);
    const child = startCli(root, [...words, "--input", JSON.stringify(payload)], environment);
    expect(await finishCli(child)).toEqual({ code: 0, signal: null });
    expect(engine.requests).toHaveLength(1);
    expect(engine.requests[0]).toMatchObject({ _tag: "Request", tag: command, payload });
    if (command.startsWith("roles.") || command.startsWith("project.") && command !== "project.read" && command !== "project.task.history" && command !== "project.requests") expect(JSON.parse(child.stdout())).toEqual(expectedReply);
    if (["board.read", "project.read", "project.task.history", "project.requests"].includes(command)) expect(child.stdout()).toBe((expectedReply as { data: string }).data + "\n");
    if (command === "configure" || command.startsWith("client.agent.")) expect(JSON.parse(child.stdout())).toEqual(expectedReply);
    assertNoSecrets(child, [token]);
  });
}

it("P02 (7.5) catches MCP omitting an agent command, adding an unreviewed/owner/stream/secret tool, or listing duplicates", async () => {
  const root = prepareRoot();
  await fakeEngine(root);
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  const reply = await peer.request("tools/list");
  expect(reply.error).toBeUndefined();
  const tools = reply.result.tools as Array<{ name: string; description?: string }>;
  for (const tool of tools) {
    expect(tool.description, `${tool.name} must describe its purpose in tools/list`).toBeTypeOf("string");
    expect(tool.description!.trim().length, `${tool.name} purpose must be meaningful`).toBeGreaterThan(10);
  }
  expect(tools.find((tool) => tool.name === "release")?.description).toMatch(/release.*capacity hold/i);
  const names = tools.map((tool) => tool.name);
  // Row 55's explicit allow-list is intentional: adding a new agent command
  // needs review, and the CLI inventory above independently catches additions.
  expect([...names].sort()).toEqual([
    "answer", "ask", "board.acknowledge", "board.channels", "board.close", "board.members",
    "board.open", "board.post", "board.read", "board.status", "cancel-reply", "client.event", "client.roster", "client.snapshot", "client.thread", "compact", "group", "pass-up", "project.changes", "project.commit.files", "project.conflict", "project.context.search", "project.design.read", "project.design.record", "project.diff", "project.git.state", "project.history", "project.mocks.artifact", "project.mocks.read", "project.mocks.record", "project.read", "project.requests", "project.review", "project.review.report", "project.review.status", "project.sprint.complete", "project.sprint.create", "project.sprint.update", "project.stage.set", "project.task.create", "project.task.history", "project.task.note", "project.task.update", "project.team.create", "prompt", "release", "resume", "roles.handoff", "roles.orient", "start", "stop", "wait",
  ]);
  expect(new Set(names).size).toBe(names.length);
  const nonAgent = Object.entries(commandAccess).filter(([, kinds]) => !(kinds as ReadonlyArray<string>).includes("agent")).map(([name]) => name);
  for (const excluded of ["subscribe", "accounts set-secret", "accounts mark-available", "debug.compare-views", "board.flush", "client.alerts.list", "client.alerts.dismiss", "client.alerts.settings", "client.alerts.settings.set", ...ownerOnlyCommands, ...nonAgent]) {
    expect(names).not.toContain(excluded);
  }
  assertNoSecrets(child, [token]);
});

it("board.read MCP forwards the complete labelled data without changing its escapes or boundaries", async () => {
  const root = prepareRoot();
  const data = `Data from piece board [mcp-boundary]\n${JSON.stringify({ items: [{ text: '"\\\n\t🐑' }] })}\nEnd data [mcp-boundary]`;
  const engine = await fakeEngine(root, { onRequest: (frame, socket) => succeed(socket, frame, { requestId: frame.payload.requestId, data }) });
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  const reply = await peer.request("tools/call", { name: "board.read", arguments: { channelId: "channel", limit: 20 } });
  expect(reply.error).toBeUndefined();
  expect(reply.result.isError ?? false).toBe(false);
  expect(reply.result.content).toEqual([{ type: "text", text: data }]);
  expect(engine.requests).toHaveLength(1);
  expect(engine.requests[0]).toMatchObject({ tag: "board.read", payload: { channelId: "channel", limit: 20 } });
});
