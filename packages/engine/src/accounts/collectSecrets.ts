import { pieceNamespaces } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import { SecretStore } from "../commands/SecretStore.ts";
import type { Snapshot } from "../commands/internal.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { guardPiece } from "../pieces/guardPiece.ts";
export const collectSecrets = (snapshot: Snapshot, lists: EngineLists = engineLists) => Effect.gen(function* () {
  const secrets = yield* SecretStore;
  if (secrets.retainOnly === undefined) return;
  const keep = new Set<string>();
  for (const account of Object.values(snapshot.accounts)) {
    if (account.secret !== undefined && !account.secret.startsWith("secret:client.")) keep.add(account.secret);
    for (const value of Object.values(account.environment ?? {})) if (value.startsWith("secret:") && !value.startsWith("secret:client.")) keep.add(value);
  }
  const failed = Symbol("collection failed");
  for (const namespace of pieceNamespaces) {
    const references = guardPiece("secretKeep", namespace, (): ReadonlyArray<string> | typeof failed => lists.secretKeep[namespace](snapshot), failed);
    if (references === failed) return;
    for (const reference of references) keep.add(reference);
  }
  yield* secrets.retainOnly(keep).pipe(Effect.catchTag("LogWriteFailed", () => Effect.logWarning("unreferenced secret collection failed")));
});
