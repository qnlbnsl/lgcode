// The product was called LGcode until 2026-11-12. An installation from that
// time keeps working: its LGCODE_ variables and its state folder are read
// when the LGTM_ ones are absent.

export const legacyVariablePrefix = "LGCODE_"
export const variablePrefix = "LGTM_"

// Copies each LGCODE_ variable to its LGTM_ name when that name is unset, then
// removes the LGCODE_ name, so no child process inherits a second copy of a
// secret under a name the agent filters might not know.
export const adoptLegacyVariables = (environment: Record<string, string | undefined>): void => {
  for (const name of Object.keys(environment)) {
    if (!name.startsWith(legacyVariablePrefix)) continue
    const current = variablePrefix + name.slice(legacyVariablePrefix.length)
    if (environment[current] === undefined) environment[current] = environment[name]
    delete environment[name]
  }
}

// True for a variable that belongs to the owner's service, under either name.
export const isServiceVariable = (name: string): boolean =>
  name.startsWith(variablePrefix) || name.startsWith(legacyVariablePrefix)

// The default state folder's name, and the name it had before the rename.
export const stateFolderName = "lgtm"
export const legacyStateFolderName = "lgcode"
