import { serviceSettingsSource } from "./serviceSettings.ts"
import { gitActionsSource } from "./gitActions.ts"
import { harnessChoicesSource } from "./harnessChoices.ts"
import { harnessIntegrationSource } from "./harnessIntegration.ts"
// Builds the live website into packages/studio/dist, which the engine serves at /studio/.
//
// 1. It copies the website from design/mock. The folders that are links there, fonts and
//    vendor/*, are copied as real files, because the engine's static server refuses any
//    path whose real location is outside its folder.
// 2. It rewrites index.html for the engine's content security policy, which allows no
//    inline script: the colour-mode script moves to theme.js, and the page loads live.js
//    instead of js/main.js, so the website starts in live mode.
// 3. It bundles src/live.ts, with the connection and the mapping, as live.js.
//
// The sample gets generated contracts and the canonical default before copying.
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const mock = fileURLToPath(new URL("../../../design/mock/", import.meta.url))
const defaultDist = join(root, "dist")

// The parts of design/mock that the page loads. Its notes and briefs stay behind.
const parts = ["css", "js", "fonts", "vendor", "plans", "workflows"]

export function rewriteIndex(html: string): { readonly page: string; readonly theme: string } {
  const inline = /<script>\s*([\s\S]*?)\s*<\/script>/.exec(html)
  if (inline === null) throw new Error("design/mock/index.html has no colour-mode script to move")
  const main = '<script type="module" src="js/main.js"></script>'
  if (!html.includes(main)) throw new Error("design/mock/index.html no longer loads js/main.js")
  const page = html
    .replace(inline[0], '<script src="theme.js"></script>')
    .replace(main, '<script type="module" src="live.js"></script>')
    // The policy allows no data: address, and an empty icon is not needed.
    .replace(/\s*<link rel="icon" href="data:,">/, "")
  return { page, theme: inline[1]! + "\n" }
}

function assertNoLinks(folder: string): void {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name)
    const info = lstatSync(path)
    if (info.isSymbolicLink()) throw new Error(`${path} is still a link`)
    if (info.isDirectory()) assertNoLinks(path)
  }
}

// Browser fixtures can build concurrently. Publish complete sample assets with
// a rename so another build or sample reader never sees a truncated file.
function writeGenerated(path: string, bytes: Buffer): void {
  const temporary = path + "." + randomUUID()
  writeFileSync(temporary, bytes)
  renameSync(temporary, path)
}

// Tests build into a folder of their own. The engine serves the default folder.
export async function buildStudio(dist = defaultDist): Promise<string> {
  rmSync(dist, { recursive: true, force: true })
  mkdirSync(dist, { recursive: true })
  // Both page modes use the contracts source. The mock's small re-export is
  // replaced in the live output, and its import map loads the same sample bundle.
  await build({
    configFile: false, root, logLevel: "warn",
    build: {
      outDir: join(dist, "js"), emptyOutDir: false, target: "esnext", copyPublicDir: false,
      lib: { entry: join(root, "src/workflows.ts"), formats: ["es"], fileName: () => "workflow-contracts.js" }
    }
  })
  const contracts = readFileSync(join(dist, "js/workflow-contracts.js"))
  writeGenerated(join(mock, "vendor/workflow-contracts.js"), contracts)
  mkdirSync(join(mock, "workflows"), { recursive: true })
  writeGenerated(join(mock, "workflows/build-loop.json"), readFileSync(join(root, "../engine/src/workflows/build-loop.json")))
  for (const part of parts) cpSync(join(mock, part), join(dist, part), { recursive: true, dereference: true })
  for (const path of ["js/screens/git.js", "js/actions.js", "js/live/git.js", "js/live/board.js", "js/screens/service.js", "js/screens/auth.js", "js/dialogs.js", "js/ui.js", "js/screens/messages.js"]) {
    const target = join(dist, path)
    writeFileSync(target, serviceSettingsSource(path, gitActionsSource(path, harnessIntegrationSource(path, harnessChoicesSource(path, readFileSync(target, "utf8"))))))
  }

  writeFileSync(join(dist, "js/workflow-contracts.js"), contracts)
  const { page, theme } = rewriteIndex(readFileSync(join(mock, "index.html"), "utf8"))
  writeFileSync(join(dist, "index.html"), page)
  writeFileSync(join(dist, "theme.js"), theme)
  await build({
    configFile: false, root, logLevel: "warn",
    build: {
      outDir: dist, emptyOutDir: false, target: "esnext", modulePreload: false, copyPublicDir: false,
      rolldownOptions: { input: join(root, "src", "live.ts"), output: { entryFileNames: "live.js", chunkFileNames: "live-[name].js" } }
    }
  })
  assertNoLinks(dist)
  return dist
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await buildStudio()
  console.log(`Built the live website in ${out}`)
}
