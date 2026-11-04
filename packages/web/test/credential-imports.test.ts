import { resolve } from "node:path"
import { expect, it } from "vitest"
import { build } from "vite"

type BuildOutput = { readonly output: ReadonlyArray<{ readonly type: string; readonly modules?: Readonly<Record<string, unknown>> }> }

it("7.1 bundles the browser client entry without importing its Node credential path", async () => {
  const root = resolve(process.cwd(), "packages/web")
  const output = await build({
    configFile: false,
    root,
    logLevel: "silent",
    build: { write: false, rollupOptions: { input: `${root}/index.html` } }
  }) as unknown as BuildOutput | BuildOutput[]
  const entries = Array.isArray(output) ? output.flatMap((result) => result.output) : output.output
  const modules = entries.flatMap((entry) => entry.type === "chunk" ? Object.keys(entry.modules ?? {}) : [])

  expect(modules.some((id) => id.endsWith("/packages/client/src/browser.ts")), "page must use the cookie-authenticated browser client")
    .toBe(true) // catches bypassing the shared browser API
  expect(modules.some((id) => id.endsWith("/packages/client/src/node.ts")), "browser build must not import Node credential resolution")
    .toBe(false) // catches bundling the local credential path into the page
})
