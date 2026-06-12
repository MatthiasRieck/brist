import { useCallback, useEffect, useState } from "react";
import { gitApi, type ConflictFile } from "@/lib/git";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Check, FileWarning, Loader2 } from "lucide-react";

/**
 * Shown while a rebase is stopped on conflicts. Lets the user edit each
 * conflicted file (conflict markers included), mark it resolved, and then
 * continue or abort the rebase.
 */
export function ConflictDialog({
  repo,
  branch,
  onto,
  files: initialFiles,
  open,
  onDone,
  onMoreConflicts,
}: {
  repo: string;
  branch: string;
  onto: string;
  files: ConflictFile[];
  open: boolean;
  onDone: (aborted: boolean) => void;
  onMoreConflicts: (files: ConflictFile[]) => void;
}) {
  const [files, setFiles] = useState<ConflictFile[]>(initialFiles);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFiles(initialFiles);
    setResolved(new Set());
    setSelected(initialFiles[0]?.path ?? null);
    setError(null);
  }, [initialFiles]);

  const loadFile = useCallback(
    (file: string) => {
      setSelected(file);
      setContent("");
      gitApi
        .readConflictFile(repo, file)
        .then(setContent)
        .catch((e: unknown) => setError(String(e)));
    },
    [repo],
  );

  useEffect(() => {
    if (open && selected) loadFile(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, files]);

  async function markResolved() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await gitApi.saveConflictFile(repo, selected, content);
      const next = new Set(resolved);
      next.add(selected);
      setResolved(next);
      const remaining = files.find((f) => !next.has(f.path));
      if (remaining) loadFile(remaining.path);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function continueRebase() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await gitApi.rebaseContinue(repo);
      if (outcome.status === "completed") {
        onDone(false);
      } else {
        onMoreConflicts(outcome.files);
      }
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function abort() {
    setBusy(true);
    setError(null);
    try {
      await gitApi.rebaseAbort(repo);
      onDone(true);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const allResolved = files.length > 0 && files.every((f) => resolved.has(f.path));

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-4xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="size-4 text-amber-500" />
            Conflicts rebasing <span className="font-mono">{branch}</span> onto{" "}
            <span className="font-mono">{onto}</span>
          </DialogTitle>
          <DialogDescription>
            Edit each file, remove the conflict markers, then mark it resolved and continue.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 gap-3">
          <div className="w-56 shrink-0 overflow-y-auto rounded-lg border">
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => loadFile(f.path)}
                className={cn(
                  "flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-mono text-xs hover:bg-accent/50",
                  f.path === selected && "bg-accent",
                )}
              >
                {resolved.has(f.path) ? (
                  <Check className="size-3 shrink-0 text-green-500" />
                ) : (
                  <span className="size-3 shrink-0 rounded-full border border-amber-500" />
                )}
                <span className="truncate">{f.path}</span>
              </button>
            ))}
          </div>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-80 min-h-80 flex-1 font-mono text-xs whitespace-pre"
            spellCheck={false}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="destructive" onClick={abort} disabled={busy}>
            Abort rebase
          </Button>
          <Button variant="secondary" onClick={markResolved} disabled={busy || !selected}>
            {busy && <Loader2 className="animate-spin" />}
            Save & mark resolved
          </Button>
          <Button onClick={continueRebase} disabled={busy || !allResolved}>
            Continue rebase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
