import { expect, it } from "vitest";
import { capacityDecision } from "../../../../src/roles/sheepdog/rules/capacity.ts";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const held = {
  _tag: "DeliveryHeld",
  agentId: "worker",
  deliveryId: "delivery-1",
  reason: "capacity",
} as const;

it("CP01 releases the held delivery after the configured five-minute backoff", () => {
  expect(capacityDecision({
    event: held,
    now: 300_000,
    heldAt: 0,
    releasedCount: 0,
    capacityRetryLimit: 12,
  })).toEqual({ _tag: "release", agentId: "worker", deliveryId: "delivery-1" });
});

it("CP02 does not release a capacity hold before its five-minute deadline", () => {
  expect(capacityDecision({
    event: held,
    now: 299_999,
    heldAt: 0,
    releasedCount: 0,
    capacityRetryLimit: 12,
  })).toEqual({ _tag: "none" });
});

it("CP03 stops holding after twelve releases in the same outage", () => {
  expect(capacityDecision({
    event: held,
    now: 300_000,
    heldAt: 0,
    releasedCount: 12,
    capacityRetryLimit: 12,
  })).toEqual({ _tag: "none" });
});

it("CP08 reports capacity give-up from the capacity return, once per outage", () => {
  const returned = {
    _tag: "DeliveryReturned",
    agentId: "worker",
    deliveryId: "delivery-1",
    cause: "capacity",
  } as const;

  expect(capacityDecision({
    event: returned,
    now: 0,
    heldAt: 0,
    releasedCount: 12,
    capacityRetryLimit: 12,
    gaveUpForOutage: false,
  })).toEqual({ _tag: "gave-up", agentId: "worker", cause: "capacity" });

  expect(capacityDecision({
    event: returned,
    now: 0,
    heldAt: 0,
    releasedCount: 12,
    capacityRetryLimit: 12,
    gaveUpForOutage: true,
  })).toEqual({ _tag: "none" });
});

it("CP09 treats a non-capacity return as the end of an outage", () => {
  const returned = {
    _tag: "DeliveryReturned",
    agentId: "worker",
    deliveryId: "delivery-1",
    cause: "failed",
  } as const;

  expect(capacityDecision({
    event: returned,
    now: 0,
    heldAt: 0,
    releasedCount: 12,
    capacityRetryLimit: 12,
    gaveUpForOutage: false,
  })).toEqual({ _tag: "reset-outage", agentId: "worker" });
});
