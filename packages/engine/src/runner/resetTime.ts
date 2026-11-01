// Only structured prompt errors can supply a usage deadline. Do not coerce
// objects or booleans, or let an untrusted value schedule an unbounded wait.
export const resetTimeFromError = (error: unknown): number | undefined => {
  if (error === null || typeof error !== "object") return undefined;
  const data = (error as { readonly data?: unknown }).data;
  if (data === null || typeof data !== "object") return undefined;
  const value = (data as { readonly resetsAt?: unknown }).resetsAt;
  const resetAt = typeof value === "string" ? Date.parse(value) : value;
  return typeof resetAt === "number" && Number.isFinite(resetAt)
    && Number.isInteger(resetAt) && resetAt >= 0
    && Math.abs(resetAt - Date.now()) <= 366 * 24 * 60 * 60 * 1_000
    ? resetAt : undefined;
};
