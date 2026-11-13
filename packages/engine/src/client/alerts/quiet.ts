import type { QuietHours } from "@lgtm/contracts";

export const quietOverrideKinds: ReadonlySet<string> = new Set(["failure", "account", "client.web-down"]);

export const validQuietHours = (quiet: QuietHours): boolean => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.end) || quiet.start === quiet.end) return false;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: quiet.timeZone }).format(); return true; } catch { return false; }
};
export const quietNow = (quiet: QuietHours, kind: string, now: number): boolean => {
  if (!quiet.enabled || (quietOverrideKinds.has(kind) && quiet.failureOverride)) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: quiet.timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const time = `${parts.find((p) => p.type === "hour")!.value}:${parts.find((p) => p.type === "minute")!.value}`;
  return quiet.start < quiet.end ? time >= quiet.start && time < quiet.end : time >= quiet.start || time < quiet.end;
};
