import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "vitest"
import { mockControlsSource } from "../scripts/mockControlsSource.ts"
import { mapMocks } from "../src/mocks.ts"
import type { MockRevision, MockScreenReview } from "@lgtm/contracts"

const mockRoot = resolve(existsSync("design/mock") ? "design/mock" : "../../design/mock")
const mockSource = (path: string) => readFileSync(resolve(mockRoot, path), "utf8")

it("review item 2: keeps plain text comments and their revision when a new version is recorded", () => {
  const revision = { projectId: "project", revisionId: "v1", at: 1, author: { _tag: "owner" }, artifacts: [], comparisons: [],
    bundle: { sources: [], screens: [{ screenId: "home", sourceId: "page", name: "Home", route: "/home", scenarioRoutes: [] }], scenarios: [], components: [], draftedFields: [] } } as unknown as MockRevision
  const review = { projectId: "project", revisionId: "v1", screenId: "home", comments: [{ commentId: "c1", text: "<script>plain data</script>", at: 2, author: { _tag: "owner" } }] } as unknown as MockScreenReview
  expect(mapMocks([revision], undefined, [review]).screens[0]?.comments).toEqual([{ id: "c1", from: "owner", text: "<script>plain data</script>", ts: 2, revisionId: "v1" }])
  expect(mapMocks([revision, { ...revision, revisionId: "v2" } as MockRevision], undefined, [review]).screens[0]?.comments).toMatchObject([{ id: "c1", revisionId: "v1" }])
})

it("connects the copied screen and fails closed when its reference markup changes", () => {
  const source = mockSource("js/screens/mocks.js")
  const wired = mockControlsSource("js/screens/mocks.js", source)
  expect(wired).toContain("controls.comment(p, sc, text)")
  expect(wired).toContain("'Sending…'")
  expect(wired).not.toContain("<p dangerouslySetInnerHTML")
  expect(() => mockControlsSource("js/screens/mocks.js", source.replace("sc, text.trim()); setText('');", "changed"))).toThrow("no longer matches")
})

it("loads one project feedback snapshot and checks its mock head without a global sequence window", () => {
  const source = mockSource("js/live/mocks.js")
  const wired = mockControlsSource("js/live/mocks.js", source)
  expect(wired).toContain("project.mocks.reviews.read")
  expect(wired).not.toContain("project.mocks.screen.read")
  expect(wired).not.toContain("client.sequence")
  expect(wired).toContain("feedback.revisionId !== items.at(-1)?.revisionId")
  expect(wired).toContain("mapMocks(items, approval, reviews)")
})

it("shows only the exact screen version approval and preserves explicit withdrawal", () => {
  const revision = { projectId: "project", revisionId: "v1", at: 1, author: { _tag: "owner" }, artifacts: [], comparisons: [],
    bundle: { sources: [], screens: [{ screenId: "home", sourceId: "page", name: "Home", route: "/home", scenarioRoutes: [] }], scenarios: [], components: [], draftedFields: [] } } as unknown as MockRevision
  const review = { projectId: "project", revisionId: "v1", screenId: "home", comments: [], approval: { approved: true, author: { _tag: "owner" }, at: 3 } } as unknown as MockScreenReview
  expect(mapMocks([revision], undefined, [review]).screens[0]).toMatchObject({ status: "approved", approval: { at: 3 } })
  expect(mapMocks([{ ...revision, revisionId: "v2" } as MockRevision], undefined, [review]).screens[0]?.status).toBe("draft")
  expect(mapMocks([revision], { revisionId: "v1", at: 2 } as never, [{ ...review, approval: { ...review.approval!, approved: false } }]).screens[0]?.status).toBe("draft")
})

it("keeps unseen changes per screen version when a new revision is recorded", () => {
  const revision = { projectId: "project", revisionId: "v1", at: 1, author: { _tag: "owner" }, artifacts: [], comparisons: [],
    bundle: { sources: [], screens: [{ screenId: "home", sourceId: "page", name: "Home", route: "/home", scenarioRoutes: [] }], scenarios: [], components: [], draftedFields: [] } } as unknown as MockRevision
  const review = { projectId: "project", revisionId: "v1", screenId: "home", comments: [], seen: { author: { _tag: "owner" }, at: 3 } } as unknown as MockScreenReview
  const mapped = mapMocks([revision, { ...revision, revisionId: "v2" } as MockRevision], undefined, [review])
  expect(mapped.changes.map((c) => [c.screen, c.to, c.seen])).toEqual([["home", "v2", false], ["home", "v1", true]])
  expect(mapped.screens[0]?.seen).toBeNull()
})

it("review item 2: shows a screen's historical comments oldest first and excludes other screens and projects", () => {
  const revision = { projectId: "project", revisionId: "v1", at: 1, author: { _tag: "owner" }, artifacts: [], comparisons: [],
    bundle: { sources: [], screens: [{ screenId: "home", sourceId: "page", name: "Home", route: "/home", scenarioRoutes: [] }], scenarios: [], components: [], draftedFields: [] } } as unknown as MockRevision
  const review = { projectId: "project", revisionId: "v1", screenId: "home", comments: [{ commentId: "old", text: "Earlier feedback", at: 2, author: { _tag: "owner" } }] } as unknown as MockScreenReview
  const recent = { ...review, revisionId: "v2", comments: [{ ...review.comments[0]!, commentId: "new", text: "Later feedback", at: 5 }] } as unknown as MockScreenReview
  const mapped = mapMocks([revision, { ...revision, revisionId: "v2", at: 4 } as MockRevision], undefined,
    [recent, { ...review, projectId: "other-project" } as MockScreenReview, { ...review, screenId: "other-screen" } as MockScreenReview, review])
  expect(mapped.screens[0]?.comments.map((c) => ({ id: c.id, revisionId: (c as unknown as { revisionId: string }).revisionId }))).toEqual([
    { id: "old", revisionId: "v1" }, { id: "new", revisionId: "v2" }
  ])
})

it("review item 9: refuses duplicate replacement anchors in the merged mock", () => {
  for (const path of ["js/screens/mocks.js", "js/live/mocks.js"]) {
    const source = mockSource(path)
    expect(() => mockControlsSource(path, source + "\n" + source)).toThrow(/unique|ambiguous|multiple/)
  }
})

it("review item 9: refuses a missing seen-badge replacement instead of silently leaving the old control", () => {
  const source = mockSource("js/screens/mocks.js")
  expect(() => mockControlsSource("js/screens/mocks.js", source.replaceAll("!live.on && !c.seen", "!c.seen"))).toThrow("no longer matches")
})

it("review item 2: labels earlier comments with their recorded revision in the copied screen", () => {
  const source = mockSource("js/screens/mocks.js")
  const wired = mockControlsSource("js/screens/mocks.js", source)
  expect(wired).toContain("c.revisionId")
})
