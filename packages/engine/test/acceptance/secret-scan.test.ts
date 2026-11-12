// The secret scan of the acceptance harness (review finding A4). A scan that
// never fails proves nothing, so this file plants a base64 encoded secret and a
// split secret in synthetic text and requires `findLeaks` and `threadSources`
// to find them, to find nothing in clean text, and never to print a value.
import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import type { EventEnvelope } from "@lgtm/contracts";

import { findLeaks, threadSources } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const secret = () => `planted-${randomUUID()}`;

const thread = (agentId: string, text: string, sequence: number): EventEnvelope => ({
  sequence, eventId: `event-${sequence}`, occurredAt: sequence, caller: { _tag: "owner" }, agentId,
  event: { _tag: "ThreadItem", content: { _tag: "text", text } },
}) as unknown as EventEnvelope;

it("the scan finds a secret in every form a service could print it in", () => {
  const value = secret();
  const text = (form: string) => [{ label: "output", text: `log line before ${form} and after` }];
  const forms: Record<string, string> = {
    raw: value,
    json: JSON.stringify({ value }),
    hex: Buffer.from(value).toString("hex"),
    percent: encodeURIComponent(`${value} ${value}`),
  };
  for (const [name, form] of Object.entries(forms)) {
    expect(findLeaks([value], text(form)), `the ${name} form`).not.toEqual([]);
  }
});

it("the scan finds a base64 and a base64url encoded secret at every alignment inside a longer text", () => {
  const value = secret();
  for (const filler of ["", "x", "xy", "xyz"]) {
    const bytes = Buffer.from(`${filler}${value}tail`);
    for (const encoded of [bytes.toString("base64"), bytes.toString("base64url")]) {
      const leaks = findLeaks([value], [{ label: "output", text: `prefix ${encoded} suffix` }]);
      expect(leaks, `base64 with a ${filler.length} byte lead`).not.toEqual([]);
    }
  }
});

it("the scan finds a secret that an agent's output split over two thread items", () => {
  const value = secret();
  const half = Math.floor(value.length / 2);
  const events = [
    thread("agent-1", `first half ${value.slice(0, half)}`, 1),
    thread("agent-2", "an unrelated agent", 2),
    thread("agent-1", `${value.slice(half)} second half`, 3),
  ];
  expect(JSON.stringify(events).includes(value), "the planted secret must not be in one piece in the events").toBe(false);
  const leaks = findLeaks([value], [{ label: "the events", text: JSON.stringify(events) }, ...threadSources(events)]);
  expect(leaks.length).toBeGreaterThan(0);
  expect(leaks.every((leak) => leak.includes("thread of agent")), "only the thread of the splitting agent holds it whole").toBe(true);
});

it("the scan finds nothing in clean text, and its report never contains the secret", () => {
  const clean = secret();
  const leaked = secret();
  expect(findLeaks([clean], [{ label: "output", text: `${leaked} is not ${clean.slice(0, 12)}` }])).toEqual([]);
  const report = findLeaks([clean, leaked], [{ label: "output", text: `before ${leaked} after` }]);
  expect(report).toEqual(["secret 2 (raw) in output"]);
  expect(report.join("")).not.toContain(leaked);
});
