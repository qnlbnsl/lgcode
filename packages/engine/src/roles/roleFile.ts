import { createHash } from "node:crypto";
import { RoleFile, RolesEvent, rolesMaxima } from "@lgcode/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { refused, type Input, type Payload, type PiecePlan } from "../commands/internal.ts";

export class RoleFileError extends Data.TaggedError("RoleFileError")<{
  readonly path: ReadonlyArray<string | number>;
  readonly reason: string;
}> {}
export interface LoadedRoleFile { readonly file: RoleFile; readonly roleFileHash: string }

// Error messages contain no supplied values. Only the failing path is returned.
const issues = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: () => "invalid role file value", checkHook: () => "invalid role file value",
});
const encodeEvent = Schema.encodeSync(RolesEvent);
export const loadRoleFile = (content: string): Effect.Effect<LoadedRoleFile, RoleFileError> => Effect.gen(function* () {
  if (Buffer.byteLength(content, "utf8") > rolesMaxima.roleFileBytes) {
    return yield* new RoleFileError({ path: [], reason: "role file exceeds 64 KiB" });
  }
  const roleFileHash = createHash("sha256").update(content, "utf8").digest("hex");
  // Decision 145 bounds the actual event encoding as well as the input.
  // Run this before parsing so control-character input cannot evade the budget.
  const encoded = encodeEvent({ _tag: "roles.RoleFileSet", content, roleFileHash });
  if (Buffer.byteLength(JSON.stringify(encoded), "utf8") > rolesMaxima.roleFileEventBytes) {
    return yield* new RoleFileError({ path: [], reason: "encoded role-file event exceeds 200 KiB" });
  }
  const value = yield* Effect.try({
    try: (): unknown => JSON.parse(content),
    catch: () => new RoleFileError({ path: [], reason: "invalid role file JSON" }),
  });
  const file = yield* Schema.decodeUnknownEffect(RoleFile, { onExcessProperty: "error" })(value).pipe(
    Effect.mapError((error) => new RoleFileError({
      path: (issues(error.issue).issues[0]?.path ?? []).map((part) =>
        typeof part === "object" ? String(part.key) : typeof part === "number" ? part : String(part)),
      reason: "invalid role file value",
    })),
  );
  return { file, roleFileHash };
});

// The full roles fold delegates the loaded-file fields to this reducer.
export interface RoleFileState { readonly file: RoleFile | null; readonly roleFileHash: string | null }
export const emptyRoleFile = (): RoleFileState => ({ file: null, roleFileHash: null });
export const reduceRoleFile = (state: unknown, event: Readonly<Record<string, unknown>>): unknown => {
  if (event._tag !== "roles.RoleFileSet") return state;
  const file = Schema.decodeUnknownSync(RoleFile, { onExcessProperty: "error" })(JSON.parse(event.content as string));
  return { ...state as RoleFileState, file, roleFileHash: event.roleFileHash as string };
};

export const setRoleFile = (input: Input, payload: Payload<"roles.role-file.set">): Effect.Effect<PiecePlan, ReturnType<typeof refused>> => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused();
  const load = (content: string) => loadRoleFile(content).pipe(Effect.catchTag("RoleFileError", (error) =>
    input.runtime.log.redactText(`role file error: ${JSON.stringify(error.path)}: ${error.reason}`).pipe(
      Effect.flatMap((reason) => Effect.fail(refused(reason))),
    )));
  const loaded = yield* load(payload.content);
  // The view must contain only committed, redacted data. Refuse if redaction
  // makes the serialized document invalid instead of committing an unusable file.
  const content = yield* input.runtime.log.redactText(payload.content);
  yield* load(content);
  return {
    // The writer performs the mandatory redaction pass. Passing the original
    // avoids redacting replacement markers again. It validates the final
    // representation as well, with its current secret registry.
    events: [{ _tag: "roles.RoleFileSet", content: payload.content, roleFileHash: loaded.roleFileHash }],
    reply: (batch) => {
      const event = batch.find(({ event }) => event._tag === "roles.RoleFileSet")?.event;
      return { requestId: payload.requestId, roleFileHash: event?._tag === "roles.RoleFileSet" ? event.roleFileHash : undefined };
    },
  };
});

export const getRoleFile = (input: Input, payload: Record<string, unknown>) => input.actor._tag !== "owner"
  ? Effect.fail(refused())
  : Effect.succeed({ reply: {
    requestId: payload.requestId,
    file: (input.snapshot.roles as RoleFileState).file,
    roleFileHash: (input.snapshot.roles as RoleFileState).roleFileHash,
  } });
