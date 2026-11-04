import { existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";

it.each(["core", "browser"])("2.8 %s bundles for the browser without reaching a Node.js built-in through any dependency", async (entry) => {
  const url = new URL(`../src/${entry}.ts`, import.meta.url);
  expect(existsSync(url), `E26 must supply ${entry}.ts`).toBe(true);
  const builtins = new Set(builtinModules);
  const output = await build({
    configFile: false, logLevel: "silent",
    plugins: [{ name: "reject-node-builtins", enforce: "pre", resolveId(id) {
      if (id.startsWith("node:") || builtins.has(id)) throw new Error(`Browser entry reaches Node.js import ${id}`);
      return null;
    } }],
    build: { write: false, minify: false, lib: { entry: fileURLToPath(url), formats: ["es"] },
      rollupOptions: { treeshake: false } },
  });
  const results = Array.isArray(output) ? output : [output];
  expect(results.some((result) => "output" in result && result.output.some((item) => item.type === "chunk" && item.code.length > 0))).toBe(true);
});
