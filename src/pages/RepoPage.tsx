import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { Check } from "lucide-react";
import { useHeader } from "@/contexts/HeaderContext";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/lib/git";

function BranchStatusBadge({ branch }: { branch: BranchInfo }) {
  if (!branch.upstream) {
    return (
      <span className="rounded px-1.5 py-0.5 text-xs text-muted-foreground">
        local only
      </span>
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

export function RepoPage() {
  const { path } = useSearch({ from: "/repo" });
  const { setHeaderContent } = useHeader();
  const repoName = path.split("/").pop() ?? path;
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHeaderContent(repoName);
    return () => setHeaderContent(null);
  }, [repoName, setHeaderContent]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setBranches([]);
    invoke<BranchInfo[]>("get_branches", { path })
      .then(setBranches)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [path]);

  const localBranches = branches.filter((b) => !b.is_remote);
  const remoteBranches = branches.filter((b) => b.is_remote);

  return (
    <div className="space-y-8 p-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Local Branches
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : localBranches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No local branches.</p>
        ) : (
          <ul className="space-y-0.5">
            {localBranches.map((b) => (
              <li
                key={b.name}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5",
                  b.is_current ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                {b.is_current ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className={cn("font-mono text-sm", b.is_current && "font-semibold")}>
                  {b.name}
                </span>
                <div className="ml-auto">
                  <BranchStatusBadge branch={b} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Remote Branches
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : remoteBranches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No remote branches.</p>
        ) : (
          <ul className="space-y-0.5">
            {remoteBranches.map((b) => (
              <li
                key={b.name}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-accent/50"
              >
                <span className="h-3.5 w-3.5 shrink-0" />
                <span className="font-mono text-sm">{b.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
