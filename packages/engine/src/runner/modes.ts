import { comparePermission, type HarnessSettings, type PermissionLevel } from "@shepherd/contracts";

export const reportedLevel = (harness: HarnessSettings, mode: string, ceiling: PermissionLevel): PermissionLevel | undefined => {
  const level = harness.reportedModes.find((entry) => entry.id === mode)?.level;
  return level !== undefined && comparePermission(level, ceiling) <= 0 ? level : undefined;
};
