import { harnessChoicesSource } from "./harnessChoices.ts"
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
// design/mock itself is not changed. It still opens on its own, on its sample data.
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const mock = fileURLToPath(new URL("../../../design/mock/", import.meta.url))
const defaultDist = join(root, "dist")

// The parts of design/mock that the page loads. Its notes and briefs stay behind.
const parts = ["css", "js", "fonts", "vendor", "plans"]

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

// Tests build into a folder of their own. The engine serves the default folder.
export async function buildStudio(dist = defaultDist): Promise<string> {
  rmSync(dist, { recursive: true, force: true })
  mkdirSync(dist, { recursive: true })
  for (const part of parts) cpSync(join(mock, part), join(dist, part), { recursive: true, dereference: true })
  for (const path of ["js/live/git.js", "js/live/board.js", "js/screens/service.js", "js/screens/auth.js", "js/dialogs.js", "js/ui.js", "js/screens/messages.js"]) {
    const target = join(dist, path)
    writeFileSync(target, harnessChoicesSource(path, readFileSync(target, "utf8")))
  }
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
