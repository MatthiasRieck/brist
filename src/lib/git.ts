export interface BranchInfo {
  name: string;
  is_current: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  is_remote: boolean;
  gone: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  is_main: boolean;
  is_locked: boolean;
  is_bare: boolean;
}
