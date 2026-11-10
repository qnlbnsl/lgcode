import { expect, it } from "vitest"
import { scopeMockMarkup } from "../../src/client/web/display/markup.ts"

const origin = "https://design.example", token = "a".repeat(43), prefix = `/session/${token}`
const scope = (text: string, route = "/pages/home?state=empty") => scopeMockMarkup(text, route, origin, token)

it("scopes the unchanged native fixture's root-relative stylesheet, image and module without altering other markup", () => {
  const source = '<!doctype html><title>Recorded actual mock</title><link rel="stylesheet" href="/style.css"><h1>Registered mock pixels</h1><img alt="Recorded companion" src="/mark.svg"><script type="module" src="/companion.js"></script>'
  expect(scope(source)).toBe(`<!doctype html><title>Recorded actual mock</title><link rel="stylesheet" href="${prefix}/style.css"><h1>Registered mock pixels</h1><img alt="Recorded companion" src="${prefix}/mark.svg"><script type="module" src="${prefix}/companion.js"></script>`)
})

it("resolves ordinary relative references against the actual selected document route, preserving query and fragment semantics", () => {
  const source = '<link rel="alternate stylesheet" href="assets/style.css?a=1&amp;b=2"><img src="./草稿 design.svg#mark"><script type="module" src="./companion.js?v=3"></script>'
  expect(scope(source)).toBe(`<link rel="alternate stylesheet" href="${prefix}/pages/assets/style.css?a=1&amp;b=2"><img src="${prefix}/pages/%E8%8D%89%E7%A8%BF%20design.svg#mark"><script type="module" src="${prefix}/pages/companion.js?v=3"></script>`)
  expect(scope('<img src="mark.svg">', "/pages/")).toBe(`<img src="${prefix}/pages/mark.svg">`)
  expect(scope('<script src="?variant=module"></script>')).toBe(`<script src="${prefix}/pages/home?variant=module"></script>`)
  expect(scope('<img src="https://design.example/mark.svg">')).toBe(`<img src="${prefix}/mark.svg">`)
})

it("does not attach private scope to another origin, protocol-relative URL, data/blob URL or unrelated markup", () => {
  const source = '<base href="https://elsewhere.example/"><a href="/home">Go</a><link rel="icon" href="/icon.svg"><img src="https://elsewhere.example/mark.svg"><img src="//elsewhere.example/mark.svg"><img src="data:image/png;base64,AAAA"><img src="blob:https://design.example/example"><style>h1{background:url(/mark.svg)}</style><script>import("/companion.js")</script>'
  expect(scope(source)).toBe(source)
})

it("rejects traversal, encoded separators, malformed paths and repository-selected session identities before URL normalization", () => {
  for (const reference of ["../outside.svg", "/../outside.svg", "assets/../outside.svg", "%2e%2e/outside.svg", "/%2e%2e/outside.svg", "assets%2foutside.svg", "assets%5coutside.svg", "%252e%252e/outside.svg", "bad%00.svg", "bad%.svg", "bad%FF.svg", "bad\\name.svg", "/session/other/mark.svg", "/%73ession/other/mark.svg", "/api/private.svg", "mark.svg?__lgcode_display_session=other", "https://design.example/../outside.svg"]) {
    expect(() => scope(`<img src="${reference}">`)).toThrow("recorded resource address unavailable")
  }
  expect(() => scope('<img src="mark.svg" src="other.svg">')).toThrow("recorded resource address unavailable")
})

it("rewrites only parsed attributes, with correct escaping, and leaves source script strings and template text alone", () => {
  const source = '<!-- <img src="/ignored.svg"> --><SCRIPT SRC=/app.js></SCRIPT><img src="/mark.svg?caption=&quot;yes&quot;&amp;x=1"><script>const sample=\'<img src="/ignored.svg">\'</script>'
  expect(scope(source)).toBe(`<!-- <img src="/ignored.svg"> --><SCRIPT src="${prefix}/app.js"></SCRIPT><img src="${prefix}/mark.svg?caption=%22yes%22&amp;x=1"><script>const sample='<img src="/ignored.svg">'</script>`)
})
