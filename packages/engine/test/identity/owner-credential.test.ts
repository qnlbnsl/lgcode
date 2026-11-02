import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { DeviceId, RequestId } from "@shephrd/contracts";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { loadOwnerCredential } from "../../src/identity/ownerCredential.ts";
import { mintDeviceCredential, verifyDeviceCredential } from "../../src/identity/devices.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Views from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import * as Redactor from "../../src/log/Redactor.ts";

let home: string;
let state: string;
let oldMask: number;
beforeEach(() => {
  home = mkdtempSync("/tmp/shephrd-owner-credential-");
  state = join(home, "state");
  oldMask = process.umask();
  vi.stubEnv("HOME", home);
  vi.stubEnv("SHEPHRD_HOME", state);
});
afterEach(() => {
  process.umask(oldMask);
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const filename = () => join(state, "owner-credential");
const id = (value: string) => Schema.decodeUnknownSync(DeviceId)(value);
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

it.effect("5.2 device format: catches missing device prefix, entropy or checksum", () => Effect.sync(() => {
  const tokens = Array.from({ length: 32 }, () => mintDeviceCredential());
  expect(new Set(tokens.map(({ token }) => Redacted.value(token))).size).toBe(32);
  for (const issued of tokens) {
    const raw = Redacted.value(issued.token);
    expect(raw).toMatch(/^shp_d_[A-Za-z0-9_-]{43}_[a-f0-9]{8}$/);
    const payload = Buffer.from(raw.slice(6, 49), "base64url");
    expect(payload.byteLength).toBe(32);
    expect(raw.slice(50)).toBe(createHash("sha256").update(payload).digest("hex").slice(0, 8));
    expect(issued.tokenHash).toBe(createHash("sha256").update(raw).digest("hex"));
  }
}));

it.effect("5.2 device storage: catches storing credentials in device rows, events or receipt bytes", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const deviceId = id("phone");
    const issued = mintDeviceCredential();
    const raw = Redacted.value(issued.token);
    yield* log.append({ _tag: "owner" }, request(), "a".repeat(64), [{ _tag: "DeviceAdded", deviceId, name: "Phone" }], {
      devices: [{ deviceId, name: "Phone", tokenHash: issued.tokenHash, createdAt: 123, revokedAt: null }],
    });
    expect(yield* verifyDeviceCredential(raw)).toBe(deviceId);
    expect(yield* sql`SELECT device_id, token_hash, revoked_at FROM devices`).toEqual([
      { device_id: deviceId, token_hash: createHash("sha256").update(raw).digest("hex"), revoked_at: null },
    ]);
    yield* sql`PRAGMA wal_checkpoint(FULL)`;
    for (const file of readdirSync(state)) expect(readFileSync(join(state, file)).includes(Buffer.from(raw))).toBe(false);
  })),
);

it.effect("5.2 isolated device revocation: catches signing out every device or leaving the selected device valid", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const phone = mintDeviceCredential();
    const laptop = mintDeviceCredential();
    const phoneId = id("phone");
    const laptopId = id("laptop");
    yield* log.append({ _tag: "owner" }, request(), "b".repeat(64), [
      { _tag: "DeviceAdded", deviceId: phoneId, name: "Phone" },
      { _tag: "DeviceAdded", deviceId: laptopId, name: "Laptop" },
    ], {
      devices: [
        { deviceId: phoneId, name: "Phone", tokenHash: phone.tokenHash, createdAt: 123, revokedAt: null },
        { deviceId: laptopId, name: "Laptop", tokenHash: laptop.tokenHash, createdAt: 123, revokedAt: null },
      ],
    });
    expect(yield* verifyDeviceCredential(Redacted.value(phone.token))).toBe(phoneId);
    yield* log.append({ _tag: "owner" }, request(), "c".repeat(64), [{ _tag: "DeviceRevoked", deviceId: phoneId }], {
      revokeDevices: [phoneId],
    });
    expect(Result.isFailure(yield* verifyDeviceCredential(Redacted.value(phone.token)).pipe(Effect.result))).toBe(true);
    expect(yield* verifyDeviceCredential(Redacted.value(laptop.token))).toBe(laptopId);
  })),
);

it.effect.each(["insert", "revoke"] as const)(
  "5.2 atomic device/%s: catches committing a device mutation without its corresponding event",
  (operation) => withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const deviceId = id("phone");
    const issued = mintDeviceCredential();
    if (operation === "revoke") {
      yield* log.append({ _tag: "owner" }, request(), "d".repeat(64), [{ _tag: "DeviceAdded", deviceId, name: "Phone" }], {
        devices: [{ deviceId, name: "Phone", tokenHash: issued.tokenHash, createdAt: 123, revokedAt: null }],
      });
    }
    yield* sql.unsafe(`CREATE TRIGGER fail_device AFTER ${operation === "insert" ? "INSERT" : "UPDATE"} ON devices
      BEGIN SELECT RAISE(ABORT, 'device mutation must roll back'); END`);
    const outcome = yield* log.append({ _tag: "owner" }, request(), "e".repeat(64), [
      operation === "insert" ? { _tag: "DeviceAdded", deviceId, name: "Phone" } : { _tag: "DeviceRevoked", deviceId },
    ], operation === "insert"
      ? { devices: [{ deviceId, name: "Phone", tokenHash: issued.tokenHash, createdAt: 123, revokedAt: null }] }
      : { revokeDevices: [deviceId] }).pipe(Effect.result);
    expect(Result.isFailure(outcome)).toBe(true);
    const count = operation === "insert" ? 0 : 1;
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: count }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: count }]);
    const verified = yield* verifyDeviceCredential(Redacted.value(issued.token)).pipe(Effect.result);
    expect(Result.isFailure(verified)).toBe(operation === "insert");
  })),
);
