import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AgentId, PermissionRequestId, permissionForOptionKind, type PermissionOption } from "@shephrd/contracts";
import type { RequestPermissionOutcome } from "@shephrd/t3-effect-acp/schema-v1";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { canAnswerOption } from "../identity/ceiling.ts";
import type { RunnerRejected } from "./Runner.ts";

export function mapPermissionOption(harness: string, option: { optionId: string; name: string; kind: string }): PermissionOption {
  const mapped = permissionForOptionKind(option.kind);
  const full = harness === "claude" && /^exit-plan-(?:clear-)?(?:bypass|auto)$/.test(option.optionId);
  return { id: option.optionId, name: option.name, kind: option.kind,
    level: full ? "full" : mapped.level, persistent: full || mapped.persistent };
}

export const makePermissionHold = (options: ReadonlyArray<{ optionId: string }>) => Effect.gen(function* () {
  const answer = yield* Deferred.make<RequestPermissionOutcome>();
  const delivered = yield* Deferred.make<void, RunnerRejected>();
  return { id: Schema.decodeUnknownSync(PermissionRequestId)(randomUUID()),
    options: new Set(options.map((option) => option.optionId)), answer, delivered };
});

export const settingsWrite = (paths: ReadonlyArray<string>, folder: string, configDir?: string): boolean => paths.some((path) =>
  canAnswerOption({
    caller: { _tag: "agent", agentId: Schema.decodeUnknownSync(AgentId)("permission-path-check") },
    mode: "full", option: { kind: "allow_once", level: "ask", persistent: false },
    settingsPath: resolve(folder, path), ...(configDir === undefined ? {} : { configDir: resolve(folder, configDir) }),
  }) === "owner",
);
