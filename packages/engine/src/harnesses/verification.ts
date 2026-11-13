import { readFileSync, realpathSync } from "node:fs"
import { join, sep } from "node:path"
import type { RecipeDefinition } from "./recipes.ts"

// Use the nearest package boundary, so a nested dependency cannot inherit the
// identity of an expected package further up the path.
export function isPackageProgram(real: string, name: string): boolean {
  const parts = real.split(sep), index = parts.lastIndexOf("node_modules"), expected = name.split("/")
  return index >= 0 && parts.length > index + 1 + expected.length && expected.every((part, i) => parts[index + 1 + i] === part)
}

export function verifyStagedTree(prefix: string, recipe: RecipeDefinition): void {
  const committed = (name: string) => readFileSync(new URL(`./locks/${recipe.harnessId}/${name}`, import.meta.url))
  for (const name of ["package.json", "package-lock.json"]) {
    if (!readFileSync(join(prefix, name)).equals(committed(name))) throw new Error("recipe mismatch")
  }
  const expected = JSON.parse(committed("package-lock.json").toString()).packages
  const actual = JSON.parse(readFileSync(join(prefix, "node_modules/.package-lock.json"), "utf8")).packages
  const keys = Object.keys(expected).filter((key) => key !== "").sort()
  if (!actual || JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(keys)) throw new Error("recipe mismatch")
  for (const key of keys) {
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length)
    for (const field of ["name", "version", "resolved", "integrity"]) {
      const wanted = expected[key][field] ?? (field === "name" ? name : undefined)
      const found = actual[key]?.[field] ?? (field === "name" ? name : undefined)
      if (wanted !== found) throw new Error("recipe mismatch")
    }
  }
  const name = recipe.packages[0]!.slice(0, recipe.packages[0]!.lastIndexOf("@"))
  const folder = join(prefix, "node_modules", ...name.split("/"))
  const executable = realpathSync(join(prefix, "node_modules", ".bin", recipe.executable))
  if (realpathSync(folder) !== folder || !executable.startsWith(folder + sep) || !isPackageProgram(executable, name)) throw new Error("recipe mismatch")
}
