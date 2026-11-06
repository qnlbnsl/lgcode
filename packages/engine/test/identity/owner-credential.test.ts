import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { RequestId } from "@sheprd/contracts";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { loadOwnerCredential } from "../../src/identity/ownerCredential.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Views from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Redactor from "../../src/log/Redactor.ts";

let home: string;
let state: string;
let oldMask: number;
beforeEach(() => {
  home = mkdtempSync("/tmp/sheprd-owner-credential-");
  state = join(home, "state");
  oldMask = process.umask();
  vi.stubEnv("HOME", home);
  vi.stubEnv("SHEPRD_HOME", state);
});
afterEach(() => {
  process.umask(oldMask);
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const filename = () => join(state, "owner-credential");
const request = () => Schema.decodeUnknownSync(RequestId)(randomUUID());
const withLog = <A, E>(program: Effect.Effect<A, E, EventLog.EventLog | SqlClient.SqlClient>) => {
  mkdirSync(state, { mode: 0o700 });
  return Effect.gen(function* () {
    yield* migrate;
    return yield* Effect.scoped(Effect.gen(function* () {
      yield* registerRebuildCheck();
      return yield* program;
    })).pipe(Effect.provide(EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(Redactor.layer))));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: join(state, "events.sqlite") })), Effect.scoped,
  );
};

it.effect("5.2 owner creation: catches a short credential, permissive file/folder, wrong owner or unchanged umask", () =>
  Effect.gen(function* () {
    process.umask(0o022);
    const credential = yield* loadOwnerCredential(state);
    const bytes = readFileSync(filename());
    expect(bytes.byteLength).toBe(32);
    expect(Redacted.value(credential)).toBe(bytes.toString("base64url"));
    expect(statSync(filename()).mode & 0o777).toBe(0o600);
    expect(statSync(state).mode & 0o777).toBe(0o700);
    expect(statSync(state).uid).toBe(process.getuid!());
    expect(process.umask()).toBe(0o077);
  }),
);

it.effect("5.2 owner restart: catches replacing or rewriting an existing credential on second start", () =>
  Effect.gen(function* () {
    const first = yield* loadOwnerCredential(state);
    utimesSync(filename(), 1_000, 1_000);
    const before = statSync(filename());
    const second = yield* loadOwnerCredential(state);
    const after = statSync(filename());
    expect(Redacted.value(second)).toBe(Redacted.value(first));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(readFileSync(filename()).toString("base64url")).toBe(Redacted.value(first));
  }),
);

it.effect.each([0o644, 0o660, 0o666])(
  "5.2 unsafe file/%i: catches silently repairing or accepting a credential readable by other users",
  (mode) => Effect.gen(function* () {
    yield* loadOwnerCredential(state);
    chmodSync(filename(), mode);
    const outcome = yield* loadOwnerCredential(state).pipe(Effect.result);
    expect(Result.isFailure(outcome)).toBe(true);
    expect(statSync(filename()).mode & 0o777).toBe(mode);
  }),
);

it.effect.each([0o755, 0o770])(
  "5.2 unsafe folder/%i: catches failing to recheck the state folder at each start",
  (mode) => Effect.gen(function* () {
    yield* loadOwnerCredential(state);
    chmodSync(state, mode);
    expect(Result.isFailure(yield* loadOwnerCredential(state).pipe(Effect.result))).toBe(true);
    expect(statSync(state).mode & 0o777).toBe(mode);
  }),
);

it.effect("5.2 no-follow: catches following an existing owner-credential symlink", () =>
  Effect.gen(function* () {
    const credential = yield* loadOwnerCredential(state);
    const outside = join(home, "outside-credential");
    const bytes = readFileSync(filename());
    writeFileSync(outside, bytes, { mode: 0o600 });
    rmSync(filename());
    symlinkSync(outside, filename());
    expect(Result.isFailure(yield* loadOwnerCredential(state).pipe(Effect.result))).toBe(true);
    expect(readFileSync(outside).toString("base64url")).toBe(Redacted.value(credential));
  }),
);
