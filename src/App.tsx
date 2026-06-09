import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronRight, Folder, GitBranch, Lock, Plus, X } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useHeader } from "@/contexts/HeaderContext";
import type { WorktreeInfo } from "@/lib/git";

interface FileTreeNode {
  name: string;
  fullPath: string;
  isRepo: boolean;
  children: FileTreeNode[];
}

interface RawTreeNode {
  isRepo: boolean;
  children: Record<string, RawTreeNode>;
}

function buildFileTree(repos: string[], rootFolder: string): FileTreeNode[] {
  const root: Record<string, RawTreeNode> = {};
  const prefix = rootFolder.endsWith("/") ? rootFolder : `${rootFolder}/`;

  for (const repo of repos) {
    if (!repo.startsWith(prefix)) continue;
    const parts = repo.slice(prefix.length).split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = { isRepo: false, children: {} };
      if (i === parts.length - 1) cur[parts[i]].isRepo = true;
      cur = cur[parts[i]].children;
    }
  }

  function toNodes(obj: Record<string, RawTreeNode>, parentPath: string): FileTreeNode[] {
    return Object.entries(obj)
      .map(([name, node]) => ({
        name,
        fullPath: `${parentPath}/${name}`,
        isRepo: node.isRepo,
        children: toNodes(node.children, `${parentPath}/${name}`),
      }))
      .sort((a, b) => {
        const aIsDir = !a.isRepo && a.children.length > 0;
        const bIsDir = !b.isRepo && b.children.length > 0;
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  return toNodes(root, rootFolder);
}

function WorktreeSubItems({
  worktrees,
  selectedRepoPath,
  onSelect,
}: {
  worktrees: WorktreeInfo[];
  selectedRepoPath?: string;
  onSelect: (path: string) => void;
}) {
  if (worktrees.length === 0) {
    return (
      <SidebarMenuSubItem>
        <span className="px-3 py-1.5 text-xs text-muted-foreground">No worktrees found</span>
      </SidebarMenuSubItem>
    );
  }
  return (
    <>
      {worktrees.map((wt) => (
        <SidebarMenuSubItem key={wt.path}>
          <SidebarMenuSubButton
            isActive={wt.path === selectedRepoPath}
            onClick={() => onSelect(wt.path)}
          >
            <GitBranch className="shrink-0" />
            <span className="truncate">{wt.branch ?? "(detached)"}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {wt.is_main && "main"}
              {wt.is_locked && <Lock className="h-3 w-3" />}
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </>
  );
}

function SubTreeItem({
  node,
  selectedRepoPath,
  onSelect,
}: {
  node: FileTreeNode;
  selectedRepoPath?: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [wtOpen, setWtOpen] = useState(false);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[] | null>(null);

  async function handleRepoClick() {
    if (worktrees === null) {
      try {
        const wts = await invoke<WorktreeInfo[]>("get_worktrees", { path: node.fullPath });
        setWorktrees(wts);
      } catch {
        setWorktrees([]);
      }
    }
    setWtOpen((o) => !o);
  }

  if (node.isRepo || node.children.length === 0) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton onClick={handleRepoClick}>
          <GitBranch className="shrink-0" />
          <span>{node.name}</span>
          <ChevronRight className={cn("ml-auto shrink-0 transition-transform", wtOpen && "rotate-90")} />
        </SidebarMenuSubButton>
        {wtOpen && worktrees !== null && (
          <SidebarMenuSub>
            <WorktreeSubItems
              worktrees={worktrees}
              selectedRepoPath={selectedRepoPath}
              onSelect={onSelect}
            />
          </SidebarMenuSub>
        )}
      </SidebarMenuSubItem>
    );
  }
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton onClick={() => setOpen((o) => !o)}>
        <Folder className="shrink-0" />
        <span>{node.name}</span>
        <ChevronRight className={cn("ml-auto transition-transform", open && "rotate-90")} />
      </SidebarMenuSubButton>
      {open && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <SubTreeItem
              key={child.fullPath}
              node={child}
              selectedRepoPath={selectedRepoPath}
              onSelect={onSelect}
            />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuSubItem>
  );
}

function TopLevelTreeItem({
  node,
  selectedRepoPath,
  onSelect,
}: {
  node: FileTreeNode;
  selectedRepoPath?: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [wtOpen, setWtOpen] = useState(false);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[] | null>(null);

  async function handleRepoClick() {
    if (worktrees === null) {
      try {
        const wts = await invoke<WorktreeInfo[]>("get_worktrees", { path: node.fullPath });
        setWorktrees(wts);
      } catch {
        setWorktrees([]);
      }
    }
    setWtOpen((o) => !o);
  }

  if (node.isRepo || node.children.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton onClick={handleRepoClick}>
          <GitBranch className="shrink-0" />
          <span>{node.name}</span>
          <ChevronRight className={cn("ml-auto shrink-0 transition-transform", wtOpen && "rotate-90")} />
        </SidebarMenuButton>
        {wtOpen && worktrees !== null && (
          <SidebarMenuSub>
            <WorktreeSubItems
              worktrees={worktrees}
              selectedRepoPath={selectedRepoPath}
              onSelect={onSelect}
            />
          </SidebarMenuSub>
        )}
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={() => setOpen((o) => !o)}>
        <Folder className="shrink-0" />
        <span>{node.name}</span>
        <ChevronRight className={cn("ml-auto transition-transform", open && "rotate-90")} />
      </SidebarMenuButton>
      {open && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <SubTreeItem
              key={child.fullPath}
              node={child}
              selectedRepoPath={selectedRepoPath}
              onSelect={onSelect}
            />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

function App() {
  const [folders, setFolders] = useState<string[]>([]);
  const [repos, setRepos] = useState<string[]>([]);
  const { headerContent } = useHeader();
  const navigate = useNavigate();
  const selectedRepoPath = useRouterState({
    select: (state) => {
      if (state.location.pathname === "/repo") {
        return (state.location.search as { path?: string }).path;
      }
      return undefined;
    },
  });

  useEffect(() => {
    Promise.all([
      invoke<string[]>("get_folders"),
      invoke<string[]>("scan_repositories"),
    ]).then(([loadedFolders, loadedRepos]) => {
      setFolders(loadedFolders);
      setRepos(loadedRepos);
    });
  }, []);

  async function addFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const updated = await invoke<string[]>("add_folder", { path: selected });
      setFolders(updated);
      const updatedRepos = await invoke<string[]>("scan_repositories");
      setRepos(updatedRepos);
    }
  }

  async function removeFolder(path: string) {
    const updated = await invoke<string[]>("remove_folder", { path });
    setFolders(updated);
    const updatedRepos = await invoke<string[]>("scan_repositories");
    setRepos(updatedRepos);
  }

  function handleSelectRepo(path: string) {
    navigate({ to: "/repo", search: { path } });
  }

  return (
    <SidebarProvider>
      <Sidebar className="border-t">
        <SidebarHeader className="flex flex-row items-center justify-between px-4 py-3">
          <span className="text-lg font-bold">brist</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={addFolder}>
            <Plus />
            <span className="sr-only">+ Add Folder</span>
          </Button>
        </SidebarHeader>
        <SidebarContent>
          {folders.length === 0 ? (
            <p className="px-4 py-2 text-xs text-muted-foreground">No folders added yet.</p>
          ) : (
            [...folders].sort((a, b) => a.localeCompare(b)).map((folder) => {
              const folderName = folder.split("/").pop() ?? folder;
              const tree = buildFileTree(repos, folder);
              return (
                <SidebarGroup key={folder}>
                  <SidebarGroupLabel>{folderName}</SidebarGroupLabel>
                  <SidebarGroupAction
                    onClick={() => removeFolder(folder)}
                    className="hover:text-destructive"
                  >
                    <X />
                    <span className="sr-only">Remove {folderName}</span>
                  </SidebarGroupAction>
                  <SidebarGroupContent>
                    {tree.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted-foreground">No repositories found.</p>
                    ) : (
                      <SidebarMenu>
                        {tree.map((node) => (
                          <TopLevelTreeItem
                            key={node.fullPath}
                            node={node}
                            selectedRepoPath={selectedRepoPath}
                            onSelect={handleSelectRepo}
                          />
                        ))}
                      </SidebarMenu>
                    )}
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })
          )}
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="border-t">
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          {headerContent}
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
