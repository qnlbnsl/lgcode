// This sink receives already-redacted structured lines. Outside the gated
// protocol test mode it also removes arbitrary copied-library causes,
// annotations and method names, preserving only fixed diagnostic categories.
const messages = new Set([
  "debug RPC group enabled", "request failed: defect", "adapter frame dropped: malformed",
  "adapter request refused: unsupported", "permission answer delivery failed",
  "adapter content dropped: no active turn", "adapter update dropped: malformed",
  "runner event dropped: malformed", "runner event dropped: processing failed",
  "mode set-back failed", "account return failed", "account timer release failed",
  "account timer check failed", "leftover process group did not exit",
  "leftover process sweep failed", "unreferenced secret collection failed",
  "delivery dispatch failed", "blocking wait cancellation failed",
  "permission request id collision", "ACP notification handler failed",
  "Dropped an ACP notification that failed to decode",
]);

export const serviceLog = (protocol: boolean, write: (line: string) => void) => (line: string): void => {
  if (protocol) { write(line); return; }
  try {
    const entry = JSON.parse(line) as { timestamp: string; level: string; message: unknown };
    write(JSON.stringify({
      timestamp: entry.timestamp, level: entry.level,
      message: typeof entry.message === "string" && messages.has(entry.message) ? entry.message : "service diagnostic",
    }));
  } catch { write('{"message":"service diagnostic"}'); }
};
