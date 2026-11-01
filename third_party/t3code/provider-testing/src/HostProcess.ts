import * as Context from "effect/Context";

// The key below is shared with provider-instance's HostProcess.ts, so one provided value serves both packages.
export const Platform = Context.Reference<NodeJS.Platform>("@shepherd/t3-host-process/Platform", {
  defaultValue: () => process.platform,
});
