import { useState } from "react"
import { GitMainReview, type GitEvidenceSet, type Workspace } from "@lgcode/contracts"
import type { Review } from "./state.ts"
import { visibleText, DataText } from "../thread/text.tsx"
import { threadHref } from "../thread/links.ts"
import { DiffBody } from "./DiffPane.tsx"
import { GitDialog } from "./Dialog.tsx"
import { gitReason, pathLabel } from "./state.ts"

type MainReview = typeof GitMainReview.Type
export function evidencePassed(evidence: GitEvidenceSet) {
  return [evidence.tests, evidence.review].every((slot) => slot.state === "current" && slot.report?.status === "passed")
}
export function Evidence({ evidence }: { readonly evidence: GitEvidenceSet }) {
  return <dl className="merge-evidence" id="merge-evidence">{(["tests", "review"] as const).map((kind) => {
    const slot = evidence[kind], report = slot.report
    return <div key={kind}><dt>{kind === "tests" ? "Tests" : "Review"}</dt><dd>{!report ? "No reported evidence" : <>
      <p>{slot.state === "stale" ? "Stale report" : "Reported"} · {report.status === "passed" ? "Passed" : "Failed"} · Head <code>{visibleText(report.head)}</code></p>
      <DataText text={report.summary} /><p>Submitted by {report.reportedBy._tag === "owner" ? "the owner" : visibleText(report.reportedBy.agentId)}. This is reported data.</p>
      <a href={threadHref(report.threadAgentId)}>Open the {kind === "review" ? "review" : "test report"} thread</a><small>Thread item {report.threadSequence}</small>
    </>}</dd></div>
  })}</dl>
}

export function ReviewDialog({ source, destination, prepared, pending, disabled, stale, error, close, prepare, approve }: {
  readonly source: Workspace; readonly destination: Workspace; readonly prepared?: { readonly review: MainReview; readonly comparison: Review }
  readonly pending: boolean; readonly disabled: boolean; readonly stale: boolean; readonly error: string; readonly close: () => void; readonly prepare: () => void
  readonly approve: (decision: "approve" | "approve_without_evidence") => void
}) {
  const [choice, setChoice] = useState<"approve" | "approve_without_evidence">()
  const review = prepared?.review, comparison = prepared?.comparison
  const good = review ? evidencePassed(review.evidence) : false
  const decision = choice ?? (good ? "approve" : "approve_without_evidence")
  return <GitDialog title={`Review merge to ${pathLabel(destination.branch)}`} close={close} className="git-review-dialog">
    <div className="git-review-body"><p className="merge-route"><code>{visibleText(source.branch)}</code> into <code>{visibleText(destination.branch)}</code></p>
      {pending && <p role="status">Loading or submitting the review…</p>}{error && <p role="alert">{error}</p>}
      {stale && review?.outcome === "open" && <p role="alert">The source or destination head changed. Prepare a new review before approving.</p>}
      {!review && <p>Prepare the complete comparison before approving these exact heads.</p>}
      {review && comparison && <>
        <dl className="git-heads"><dt>Source head</dt><dd><code>{visibleText(review.head)}</code></dd><dt>Destination head</dt><dd><code>{visibleText(review.baseHead)}</code></dd><dt>Review identity</dt><dd><code>{visibleText(review.reviewId)}</code></dd></dl>
        <Evidence evidence={review.evidence} />
        <p>{comparison.commits.items.length} {comparison.commits.items.length === 1 ? "commit" : "commits"} · {comparison.files.items.length} {comparison.files.items.length === 1 ? "file" : "files"}</p>
        <ol>{comparison.commits.items.map((commit) => <li key={commit.head}><code>{visibleText(commit.head)}</code><DataText text={commit.title} /><small>{visibleText(commit.author)} · {visibleText(commit.at)}</small></li>)}</ol>
        <ul aria-label="Reviewed files">{comparison.files.items.map((file) => <li key={file.path}>{file.originalPath && <>{pathLabel(file.originalPath)} → </>}{pathLabel(file.path)}</li>)}</ul>
        <DiffBody diff={comparison.diff} />
        {review.outcome === "merged" ? <p role="status">Merged. Destination head: <code>{visibleText(review.mergeHead ?? "")}</code></p>
          : review.outcome === "refused" ? <p role="alert">Merge refused. {gitReason(review.reason ?? "")}</p>
          : <fieldset disabled={disabled || pending}><legend>Owner decision for these exact heads</legend>
            <label><input type="radio" name="git-review-decision" checked={decision === "approve"} onChange={() => setChoice("approve")} />Approve</label>
            <label><input type="radio" name="git-review-decision" checked={decision === "approve_without_evidence"} onChange={() => setChoice("approve_without_evidence")} />Approve without evidence</label>
          </fieldset>}
      </>}
    </div><footer><button disabled={disabled || pending} onClick={prepare}>{review ? "Prepare a new review" : "Prepare review"}</button>
      <button id="approve-main-merge" className={good && decision === "approve" ? "primary" : "secondary"} disabled={disabled || pending || stale || review?.outcome !== "open"} onClick={() => approve(decision)}>
        {decision === "approve" ? `Approve merge to ${visibleText(destination.branch)}` : "Approve without evidence"}</button>
      <button onClick={close}>Cancel</button></footer>
  </GitDialog>
}
