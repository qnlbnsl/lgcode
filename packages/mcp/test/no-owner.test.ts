import { afterEach, expect, it } from "vitest";
import {
  assertNoSecrets, cleanupUnit7b, fakeEngine, finishCli, ownerCredential, prepareRoot, serviceEnvironment, startCli,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

for (const socketSet of [false, true]) {
  it(`N01 socket ${socketSet ? "set" : "unset"} (7.13) catches MCP falling back to a readable owner credential when the agent token is absent`, async () => {
    const root = prepareRoot();
    const engine = await fakeEngine(root);
    const environment = { ...serviceEnvironment(root), ...(socketSet ? { LGTM_SOCKET: root.socket } : {}) };
    const child = startCli(root, ["mcp"], environment);
    const exit = await finishCli(child);
    expect(exit.code).not.toBe(0);
    expect(exit.signal).toBeNull();
    expect(child.stderr()).toMatch(/LGTM_TOKEN|agent token/i);
    expect(engine.upgrades).toHaveLength(0);
    assertNoSecrets(child, [ownerCredential]);
  });
}
