import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

export interface RequestUsage {
  readonly requestStartedAt?: number | undefined;
  readonly inputTokens?: number | undefined;
  readonly cachedReadTokens?: number | undefined;
  readonly cachedWriteTokens?: number | undefined;
  readonly cachedWrite5mTokens?: number | undefined;
  readonly cachedWrite1hTokens?: number | undefined;
  readonly lastWriteLifetimeMinutes?: number | undefined;
}
export const transcriptTailBytes = 256 * 1024;
const sessionFormat = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

// One derived path, never a directory search. Account and folder settings are
// trusted engine state; an invalid session never becomes a path component.
export const transcriptPath = (configHome: string, folder: string, sessionId: string): string | undefined => {
  if (!isAbsolute(configHome) || !isAbsolute(folder) || !sessionFormat.test(sessionId)) return;
  const project = resolve(folder).replace(/[^a-zA-Z0-9]/g, "-");
  // Longer keys carry a harness-specific hash. Refuse rather than search
  // unrelated project folders or guess which account file to open.
  if (project.length > 200) return;
  return join(configHome, "projects", project, `${sessionId}.jsonl`);
};

// Pin each directory descriptor before opening its child. O_NOFOLLOW on just
// the leaf would still follow a substituted projects directory. O_NONBLOCK
// also keeps a FIFO from stalling the service. No input or error is logged.
const openTranscript = (path: string): number => {
  const parts = resolve(path).split(sep).filter(Boolean);
  let directory = openSync(sep, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const part of parts.slice(0, -1)) {
      const next = openSync(`/proc/self/fd/${directory}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(directory);
      directory = next;
    }
    return openSync(`/proc/self/fd/${directory}/${parts.at(-1)!}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } finally { closeSync(directory); }
};

export const readTranscriptUsage = (path: string, sessionId: string): RequestUsage | undefined => {
  if (!sessionFormat.test(sessionId) || !isAbsolute(path) || basename(path) !== `${sessionId}.jsonl`) return;
  let fd: number;
  try { fd = openTranscript(path); } catch { return; }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) return;
    const length = Math.min(stats.size, transcriptTailBytes);
    const offset = stats.size - length;
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const size = readSync(fd, buffer, read, length - read, offset + read);
      if (size === 0) break;
      read += size;
    }
    const rows = buffer.subarray(0, read).toString("utf8").split("\n");
    if (offset > 0) rows.shift(); // The first line may begin outside the tail.
    let latest: RequestUsage | undefined;
    let lastWriteLifetimeMinutes: number | undefined;
    for (const line of rows) {
      let row: Record<string, unknown> | undefined;
      try { row = object(JSON.parse(line)); } catch { continue; }
      if (row?.type !== "assistant") continue;
      const usage = object(object(row.message)?.usage);
      if (usage === undefined) continue;
      const split = object(usage.cache_creation);
      const five = count(split?.ephemeral_5m_input_tokens);
      const hour = count(split?.ephemeral_1h_input_tokens);
      const writtenLifetime = (five ?? 0) > 0 ? 5 : (hour ?? 0) > 0 ? 60 : undefined;
      if (writtenLifetime !== undefined) lastWriteLifetimeMinutes = writtenLifetime;
      else if ((count(usage.cache_creation_input_tokens) ?? 0) > 0) lastWriteLifetimeMinutes = undefined;
      const timestamp = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
      latest = {
        ...(Number.isFinite(timestamp) && timestamp >= 0 ? { requestStartedAt: timestamp } : {}),
        ...(count(usage.input_tokens) === undefined ? {} : { inputTokens: count(usage.input_tokens) }),
        ...(count(usage.cache_read_input_tokens) === undefined ? {} : { cachedReadTokens: count(usage.cache_read_input_tokens) }),
        ...(count(usage.cache_creation_input_tokens) === undefined ? {} : { cachedWriteTokens: count(usage.cache_creation_input_tokens) }),
        ...(five === undefined ? {} : { cachedWrite5mTokens: five }),
        ...(hour === undefined ? {} : { cachedWrite1hTokens: hour }),
        ...(writtenLifetime === undefined && lastWriteLifetimeMinutes !== undefined ? { lastWriteLifetimeMinutes } : {}),
      };
    }
    return latest;
  } catch { return; }
  finally { closeSync(fd); }
};
