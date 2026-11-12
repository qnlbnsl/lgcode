import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { makeNodeSocket } from "@lgtm/client/nodeSocket";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { connectWith } from "../../../client/src/core.ts";
import { serve } from "../../src/api/server.ts";
import type { Rig } from "./handlerRig.ts";
import { ancestryHeaders, authorization, socketUrl } from "./socketClient.ts";

export const boardOwnerClient = (rig: Rig) => Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url");
  const socketPath = join(rig.stateFolder, "board-wait.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: false });
  return yield* connectWith({ attempts: 1, makeSocket: () => makeNodeSocket(socketUrl(socketPath), {
    headers: { ...authorization(bearer), ...ancestryHeaders() },
  }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) });
});
