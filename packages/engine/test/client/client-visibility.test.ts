import type { EventEnvelope } from "@shephrd/contracts";
import { expect, it } from "vitest";
import { clientTags } from "../../../contracts/test/client/support.ts";
import { visibleTo } from "../../src/api/visibility.ts";
import { emptyViews } from "../../src/views/apply.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it.each(clientTags)("2.9 %s remains invisible to its own agent through the production visibility function", (tag) => {
  const envelope = { sequence: 1, eventId: "alert-event", occurredAt: 0, agentId: "agent-a",
    caller: { _tag: "piece", namespace: "client" }, event: { _tag: tag, agentId: "agent-a" } } as unknown as EventEnvelope;
  // Pin the class too: an absent registration must not masquerade as an
  // intentional owner-only event merely because visibility fails closed.
  expect(engineLists.visibility[tag]).toBe("owner-only");
  expect(visibleTo({ _tag: "agent", agentId: "agent-a" } as never, envelope, emptyViews())).toBe(false);
  expect(visibleTo({ _tag: "owner" }, envelope, emptyViews())).toBe(true);
});
