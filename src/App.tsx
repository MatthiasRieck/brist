import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronRight, Folder, GitBranch, Plus, X } from "lucide-react";
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

function SubTreeItem({ node }: { node: FileTreeNode }) {
  const [open, setOpen] = useState(true);

  if (node.isRepo || node.children.length === 0) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton>
          <GitBranch className="shrink-0" />
          <span>{node.name}</span>
        </SidebarMenuSubButton>
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
            <SubTreeItem key={child.fullPath} node={child} />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuSubItem>
  );
}

function TopLevelTreeItem({ node }: { node: FileTreeNode }) {
  const [open, setOpen] = useState(true);

  if (node.isRepo || node.children.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton>
          <GitBranch className="shrink-0" />
          <span>{node.name}</span>
        </SidebarMenuButton>
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
            <SubTreeItem key={child.fullPath} node={child} />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

function App() {
  const [folders, setFolders] = useState<string[]>([]);
  const [repos, setRepos] = useState<string[]>([]);

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

  return (
    <SidebarProvider>
      <Sidebar>
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
            folders.map((folder) => {
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
                          <TopLevelTreeItem key={node.fullPath} node={node} />
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
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="text-sm font-semibold">brist</span>
        </header>
        <main className="p-6" />
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
