import type { StepSpec } from "./steps.ts";

// Unit 8c: the step printer. One line for each step, with PASS or FAIL and the
// reason. The exit code is 0 only when every step that ran passed and every
// step that was meant to run ran.

export interface StepResult {
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly reason: string;
  readonly milliseconds: number;
}

export interface Reporter {
  // Runs one step. A thrown error, or a rejected promise, fails the step with
  // its message. The caller decides whether the run goes on.
  readonly step: <A>(spec: StepSpec, body: () => Promise<A>, reason?: (value: A) => string) => Promise<{ readonly passed: true; readonly value: A } | { readonly passed: false }>;
  // Records a step that did not run because an earlier one failed.
  readonly skip: (spec: StepSpec, because: string) => void;
  readonly note: (text: string) => void;
  // Records a step whose result the caller already knows (an effect-based step runner).
  readonly pass: (spec: StepSpec, reason: string, milliseconds?: number) => void;
  readonly fail: (spec: StepSpec, reason: string, milliseconds?: number) => void;
  readonly results: () => ReadonlyArray<StepResult>;
  readonly failed: () => boolean;
  readonly exitCode: (expected: ReadonlyArray<StepSpec>) => 0 | 1;
}

// A line is one line: a reason with line ends is folded, and a very long one
// is cut, so a stack or an adapter's whole output cannot bury the steps.
export const oneLine = (text: string, limit = 400): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

export const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
};

export const createReporter = (write: (line: string) => void, clock: () => number = Date.now): Reporter => {
  const results: Array<StepResult> = [];
  const record = (spec: StepSpec, passed: boolean, reason: string, started: number, milliseconds?: number): StepResult => {
    const result = { id: spec.id, title: spec.title, passed, reason: oneLine(reason), milliseconds: milliseconds ?? clock() - started };
    results.push(result);
    write(`${passed ? "PASS" : "FAIL"} ${spec.id}: ${spec.title}${result.reason === "" ? "" : ` (${result.reason})`}`);
    return result;
  };
  return {
    step: async (spec, body, reason) => {
      const started = clock();
      try {
        const value = await body();
        record(spec, true, reason === undefined ? "" : reason(value), started);
        return { passed: true, value };
      } catch (error) {
        record(spec, false, messageOf(error), started);
        return { passed: false };
      }
    },
    pass: (spec, reason, milliseconds) => { record(spec, true, reason, clock(), milliseconds); },
    fail: (spec, reason, milliseconds) => { record(spec, false, reason, clock(), milliseconds); },
    skip: (spec, because) => {
      results.push({ id: spec.id, title: spec.title, passed: false, reason: oneLine(because), milliseconds: 0 });
      write(`SKIP ${spec.id}: ${spec.title} (${oneLine(because)})`);
    },
    note: (text) => write(`     ${oneLine(text, 600)}`),
    results: () => results,
    failed: () => results.some((result) => !result.passed),
    exitCode: (expected) => {
      const ran = new Set(results.map((result) => result.id));
      return results.every((result) => result.passed) && expected.every((spec) => ran.has(spec.id)) ? 0 : 1;
    },
  };
};
