import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { mockControlsSource } from "../scripts/mockControlsSource.ts"
import { mapMocks } from "../src/mocks.ts"
import type { MockRevision, MockScreenReview } from "@lgtm/contracts"

it("maps persisted screen comments as plain text from the exact revision", () => {
  const revision = { projectId: "project", revisionId: "v1", at: 1, author: { _tag: "owner" }, artifacts: [], comparisons: [],
    bundle: { sources: [], screens: [{ screenId: "home", sourceId: "page", name: "Home", route: "/home", scenarioRoutes: [] }], scenarios: [], components: [], draftedFields: [] } } as unknown as MockRevision
  const review = { projectId: "project", revisionId: "v1", screenId: "home", comments: [{ commentId: "c1", text: "<script>plain data</script>", at: 2, author: { _tag: "owner" } }] } as unknown as MockScreenReview
  expect(mapMocks([revision], undefined, [review]).screens[0]?.comments).toEqual([{ id: "c1", from: "owner", text: "<script>plain data</script>", ts: 2 }])
  expect(mapMocks([{ ...revision, revisionId: "v2" } as MockRevision], undefined, [review]).screens[0]?.comments).toEqual([])
})

it("connects the copied screen and fails closed when its reference markup changes", () => {
  const source = readFileSync(new URL("../../../design/mock/js/screens/mocks.js", import.meta.url), "utf8")
  const wired = mockControlsSource("js/screens/mocks.js", source)
  expect(wired).toContain("controls.comment(p, sc, text)")
  expect(wired).toContain("'Sending…'")
  expect(wired).not.toContain("<p dangerouslySetInnerHTML")
  expect(() => mockControlsSource("js/screens/mocks.js", source.replace("sc, text.trim()); setText('');", "changed"))).toThrow("no longer matches")
})

it("loads authenticated feedback before accepting a consistent mock snapshot", () => {
  const source = readFileSync(new URL("../../../design/mock/js/live/mocks.js", import.meta.url), "utf8")
  const wired = mockControlsSource("js/live/mocks.js", source)
  expect(wired.indexOf("project.mocks.screen.read")).toBeLessThan(wired.indexOf("const final ="))
  expect(wired).toContain("mapMocks(items, approval, reviews)")
})
