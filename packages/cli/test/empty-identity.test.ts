import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { agentEnvironment, assertNoSecrets, cleanupUnit7b, fakeEngine, finishCli, ownerCredential, prepareRoot, serviceEnvironment, startCli, token } from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

for (const [name, variables, kind] of [
  ["empty socket", { LGTM_SOCKET: "" }, "refused"],
  ["empty token", { LGTM_TOKEN: "" }, "refused"],
  ["both empty", { LGTM_SOCKET: "", LGTM_TOKEN: "" }, "refused"],
  ["empty socket with token", { LGTM_SOCKET: "", LGTM_TOKEN: token }, "refused"],
  ["empty token with socket", { LGTM_SOCKET: "SOCKET_FIXTURE", LGTM_TOKEN: "" }, "refused"],
  ["both unset", {}, "owner"],
  ["both set", {}, "agent"],
] as const) {
  it(`X33 CLI ${name} (T-3) catches falling back to owner for an empty identity or choosing the wrong valid credential`, async () => {
    const root = prepareRoot();
    const peer = await fakeEngine(root);
    const marker = join(root.root, "credential-reads");
    writeFileSync(marker, "");
    const child = startCli(root, ["ask", "--input", JSON.stringify({ text: "Identity checked?" })], {
      ...(kind === "agent" ? agentEnvironment(root) : serviceEnvironment(root)), ...variables,
      ...("LGTM_SOCKET" in variables && variables.LGTM_SOCKET === "SOCKET_FIXTURE" ? { LGTM_SOCKET: root.socket } : {}),
      NODE_OPTIONS: `--import=${new URL("./support/credentialReads.ts", import.meta.url).href}`,
      LGTM_TEST_CREDENTIAL_PATH: join(root.state, "owner-credential"),
      LGTM_TEST_CREDENTIAL_READS: marker,
    });
    const exit = await finishCli(child);
    expect.soft(readFileSync(marker, "utf8"), "owner credential read count").toBe(kind === "owner" ? "read\n" : "");
    expect.soft(peer.upgrades).toHaveLength(kind === "refused" ? 0 : 1);
    expect.soft(exit).toEqual({ code: kind === "refused" ? 1 : 0, signal: null });
    if (kind === "refused") expect.soft(child.stderr()).toMatch(/LGTM_SOCKET|LGTM_TOKEN|identity|empty/i);
    else expect(peer.upgrades[0]!.authorization === `Bearer ${kind === "owner" ? ownerCredential : token}`).toBe(true);
    assertNoSecrets(child, [ownerCredential, token]);
  });
}
