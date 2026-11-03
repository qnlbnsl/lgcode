import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { loadOwnerCredential } from "../../src/identity/ownerCredential.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

let home: string;
let state: string;
let mask: number;
beforeEach(() => {
  home = mkdtempSync("/tmp/shephrd-owner-fix-1-");
  state = join(home, "state");
  mask = process.umask();
  vi.stubEnv("HOME", home);
  vi.stubEnv("SHEPHRD_HOME", state);
});
afterEach(() => {
  process.umask(mask);
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it.effect.each([{ label: "0700", mode: 0o700 }, { label: "0640", mode: 0o640 }])(
  "B1 credential mode/$label: catches accepting permission bits other than exactly 0600 or silently repairing the file",
  ({ mode }) => Effect.gen(function* () {
    yield* loadOwnerCredential(state);
    const file = join(state, "owner-credential");
    const before = readFileSync(file);
    chmodSync(file, mode);
    const result = yield* loadOwnerCredential(state).pipe(Effect.result);
    expect.soft(Result.isFailure(result)).toBe(true);
    expect(statSync(file).mode & 0o7777).toBe(mode);
    expect(readFileSync(file)).toEqual(before);
  }),
);

it.effect("B1 credential mode/0600: catches replacing or rewriting a valid credential during restart", () => Effect.gen(function* () {
  const credential = yield* loadOwnerCredential(state);
  const file = join(state, "owner-credential");
  chmodSync(file, 0o600);
  utimesSync(file, 1000, 1000);
  const before = statSync(file);
  const bytes = readFileSync(file);
  expect(Redacted.value(yield* loadOwnerCredential(state))).toBe(Redacted.value(credential));
  expect(readFileSync(file)).toEqual(bytes);
  expect(statSync(file).mode & 0o7777).toBe(0o600);
  expect(statSync(file).ino).toBe(before.ino);
  expect(statSync(file).mtimeMs).toBe(before.mtimeMs);
}));

it.effect.each([{ label: "0750", mode: 0o750 }, { label: "1700", mode: 0o1700 }])(
  "B1 state mode/$label: catches permitting state-folder bits other than exactly 0700",
  ({ mode }) => Effect.gen(function* () {
    yield* loadOwnerCredential(state);
    chmodSync(state, mode);
    expect(Result.isFailure(yield* loadOwnerCredential(state).pipe(Effect.result))).toBe(true);
    expect(statSync(state).mode & 0o7777).toBe(mode);
  }),
);
