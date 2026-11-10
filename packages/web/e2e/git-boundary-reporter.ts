// Passive Playwright reporter, selected explicitly for the owned browser proof.
// It never stores titles, parameters, errors, draft text or credentials.
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter"

export default class GitBoundaryReporter implements Reporter {
  private readonly events: Record<string, unknown>[] = []
  private readonly steps = new WeakMap<TestStep, number>()
  private next = 0
  private dropped = 0
  private record(kind: string, test: TestCase, detail: Record<string, unknown> = {}) {
    if (this.events.length >= 4000) { this.dropped++; return }
    this.events.push({ kind, unixMs: Date.now(), test: createHash("sha256").update(test.id).digest("hex"), ...detail })
  }
  onTestBegin(test: TestCase, result: TestResult) {
    this.record("test-start", test, { timeoutMs: test.timeout, retry: result.retry, worker: result.workerIndex })
  }
  onStepBegin(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== "expect") return
    const id = ++this.next; this.steps.set(step, id)
    const matcher = /\b(toHaveCount|toContainText|toBeEnabled|toBeDisabled|toBeVisible|toHaveText|toHaveValue|toBe|toEqual|toContain)\b/.exec(step.title)?.[1] ?? "other"
    this.record("assertion-start", test, { id, matcher, startUnixMs: step.startTime.getTime(),
      ...(step.location?.file.endsWith("/git.spec.ts") ? { file: "git.spec.ts", line: step.location.line, column: step.location.column } : {}) })
  }
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    const id = this.steps.get(step)
    if (id !== undefined) this.record("assertion-end", test, { id, durationMs: step.duration, failed: step.error !== undefined })
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.record("test-end", test, { status: result.status, durationMs: result.duration, retry: result.retry })
  }
  onEnd() {
    const path = ".scratch/w09-evidence/flow-resume-manager-10/assertion-boundaries.json"
    try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify({ version: 1, dropped: this.dropped, events: this.events }, null, 2) + "\n") }
    catch { process.stderr.write("W09 passive assertion artifact could not be written.\n") }
  }
}
