import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountId, AgentId, HarnessId, type HarnessChoices } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { checkFolder } from "../../identity/ceiling.ts";
import { sha256Hex } from "../../identity/credential.ts";
import { readHarnesses, refused, type Input } from "../../commands/internal.ts";
import type { ReadHandler } from "../../api/reads.ts";

// Choices depend on the account and adapter settings. They expire after five
// minutes, can be explicitly refreshed, and disappear with the runner instance.
const caches = new WeakMap<object, Map<string, { until: number; value: HarnessChoices }>>();
const empty = { source: "unavailable" as const, options: [] };
export const discoverHarnessChoices = (input: Input, requestedHarness: string, accountId?: string, refresh = false, model?: string) => Effect.gen(function* () {
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
  const installed = yield* Effect.tryPromise(() => access(harness.adapterPath, constants.X_OK)).pipe(Effect.map(() => true), Effect.catch(() => Effect.succeed(false)));
  if (!installed) return unavailable("The harness is not installed.");
  let cache = caches.get(runtime.runner);
  if (cache === undefined) { cache = new Map(); caches.set(runtime.runner, cache); }
  const key = sha256Hex(JSON.stringify([harness, account, model]));
  const cached = cache.get(key);
  if (!refresh && cached !== undefined && cached.until > Date.now()) return cached.value;
  const agentId = Schema.decodeUnknownSync(AgentId)(`discovery-${randomUUID()}`);
  // This token is never registered with the engine. The probe cannot call its API.
  const token = randomBytes(32).toString("base64url");
  const result = yield* Effect.scoped(Effect.gen(function* () {
    const folder = yield* Effect.acquireRelease(
      Effect.tryPromise(() => mkdtemp(join(tmpdir(), "lgtm-harness-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })));
    const grant = yield* checkFolder({ caller: { _tag: "owner" }, folder, parentFolder: folder,
      home: runtime.home, stateFolder: runtime.stateFolder, pluginRoot: runtime.pluginRoot });
    return yield* runtime.runner.discover({ agentId, token: Redacted.make(token), folder, grant, harness, account, permission: "read-only", ...(model === undefined ? {} : { model }) });
  })).pipe(
    Effect.timeout(20_000),
    Effect.map((choices): HarnessChoices => ({ harnessId, accountId: account.id, ...choices,
      ...(choices.models.options.length ? {} : { reason: "This harness did not report model choices." }),
      ...(choices.efforts.options.length ? {} : { effortReason: "This harness did not report effort choices." }) })),
    Effect.catch((error) => Effect.succeed(unavailable(error._tag === "RunnerRejected" && ["not-signed-in", "private-login-not-signed-in"].includes(error.startFailure ?? "")
      ? "Sign in to this harness account to see its models."
      : error._tag === "TimeoutError" ? "The harness did not report its models in time." : "The harness could not report its models on this account."))));
  if (result.models.options.length > 0) {
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + 5 * 60_000, value: result });
  }
  return result;
});

export const harnessChoices: ReadHandler = (input, payload) => input.actor._tag !== "owner" ? Effect.fail(refused()) : discoverHarnessChoices(input,
  payload.harnessId as HarnessChoices["harnessId"], payload.accountId as string | undefined, payload.refresh === true, payload.model as string | undefined).pipe(
    Effect.map((choices) => ({ reply: { requestId: payload.requestId, ...choices } })));
