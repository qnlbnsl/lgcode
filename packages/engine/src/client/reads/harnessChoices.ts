import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountId, AgentId, HarnessId, type HarnessChoices } from "@lgtm/contracts";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { checkFolder } from "../../identity/ceiling.ts";
import { sha256Hex } from "../../identity/credential.ts";
import { readHarnesses, refused, type Input } from "../../commands/internal.ts";
import type { ReadHandler } from "../../api/reads.ts";

// Share work per runner, account, adapter settings and selected model. A job
// owns its scope until the last waiting request ends. Queued work shares the
// same deadline, so neither a child nor its queue can outlive its requests.
interface Job {
  users: number;
  readonly scope: Scope.Closeable;
  readonly result: Deferred.Deferred<HarnessChoices>;
}
interface DiscoveryState {
  readonly cache: Map<string, { until: number; value: HarnessChoices }>;
  readonly running: Map<string, Job>;
}
const states = new WeakMap<object, DiscoveryState>();
const permits = Semaphore.makeUnsafe(2);
const stateFor = (runner: object): DiscoveryState => {
  let state = states.get(runner);
  if (state === undefined) {
    state = { cache: new Map(), running: new Map() };
    states.set(runner, state);
  }
  return state;
};
const empty = { source: "unavailable" as const, options: [] };
export const discoverHarnessChoices = (input: Input, requestedHarness: string, accountId?: string, refresh = false, model?: string, cacheOnly = false) => Effect.gen(function* () {
  const runtime = input.runtime;
  const harnessId = Schema.decodeUnknownSync(HarnessId)(requestedHarness);
  let resolvedAccountId = accountId === undefined ? undefined : Schema.decodeUnknownSync(AccountId)(accountId);
  const unavailable = (reason: string): HarnessChoices => ({ harnessId, ...(resolvedAccountId === undefined ? {} : { accountId: resolvedAccountId }), models: empty, efforts: empty, reason, effortReason: reason });
  const harness = (yield* readHarnesses(runtime)).find((h) => h.id === harnessId);
  if (harness === undefined) return unavailable("The harness is not installed.");
  if (harness.runMode !== "acp") return unavailable("This harness does not support model discovery in its current run mode.");
  const accounts = Object.values(input.snapshot.accounts).filter((a) => a.harness === harnessId && (accountId === undefined || a.id === accountId));
  if (accounts.length === 0) return unavailable("No account is registered for this harness.");
  const enabled = accounts.filter((a) => a.enabled !== false);
  if (enabled.length === 0) return unavailable("No enabled account is registered for this harness.");
  const account = enabled.find((a) => a.status !== "needs-sign-in") ?? enabled[0]!;
  resolvedAccountId = account.id;
  if (account.status === "needs-sign-in") return unavailable("Sign in to this harness account to see its models.");
  const state = stateFor(runtime.runner);
  const key = sha256Hex(JSON.stringify([harness, account, model]));
  const now = yield* Clock.currentTimeMillis;
  const cached = state.cache.get(key);
  if (cacheOnly) return cached !== undefined && cached.until > now ? cached.value : unavailable("Read this harness's model choices before changing the configuration.");
  // A refresh bypasses a completed result, but always joins existing work.
  const probe = Effect.gen(function* () {
    const installed = yield* Effect.tryPromise(() => access(harness.adapterPath, constants.X_OK)).pipe(Effect.map(() => true), Effect.catch(() => Effect.succeed(false)));
    if (!installed) return unavailable("The harness is not installed.");
    const agentId = Schema.decodeUnknownSync(AgentId)(`discovery-${randomUUID()}`);
    // This token is never registered with the engine. The probe cannot call its API.
    const token = randomBytes(32).toString("base64url");
    return yield* Effect.scoped(Effect.gen(function* () {
      const folder = yield* Effect.acquireRelease(
        Effect.tryPromise(() => mkdtemp(join(tmpdir(), "lgtm-harness-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })));
      const canonicalFolder = yield* Effect.tryPromise(() => realpath(folder));
      const grant = yield* checkFolder({ caller: { _tag: "owner" }, folder: canonicalFolder, parentFolder: canonicalFolder,
        home: runtime.home, stateFolder: runtime.stateFolder, pluginRoot: runtime.pluginRoot });
      return yield* runtime.runner.discover({ agentId, token: Redacted.make(token), folder: canonicalFolder, grant, harness, account, permission: "read-only", ...(model === undefined ? {} : { model }) });
    })).pipe(
      Effect.map((choices): HarnessChoices => ({ harnessId, accountId: account.id, ...choices,
        ...(choices.models.options.length ? {} : { reason: "This harness did not report model choices." }),
        ...(choices.efforts.options.length ? {} : { effortReason: "This harness did not report effort choices." }) })),
      Effect.catch((error) => Effect.succeed(unavailable(error._tag === "RunnerRejected" && ["not-signed-in", "private-login-not-signed-in"].includes(error.startFailure ?? "")
        ? "Sign in to this harness account to see its models."
        : "The harness could not report its models on this account."))));
  });
  return yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    let job = state.running.get(key);
    if (job === undefined) {
      const cached = state.cache.get(key);
      if (!refresh && cached !== undefined && cached.until > now) return cached.value;
      job = { users: 0, scope: Scope.makeUnsafe(), result: Deferred.makeUnsafe() };
      state.running.set(key, job);
      const current = job;
      const work = permits.withPermit(probe).pipe(
        Effect.timeout(20_000),
        Effect.catchTag("TimeoutError", () => Effect.succeed(unavailable("The harness did not report its models in time."))),
        Effect.tap((value) => Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (state.cache.size >= 128 && !state.cache.has(key)) state.cache.delete(state.cache.keys().next().value!);
          state.cache.set(key, { until: now + (value.models.options.length ? 300_000 : 30_000), value });
        })),
        Effect.exit,
        Effect.flatMap((exit) => Deferred.done(current.result, exit)),
        Effect.ensuring(Effect.sync(() => { if (state.running.get(key) === current) state.running.delete(key); })),
        Effect.asVoid,
      );
      yield* Effect.forkIn(restore(work), current.scope);
    }
    job.users++;
    const current = job;
    return yield* restore(Deferred.await(current.result)).pipe(Effect.ensuring(Effect.suspend(() => {
      current.users--;
      if (current.users !== 0) return Effect.void;
      // Closing can suspend while killing the child. New callers must not
      // attach to a cancelled job during that cleanup.
      if (state.running.get(key) === current) state.running.delete(key);
      return Scope.close(current.scope, Exit.void);
    })));
  }));
});

export const harnessChoices: ReadHandler = (input, payload) => input.actor._tag !== "owner" ? Effect.fail(refused()) : discoverHarnessChoices(input,
  payload.harnessId as HarnessChoices["harnessId"], payload.accountId as string | undefined, payload.refresh === true, payload.model as string | undefined).pipe(
    Effect.map((choices) => ({ reply: { requestId: payload.requestId, ...choices } })));
