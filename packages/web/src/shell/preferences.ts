export type ThemeChoice = "light" | "dark" | "system"
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function writePreference(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* Preferences are optional. */ }
}
export function themeChoice(): ThemeChoice {
  const saved = readPreference("lgcode-theme")
  return saved === "light" || saved === "dark" ? saved : "system"
}
export function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice === "system"
    ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light" : choice
}
export function initializeTheme() {
  applyTheme(themeChoice())
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(themeChoice()))
  window.addEventListener("storage", (event) => { if (event.key === "lgcode-theme" || event.key === null) applyTheme(themeChoice()) })
}
export const panelWidth = (value: number) => Number.isFinite(value) ? Math.round(Math.max(224, Math.min(360, value))) : 248
export const savedPanelWidth = () => {
  const saved = readPreference("lgcode-layout-sidebar")
  return saved === null ? 248 : panelWidth(Number(saved))
}
