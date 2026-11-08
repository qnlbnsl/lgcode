import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HarnessSettings } from "@lgcode/contracts";

// Defaults deliberately remain `none`: the first adapter accepts session
// metadata only (issue 91); the other adapters have no verified launch rule.
// Owner-configured launch templates are expanded without a shell.
export const denyArguments = (harness: HarnessSettings, folder: string, stateFolder: string, environment: Record<string, string | undefined>): string[] => {
  const mechanism = harness.denyReadMechanism;
  if (mechanism._tag === "none") return [];
  const paths = [".claude/settings.json", ".claude/settings.local.json", ".claude/commands", ".claude/agents", ".mcp.json", ".codex", ".gemini", ".cursor", ".lgcode"].map((path) => join(folder, path));
  if (environment.CLAUDE_CONFIG_DIR !== undefined) paths.push(resolve(folder, environment.CLAUDE_CONFIG_DIR));
  return [
    ...mechanism.readArguments.map((argument) => argument.replaceAll("{stateFolder}", realpathSync(stateFolder))),
    ...paths.flatMap((path) => mechanism.writeArguments.map((argument) => argument.replaceAll("{settingsPath}", path))),
  ];
};
