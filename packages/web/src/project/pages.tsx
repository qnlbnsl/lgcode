import type { ProjectId, RepositoryId, RequestId } from "@lgtm/contracts"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { Empty, ReadState } from "../pages/common.tsx"
import { Mocks } from "./mocks.tsx"
import { RepositoryDesign } from "./design.tsx"
import type { MockApprovalSession } from "./mockApproval.ts"

// Direct accepted foundation context. The authenticated owner mount supplies
// its one approval controller; these pages add no provider or route authority.
export function ProjectMocksPage({ projectId, approvals }: { readonly projectId: ProjectId; readonly approvals: MockApprovalSession }) {
  const { navigation, snapshot, complete, onSessionExpired } = useShellData()
  const disabled = useMutationDisabled()
  if (navigation === undefined) return <section className="review-page"><ReadState /></section>
  const project = navigation.projects.find((row) => row.projectId === projectId)
  if (project === undefined) return <section className="review-page"><Empty>This project is unavailable.</Empty></section>
  return <Mocks projectId={project.projectId} repoId={project.repoId} approvals={approvals} onSessionExpired={onSessionExpired}
    {...(snapshot === undefined ? {} : { refreshKey: snapshot.sequence })}
    disabled={disabled || !complete || project.archiving || project.archivedAt !== undefined} />
}

export function RepositoryDesignPage({ repoId, revisionId, projectId }: {
  readonly repoId: RepositoryId; readonly revisionId?: RequestId; readonly projectId?: ProjectId
}) {
  const { navigation, snapshot, onSessionExpired } = useShellData()
  if (navigation === undefined) return <section className="review-page"><ReadState /></section>
  if (!navigation.repositories.some((row) => row.repoId === repoId)) return <section className="review-page"><Empty>This repository is unavailable.</Empty></section>
  if (projectId !== undefined && !navigation.projects.some((row) => row.projectId === projectId && row.repoId === repoId)) return <section className="review-page"><Empty>This project is unavailable.</Empty></section>
  return <RepositoryDesign repoId={repoId} onSessionExpired={onSessionExpired}
    {...(revisionId === undefined ? {} : { revisionId })} {...(projectId === undefined ? {} : { projectId })}
    {...(snapshot === undefined ? {} : { refreshKey: snapshot.sequence })} />
}
