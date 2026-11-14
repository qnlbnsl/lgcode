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

it("review 6: approval stays enabled during a held background read and disables during its own mutation", async () => {
  const project = { id: "project", repo: "repo", lead: "lead" };
  const workspace = { id: "project-wt", project: project.id, repo: project.repo, kind: "project", machine: "local", parentId: "base", branch: "project", files: [] };
  const state = { session: { status: "in" }, ui: {}, projects: [project], worktrees: [workspace,
    { id: "base", repo: project.repo, kind: "base", machine: "local", branch: "main", files: [] }], inspecting: {}, gitUi: {} };
  let holdReads = false, release!: () => void, dialog: unknown;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const review = { id: "review", reviewId: "review", status: "open", project: project.id, source: "project", target: "main", title: "Merge review", evidence: { tests: { ok: false }, review: { ok: false }, files: 0 } };
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
    `${source}\nreturn { installMappings, openScreen, openReview, observe, busy, run };`);
  const actions = load({ state }, { on: true }, (patch: object) => Object.assign(state, patch), () => {}, { request },
    { openDialog: (value: unknown) => { dialog = value; }, toast: (message: string) => { throw new Error(message); } }, () => {}, () => {});
  actions.installMappings({ mapGitChanges: () => [], mapGitState: () => ({}), mapMainReview: () => review });
  const kit = await import("../../../design/mock/vendor/htm-preact/standalone.module.js" as string);
  const dialogSource = gitActionsSource("js/dialogs.js", readFileSync(`${process.cwd()}/design/mock/js/dialogs.js`, "utf8"));
  const component = dialogSource.slice(dialogSource.indexOf("function MergeReview("), dialogSource.indexOf("registerDialog('merge-review'"));
  const MergeReview = new Function("liveGit", "live", "html", "useState", "cx", "act", "Dialog", "Icon", "MergeFacts", `${component}\nreturn MergeReview;`)(actions, { on: true }, kit.html, kit.useState, (...values: unknown[]) => values.filter(Boolean).join(" "), {}, ({ foot }: any) => foot, () => null, () => null);
  const element = document.createElement("div"); document.body.append(element);
  const draw = () => kit.render(kit.h(MergeReview, { s: state, d: { worktreeId: workspace.id } }), element);
  const approveButton = () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((b) => /Approve|Merging/.test(b.textContent || ""))!;
  const close = actions.openScreen("git", project.id);
  try {
    await vi.waitFor(() => expect(actions.busy("git-read")).toBe(false));
    await actions.openReview(workspace, project);
    expect(dialog).toMatchObject({ type: "merge-review", requestId: "review" });
    expect(state.worktrees[0]).toMatchObject({ review: { status: "open" } });
    vi.useFakeTimers();
    holdReads = true;
    actions.observe({ projects: [project] });
    await vi.advanceTimersByTimeAsync(100);
    draw();
    expect(approveButton().textContent).toBe("Approve without evidence");
    expect(approveButton().disabled).toBe(false);
    const ownAction = actions.run("git", () => gate);
    draw(); expect(approveButton().disabled).toBe(true);
    release(); await ownAction;
    await vi.waitFor(() => expect(actions.busy("git")).toBe(false));
  } finally { release(); close(); kit.render(null, element); element.remove(); vi.useRealTimers(); }
});

it("review 4/7: copied destructive controls ask before replacing file contents or removing merge additions", () => {
  const source = gitActionsSource("js/live/git.js", readFileSync(`${process.cwd()}/design/mock/js/live/git.js`, "utf8"));
  const reopen = source.slice(source.indexOf("function reopen("), source.indexOf("export function updateFromBase"));
  expect(reopen).toContain("act.confirm(");
  expect(reopen).toContain("current contents");
  expect(reopen).toContain("fingerprint");
  expect(source).toContain("Files added during the merge are removed");
});

it("review 4: reopening waits for confirmation and sends the captured file observation", async () => {
  const observed = { id: "file.txt", path: "file.txt", fingerprint: "last-seen" };
  const state = { session: { status: "in" }, ui: {}, worktrees: [{ id: "workspace", machine: "local", head: "head", mergeHead: "merge", merge: { files: [observed] } }] };
  let confirmation: any;
  const requests: unknown[] = [];
  const source = gitActionsSource("js/live/git.js", readFileSync(`${process.cwd()}/design/mock/js/live/git.js`, "utf8")).replace(/^import .*;$/gm, "").replace(/export /g, "");
  const actions = new Function("store", "notify", "engine", "act", `${source}\nreturn { resolve };`)({ state }, () => {}, { request: async (...args: unknown[]) => { requests.push(args); return {}; } }, { confirm: (value: unknown) => { confirmation = value; }, toast: (message: string) => { throw new Error(message); } });
  actions.resolve("workspace", "file.txt", false);
  expect(confirmation.body).toContain("current contents");
  expect(requests).toEqual([]);
  // A later read cannot change the observation the owner was asked to replace.
  observed.fingerprint = "newer-read";
  await confirmation.onConfirm();
  expect(requests).toEqual([["project.conflict.reopen", { worktreeId: "workspace", path: "file.txt", expectedHead: "head", expectedMergeHead: "merge", fingerprint: "last-seen", confirmed: true }]]);
});
