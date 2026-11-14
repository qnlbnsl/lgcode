// Compose installer metadata with the model-choice patches in the live copy.
export function harnessIntegrationSource(path: string, source: string): string {
  const replace = (from: string, to: string) => {
    if (!source.includes(from)) throw new Error(`Harness installer integration no longer matches ${path}`)
    source = source.replace(from, to)
  }
  if (path === "js/live/git.js") {
    replace("Object.assign(HARNESSES, mapping.mapHarnesses([h], [report]))", "Object.assign(HARNESSES, mapping.mapInstalledHarnesses({ ...HARNESSES, ...mapping.mapHarnesses([h], [report]) }, installationReply.harnesses, recipes))")
  }
  if (path === "js/screens/service.js") {
    // Keep the old explicit defaults bookmark usable through the shared editor.
    replace('<${Body} key=${cur[0]', '${want === \'defaults\' && html`<${HarnessDefaults} s=${s} />`}<${Body} key=${cur[0]')
  }
  return source
}
