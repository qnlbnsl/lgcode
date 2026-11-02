// Unit 8c, fix round 1, finding F2 (issue 200): every line the script prints
// is redacted with the run's secret list, the owner credential is on that list
// as soon as it can be read, an unreadable credential fails the run instead of
// emptying the list, and the final scan reads what was printed.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createReporter } from "../../scripts/live/reporter.ts";
import { main } from "../../scripts/live/run.ts";
import { readOwnerCredentialFrom, redactSecrets } from "../../scripts/live/support.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: Array<ReturnType<typeof scriptedApi>> = [];
const folders: Array<string> = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const credential = Buffer.from("owner-credential-for-live-check-test");

describe("the owner credential file", () => {
  it("is read in the three forms a leak could take (breaks if a form is dropped)", () => {
    const state = mkdtempSync(join(tmpdir(), "sh8c-cred-"));
    folders.push(state);
    writeFileSync(join(state, "owner-credential"), credential);
    expect(readOwnerCredentialFrom(state)).toEqual([credential.toString("base64url"), credential.toString("base64"), credential.toString("hex")]);
  });

  it("throws when it cannot be read, so the scan is never silently empty (breaks if an unreadable file gives an empty list; finding F2)", () => {
    const state = mkdtempSync(join(tmpdir(), "sh8c-cred-"));
    folders.push(state);
    expect(() => readOwnerCredentialFrom(state)).toThrow(/owner credential/);
  });

  it("fails the final step by name when the credential file is gone, and prints no credential (breaks if the run passes with nothing to scan for)", async () => {
    const fixture = scriptedApi();
    fixtures.push(fixture);
    rmSync(join(fixture.state, "owner-credential"));
    expect(await main([], fixture.deps)).toBe(1);
    expect(fixture.lines.find((line) => line.startsWith("FAIL final:")), fixture.lines.join("\n")).toMatch(/owner credential/);
  });
});

describe("redacting what is printed", () => {
  it("replaces every form of a registered secret, the raw one and the encoded ones (breaks if only the raw value is hidden)", () => {
    const secret = "agent-token-only-for-this-test-0123456789";
    const text = [secret, Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("hex"), encodeURIComponent(secret)].join(" | ");
    const out = redactSecrets(`failed: ${text}`, [secret]);
    expect(out).not.toContain(secret);
    expect(out).not.toContain(Buffer.from(secret).toString("base64"));
    expect(out).not.toContain(Buffer.from(secret).toString("hex"));
    expect(out).toContain("[redacted]");
  });

  it("leaves a line with no secret as it was", () => {
    expect(redactSecrets("PASS lead: start the lead", ["agent-token-only-for-this-test-0123456789"])).toBe("PASS lead: start the lead");
  });

  it("redacts a bearer token, a password and an api key by their shape when no secret is registered (breaks if a diagnostic from a library repeats a header)", async () => {
    const lines: Array<string> = [];
    const reporter = createReporter((line) => { lines.push(line); });
    await reporter.step({ id: "lead", title: "start the lead" }, async () => { throw new Error('POST failed, headers {"authorization":"Bearer abcdefghijkl123"}, api_key=zzzzzzzzzzzz9, password: hunter2hunter2'); });
    const text = lines.join("\n");
    for (const value of ["abcdefghijkl123", "zzzzzzzzzzzz9", "hunter2hunter2"]) expect(text).not.toContain(value);
    expect(text).toContain("FAIL lead:");
  });

  it("registers the owner credential from the first print: a failing setup that repeats it prints [redacted] and the final line names the leak (breaks if the printer is not tied to the run's secret list)", async () => {
    const fixture = scriptedApi();
    fixtures.push(fixture);
    const code = await main([], { ...fixture.deps, harnessSettings: async () => { throw new Error(`adapter error: ${fixture.secret} and ${credential.toString("hex")}`); } });
    expect(code).toBe(1);
    const text = fixture.lines.join("\n");
    expect(text).not.toContain(fixture.secret);
    expect(text).not.toContain(credential.toString("hex"));
    expect(text).toContain("[redacted]");
  });
});
