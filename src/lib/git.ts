import { invoke } from "@tauri-apps/api/core";

export interface BranchInfo {
  name: string;
  is_current: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  is_remote: boolean;
  gone: boolean;
  author_email: string | null;
  committer_date: number | null;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  is_main: boolean;
  is_locked: boolean;
  is_bare: boolean;
  has_changes: boolean;
}

export interface AnalyzedBranch {
  name: string;
  is_main: boolean;
  target: string | null;
  ahead_of_target: number | null;
  behind_target: number | null;
  is_mine: boolean;
  mine_override: boolean | null;
}

export interface RepoAnalysis {
  default_branch: string | null;
  main_branches: string[];
  user_email: string | null;
  branches: AnalyzedBranch[];
}

export interface ConflictFile {
  path: string;
}

export interface RebaseSession {
  repo: string;
  branch: string;
  onto: string;
  worktree: string;
  is_temp: boolean;
}

export type OpOutcome =
  | { status: "completed" }
  | { status: "conflicts"; branch: string; onto: string; files: ConflictFile[] };

export interface CommitSummary {
  hash: string;
  subject: string;
  body: string;
}

export interface SquashPreview {
  base_commit: string;
  commits: CommitSummary[];
  combined_message: string;
}

export interface GraphCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  refs: string[];
  subject: string;
}

export const gitApi = {
  getBranches: (path: string) => invoke<BranchInfo[]>("get_branches", { path }),
  getWorktrees: (path: string) => invoke<WorktreeInfo[]>("get_worktrees", { path }),
  fetchRepo: (path: string) => invoke<void>("fetch_repo", { path }),
  getRepoAnalysis: (path: string) => invoke<RepoAnalysis>("get_repo_analysis", { path }),
  setBranchOwner: (repo: string, branch: string, mine: boolean | null) =>
    invoke<void>("set_branch_owner", { repo, branch, mine }),
  addWorktree: (
    repo: string,
    worktreePath: string,
    branch: string,
    createBranch: boolean,
    base: string | null,
  ) => invoke<void>("add_worktree", { repo, worktreePath, branch, createBranch, base }),
  removeWorktree: (repo: string, worktreePath: string, force: boolean) =>
    invoke<void>("remove_worktree", { repo, worktreePath, force }),
  switchBranch: (worktree: string, branch: string) =>
    invoke<void>("switch_branch", { worktree, branch }),
  pushBranch: (repo: string, branch: string, force: boolean) =>
    invoke<void>("push_branch", { repo, branch, force }),
  pullBranch: (repo: string, branch: string) =>
    invoke<void>("pull_branch", { repo, branch }),
  rebaseBranch: (repo: string, branch: string, onto: string) =>
    invoke<OpOutcome>("rebase_branch", { repo, branch, onto }),
  rebaseContinue: (repo: string) => invoke<OpOutcome>("rebase_continue", { repo }),
  rebaseAbort: (repo: string) => invoke<void>("rebase_abort", { repo }),
  getRebaseSession: (repo: string) =>
    invoke<RebaseSession | null>("get_rebase_session", { repo }),
  getConflictFiles: (repo: string) => invoke<ConflictFile[]>("get_conflict_files", { repo }),
  readConflictFile: (repo: string, file: string) =>
    invoke<string>("read_conflict_file", { repo, file }),
  saveConflictFile: (repo: string, file: string, content: string) =>
    invoke<void>("save_conflict_file", { repo, file, content }),
  getSquashPreview: (repo: string, branch: string, base: string) =>
    invoke<SquashPreview>("get_squash_preview", { repo, branch, base }),
  squashBranch: (repo: string, branch: string, base: string, message: string) =>
    invoke<void>("squash_branch", { repo, branch, base, message }),
  getGraph: (repo: string, refs: string[] | null, limit?: number) =>
    invoke<GraphCommit[]>("get_graph", { repo, refs, limit: limit ?? null }),
};
