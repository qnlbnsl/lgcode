// The rename from LGcode to LGTM Studio (2026-11-12) keeps an existing
// installation working: LGCODE_ variables are adopted under their LGTM_
// names, and the old state folder is used while the new one is absent.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adoptLegacyVariables, isServiceVariable } from "@lgtm/contracts";
import { stateFolder as clientStateFolder } from "@lgtm/client";
import { afterEach, expect, it } from "vitest";

import { stateFolder } from "../../src/api/stateFolder.ts";
import { buildBaseEnvironment } from "../../src/runner/baseEnvironment.ts";

const roots: Array<string> = [];
const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "lgtm-legacy-names-"));
  roots.push(root);
  return root;
};
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("adopts an LGCODE_ variable under its LGTM_ name and removes the old name", () => {
  const environment: Record<string, string | undefined> = { LGCODE_WEB_PASSWORD: "old", LGCODE_HOME: "/state", PATH: "/bin" };
  adoptLegacyVariables(environment);
  expect(environment).toEqual({ LGTM_WEB_PASSWORD: "old", LGTM_HOME: "/state", PATH: "/bin" });
});

it("keeps an LGTM_ variable that is already set, and still removes the old name", () => {
  const environment: Record<string, string | undefined> = { LGCODE_TOKEN: "old", LGTM_TOKEN: "new" };
  adoptLegacyVariables(environment);
  expect(environment).toEqual({ LGTM_TOKEN: "new" });
});

it("treats both prefixes as the service's own variables", () => {
  expect(isServiceVariable("LGTM_TOKEN")).toBe(true);
  expect(isServiceVariable("LGCODE_TOKEN")).toBe(true);
  expect(isServiceVariable("PATH")).toBe(false);
});

it("never passes an account variable with the old prefix to an agent", () => {
  const environment = buildBaseEnvironment({ parent: {}, accountVariables: { LGCODE_WEB_PASSWORD: "secret", LGTM_TOKEN: "secret", KEEP: "yes" } });
  expect(environment).toEqual({ KEEP: "yes" });
});

for (const [name, resolve] of [["engine", stateFolder], ["client", clientStateFolder]] as const) {
  it(`${name}: uses the new state folder when neither folder exists`, () => {
    const home = scratch();
    expect(resolve({ HOME: home })).toBe(join(home, ".local/state/lgtm"));
  });

  it(`${name}: keeps the old state folder while the new one is absent`, () => {
    const home = scratch();
    mkdirSync(join(home, ".local/state/lgcode"), { recursive: true });
    expect(resolve({ HOME: home })).toBe(join(home, ".local/state/lgcode"));
  });

  it(`${name}: prefers the new state folder once it exists`, () => {
    const home = scratch();
    mkdirSync(join(home, ".local/state/lgcode"), { recursive: true });
    mkdirSync(join(home, ".local/state/lgtm"), { recursive: true });
    expect(resolve({ HOME: home })).toBe(join(home, ".local/state/lgtm"));
  });

  it(`${name}: applies the same rule under XDG_STATE_HOME`, () => {
    const state = scratch();
    mkdirSync(join(state, "lgcode"));
    expect(resolve({ XDG_STATE_HOME: state })).toBe(join(state, "lgcode"));
  });
}
