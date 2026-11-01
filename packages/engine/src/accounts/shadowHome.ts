// The Codex home an account's child runs in. The copied managed layout
// (third_party/t3code/provider-instance/, T3 Code, MIT) keeps the instance
// "codex" on the shared home and gives every other account a private
// `auth.json` over symlinks into the shared home (rows 19, 33).
import { resolveManagedCodexHomeLayout } from "@shepherd/t3-provider-instance/CodexManagedHome";
import { materializeCodexShadowHome } from "@shepherd/t3-provider-instance/CodexHomeLayout";
import { HomeDirectory } from "@shepherd/t3-provider-instance/HostProcess";
import { ProviderInstanceId } from "@shepherd/t3-provider-instance/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class ShadowHomeFailed {
  readonly _tag = "ShadowHomeFailed";
}

const decodeInstance = Schema.decodeUnknownOption(ProviderInstanceId);

// The account's variables with CODEX_HOME set when the layout names an
// explicit home. No path or cause leaves this function.
export const withCodexHome = (
  input: { readonly stateFolder: string; readonly home: string; readonly accountId: string; readonly variables: Readonly<Record<string, string>> },
): Effect.Effect<Record<string, string>, ShadowHomeFailed, FileSystem.FileSystem | Path.Path> => Effect.gen(function* () {
  const instance = decodeInstance(input.accountId);
  if (instance._tag === "None") return yield* Effect.fail(new ShadowHomeFailed());
  const layout = yield* resolveManagedCodexHomeLayout(input.stateFolder, instance.value, {
    homePath: input.variables.CODEX_HOME ?? "", shadowHomePath: "",
  });
  yield* materializeCodexShadowHome(layout);
  return layout.effectiveHomePath === undefined ? { ...input.variables } : { ...input.variables, CODEX_HOME: layout.effectiveHomePath };
}).pipe(
  Effect.provideService(HomeDirectory, input.home),
  Effect.catch(() => Effect.fail(new ShadowHomeFailed())),
);
