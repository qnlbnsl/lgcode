import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { gitActionsSource } from "../scripts/gitActions.ts";
import { harnessChoicesSource } from "../scripts/harnessChoices.ts";
for (const path of ["js/screens/git.js", "js/live/git.js", "js/actions.js", "js/dialogs.js"]) {
  const original = readFileSync(`${process.cwd()}/design/mock/${path}`, "utf8");
  it(`wires the existing Git controls in ${path} and rejects unmatched patches`, () => {
    const current = harnessChoicesSource(path, original);
    expect(gitActionsSource(path, current)).not.toBe(current);
    expect(() => gitActionsSource(path, "")).toThrow("Git actions integration no longer matches");
  });
}
it("keeps unrelated copied pages unchanged", () => {
  expect(gitActionsSource("js/screens/service.js", "source")).toBe("source");
});

it("keeps an open review busy until its snapshot-triggered Git reads finish", async () => {
  const project = { id: "project", repo: "repo", lead: "lead" };
  const workspace = { id: "project-wt", project: project.id, repo: project.repo, kind: "project", machine: "local", parentId: "base", branch: "project", files: [] };
  const state = { session: { status: "in" }, ui: {}, projects: [project], worktrees: [workspace,
    { id: "base", repo: project.repo, kind: "base", machine: "local", branch: "main", files: [] }], inspecting: {}, gitUi: {} };
  let holdReads = false, release!: () => void, dialog: unknown;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const review = { id: "review", reviewId: "review", status: "open" };
  const request = async (tag: string) => {
    if (tag === "project.git.state") { if (holdReads) await gate; return { result: { mergeHead: null } }; }
    if (tag === "project.changes") return { result: { items: [], truncated: false } };
    if (tag === "project.review.status") return { result: { review: null } };
    if (tag === "project.review.prepare") return { result: { review, comparison: {} } };
    throw new Error(`Unexpected request: ${tag}`);
  };
  const source = gitActionsSource("js/live/git.js", readFileSync(`${process.cwd()}/design/mock/js/live/git.js`, "utf8"))
    .replace(/^import .*;$/gm, "").replace(/export /g, "");
  const load = new Function("store", "live", "engineWrite", "notify", "engine", "act", "addEventListener", "removeEventListener",
    `${source}\nreturn { installMappings, openScreen, openReview, observe, busy };`);
  const actions = load({ state }, { on: true }, (patch: object) => Object.assign(state, patch), () => {}, { request },
    { openDialog: (value: unknown) => { dialog = value; }, toast: (message: string) => { throw new Error(message); } }, () => {}, () => {});
  actions.installMappings({ mapGitChanges: () => [], mapGitState: () => ({}), mapMainReview: () => review });
  const close = actions.openScreen("git", project.id);
  try {
    await vi.waitFor(() => expect(actions.busy("git")).toBe(false));
    await actions.openReview(workspace, project);
    expect(dialog).toMatchObject({ type: "merge-review", requestId: "review" });
    expect(state.worktrees[0]).toMatchObject({ review: { status: "open" } });
    vi.useFakeTimers();
    holdReads = true;
    actions.observe({ projects: [project] });
    await vi.advanceTimersByTimeAsync(100);
    expect(actions.busy("git")).toBe(true);
    expect(state.worktrees[0]).toMatchObject({ review: { status: "open" } });
    release();
    await vi.waitFor(() => expect(actions.busy("git")).toBe(false));
  } finally { release(); close(); vi.useRealTimers(); }
});
