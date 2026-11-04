import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { expect, it } from "vitest";
import { mintAgentToken } from "../../src/identity/tokens.ts";
import * as HostServer from "../../src/api/server.ts";
import { ancestryHeaders, authorization, upgradeStatus } from "../support/socketClient.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { seedAgent } from "../support/handlerRig.ts";
import { rows, login, post, upgrade, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

it("5.3 host credentials: catches accepting a bearer credential, an agent token or an owner-shaped cookie on the web listener", async () => withWeb((ctx) => Effect.gen(function* () {
  const agent = yield* seedAgent({ id: "web-host-token" });
  const unknownAgent = Redacted.value(mintAgentToken().token);
  const owner = randomBytes(32).toString("base64url");
  const hostSocket = join(ctx.rig.stateFolder, "engine.sock");
  yield* HostServer.serve({ socketPath: hostSocket, ownerCredential: Redacted.make(owner), debug: false });
  for (const value of [owner, agent.token]) {
    expect((yield* Effect.promise(() => upgradeStatus(hostSocket, { ...authorization(value), ...ancestryHeaders() }))).status).toBe(101);
  }
  const { cookie } = yield* login(ctx);
  const cookieName = cookie.slice(0, cookie.indexOf("="));
  const before = yield* rows;
  for (const token of [owner, agent.token, unknownAgent, ctx.password]) {
    for (const headers of [{ Authorization: `Bearer ${token}` }, { Cookie: `${cookieName}=${token}` }, { Cookie: `owner-credential=${token}` }]) {
      expect((yield* Effect.promise(() => post(ctx, "/api/session", undefined, headers))).status).toBe(401);
      expect((yield* upgrade(ctx, headers)).status).toBe(401);
    }
  }
  expect(JSON.stringify(yield* rows) === JSON.stringify(before), "a host credential reached the web command handler").toBe(true);
})));
