import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as NodeOS from "node:os";

// The keys below are shared with provider-testing's HostProcess.ts, so one provided value serves both packages.
export const Platform = Context.Reference<NodeJS.Platform>("@lgtm/t3-host-process/Platform", {
  defaultValue: () => process.platform,
});

export const HomeDirectory = Context.Reference<string>("@lgtm/t3-host-process/HomeDirectory", {
  defaultValue: () => NodeOS.homedir(),
});

export const isWindows = Effect.map(Platform, (platform) => platform === "win32");
