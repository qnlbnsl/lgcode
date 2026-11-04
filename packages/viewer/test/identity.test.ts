import { expect, it } from "vitest";
import * as viewer from "../src/index.ts";

type ConnectViewer = {
  readonly connectViewer: (environment: Readonly<Record<string, string | undefined>>) => Promise<unknown>;
};

const identity = viewer as unknown as ConnectViewer;

it("I81 catches a viewer that accepts agent credentials instead of the owner identity", async () => {
  expect(typeof identity.connectViewer, "viewer must establish its owner identity through the client library").toBe("function");

  await expect(identity.connectViewer({
    SHEPHRD_HOME: "/tmp/shephrd-viewer-identity",
    SHEPHRD_SOCKET: "/tmp/shephrd-viewer-identity/engine.sock",
    SHEPHRD_TOKEN: "agent-token-fixture",
  })).rejects.toThrow(/owner|agent|identity/i);
});
