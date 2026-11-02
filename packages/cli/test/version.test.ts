import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { cleanupUnit7b, finishCli, prepareRoot, serviceEnvironment, startCli } from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

it("V01 (7.14) catches a stale hardcoded version, the old stub, or --version attempting an engine connection", async () => {
  const root = prepareRoot();
  // No service exists; both identity variables are absent.
  const child = startCli(root, ["--version"], serviceEnvironment(root));
  const exit = await finishCli(child);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  expect(exit).toEqual({ code: 0, signal: null });
  expect(child.stdout().trim()).toBe(manifest.version);
  expect(child.stderr()).toBe("");
});
