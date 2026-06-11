import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronRight, Folder, GitBranch, Loader2, Plus, RefreshCw, X } from "lucide-react";
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
import { useSync } from "@/contexts/SyncContext";

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

function RepoButton({
  node,
  selectedRepoPath,
  onSelect,
  sub,
}: {
  node: FileTreeNode;
  selectedRepoPath?: string;
  onSelect: (path: string) => void;
  sub: boolean;
}) {
  const { fetching } = useSync();
  const isFetching = fetching.has(node.fullPath);
  const ButtonComp = sub ? SidebarMenuSubButton : SidebarMenuButton;
  return (
    <ButtonComp
      isActive={node.fullPath === selectedRepoPath}
      onClick={() => onSelect(node.fullPath)}
    >
      <GitBranch className="shrink-0" />
      <span className="truncate">{node.name}</span>
      {isFetching && <Loader2 className="ml-auto shrink-0 animate-spin text-muted-foreground" />}
    </ButtonComp>
  );
}

function TreeItem({
  node,
  selectedRepoPath,
  onSelect,
  depth,
}: {
  node: FileTreeNode;
  selectedRepoPath?: string;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const isLeaf = node.isRepo || node.children.length === 0;
  const ItemComp = depth === 0 ? SidebarMenuItem : SidebarMenuSubItem;
  const ButtonComp = depth === 0 ? SidebarMenuButton : SidebarMenuSubButton;

  if (isLeaf) {
    return (
      <ItemComp>
        <RepoButton
          node={node}
          selectedRepoPath={selectedRepoPath}
          onSelect={onSelect}
          sub={depth > 0}
        />
      </ItemComp>
    );
  }
  return (
    <ItemComp>
      <ButtonComp onClick={() => setOpen((o) => !o)}>
        <Folder className="shrink-0" />
        <span>{node.name}</span>
        <ChevronRight className={cn("ml-auto transition-transform", open && "rotate-90")} />
      </ButtonComp>
      {open && (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <TreeItem
              key={child.fullPath}
              node={child}
              selectedRepoPath={selectedRepoPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </SidebarMenuSub>
      )}
    </ItemComp>
  );
}

function App() {
  const [folders, setFolders] = useState<string[]>([]);
  const [repos, setRepos] = useState<string[]>([]);
  const { headerContent } = useHeader();
  const { fetching, fetchRepos } = useSync();
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

  const anyFetching = fetching.size > 0;

  return (
    <SidebarProvider>
      <Sidebar className="border-t">
        <SidebarHeader className="flex flex-row items-center justify-between px-4 py-3">
          <span className="text-lg font-bold">brist</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => fetchRepos(repos)}
              disabled={anyFetching || repos.length === 0}
            >
              <RefreshCw className={cn(anyFetching && "animate-spin")} />
              <span className="sr-only">Fetch all repositories</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={addFolder}>
              <Plus />
              <span className="sr-only">+ Add Folder</span>
            </Button>
          </div>
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
                          <TreeItem
                            key={node.fullPath}
                            node={node}
                            selectedRepoPath={selectedRepoPath}
                            onSelect={handleSelectRepo}
                            depth={0}
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
