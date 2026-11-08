import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { auditCredentialReads } from "../../cli/test/support/credentialReads.ts";
import { agentEnvironment, cleanupUnit7b, fakeEngine, loadClient, ownerCredential, prepareRoot, serviceEnvironment, token } from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

for (const [name, variables] of [
  ["empty socket", { LGCODE_SOCKET: "" }],
  ["empty token", { LGCODE_TOKEN: "" }],
  ["both empty", { LGCODE_SOCKET: "", LGCODE_TOKEN: "" }],
  ["empty socket with token", { LGCODE_SOCKET: "", LGCODE_TOKEN: token }],
  ["empty token with socket", { LGCODE_SOCKET: "SOCKET_FIXTURE", LGCODE_TOKEN: "" }],
] as const) {
  it(`X31 client ${name} (T-3) catches treating an explicitly empty identity as unset and reading the owner credential`, async () => {
    const connect = await loadClient();
    const root = prepareRoot();
    const peer = await fakeEngine(root);
    const marker = join(root.root, "credential-reads");
    writeFileSync(marker, "");
    const restore = auditCredentialReads(join(root.state, "owner-credential"), marker);
    try {
      const environment: Record<string, string> = { ...serviceEnvironment(root), ...variables };
      if (environment.LGCODE_SOCKET === "SOCKET_FIXTURE") environment.LGCODE_SOCKET = root.socket;
      const exit = await Effect.runPromiseExit(Effect.scoped(connect({ environment })));
      expect.soft(readFileSync(marker, "utf8"), "owner credential was read before refusing an incomplete agent identity").toBe("");
      expect.soft(peer.upgrades, "an empty identity reached a peer").toHaveLength(0);
      expect.soft(Exit.isFailure(exit), "an explicitly empty identity must fail").toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toMatch(/LGCODE_SOCKET|LGCODE_TOKEN|identity|empty/i);
    } finally { restore(); }
  });
}

for (const kind of ["owner", "agent"] as const) {
  it(`X32 client ${kind} (T-3 control) catches refusing a valid identity or reading the wrong credential source`, async () => {
    const connect = await loadClient();
    const root = prepareRoot();
    const peer = await fakeEngine(root);
    const marker = join(root.root, "credential-reads");
    writeFileSync(marker, "");
    const restore = auditCredentialReads(join(root.state, "owner-credential"), marker);
    try {
      const environment = kind === "owner" ? serviceEnvironment(root) : agentEnvironment(root);
      const exit = await Effect.runPromiseExit(Effect.scoped(connect({ environment })));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(readFileSync(marker, "utf8")).toBe(kind === "owner" ? "read\n" : "");
      expect(peer.upgrades).toHaveLength(1);
      expect(peer.upgrades[0]!.authorization === `Bearer ${kind === "owner" ? ownerCredential : token}`).toBe(true);
    } finally { restore(); }
  });
}
