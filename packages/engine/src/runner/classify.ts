type Classification = "out-of-usage" | "signed-out";

// Match adapter-specific phrases rather than loose words that also occur
// in successful replies about authentication or application rate limits.
const usage: Readonly<Record<string, RegExp>> = {
  claude: /you've hit your\b/i,
  codex: /\brateLimitExceeded\b|\brate_limited\b/,
  cursor: /\bout of usage\b|\bupgrade your plan to continue\b/i,
  gemini: /\brate limit exceeded\. try again later\./i,
};

export const classifyError = ({ harness, text }: { readonly harness: string; readonly text: string }): Classification | undefined => {
  const pattern = Object.hasOwn(usage, harness) ? usage[harness] : undefined;
  if (pattern === undefined) return undefined;
  if (/\bauthentication required\b/i.test(text)) return "signed-out";
  return pattern.test(text) ? "out-of-usage" : undefined;
};
