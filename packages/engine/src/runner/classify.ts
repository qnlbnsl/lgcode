type Classification = "out-of-usage" | "signed-out" | "capacity";

// Match adapter-specific phrases rather than loose words that also occur
// in successful replies about authentication or application rate limits.
const usage: Readonly<Record<string, RegExp>> = {
  claude: /you've hit your\b/i,
  codex: /\brateLimitExceeded\b|\brate_limited\b/,
  cursor: /\bout of usage\b|\bupgrade your plan to continue\b/i,
  gemini: /\brate limit exceeded\. try again later\./i,
};

// The runner serializes the protocol error. Its message can itself be the
// provider's JSON error, so inspect those wrappers without matching prose.
const overloaded = (text: string, depth = 0): boolean => {
  if (depth > 4) return false;
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return row.type === "overloaded_error"
      || typeof row.error === "object" && row.error !== null && "type" in row.error && row.error.type === "overloaded_error"
      || typeof row.message === "string" && overloaded(row.message, depth + 1)
      || typeof row.errorMessage === "string" && overloaded(row.errorMessage, depth + 1);
  } catch {
    return false;
  }
};

export const classifyError = ({ harness, text }: { readonly harness: string; readonly text: string }): Classification | undefined => {
  const pattern = Object.hasOwn(usage, harness) ? usage[harness] : undefined;
  if (pattern === undefined) return undefined;
  if (/\bauthentication required\b/i.test(text)) return "signed-out";
  // Anthropic documents this exact error type. The fixture pins the source
  // to Claude adapter 0.99.1; other harnesses have no capacity source yet.
  if (harness === "claude" && overloaded(text)) return "capacity";
  return pattern.test(text) ? "out-of-usage" : undefined;
};
