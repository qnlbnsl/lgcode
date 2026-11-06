import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { connect, type Client } from "@shephrd/client";
import type { AgentId, EventEnvelope } from "@shephrd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { afterEach, expect, vi } from "vitest";
import { firstStall, rolesMain } from "../../scripts/live/rolesRun.ts";
import { createReporter } from "../../scripts/live/reporter.ts";
import { FLUSH_MARKER, ROLES_GROUP, STALL_MARKER, WAVE_MARKER } from "../../scripts/live/rolesPrompts.ts";
import { startLiveService, type LiveService } from "../../scripts/live/service.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

vi.mock("@shephrd/client", async (original) => ({ ...await original<typeof import("@shephrd/client")>(), connect: vi.fn() }));
vi.mock("../../scripts/live/service.ts", () => ({ startLiveService: vi.fn() }));
registerRebuildCheck({ noLog: true });
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const party = (agentId: string) => ({ _tag: "agent", agentId });

// Only the API boundary is scripted. The real roles journey, assertions,
// event subscriptions, report writer, and thread exporter run unchanged.
const api = (fault = "", work = "/tmp/roles-scripted-work") => {
  const rows: EventEnvelope[] = [];
  const posts: string[] = [];
  let future: (() => void) | undefined;
  let stopped = false;
  let origin = 0;
  let firstEnd = 0;
  let settings: Record<string, unknown> = {};
  let time = 1_800_000_000_000;
  const emit = (event: Record<string, unknown>, caller = { _tag: "owner" }): number => {
    const sequence = rows.length + 1;
    rows.push({ sequence, eventId: `event-${sequence}`, occurredAt: time++, caller,
      ...(typeof event.agentId === "string" ? { agentId: event.agentId } : {}),
      event: event._tag === "board.WakeBuilt" ? { carried: [], reminders: [], completions: [], ...event } : event } as unknown as EventEnvelope);
    return sequence;
  };
  const stall = () => {
    emit({ _tag: "board.PostWritten", postId: "obligation", channelId: "direct", author: { _tag: "owner" }, text: STALL_MARKER, reply: "all", to: [party("worker")] });
    emit({ _tag: "board.PostAcknowledged", postId: "obligation", addressee: party("worker") });
    firstEnd = emit({ _tag: "TurnEnded", agentId: "worker", compact: false });
    emit({ _tag: "board.WakeBuilt", wakeId: "reminder", targetAgentId: fault === "other reminder" ? "other" : "worker", reminders: [fault === "missing reminder" ? "other" : "obligation"] });
    emit({ _tag: "DeliveryQueued", delivery: { id: "reminder-delivery", target: "worker", source: { _tag: "piece", namespace: "board", id: "reminder" } } });
    if (fault !== "unaccepted reminder") emit({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: "reminder-delivery" });
    origin = emit({ _tag: "TurnEnded", agentId: "worker", compact: false });
    emit({ _tag: "board.AddresseeResolved", postId: "obligation", addressee: party("worker"), disposition: fault === "early reply" ? "replied" : "no-answer" });
    if (fault === "closed") emit({ _tag: "board.PostClosed", postId: "obligation", outcome: "unanswerable" });
    future = () => {
      if (fault === "later turn" || fault === "stale later turn") origin = emit({ _tag: "TurnEnded", agentId: "worker", compact: false });
      time = rows[origin - 1]!.occurredAt + 600_000 - 3 - (fault === "early timer" ? 1 : 0);
      const triggerSequence = fault === "first turn origin" ? firstEnd : fault === "stale later turn" ? origin - 2 : origin;
      emit({ _tag: "roles.StallNoticePlanned", agentId: "worker", stalledPostId: "obligation", occurrence: 1, triggerSequence });
      emit({ _tag: "board.PostWritten", postId: "nudge", channelId: "direct", author: { _tag: "service", service: "roles.sheepdog" } });
      emit({ _tag: "board.WakeBuilt", targetAgentId: "worker", carried: ["nudge"] });
      const action = { _tag: "roles.StallSeen", agentId: "worker", stalledPostId: "obligation", occurrence: 1, triggerSequence, noticeRecipient: "worker", notice: "sent", postId: "nudge" };
      emit(action);
      if (fault === "duplicate stall") emit(action);
      emit({ _tag: "board.PostWritten", postId: "answer", channelId: "direct", replyToPostId: "obligation", author: party("worker") }, party("worker"));
      emit({ _tag: "board.PostClosed", postId: "obligation", outcome: "answered" });
      emit({ _tag: "TurnEnded", agentId: "worker", compact: false });
    };
  };
  const wave = () => {
    emit({ _tag: "board.ChannelOpened", channelId: "team", kind: "group", group: ROLES_GROUP, anchorAgentId: "lead" });
    emit({ _tag: "board.PostWritten", postId: "orientation", channelId: "team", author: party("lead"), text: JSON.stringify({ marker: "roles-live-orient", agentId: "lead", parent: { _tag: "owner" } }) }, party("lead"));
    emit({ _tag: "board.PostWritten", postId: "wave", channelId: "team", author: party("lead"), reply: "all", to: [party("worker"), party("other")], text: WAVE_MARKER }, party("lead"));
    for (const id of ["worker", "other"]) {
      emit({ _tag: "board.PostAcknowledged", postId: "wave", addressee: party(id) });
      emit({ _tag: "board.PostWritten", postId: `${id}-reply`, channelId: "team", replyToPostId: "wave", author: party(id), text: JSON.stringify({ marker: WAVE_MARKER, agentId: id, parent: party("lead") }) }, party(id));
      emit({ _tag: "board.AddresseeResolved", postId: "wave", addressee: party(id), disposition: "replied", decidingPostId: `${id}-reply` });
    }
    emit({ _tag: "board.PostClosed", postId: "wave", outcome: "answered" });
    emit({ _tag: "board.WakeBuilt", targetAgentId: "lead", completions: ["wave"] });
  };
  const agents = ["lead", "worker", "other"].map((id, index) => ({ agentId: id, role: index === 0 ? "lead" : "worker", harness: index === 0 ? "claude" : "codex",
    parent: index === 0 ? { _tag: "owner" } : party("lead"), groups: [ROLES_GROUP], folder: index === 0 ? work : join(work, `worker-${index}`) }));
  const owner = {
    "roles.settings.get": () => Effect.succeed({ settings }),
    "roles.settings.set": (input: { settings: Record<string, unknown> }) => Effect.sync(() => { settings = input.settings; }),
    "board.post": (input: { text: string }) => Effect.sync(() => { posts.push(input.text); expect(input.text).toBe(STALL_MARKER); stall(); return { postId: "obligation" }; }),
    "debug.compare-views": () => Effect.succeed({ sequence: rows.length, equal: true, differences: [] }),
    "client.snapshot": () => Effect.succeed({ agents: agents.map(agent => ({ agentId: agent.agentId, state: { _tag: "idle" } })), requests: [], questions: [] }),
    "client.roster": () => Effect.succeed({ agents: agents.map(agent => ({ ...agent, state: { _tag: stopped ? "stopped" : "idle" } })) }),
    "client.thread": () => Effect.succeed({ items: [{ sequence: 1, event: { _tag: "TurnEnded" } }] }),
    harnesses: () => Effect.void, accounts: () => Effect.void,
    start: () => Effect.sync(() => { wave(); return { agentId: "lead" }; }),
    stop: () => Effect.sync(() => { stopped = true; }),
    subscribe: ({ after }: { after: number }) => Stream.unfold(after, cursor => Effect.sync(() => {
      // A blocking read at the end of the preparation observes the later
      // timer and reply. Bounded catch-up reads stop at their captured head.
      if (cursor >= rows.length && future !== undefined) { const next = future; future = undefined; next(); }
      const row = rows.find(row => row.sequence > cursor);
      return row === undefined ? undefined : [row, row.sequence] as const;
    })),
  } as unknown as Client;
  return { owner, rows, posts, get origin() { return origin; } };
};

