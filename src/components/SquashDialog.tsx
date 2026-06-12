import { useEffect, useState } from "react";
import { gitApi, type SquashPreview } from "@/lib/git";
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
import { Loader2 } from "lucide-react";

export function SquashDialog({
  repo,
  branch,
  base,
  open,
  onOpenChange,
  onSquashed,
}: {
  repo: string;
  branch: string;
  base: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSquashed: () => void;
}) {
  const [preview, setPreview] = useState<SquashPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    gitApi
      .getSquashPreview(repo, branch, base)
      .then((p) => {
        setPreview(p);
        setMessage(p.combined_message);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [open, repo, branch, base]);

  async function squash() {
    setBusy(true);
    setError(null);
    try {
      await gitApi.squashBranch(repo, branch, base, message);
      onOpenChange(false);
      onSquashed();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Squash <span className="font-mono">{branch}</span>
          </DialogTitle>
          <DialogDescription>
            Squashes all commits since the merge-base with{" "}
            <span className="font-mono">{base}</span> into a single commit.
          </DialogDescription>
        </DialogHeader>
        {preview === null && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading commits…
          </p>
        )}
        {preview && (
          <>
            <div className="max-h-40 overflow-y-auto rounded-lg border">
              {preview.commits.map((c) => (
                <div key={c.hash} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <span className="font-mono text-muted-foreground">{c.hash.slice(0, 7)}</span>
                  <span className="truncate">{c.subject}</span>
                </div>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Commit message
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="min-h-40 font-mono"
              />
            </label>
          </>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={squash}
            disabled={busy || !preview || preview.commits.length < 2 || !message.trim()}
          >
            {busy && <Loader2 className="animate-spin" />}
            Squash {preview ? `${preview.commits.length} commits` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
