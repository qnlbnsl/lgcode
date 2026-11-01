import { readFileSync, readlinkSync, statSync } from "node:fs";
import * as Effect from "effect/Effect";
import type { ProcessRow } from "../log/EventLog.ts";

export interface ProcessFacts {
  readonly startTime: string;
  readonly userId: number;
  readonly executable: string;
}
export interface ProcessReader {
  readonly bootId: () => string;
  readonly ownGroupId: () => number;
  readonly facts: (groupId: number) => ProcessFacts | undefined;
}

const statFields = (pid: number) => {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8");
  return text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
};

export const linuxProcessReader: ProcessReader = {
  bootId: () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
  ownGroupId: () => Number(statFields(process.pid)[2]),
  facts: (groupId) => {
    if (!Number.isSafeInteger(groupId) || groupId <= 1) return undefined;
    try {
      const fields = statFields(groupId);
      if (["Z", "X", "x"].includes(fields[0]!) || Number(fields[2]) !== groupId) return undefined;
      const executable = readlinkSync(`/proc/${groupId}/exe`);
      const userId = statSync(`/proc/${groupId}`).uid;
      // Re-read after the other facts, refusing a leader replaced mid-read.
      const after = statFields(groupId);
      if (after[19] !== fields[19] || ["Z", "X", "x"].includes(after[0]!)) return undefined;
      if (fields[19] === undefined) return undefined;
      return { startTime: fields[19], userId, executable };
    } catch { return undefined; }
  },
};

export const macosProcessReader: ProcessReader = {
  bootId: () => { throw new Error("macOS process reader is unsupported"); },
  ownGroupId: () => { throw new Error("macOS process reader is unsupported"); },
  facts: () => { throw new Error("macOS process reader is unsupported"); },
};

export const signalProcessGroup = (groupId: number, signal: "SIGTERM" | "SIGKILL"): void => {
  if (!Number.isSafeInteger(groupId) || groupId <= 1) throw new Error("invalid process group");
  process.kill(-groupId, signal);
};

export const sweepOrphans = (options: {
  readonly rows: ReadonlyArray<ProcessRow>;
  readonly reader: ProcessReader;
  readonly kill: (groupId: number, signal: "SIGTERM" | "SIGKILL") => void;
  readonly graceMillis: number;
  readonly killWaitMillis?: number;
}) => Effect.gen(function* () {
  const { reader } = options;
  const guard = (row: ProcessRow): string | undefined => {
    if (row.bootId !== reader.bootId()) return "boot id differs";
    if (!Number.isSafeInteger(row.groupId) || row.groupId <= 1) return "group id not above 1";
    if (row.groupId === reader.ownGroupId()) return "group id is the engine's own";
    const facts = reader.facts(row.groupId);
    if (facts === undefined) return "process not found";
    if (facts.startTime !== row.startTime) return "start time differs";
    if (facts.userId !== row.userId) return "user differs";
    if (facts.executable !== row.executable) return "executable differs";
    return undefined;
  };
  const signal = (row: ProcessRow, value: "SIGTERM" | "SIGKILL") => {
    try { options.kill(row.groupId, value); }
    catch (error) {
      if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  const results: Array<{ agentId: ProcessRow["agentId"]; groupId: number; outcome: "stopped" | "left-alone"; reason: string }> = [];
  for (const row of options.rows) {
    const reason = guard(row);
    if (reason !== undefined) {
      results.push({ agentId: row.agentId, groupId: row.groupId, outcome: "left-alone", reason });
      continue;
    }
    signal(row, "SIGTERM");
    const deadline = Date.now() + Math.max(0, options.graceMillis);
    while (guard(row) === undefined && Date.now() < deadline) yield* Effect.sleep(Math.min(10, Math.max(0, deadline - Date.now())));
    // Every guard is checked again immediately before escalation. A reused
    // group number belongs to another process and must never be signalled.
    if (guard(row) === undefined) {
      signal(row, "SIGKILL");
      const killDeadline = Date.now() + Math.max(0, options.killWaitMillis ?? 5_000);
      while (guard(row) === undefined && Date.now() < killDeadline) yield* Effect.sleep(Math.min(10, Math.max(0, killDeadline - Date.now())));
      if (guard(row) === undefined) {
        results.push({ agentId: row.agentId, groupId: row.groupId, outcome: "left-alone", reason: "group did not exit" });
        continue;
      }
    }
    results.push({ agentId: row.agentId, groupId: row.groupId, outcome: "stopped", reason: "group stopped" });
  }
  return results;
});
