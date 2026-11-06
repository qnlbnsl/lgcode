import { spawnSync } from "node:child_process";
import { resolveIdentity, type Environment } from "@sheprd/client";
import { connectViewer } from "@sheprd/viewer/connection";

// Herdr action commands run in the background. The action opens the declared
// pane, whose terminal runs `sheprd view` with the same owner identity checks.
export const openViewerPane = async (environment: Environment): Promise<number> => {
  try {
    if (resolveIdentity(environment).kind !== "owner") throw new Error("Owner required");
    // Authenticate the action's process before asking Herdr to spawn a pane.
    // Otherwise an agent that clears its variables could launder its ancestry
    // through Herdr's server, which starts the viewer outside the agent's tree.
    const client = await connectViewer(environment);
    await client.close();
    const result = spawnSync(environment.HERDR_BIN_PATH || "herdr", [
      "plugin", "pane", "open", "--plugin", "sheprd", "--entrypoint", "view",
    ], { env: environment, stdio: "ignore" });
    if (result.status === 0 && result.error === undefined) return 0;
  } catch { /* No environment, subprocess output or identity data in errors. */ }
  process.stderr.write("sheprd: the owner viewer pane could not be opened.\n");
  return 1;
};

process.exitCode = await openViewerPane(process.env);
