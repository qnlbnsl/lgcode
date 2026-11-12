import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Test files start without the invoking agent's credentials or socket settings.
const privateEnvironment = /^(?:ANTHROPIC|CLAUDE|CODEX|OPENAI|GEMINI|GOOGLE|CURSOR|T3CODE|LGTM)_/;
for (const name of Object.keys(process.env)) {
  if (privateEnvironment.test(name)) delete process.env[name];
}

const stateDirectory = realpathSync(mkdtempSync(join(tmpdir(), "lgtm-test-")));
process.env["LGTM_HOME"] = stateDirectory;
afterAll(() => rmSync(stateDirectory, { recursive: true, force: true }));
