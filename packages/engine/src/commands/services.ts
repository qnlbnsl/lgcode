import type { Caller } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { Restart } from "../recovery/service.ts";
import { CommandHandler } from "./CommandHandler.ts";
import { refused } from "./internal.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { pieceNamespace } from "./pieceBatch.ts";
const permitted = (service: string, name: string, lists: EngineLists): boolean =>
  Object.hasOwn(lists.services, service) && lists.services[service]?.includes(name) === true
  && lists.access[name]?.includes("service") === true
  && (pieceNamespace(name) !== undefined || ["prompt", "compact", "resume", "subscribe"].includes(name));
export const executeService = (caller: Extract<Caller, { _tag: "service" }>, name: string, payload: Record<string, unknown>, lists: EngineLists = engineLists) => Effect.gen(function* () {
  if (!permitted(caller.service, name, lists)) return yield* refused();
  return yield* (yield* CommandHandler).execute(caller, name, payload);
});
export const subscribeService = (service: string, after: number, lists: EngineLists = engineLists) => Stream.unwrap(Effect.gen(function* () {
  if (!permitted(service, "subscribe", lists)) return yield* refused();
  const recovery = yield* Effect.serviceOption(Restart);
  if (Option.isSome(recovery) && !(yield* recovery.value.ready)) return yield* refused("recovering");
  const input = yield* (yield* CommandHandler).input({ _tag: "service", service });
  return lists.reads.subscribe!({ ...input, runtime: { ...input.runtime, lists } }, { after }) as Stream.Stream<import("@shephrd/contracts").EventEnvelope, unknown, any>;
}));
