// A synchronous guard also works in the pure view fold. The bounded sink
// contains only categories; neither Error.name nor Error.message is trusted.
interface PieceError { readonly namespace: string; readonly table: string; readonly errorClass: string }
const pending = new Map<string, PieceError>();
const last = new Map<string, number>();
const errorClass = (error: unknown): string => {
  try {
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof RangeError) return "RangeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof ReferenceError) return "ReferenceError";
    if (error instanceof Error) return "Error";
  } catch { /* A thrown proxy cannot break the error sink. */ }
  return "Unknown";
};
export const guardPiece = <T>(table: string, namespace: string, call: () => T, fallback: T): T => {
  try { return call(); }
  catch (error) {
    const key = `${namespace}:${table}`;
    const now = Date.now();
    if (!last.has(key) || now - last.get(key)! >= 60_000) {
      last.set(key, now);
      pending.set(key, { namespace, table, errorClass: errorClass(error) });
    }
    return fallback;
  }
};
export const drainPieceErrors = (): ReadonlyArray<PieceError> => {
  const errors = [...pending.values()];
  pending.clear();
  return errors;
};
