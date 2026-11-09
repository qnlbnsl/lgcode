import * as Contracts from "../../src/index.ts";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import { expect } from "vitest";

export const clientCommands = [
  "client.snapshot", "client.roster", "client.thread", "client.subscribe", "client.event", "client.sequence",
  "client.alerts.retry", "client.alerts.test", "client.alerts.prompt.dismiss",
  "client.alerts.list", "client.alerts.dismiss", "client.alerts.settings", "client.alerts.settings.set",
  "client.alerts.carrier.set", "client.alerts.carrier.set-token", "client.alerts.carrier.clear-token",
  "client.web.settings", "client.web.settings.set",
] as const;
export const clientTags = [
  "client.AlertBaseline", "client.AlertRaised", "client.AlertDelivered", "client.AlertDeliveryFailed",
  "client.AlertPromptDismissed", "client.AlertCleared", "client.AlertSettingsChanged", "client.AlertCarrierChanged",
  "client.AlertCarrierTokenSet", "client.AlertCarrierTokenCleared", "client.WebSettingsChanged",
  "client.WebServerDown", "client.WebServerUp",
] as const;

export const definitions = () => {
  const group = (Contracts as unknown as { ClientRpcGroup?: RpcGroup.RpcGroup<any> }).ClientRpcGroup;
  expect(group, "Unit 2 must export ClientRpcGroup definitions without installing unhandled commands").toBeDefined();
  return group!;
};

export const accessTable = () => {
  const access = (Contracts as unknown as { clientCommandAccess?: Record<string, readonly string[]> }).clientCommandAccess;
  expect(access, "ClientRpcGroup needs its own clientCommandAccess before handlers install commands").toBeDefined();
  return access!;
};
