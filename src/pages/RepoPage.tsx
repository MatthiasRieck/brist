import { useCallback, useEffect, useRef, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import {
  Check,
  FolderGit2,
  GitBranch,
  GitGraph as GitGraphIcon,
  GitMerge,
  ListTree,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  User,
} from "lucide-react";
import { useHeader } from "@/contexts/HeaderContext";
import { useSync } from "@/contexts/SyncContext";
import { cn } from "@/lib/utils";
import {
  gitApi,
  type AnalyzedBranch,
  type BranchInfo,
  type ConflictFile,
  type GraphCommit,
  type RepoAnalysis,
  type WorktreeInfo,
} from "@/lib/git";
import { Button } from "@/components/ui/button";
import { AddWorktreeDialog } from "@/components/AddWorktreeDialog";
import { SquashDialog } from "@/components/SquashDialog";
import { ConflictDialog } from "@/components/ConflictDialog";
import { GitGraph } from "@/components/GitGraph";

function BranchStatusBadge({ branch }: { branch: BranchInfo | undefined }) {
  if (!branch) return null;
  if (!branch.upstream) {
    return (
      <span className="rounded px-1.5 py-0.5 text-xs text-muted-foreground">local only</span>
    );
  }
  if (branch.gone) {
    return (
      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
        gone
      </span>
    );
  }
  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;
  if (ahead === 0 && behind === 0) {
    return (
      <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-600 dark:text-green-400">
        up to date
      </span>
    );
  }
  const parts: string[] = [];
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  return (
    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
      {parts.join(" ")}
    </span>
  );
}

function WorktreeRow({
  repo,
  worktree,
  onRemoved,
}: {
  repo: string;
  worktree: WorktreeInfo;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      await gitApi.removeWorktree(repo, worktree.path, force);
      onRemoved();
    } catch (e: unknown) {
      setError(String(e));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-accent/50">
      <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-mono text-sm">{worktree.branch ?? "(detached)"}</span>
      <span className="truncate text-xs text-muted-foreground">{worktree.path}</span>
      {worktree.is_locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
      {worktree.has_changes && (
        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
          uncommitted changes
        </span>
      )}
      {error && <span className="truncate text-xs text-destructive">{error}</span>}
      <div className="ml-auto flex items-center gap-1">
        {worktree.is_main ? (
          <span className="text-xs text-muted-foreground">main worktree</span>
        ) : confirming ? (
          <>
            <Button size="xs" variant="destructive" disabled={busy} onClick={() => remove(worktree.has_changes)}>
              {busy && <Loader2 className="animate-spin" />}
              {worktree.has_changes ? "Force remove" : "Confirm remove"}
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="icon-xs" variant="ghost" onClick={() => setConfirming(true)}>
            <Trash2 />
            <span className="sr-only">Remove worktree {worktree.path}</span>
          </Button>
        )}
      </div>
    </li>
  );
}

interface RebaseRun {
  base: string;
  queue: string[];
  current: string | null;
}

export function RepoPage() {
  const { path } = useSearch({ from: "/repo" });
  const { setHeaderContent } = useHeader();
  const { fetching, fetchRepos, syncVersion } = useSync();
  const repoName = path.split("/").pop() ?? path;

  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"branches" | "graph">("branches");
  const [graphScope, setGraphScope] = useState<string>("all");
  const [graphCommits, setGraphCommits] = useState<GraphCommit[] | null>(null);

  const [addWorktreeOpen, setAddWorktreeOpen] = useState(false);
  const [squash, setSquash] = useState<{ branch: string; base: string } | null>(null);
  const [conflict, setConflict] = useState<{
    branch: string;
    onto: string;
    files: ConflictFile[];
  } | null>(null);
  const rebaseRun = useRef<RebaseRun | null>(null);
  const [rebasing, setRebasing] = useState<string | null>(null);

  const isFetching = fetching.has(path);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [loadedBranches, loadedWorktrees] = await Promise.all([
        gitApi.getBranches(path),
        gitApi.getWorktrees(path),
      ]);
      setBranches(loadedBranches);
      setWorktrees(loadedWorktrees);
      const loadedAnalysis = await gitApi.getRepoAnalysis(path);
      setAnalysis(loadedAnalysis);
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [path]);

  useEffect(() => {
    setHeaderContent(<span className="font-medium">{repoName}</span>);
    return () => setHeaderContent(null);
  }, [repoName, setHeaderContent]);

  useEffect(() => {
    setLoading(true);
    setAnalysis(null);
    setBranches([]);
    setWorktrees([]);
    setView("branches");
    setGraphScope("all");
    reload().finally(() => setLoading(false));
    // Resume a conflict session if one is still open for this repo.
    gitApi.getRebaseSession(path).then((session) => {
      if (session) {
        gitApi.getConflictFiles(path).then((files) => {
          setConflict({ branch: session.branch, onto: session.onto, files });
        });
      }
    });
  }, [path, reload]);

  useEffect(() => {
    if (syncVersion > 0) reload();
  }, [syncVersion, reload]);

  const loadGraph = useCallback(
    async (scope: string) => {
      setGraphCommits(null);
      let refs: string[] | null = null;
      if (scope !== "all" && analysis) {
        const localNames = new Set(branches.filter((b) => !b.is_remote).map((b) => b.name));
        const baseRef = localNames.has(scope) ? scope : `origin/${scope}`;
        const attached = analysis.branches
          .filter((b) => b.target === scope)
          .map((b) => b.name);
        refs = [baseRef, ...attached];
      }
      try {
        setGraphCommits(await gitApi.getGraph(path, refs));
      } catch (e: unknown) {
        setError(String(e));
        setGraphCommits([]);
      }
    },
    [path, analysis, branches],
  );

  function showGraph(scope: string) {
    setGraphScope(scope);
    setView("graph");
    loadGraph(scope);
  }

  async function processRebaseQueue() {
    const run = rebaseRun.current;
    if (!run) return;
    while (run.queue.length > 0) {
      const branch = run.queue.shift()!;
      run.current = branch;
      setRebasing(branch);
      try {
        const outcome = await gitApi.rebaseBranch(path, branch, run.base);
        if (outcome.status === "conflicts") {
          setRebasing(null);
          setConflict({ branch, onto: run.base, files: outcome.files });
          return;
        }
      } catch (e: unknown) {
        setError(`Rebase of ${branch} failed: ${String(e)}`);
        break;
      }
    }
    rebaseRun.current = null;
    setRebasing(null);
    reload();
  }

  function rebaseBranches(base: string, branchNames: string[]) {
    if (rebaseRun.current || branchNames.length === 0) return;
    rebaseRun.current = { base, queue: [...branchNames], current: null };
    processRebaseQueue();
  }

  function handleConflictDone(aborted: boolean) {
    setConflict(null);
    if (aborted) {
      rebaseRun.current = null;
      setRebasing(null);
      reload();
    } else if (rebaseRun.current) {
      processRebaseQueue();
    } else {
      reload();
    }
  }

  async function toggleMine(branch: AnalyzedBranch) {
    const newValue = !branch.is_mine;
    await gitApi.setBranchOwner(path, branch.name, newValue);
    setAnalysis((prev) =>
      prev
        ? {
            ...prev,
            branches: prev.branches.map((b) =>
              b.name === branch.name ? { ...b, is_mine: newValue, mine_override: newValue } : b,
            ),
          }
        : prev,
    );
  }

  const localByName = new Map(branches.filter((b) => !b.is_remote).map((b) => [b.name, b]));
  const worktreeByBranch = new Map(
    worktrees.filter((w) => w.branch).map((w) => [w.branch as string, w]),
  );

  const groups = (analysis?.main_branches ?? []).map((main) => ({
    main,
    children: (analysis?.branches ?? []).filter((b) => b.target === main),
  }));
  const ungrouped = (analysis?.branches ?? []).filter(
    (b) => !b.is_main && b.target === null,
  );
  const remoteOnly = branches.filter(
    (b) =>
      b.is_remote &&
      !localByName.has(b.name.replace(/^origin\//, "")) &&
      !b.name.endsWith("/HEAD"),
  );

  function BranchRow({ branch }: { branch: AnalyzedBranch }) {
    const info = localByName.get(branch.name);
    const wt = worktreeByBranch.get(branch.name);
    const target = branch.target;
    return (
      <li
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-1.5",
          info?.is_current ? "bg-accent" : "hover:bg-accent/50",
        )}
      >
        {wt ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className={cn("font-mono text-sm", info?.is_current && "font-semibold")}>
          {branch.name}
        </span>
        <button
          onClick={() => toggleMine(branch)}
          title={branch.is_mine ? "Marked as my branch" : "Mark as my branch"}
          className={cn(
            "flex items-center gap-0.5 rounded px-1 py-0.5 text-xs",
            branch.is_mine
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "text-muted-foreground/50 hover:text-muted-foreground",
          )}
        >
          <User className="h-3 w-3" />
          {branch.is_mine ? "mine" : ""}
        </button>
        {wt && (
          <span className="truncate text-xs text-muted-foreground" title={wt.path}>
            {wt.path.split("/").pop()}
            {wt.has_changes ? " ●" : ""}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {target && (branch.ahead_of_target ?? 0) + (branch.behind_target ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">
              {branch.ahead_of_target ? `↑${branch.ahead_of_target}` : ""}
              {branch.behind_target ? ` ↓${branch.behind_target}` : ""} vs {target}
            </span>
          )}
          <BranchStatusBadge branch={info} />
          {target && (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={rebasing !== null}
                onClick={() => rebaseBranches(target, [branch.name])}
                title={`Rebase onto ${target}`}
              >
                {rebasing === branch.name ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <GitMerge />
                )}
                Rebase
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={rebasing !== null}
                onClick={() => setSquash({ branch: branch.name, base: target })}
                title={`Squash commits since ${target}`}
              >
                <ListTree />
                Squash
              </Button>
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={view === "branches" ? "secondary" : "ghost"}
          onClick={() => setView("branches")}
        >
          <GitBranch /> Branches
        </Button>
        <Button
          size="sm"
          variant={view === "graph" ? "secondary" : "ghost"}
          onClick={() => showGraph(graphScope)}
        >
          <GitGraphIcon /> Graph
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isFetching}
            onClick={() => fetchRepos([path])}
          >
            <RefreshCw className={cn(isFetching && "animate-spin")} />
            Fetch
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {rebasing && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Rebasing <span className="font-mono">{rebasing}</span>…
        </p>
      )}

      {view === "graph" ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant={graphScope === "all" ? "secondary" : "ghost"}
              onClick={() => showGraph("all")}
            >
              All branches
            </Button>
            {(analysis?.main_branches ?? []).map((m) => (
              <Button
                key={m}
                size="xs"
                variant={graphScope === m ? "secondary" : "ghost"}
                onClick={() => showGraph(m)}
              >
                {m} + attached
              </Button>
            ))}
          </div>
          {graphCommits === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading graph…
            </p>
          ) : (
            <GitGraph commits={graphCommits} />
          )}
        </section>
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Worktrees
              </h2>
              <Button
                size="xs"
                variant="outline"
                className="ml-auto"
                onClick={() => setAddWorktreeOpen(true)}
              >
                <Plus /> Add worktree
              </Button>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : worktrees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No worktrees.</p>
            ) : (
              <ul className="space-y-0.5">
                {worktrees.map((wt) => (
                  <WorktreeRow key={wt.path} repo={path} worktree={wt} onRemoved={reload} />
                ))}
              </ul>
            )}
          </section>

          {loading && <p className="text-sm text-muted-foreground">Analyzing branches…</p>}
          {!loading && analysis === null && !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Analyzing branches…
            </p>
          )}

          {groups.map(({ main, children }) => (
            <section key={main}>
              <div className="mb-2 flex items-center gap-2 border-b pb-2">
                <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-mono text-sm font-semibold">{main}</span>
                {analysis?.default_branch === main && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                    default
                  </span>
                )}
                <BranchStatusBadge branch={localByName.get(main)} />
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="xs" variant="ghost" onClick={() => showGraph(main)}>
                    <GitGraphIcon /> Graph
                  </Button>
                  {children.length > 0 && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={rebasing !== null}
                      onClick={() =>
                        rebaseBranches(
                          main,
                          children.map((c) => c.name),
                        )
                      }
                    >
                      <GitMerge /> Rebase all ({children.length})
                    </Button>
                  )}
                </div>
              </div>
              {children.length === 0 ? (
                <p className="px-3 text-xs text-muted-foreground">No branches target {main}.</p>
              ) : (
                <ul className="space-y-0.5">
                  {children.map((b) => (
                    <BranchRow key={b.name} branch={b} />
                  ))}
                </ul>
              )}
            </section>
          ))}

          {ungrouped.length > 0 && (
            <section>
              <h2 className="mb-2 border-b pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Other branches
              </h2>
              <ul className="space-y-0.5">
                {ungrouped.map((b) => (
                  <BranchRow key={b.name} branch={b} />
                ))}
              </ul>
            </section>
          )}

          {remoteOnly.length > 0 && (
            <section>
              <h2 className="mb-2 border-b pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Remote only
              </h2>
              <ul className="space-y-0.5">
                {remoteOnly.map((b) => (
                  <li
                    key={b.name}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-accent/50"
                  >
                    <span className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono text-sm text-muted-foreground">{b.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <AddWorktreeDialog
        repo={path}
        branches={branches}
        worktrees={worktrees}
        open={addWorktreeOpen}
        onOpenChange={setAddWorktreeOpen}
        onCreated={reload}
      />
      {squash && (
        <SquashDialog
          repo={path}
          branch={squash.branch}
          base={squash.base}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSquash(null);
          }}
          onSquashed={reload}
        />
      )}
      {conflict && (
        <ConflictDialog
          repo={path}
          branch={conflict.branch}
          onto={conflict.onto}
          files={conflict.files}
          open={true}
          onDone={handleConflictDone}
          onMoreConflicts={(files) => setConflict({ ...conflict, files })}
        />
      )}
    </div>
  );
}
