import { createElement } from "react";
import { render } from "ink";
import * as Effect from "effect/Effect";
import type { Environment } from "@lgcode/client";
import { connectViewer } from "./connection.ts";
import { ViewerApp } from "./app.ts";

// All runtime modules use createElement in .ts files. Node 26 can run this
// source checkout directly, without a JSX loader or a generated bundle.
export const runViewer = (environment: Environment): Effect.Effect<number> =>
  Effect.tryPromise({
    try: async (signal) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("A terminal is required");
      const client = await connectViewer(environment, signal);
      let app: ReturnType<typeof render> | undefined;
      const stop = () => app?.unmount();
      try {
        if (signal.aborted) return 1;
        app = render(createElement(ViewerApp, { client }), { exitOnCtrlC: true });
        signal.addEventListener("abort", stop, { once: true });
        await app.waitUntilExit();
        return 0;
      } finally {
        signal.removeEventListener("abort", stop);
        app?.unmount();
        await client.close();
      }
    },
    catch: () => new Error("The viewer needs an owner terminal and a running engine."),
  }).pipe(Effect.catch(() => Effect.sync(() => {
    process.stderr.write("lgcode: the viewer needs an owner terminal and a running engine.\n");
    return 1;
  })));
