// This sink receives already-redacted structured lines. Outside the gated
// protocol test mode it also removes arbitrary copied-library causes,
// annotations and method names, preserving only fixed diagnostic categories.
const messages = new Set([
  "piece table failed",
  "web server disabled: web password is unset or shorter than eight characters",
  "web server status could not be recorded",
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

// Fix round 2, F-2: the first-start warning names the harness adapters that
// were not found. Only the four default ids, each once and in the defaults'
// order, are allowed, so the line holds no text the sink has not fixed.
const missingAdapters = /^harness adapters not found: (?:claude|codex|gemini|cursor)(?:, (?:claude|codex|gemini|cursor))*$/;
const fixedMessage = (message: unknown): boolean => {
  if (typeof message !== "string") return false;
  if (messages.has(message)) return true;
  if (!missingAdapters.test(message)) return false;
  const ids = message.slice("harness adapters not found: ".length).split(", ");
  const order = ["claude", "codex", "gemini", "cursor"];
  return new Set(ids).size === ids.length && ids.every((id, index) => index === 0 || order.indexOf(id) > order.indexOf(ids[index - 1]!));
};

const pieceNamespaces = new Set(["client", "board", "roles", "project"]);
const pieceTables = new Set(["views", "snapshotSections", "pieceVisibility", "reach", "holdUnsettled", "requestHeld", "sourceRules", "secretKeep", "alertSources", "openMatters"]);
const errorClasses = new Set(["TypeError", "RangeError", "SyntaxError", "ReferenceError", "Error", "Unknown"]);
const pieceAnnotations = (message: unknown, value: unknown) => {
  if (message !== "piece table failed" || value === null || typeof value !== "object") return {};
  const { namespace, table, errorClass } = value as Record<string, unknown>;
  if (typeof namespace !== "string" || !pieceNamespaces.has(namespace)
    || typeof table !== "string" || !pieceTables.has(table)
    || typeof errorClass !== "string" || !errorClasses.has(errorClass)) return {};
  return { annotations: { namespace, table, errorClass } };
};

export const serviceLog = (protocol: boolean, write: (line: string) => void) => (line: string): void => {
  if (protocol) { write(line); return; }
  try {
    const entry = JSON.parse(line) as { timestamp: string; level: string; message: unknown; annotations?: unknown };
    write(JSON.stringify({
      timestamp: entry.timestamp, level: entry.level,
      message: fixedMessage(entry.message) ? entry.message : "service diagnostic",
      ...pieceAnnotations(entry.message, entry.annotations),
    }));
  } catch { write('{"message":"service diagnostic"}'); }
};
