import type { CacheTarget } from "./cache.ts";
import type { Caller } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { Restart } from "../recovery/service.ts";
import { CommandHandler } from "./CommandHandler.ts";
import { readHarnesses, refused } from "./internal.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { pieceNamespace } from "./pieceBatch.ts";
const permitted = (service: string, name: string, lists: EngineLists): boolean =>
  Object.hasOwn(lists.services, service) && lists.services[service]?.includes(name) === true
  && lists.access[name]?.includes("service") === true
  && (pieceNamespace(name) !== undefined || ["prompt", "compact", "resume", "release", "subscribe"].includes(name));
// Cache timing needs the engine's configured home and the owner's harness
// lifetimes. Keep the raw runtime, SQL and account credentials inside the
// engine boundary; this helper exposes only these nonsecret settings.
export const serviceCacheSettings = (caller: Extract<Caller, { _tag: "service" }>, lists: EngineLists = engineLists) => Effect.gen(function* () {
  if (caller.service !== "roles.stallWatch" || !permitted(caller.service, "client.event", lists)) return yield* refused();
  const input = yield* (yield* CommandHandler).input(caller);
  return { home: input.runtime.home, harnesses: (yield* readHarnesses(input.runtime)).map((harness) => ({
    id: harness.id, cacheLifetime: harness.cacheLifetime,
  })) };
});
export const executeService = (caller: Extract<Caller, { _tag: "service" }>, name: string, payload: Record<string, unknown>, lists: EngineLists = engineLists) => Effect.gen(function* () {
  if (!permitted(caller.service, name, lists)) return yield* refused();
  return yield* (yield* CommandHandler).execute(caller, name, payload);
});
export const subscribeService = (service: string, after: number, lists: EngineLists = engineLists) => Stream.unwrap(Effect.gen(function* () {
  if (!permitted(service, "subscribe", lists)) return yield* refused();
  const recovery = yield* Effect.serviceOption(Restart);
  if (Option.isSome(recovery) && !(yield* recovery.value.ready)) return yield* refused("recovering");
  const input = yield* (yield* CommandHandler).input({ _tag: "service", service });
  return lists.reads.subscribe!({ ...input, runtime: { ...input.runtime, lists } }, { after }) as Stream.Stream<import("@lgtm/contracts").EventEnvelope, unknown, any>;
}));

// This is an internal composite of the existing compact and board.flush
// rights, not a new public command or an expanded service permission.
export const serviceCacheAction = (caller: Extract<Caller, { _tag: "service" }>, target: CacheTarget, lists: EngineLists = engineLists) => Effect.gen(function* () {
  if (caller.service !== "roles.stallWatch" || !permitted(caller.service, "compact", lists)
    || !permitted(caller.service, "board.flush", lists)) return yield* refused();
  return yield* (yield* CommandHandler).cache(target);
});
