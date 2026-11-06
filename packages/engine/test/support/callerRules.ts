// Unit 1b's test interfaces. These describe missing seams, not substitute
// implementations. Keep production authorization, planning and writes real.
import { existsSync } from "node:fs";
import type { EventEnvelope } from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import { expect } from "vitest";
import { fixtureLists, loadLists, withFixture, type EngineLists, type TestPlan, type View } from "./fixturePiece.ts";
import { registerRebuildCheck } from "./rebuildCheck.ts";

export type Caller =
  | { readonly _tag: "owner" }
  | { readonly _tag: "agent"; readonly agentId: string }
  | { readonly _tag: "service"; readonly service: string; readonly rule?: string }
  | { readonly _tag: "piece"; readonly namespace: string };
export interface DeliveryRequest { readonly target: string; readonly body: string; readonly sourceId: string }
export interface Batch extends TestPlan { readonly deliveries?: ReadonlyArray<DeliveryRequest> }
export interface ReachInput {
  readonly caller?: Caller;
  readonly target: string;
  readonly deliveryId: string;
  readonly source: { readonly _tag: "piece"; readonly namespace: string; readonly id: string };
  readonly snapshot: View;
}
export interface Rules extends EngineLists {
  readonly reach: Record<string, (input: ReachInput) => boolean>;
  readonly sourceRules: Record<string, () => "withdraw" | "return">;
  readonly holdUnsettled: Record<string, (state: View, agentId: string, pieceView: unknown) => boolean>;
  readonly requestHeld: Record<string, (state: View, agentId: string, pieceView: unknown) => boolean>;
  readonly secretKeep: Record<string, (view: View) => ReadonlyArray<string>>;
  readonly services: Record<string, ReadonlyArray<string>>;
  readonly secretCommands: ReadonlyArray<string>;
}
export async function requiredModule<T>(path: string): Promise<T> {
  const url = new URL(`../../src/${path}`, import.meta.url);
  expect(existsSync(url), `Unit 1b must implement ${path}; the interface is recorded in .foundry/tests-result.md`).toBe(true);
  return await import(/* @vite-ignore */ url.href) as T;
}
export async function rulesFixture(): Promise<Rules> {
  const base = fixtureLists(await loadLists()) as Rules;
  return {
    ...base,
    access: { ...base.access, "client.record": ["owner", "agent", "service"] },
    reach: { client: () => false, board: () => false, roles: () => false, ...base.reach },
    sourceRules: { client: () => "withdraw", board: () => "withdraw", roles: () => "withdraw", ...base.sourceRules },
    holdUnsettled: { client: () => false, board: () => false, roles: () => false, ...base.holdUnsettled },
    requestHeld: { client: () => false, board: () => false, roles: () => false, ...base.requestHeld },
    secretKeep: { client: () => [], board: () => [], roles: () => [], ...base.secretKeep },
    services: { ...base.services, "client.fixture": ["prompt", "compact", "resume", "subscribe", "client.record"] },
    secretCommands: base.secretCommands ?? ["accounts set-secret"],
  };
}
export const useRules = async (lists: Rules, body: Parameters<typeof withFixture>[1]) =>
  withFixture(lists, (rig, bearer) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    return yield* body(rig, bearer);
  }));
export interface Services {
  readonly executeService: (caller: Extract<Caller, { _tag: "service" }>, name: string, payload: Record<string, unknown>, lists: Rules) => Effect.Effect<Record<string, unknown>, unknown, any>;
  readonly subscribeService: (service: string, after: number, lists: Rules) => Stream.Stream<EventEnvelope, unknown, any>;
}
export interface PieceBatches {
  readonly writePieceBatch: (input: {
    readonly namespace: "client" | "board" | "roles";
    readonly kind: "reactor";
    readonly sourceSequence: number;
    readonly build: (view: View) => Batch;
  }, lists: Rules) => Effect.Effect<unknown, unknown, any>;
}
export const planWith = (lists: Rules, plan: (payload: Record<string, unknown>) => Batch): Rules => ({
  ...lists,
  planners: { ...lists.planners, "client.record": (_input, payload) => Effect.succeed(plan(payload)) },
});
export const record = (id = "record") => ({ _tag: "client.FixtureRecorded", id, text: "Fixture data." });
export const reply = (batch: ReadonlyArray<EventEnvelope>) => ({
  requestId: batch[0]?.requestId,
  id: (batch[0]?.event as unknown as { id?: string })?.id ?? "record",
  sequence: batch[0]?.sequence ?? 0,
});
