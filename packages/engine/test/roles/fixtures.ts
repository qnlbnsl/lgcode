import { type Event, type EventSequence } from "@shephrd/contracts";
import { createHash } from "node:crypto";
import { expect } from "vitest";
import { apply, emptyViews, type State } from "../../src/views/apply.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { event, envelopes, started } from "../support/viewFixtures.ts";

export { event, envelopes };
export const owner = { _tag: "owner" } as const;
export const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
export const start = (agentId = "worker", overrides: Record<string, unknown> = {}): Event => event({
  ...started, agentId, name: `Name ${agentId}`, role: "worker:builder", permission: "ask", ...overrides,
});
export const action = (kind: string, overrides: Record<string, unknown> = {}): Event => event(Object.fromEntries(Object.entries({
  _tag: `roles.${kind}`, agentId: "worker", noticeRecipient: "owner", triggerSequence: 1,
  sourceSequence: 2, occurrence: 1, notice: "sent", postId: `notice-${kind}`,
  ...(kind === "TeamIdleReported" ? { group: "build" } : {}),
  ...(kind === "GaveUp" ? { cause: "crash", engineAlertOpen: false } : {}),
  ...overrides,
}).filter(([, value]) => value !== undefined)));
export const fileEvent = (advice = "Report to the lead."): Event => {
  const content = JSON.stringify({ name: "Build team", roles: { builder: { advice, limits: { stallMinutes: 10 } } } });
  return event({ _tag: "roles.RoleFileSet", content, roleFileHash: createHash("sha256").update(content).digest("hex") });
};

// These are the observable data seams for task 1d. No reducer, paging,
// visibility, counter or snapshot algorithm is implemented in the fixtures.
export interface ActionRecord {
  readonly _tag: string;
  readonly sequence: number;
  readonly agentId: string;
  readonly triggerSequence: number;
  readonly sourceSequence: number;
  readonly occurrence: number;
  readonly noticeRecipient: string;
  readonly notice: string;
  readonly postId?: string;
  readonly noticeRead?: boolean;
}
export interface Matter { readonly key: string; readonly kind: string; readonly agentId: string }
export interface AgentRoles {
  readonly highestPermission: string;
  readonly startedSequence: number;
  readonly turnStartSequence?: number;
  readonly turnEndSequence?: number;
  readonly crashSequence?: number;
  readonly stallCount: number;
  readonly crashRetries: number;
  readonly capacityRetries: number;
  readonly openCrash?: ActionRecord;
  readonly matters: ReadonlyArray<Matter>;
}
export interface RolesView {
  readonly file: { readonly name: string } | null;
  readonly roleFileHash: string | null;
  readonly settings: Record<string, unknown>;
  readonly snoozes: Readonly<Record<string, number>>;
  readonly actions: ReadonlyArray<ActionRecord>;
  readonly agents: Readonly<Record<string, AgentRoles>>;
  readonly position: number;
}
export interface CutList<T> { readonly items: ReadonlyArray<T>; readonly truncated: boolean }
export interface RolesSection {
  readonly roleFile: { readonly name: string; readonly roleFileHash: string } | null;
  readonly settings: Record<string, unknown>;
  readonly matters: CutList<Matter>;
  readonly snoozes: CutList<{ readonly group: string; readonly until: number }>;
  readonly agents: CutList<{ readonly agentId: string; readonly actions: ReadonlyArray<ActionRecord> }>;
}
export const roles = (view: State): RolesView => {
  const value = view.roles as RolesView;
  expect(value?.agents, "1d must extend the role-file-only fold with the roles agent index").toBeDefined();
  expect(value?.actions, "1d must fold roles action records").toBeDefined();
  return value;
};
export const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
export const fold = (events: ReadonlyArray<Event>) => envelopes(events).reduce((view, row) => apply(freeze(view), freeze(row)), emptyViews());
export const section = (view: State, caller: Parameters<typeof engineLists.snapshotSections.roles>[0] = owner): RolesSection => {
  const value = engineLists.snapshotSections.roles(caller, view);
  expect(value, "1d must register the bounded roles snapshotFor section").toBeDefined();
  return value as RolesSection;
};
export const seq = (n: number) => n as EventSequence;