for (const fault of ["", "later turn", "missing reminder", "other reminder", "unaccepted reminder", "early reply", "closed", "first turn origin", "stale later turn", "early timer", "duplicate stall"]) {
  it.effect(`first-stall ${fault || "accepts the reminder and no-answer before timing the nudge"}`, () => Effect.gen(function* () {
    const rig = api(fault);
    const notes: string[] = [];
    const reporter = createReporter(line => notes.push(line));
    const fiber = yield* firstStall(rig.owner, "worker" as AgentId, 1000, reporter).pipe(Effect.exit, Effect.forkChild);
    yield* TestClock.adjust("5 seconds");
    const result = yield* Fiber.join(fiber);
    expect(result._tag).toBe(fault === "" || fault === "later turn" ? "Success" : "Failure");
    if (result._tag === "Failure") {
      const reason = ["missing reminder", "other reminder", "unaccepted reminder", "early reply"].includes(fault)
        ? "the worker did not finish the board reminder with a no-answer disposition"
        : fault === "closed" ? "the worker did not leave a genuine idle unanswered obligation"
        : fault === "duplicate stall" ? "the first-stall scenario recorded other than one stall action"
        : "the first stall did not wait production minutes after the worker became idle";
      expect(Cause.squash(result.cause)).toEqual(new Error(reason));
    }
    if (result._tag === "Success") {
      expect(notes.join("\n")).toContain("no-answer sequence");
      expect(notes.join("\n")).toContain(`origin sequence ${rig.origin}; elapsed 60000`);
    }
  }));
}

