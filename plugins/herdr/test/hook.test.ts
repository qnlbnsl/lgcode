import { expect, it } from "vitest";
import { checkPluginHook, herdrInstalled } from "../src/checkHook.ts";

it("skips the optional hook when Herdr is absent without launching a service", async () => {
  const environment = { PATH: "/nonexistent-herdr-path", HOME: "/nonexistent-home" };
  expect(herdrInstalled(environment)).toBe(false);
  expect(await checkPluginHook(environment)).toBeUndefined();
});

it("checks the declared startup hook twice in private state and cleans it up", async () => {
  // An executable fixture makes this check independent of the host's plugins.
  // The probe executes the manifest's lgtm command, and never this binary.
  const result = await checkPluginHook({ PATH: process.env.PATH, HERDR_BIN_PATH: process.execPath });
  expect(result?.passed).toBe(true);
  expect(result?.reason).toContain("a second invocation reuses it");
}, 45_000);
