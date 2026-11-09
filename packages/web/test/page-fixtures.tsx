import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, vi } from "vitest"
import { snapshot } from "./project-fixtures.ts"
import type { ShellData } from "../src/data/ShellDataProvider.tsx"
import { createRequestSources } from "../src/data/requestSources.ts"

const pageEnvironment = vi.hoisted(() => ({ data: undefined as unknown as ShellData, disabled: false, client: {} as Record<string, unknown> }))
export const environment = pageEnvironment
vi.mock("../src/data/ShellDataProvider.tsx", () => ({ useShellData: () => pageEnvironment.data, useMutationDisabled: () => pageEnvironment.disabled }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(pageEnvironment.client) }
})

export { snapshot, request, questionEvent } from "./project-fixtures.ts"
export function resetData() {
  const value = snapshot()
  environment.data = { snapshot: value, navigation: value.project!, requests: [], alerts: [], connection: "Live", complete: true, retry: vi.fn(), onSessionExpired: vi.fn(), requestSources: createRequestSources() }
  environment.disabled = false
  environment.client = {}
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false } })
}
const mounts: { root: Root; container: HTMLDivElement }[] = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
export async function mount(node: ReactNode) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounts.push({ root, container })
  await act(async () => root.render(node))
  return { container, render: async (next: ReactNode) => { await act(async () => root.render(next)) } }
}
export async function click(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find((row) => row.textContent?.trim() === text)
  if (!button) throw new Error(`Missing button ${text}`)
  await act(async () => button.click())
  return button
}
afterEach(async () => {
  for (const { root, container } of mounts.splice(0)) { await act(async () => root.unmount()); container.remove() }
  history.replaceState({}, "", "/")
  environment.data?.requestSources.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
