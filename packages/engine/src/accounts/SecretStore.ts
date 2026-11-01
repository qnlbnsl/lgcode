import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Semaphore from "effect/Semaphore";

import { SecretStore } from "../commands/SecretStore.ts";
import { LogWriteFailed } from "../log/EventLog.ts";

// Rows 19 and 40: account secrets live in `secrets.json` in the state folder,
// readable by the owner only. The file maps a reference to its value. A value
// leaves this store only as `Redacted`, and only the runner's child
// environment unwraps it. No message here names a reference or a value.
const FILE = "secrets.json";

const parse = (text: string): Record<string, string> => {
  const data: unknown = JSON.parse(text);
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("secrets file is malformed");
  return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
};

// A missing file is an empty store. Any other failure to read it is an error
// the caller handles: `resolve` treats it as "no such secret".
const read = async (path: string): Promise<Record<string, string>> => {
  try {
    return parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
};

export const layer = (configuration: { readonly stateFolder: string }): Layer.Layer<SecretStore> =>
  Layer.effect(SecretStore, Effect.gen(function* () {
    const path = join(configuration.stateFolder, FILE);
    const writes = yield* Semaphore.make(1);
    // The owner-only mode is set when the temporary file is created, so the
    // value is never readable by others, and the rename replaces the whole
    // file at once.
    const replace = async (next: Record<string, string>) => {
      await mkdir(configuration.stateFolder, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, path);
    };
    const put = async (reference: string, value: string) => replace({ ...await read(path), [reference]: value });
    // Issue 119. A store with nothing to remove is left untouched.
    const retainOnly = async (keep: ReadonlySet<string>) => {
      const values = await read(path);
      const kept = Object.fromEntries(Object.entries(values).filter(([reference]) => keep.has(reference)));
      if (Object.keys(kept).length !== Object.keys(values).length) await replace(kept);
    };
    return SecretStore.of({
      put: (reference, value) => writes.withPermit(Effect.tryPromise({
        try: () => put(reference, Redacted.value(value)),
        catch: () => new LogWriteFailed({ reason: "secret store write failed" }),
      })),
      retainOnly: (keep) => writes.withPermit(Effect.tryPromise({
        try: () => retainOnly(keep),
        catch: () => new LogWriteFailed({ reason: "secret store write failed" }),
      })),
      resolve: (reference) => Effect.promise(() => read(path)).pipe(
        Effect.map((values) => {
          const value = Object.hasOwn(values, reference) ? values[reference] : undefined;
          return value === undefined ? undefined : Redacted.make(value);
        }),
        Effect.catchCause(() => Effect.succeed(undefined)),
      ),
    });
  }));