it("--skip-timed-flush skips only that step, completes first-stall and exports, and exits incomplete", async () => {
  const root = mkdtempSync("/tmp/shephrd-roles-run-test-"); roots.push(root);
  const work = join(root, "work"); const state = join(root, "state");
  mkdirSync(work); mkdirSync(state);
  writeFileSync(join(state, "owner-credential"), "synthetic-roles-owner-credential");
  const rig = api("", work);
  vi.mocked(connect).mockReturnValue(Effect.succeed(rig.owner) as ReturnType<typeof connect>);
  const stop = vi.fn(async () => []);
  vi.mocked(startLiveService).mockReturnValue({ root, work, state, pid: 0, exited: () => false, stop } as unknown as LiveService);
  vi.spyOn(process, "cwd").mockReturnValue(root);
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { output.push(String(chunk)); return true; });
  // The real journey keeps its two five-second stability observations.
  expect(await rolesMain(["--skip-timed-flush"], { PATH: "" })).toBe(1);
  const text = output.join("");
  expect(rig.posts).toEqual([STALL_MARKER]);
  expect(rig.posts).not.toContain(FLUSH_MARKER);
  expect(text).toContain("SKIP timed-flush:");
  expect(text).toContain("PASS first-stall:");
  expect(text).toContain("PASS wrap-up:");
  expect(text).toContain("PASS shutdown:");
  expect(text).toContain("Result: INCOMPLETE.");
  expect(text).not.toContain("Result: PASS.");
  expect(stop).toHaveBeenCalledOnce();
  const archive = join(root, ".scratch/live-check-roles");
  const report = readFileSync(join(archive, readdirSync(archive)[0]!, "report.md"), "utf8");
  expect(report).toContain("SKIP timed-flush:");
  expect(report).toContain("Result: INCOMPLETE.");
}, 30_000);

it("help and dry-run document the skip and unknown arguments cannot start a run", async () => {
  const start = vi.mocked(startLiveService); start.mockClear();
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { output.push(String(chunk)); return true; });
  expect(await rolesMain(["--dry-run", "--skip-timed-flush"], {})).toBe(0);
  expect(output.join("")).toContain("SKIP timed-flush:");
  expect(output.join("")).not.toContain(`Owner's later board post: ${FLUSH_MARKER}`);
  output.length = 0;
  expect(await rolesMain(["--help"], {})).toBe(0);
  expect(output.join("")).toContain("--skip-timed-flush");
  expect(await rolesMain(["--skip-timed-flush", "--typo", "--help"], {})).toBe(2);
  expect(start).not.toHaveBeenCalled();
});
