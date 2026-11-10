import type * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import type { Caller, GitMutationIdentity } from "@lgcode/contracts";

export type GitFailureReason =
  | "invalid_path" | "not_repository" | "invalid_ref" | "output_limit" | "timeout" | "cancelled"
  | "git_unavailable" | "git_failed" | "busy" | "collision" | "dirty_destination" | "dirty_source"
  | "conflicts" | "confirmation_required" | "stale_state" | "nothing_staged" | "invalid_message"
  | "missing_remote" | "missing_upstream" | "authentication_required" | "network_failed" | "push_rejected"
  | "pull_diverged" | "base_requires_review" | "unsupported_provider" | "push_required"
  | "unsupported_conflict" | "incomplete_choices" | "owner_required" | "unsupported_review";

// Neither subprocess output nor rejected paths are attached to a failure.
export class GitFailure extends Data.TaggedError("GitFailure")<{ readonly reason: GitFailureReason; readonly uncertain?: boolean }> {}
export type GitOperation<A> = Effect.Effect<A, GitFailure>;
export interface Bounded<A> { readonly items: ReadonlyArray<A>; readonly truncated: boolean }
export interface Repository { readonly path: string; readonly name: string; readonly commonDirectory: string }
export interface Branch { readonly name: string; readonly head: string; readonly current: boolean; readonly upstream: string | null }
export interface Worktree { readonly path: string; readonly head: string | null; readonly branch: string | null; readonly locked: boolean; readonly available: boolean }
export interface Change {
  readonly path: string; readonly originalPath: string | null; readonly index: string; readonly worktree: string;
  readonly staged: boolean; readonly unstaged: boolean; readonly conflict: boolean; readonly untracked: boolean;
}
export interface Diff {
  readonly patch: string; readonly additions: number; readonly deletions: number;
  readonly binary: boolean; readonly truncated: boolean;
}
export interface Commit { readonly head: string; readonly parents: ReadonlyArray<string>; readonly author: string; readonly at: string; readonly title: string }
export interface CommitFile { readonly path: string; readonly originalPath: string | null; readonly status: string }
export interface GitState {
  readonly head: string | null; readonly branch: string | null; readonly upstream: string | null;
  readonly mergeHead: string | null;
  readonly ahead: number; readonly behind: number; readonly pending: number; readonly pendingSince: string | null;
}
export type ConflictChoice = "ours" | "theirs" | "both";
export type ConflictSegment = { readonly kind: "context"; readonly line: number; readonly context: ReadonlyArray<string> }
  | { readonly kind: "conflict"; readonly ours: ReadonlyArray<string>; readonly base: ReadonlyArray<string>; readonly theirs: ReadonlyArray<string> };
export interface Conflict {
  readonly path: string; readonly fingerprint: string; readonly head: string;
  readonly ours: string; readonly base: string; readonly theirs: string;
  readonly segments: ReadonlyArray<ConflictSegment>; readonly choices: ReadonlyArray<ConflictChoice | null>;
}
export interface Review {
  readonly head: string; readonly baseHead: string; readonly branch: string; readonly base: string;
  readonly commits: Bounded<Commit>; readonly files: Bounded<CommitFile>; readonly diff: Diff;
}
export interface DiscardPlan { readonly fingerprint: string; readonly paths: ReadonlyArray<string> }
export interface GitService {
  mutationIdentity(folder: string): GitOperation<GitMutationIdentity>;
  reconcileCommit(folder: string, before: GitMutationIdentity, message: string): GitOperation<string | null>;
  readonly contextFiles: (folder: string, query: string) => GitOperation<Bounded<string>>;
  readonly contextFile: (folder: string, path: string) => GitOperation<void>;
  discover(): GitOperation<Bounded<Repository>>;
  createRepository(name: string): GitOperation<Repository>;
  register(folder: string): GitOperation<Repository>;
  branches(folder: string): GitOperation<Bounded<Branch>>;
  worktrees(folder: string): GitOperation<Bounded<Worktree>>;
  createWorktree(folder: string, name: string, from?: string): GitOperation<Worktree>;
  changes(folder: string): GitOperation<Bounded<Change>>;
  diff(folder: string, options?: { readonly path?: string; readonly staged?: boolean; readonly commit?: string }): GitOperation<Diff>;
  history(folder: string, limit?: number): GitOperation<Bounded<Commit>>;
  commitFiles(folder: string, commit: string): GitOperation<Bounded<CommitFile>>;
  state(folder: string, target?: string): GitOperation<GitState>;
  stage(folder: string, path: string): GitOperation<void>;
  unstage(folder: string, path: string): GitOperation<void>;
  stageAll(folder: string): GitOperation<void>;
  unstageAll(folder: string): GitOperation<void>;
  planDiscard(folder: string, paths?: ReadonlyArray<string>): GitOperation<DiscardPlan>;
  discard(folder: string, plan: DiscardPlan, confirmed: boolean): GitOperation<void>;
  commit(folder: string, message: string): GitOperation<string>;
  fetch(folder: string): GitOperation<void>;
  pull(folder: string): GitOperation<void>;
  push(folder: string): GitOperation<void>;
  mergeTeam(source: string, destination: string, expectedHead: string): GitOperation<string>;
  review(folder: string, base: string): GitOperation<Review>;
  reviewMain(source: string, destination: string): GitOperation<Review>;
  // A distinct execution boundary, never a bypass on mergeTeam. The engine
  // supplies the authenticated caller, not a field from the command payload.
  approveMain(source: string, destination: string, reviewed: Pick<Review, "head" | "baseHead" | "branch" | "base">,
    caller: Caller | undefined, confirmed: boolean, reconcileOnly?: boolean): GitOperation<string>;
  conflict(folder: string, path: string): GitOperation<Conflict>;
  choose(folder: string, selection: Conflict, hunk: number, choice: ConflictChoice): GitOperation<Conflict>;
  resolve(folder: string, selection: Conflict): GitOperation<void>;
}
