import { readFileSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"
import { expect, it, vi } from "vitest"
import { mockControlsSource } from "../scripts/mockControlsSource.ts"

const source = readFileSync(fileURLToPath(new URL("../../../design/mock/js/live/mocks.js", import.meta.url)), "utf8")
const wired = mockControlsSource("js/live/mocks.js", source)
// Execute the real copied loader with a fake authenticated transport. The
// imports and page components outside this function are irrelevant here.
const load = (request: (...args: any[]) => Promise<unknown>) => new Function("engine", "maps",
  wired.slice(wired.indexOf("export async function readMocks"), wired.indexOf("export function loadMocks"))
    .replace("export async function", "async function") + ";return readMocks;")({ request }, () => ({ mapMocks: (items: unknown, approval: unknown, reviews: unknown) => ({ items, approval, reviews }) }))
const items = Array.from({ length: 12 }, (_, i) => ({ projectId: "project", revisionId: "version-" + i,
  bundle: { screens: [{ screenId: "one" }, { screenId: "two" }, { screenId: "three" }] } }))

for (const churn of [false, true]) it(`review item 1: reads project feedback once with ${churn ? "unrelated engine events" : "many screen versions"}`, async () => {
  let sequence = 0
  const reviews = [{ projectId: "project", revisionId: "version-0", screenId: "one", comments: [] }]
  const request = vi.fn(async (tag: string) => {
    if (tag === "client.sequence") return { sequence: churn ? sequence++ : 0 }
    if (tag === "project.mocks.read") return { items }
    if (tag === "project.mocks.reviews.read") return { reviews, revisionId: "version-11" }
    if (tag === "project.mocks.screen.read") return { review: reviews[0] }
    throw new Error("unexpected request: " + tag)
  })
  const result = await load(request)("project")
  expect(result.reviews).toEqual(reviews)
  expect(request.mock.calls.filter(([tag]) => tag === "project.mocks.reviews.read")).toHaveLength(1)
  expect(request.mock.calls.filter(([tag]) => tag === "project.mocks.screen.read")).toHaveLength(0)
  expect(request.mock.calls.filter(([tag]) => tag === "client.sequence")).toHaveLength(0)
  expect(request.mock.calls).toHaveLength(2)
})
