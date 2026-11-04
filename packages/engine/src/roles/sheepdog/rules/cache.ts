import type { RequestUsage } from "../usage.ts";

export interface CacheExpiryInput {
  readonly requestStartedAt?: number | undefined;
  readonly turnStartedAt?: number | undefined;
  readonly turnEndedAt?: number | undefined;
  readonly written5m?: number | undefined;
  readonly written1h?: number | undefined;
  readonly priorWriteExpiry?: number | undefined;
  readonly priorWriteLifetimeMinutes?: number | undefined;
  readonly cacheLifetimeMinutes?: number | undefined;
  readonly used?: number | undefined;
  readonly terminalUsage?: Readonly<Record<string, number>> | undefined;
  readonly transcript?: RequestUsage | undefined;
}
export const cacheLifetime = (input: CacheExpiryInput): number | undefined => {
  const five = input.written5m ?? input.transcript?.cachedWrite5mTokens;
  const hour = input.written1h ?? input.transcript?.cachedWrite1hTokens;
  if ((five ?? 0) > 0) return 5;
  if ((hour ?? 0) > 0) return 60;
  // A split explicitly reporting no write needs evidence of a previous write.
  if (five !== undefined || hour !== undefined) return input.priorWriteLifetimeMinutes;
  return input.priorWriteLifetimeMinutes ?? input.cacheLifetimeMinutes;
};
export const cacheExpiry = (input: CacheExpiryInput): number | undefined => {
  const requestStart = input.requestStartedAt ?? input.transcript?.requestStartedAt;
  const start = requestStart !== undefined && (input.turnEndedAt === undefined || requestStart <= input.turnEndedAt)
    ? requestStart : input.turnStartedAt;
  if (start === undefined || !Number.isFinite(start) || start < 0) return;
  const minutes = cacheLifetime(input);
  if (minutes !== undefined && [5, 60].includes(minutes)) return start + minutes * 60_000;
  // Compatibility with a source that exposes only an already-known expiry.
  // The runtime uses the write's lifetime so later reads renew from their start.
  return input.priorWriteExpiry;
};

export interface CacheActionInput {
  readonly expiry: number | undefined;
  readonly now: number;
  readonly contextTokens: number | undefined;
  readonly floor: number;
  readonly unreadPosts: number;
  readonly compaction: "on" | "off";
  readonly flushLeadMinutes?: number | undefined;
  readonly armed?: boolean;
  readonly boardOn?: boolean;
  readonly idle?: boolean;
  readonly queued?: boolean;
  readonly sent?: boolean;
  readonly capacityHold?: boolean;
  readonly openRequest?: boolean;
  readonly openQuestion?: boolean;
  readonly blockingWait?: boolean;
  readonly compacting?: boolean;
  readonly lastTurnWasCompact?: boolean;
  readonly newerTurn?: boolean;
  readonly ownOpenPost?: boolean;
  readonly role?: string;
  readonly workersWorking?: boolean;
  readonly teamsWorking?: boolean;
}
export const cacheAction = (input: CacheActionInput): "flush" | "compact" | undefined => {
  const { expiry, now } = input;
  if (expiry === undefined || !Number.isFinite(expiry) || !Number.isFinite(now)) return;
  const due = expiry - (input.flushLeadMinutes ?? 2) * 60_000;
  if (now < due || now >= expiry || (!input.armed && now > due)) return;
  if (input.idle === false || input.queued || input.sent || input.capacityHold || input.openRequest || input.openQuestion
    || input.blockingWait || input.compacting || input.lastTurnWasCompact || input.newerTurn) return;
  if (input.boardOn !== false && input.unreadPosts > 0) return "flush";
  if (input.compaction === "on" && input.contextTokens !== undefined && Number.isFinite(input.contextTokens)
    && input.contextTokens >= input.floor) return "compact";
};
