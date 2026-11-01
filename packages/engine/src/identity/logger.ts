import * as Cause from "effect/Cause";
import type * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References";

// Deeper values are cut off rather than walked, so a huge or hostile value
// cannot stall the logger.
const maximumDepth = 8;

type RedactText = (text: string) => string;

// Defined, not assigned, so a `__proto__` key stays an ordinary field.
const setField = (fields: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(fields, key, { value, enumerable: true, writable: true, configurable: true });
};

// Turns any logged value into plain JSON data with every string redacted
// before anything is serialized. Errors keep their name, message, stack and
// nested `cause`; a Cause keeps each failure, defect and interruption.
const sanitize = (value: unknown, redact: RedactText, depth: number, seen: Set<object>): unknown => {
  switch (typeof value) {
    case "string": return redact(value);
    case "number":
    case "boolean":
    case "undefined": return value;
    case "bigint":
    case "symbol": return redact(String(value));
    case "function": return "[function]";
  }
  if (value === null) return null;
  if (Redacted.isRedacted(value)) return "<redacted>";
  if (depth >= maximumDepth) return "[too deep]";
  const object = value as object;
  if (seen.has(object)) return "[circular]";
  seen.add(object);
  try {
    const next = (item: unknown) => sanitize(item, redact, depth + 1, seen);
    if (Cause.isCause(object)) return object.reasons.map((reason) => sanitizeReason(reason, next));
    if (object instanceof Error) {
      const fields: Record<string, unknown> = {
        name: redact(object.name), message: redact(object.message),
        ...(object.stack === undefined ? {} : { stack: redact(object.stack) }),
        ...(object.cause === undefined ? {} : { cause: next(object.cause) }),
      };
      if (object instanceof AggregateError) setField(fields, "errors", (object.errors as Array<unknown>).map(next));
      for (const [key, item] of Object.entries(object)) {
        const safeKey = redact(key);
        if (!Object.hasOwn(fields, safeKey)) setField(fields, safeKey, next(item));
      }
      return fields;
    }
    if (Array.isArray(object)) return object.map(next);
    if (object instanceof Date) return Number.isNaN(object.getTime()) ? "Invalid Date" : object.toISOString();
    if (object instanceof Map) return [...object.entries()].map(([key, item]) => [next(key), next(item)]);
    if (object instanceof Set) return [...object].map(next);
    const fields: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) setField(fields, redact(key), next(item));
    return fields;
  } catch {
    // A throwing getter or proxy must not stop the log line or leak through
    // an error message.
    return "[unreadable]";
  } finally {
    seen.delete(object);
  }
};

const sanitizeReason = (reason: Cause.Reason<unknown>, next: (item: unknown) => unknown): unknown => {
  if (Cause.isFailReason(reason)) return { _tag: "Fail", error: next(reason.error) };
  if (Cause.isDieReason(reason)) return { _tag: "Die", defect: next(reason.defect) };
  return { _tag: "Interrupt", fiberId: reason.fiberId };
};

// The service's logger (issue 13, decision row 57). It replaces every logger
// already installed, so no inherited logger writes the raw values beside it.
// The message, every annotation key and value, every span label and the
// cause, including nested errors, pass through the redactor before the line
// is serialized; the finished line passes through it once more. Units 6a, 6d
// and 7a install it before any ACP runner or handler is built.
export const redactingLoggerLayer = (
  instance: { readonly redactText: RedactText },
  write: (line: string) => void,
): Layer.Layer<never> =>
  Logger.layer([
    Logger.make(({ cause, date, fiber, logLevel, message }) => {
      const redact = instance.redactText;
      const clean = (value: unknown) => sanitize(value, redact, 0, new Set());
      const annotations: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fiber.getRef(CurrentLogAnnotations))) {
        setField(annotations, redact(key), clean(value));
      }
      const spans: Record<string, number> = {};
      for (const [label, started] of fiber.getRef(CurrentLogSpans)) setField(spans, redact(label), date.getTime() - started);
      const messages = Array.isArray(message) ? message : [message];
      const entry = {
        timestamp: date.toISOString(),
        level: logLevel.toUpperCase(),
        fiberId: `#${fiber.id}`,
        message: messages.length === 1 ? clean(messages[0]) : messages.map(clean),
        ...(cause.reasons.length === 0 ? {} : { cause: clean(cause) }),
        annotations,
        spans,
      };
      try {
        write(redact(JSON.stringify(entry)));
      } catch {
        // A failing sink must not fail the fiber that logged.
      }
    }),
  ]);
