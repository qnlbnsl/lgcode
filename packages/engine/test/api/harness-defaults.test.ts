// Fix round 1, N-1 (owner choices, 2026-11-03), through the real service: a
// fresh state folder lists the pinned Claude and Codex adapters without any
// `harnesses set`; a restart leaves the owner's edit alone; `harnesses reset`
// through the client restores the default.
import { afterEach, expect, it } from "@effect/vitest";
import type { HarnessSettings } from "@lgtm/contracts";
import * as Effect from "effect/Effect";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { makeServiceRoot, ownerClient, requestId, startService, stopAllServices, waitServing } from "../support/serviceProcess.ts";

registerRebuildCheck({ noLog: true });

const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);
afterEach(async () => { await stopAllServices(); });

const listed = (root: ReturnType<typeof makeServiceRoot>) => Effect.scoped(Effect.gen(function* () {
  const client = yield* ownerClient(root);
  return ((yield* client.harnesses({ requestId: requestId(), operation: "list" } as never)) as { harnesses: ReadonlyArray<HarnessSettings> }).harnesses;
}));

live("N-1 a fresh service lists the pinned harnesses, a restart keeps the owner's edit, and reset restores the default (breaks if a fresh state folder lists nothing, a restart reloads over an edit, or reset is not served)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const first = startService(root);
    yield* waitServing(root, first);
    const initial = yield* listed(root);
    const claude = initial.find((harness) => harness.id === "claude");
    expect(claude?.adapterPath).toMatch(/\/node_modules\/\.bin\/claude-agent-acp$/);
    expect(initial.find((harness) => harness.id === "codex")?.adapterPath).toMatch(/\/node_modules\/\.bin\/codex-acp$/);

    const edited = { ...claude!, adapterArguments: ["--edited"] };
    yield* Effect.scoped(Effect.gen(function* () {
      const client = yield* ownerClient(root);
      yield* client.harnesses({ requestId: requestId(), operation: "set", harness: edited } as never);
    }));
    first.child.kill("SIGTERM");
    yield* Effect.promise(() => first.exit);

    const second = startService(root);
    yield* waitServing(root, second);
    expect((yield* listed(root)).find((harness) => harness.id === "claude")).toEqual(edited);

    yield* Effect.scoped(Effect.gen(function* () {
      const client = yield* ownerClient(root);
      const reply = (yield* client.harnesses({ requestId: requestId(), operation: "reset" } as never)) as { harnesses: ReadonlyArray<HarnessSettings> };
      expect(reply.harnesses.find((harness) => harness.id === "claude")).toEqual(claude);
    }));
    expect((yield* listed(root)).find((harness) => harness.id === "claude")).toEqual(claude);
  }), 120_000);
