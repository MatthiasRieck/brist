import { useEffect, useMemo, useState } from "react";
import { gitApi, type BranchInfo, type WorktreeInfo } from "@/lib/git";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

export function AddWorktreeDialog({
  repo,
  branches,
  worktrees,
  open,
  onOpenChange,
  onCreated,
}: {
  repo: string;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [branch, setBranch] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [base, setBase] = useState("");
  const [path, setPath] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkedOut = useMemo(
    () => new Set(worktrees.map((w) => w.branch).filter(Boolean) as string[]),
    [worktrees],
  );
  const availableBranches = branches.filter((b) => !b.is_remote && !checkedOut.has(b.name));
  const allRefs = branches.map((b) => b.name);

  const effectiveBranch = mode === "existing" ? branch : newBranch;

  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
      setPathTouched(false);
      setNewBranch("");
      return;
    }
    if (mode === "existing" && !branch && availableBranches.length > 0) {
      setBranch(availableBranches[0].name);
    }
    if (!base && allRefs.length > 0) {
      setBase(allRefs[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  useEffect(() => {
    if (pathTouched || !effectiveBranch) return;
    const safe = effectiveBranch.replace(/[^a-zA-Z0-9._-]+/g, "-");
    setPath(`${repo}-${safe}`);
  }, [effectiveBranch, pathTouched, repo]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await gitApi.addWorktree(
        repo,
        path,
        effectiveBranch,
        mode === "new",
        mode === "new" ? base : null,
      );
      onOpenChange(false);
      onCreated();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add worktree</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === "existing" ? "secondary" : "ghost"}
            onClick={() => setMode("existing")}
          >
            Existing branch
          </Button>
          <Button
            size="sm"
            variant={mode === "new" ? "secondary" : "ghost"}
            onClick={() => setMode("new")}
          >
            New branch
          </Button>
        </div>
        {mode === "existing" ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Branch
            <NativeSelect value={branch} onChange={(e) => setBranch(e.target.value)}>
              {availableBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              New branch name
              <Input
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="feature/my-change"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Base
              <NativeSelect value={base} onChange={(e) => setBase(e.target.value)}>
                {allRefs.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Worktree path
          <Input
            value={path}
            onChange={(e) => {
              setPathTouched(true);
              setPath(e.target.value);
            }}
          />
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !effectiveBranch || !path}>
            {busy && <Loader2 className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
