import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { FolderOpen, Plus, X } from "lucide-react";
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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

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
        <SidebarHeader className="px-4 py-3">
          <span className="text-lg font-bold">brist</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Folders</SidebarGroupLabel>
            <SidebarGroupAction onClick={addFolder} title="Add Folder">
              <Plus />
              <span className="sr-only">+ Add Folder</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              {folders.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">No folders added yet.</p>
              ) : (
                <SidebarMenu>
                  {folders.map((folder) => {
                    return (
                      <SidebarMenuItem key={folder}>
                        <SidebarMenuButton>
                          <FolderOpen className="shrink-0" />
                          <span className="truncate" title={folder}>{folder}</span>
                        </SidebarMenuButton>
                        <SidebarMenuAction
                          onClick={() => removeFolder(folder)}
                          title="Remove folder"
                          className="hover:text-destructive"
                        >
                          <X />
                          <span className="sr-only">Remove</span>
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="text-sm font-semibold">Repositories</h1>
        </header>
        <main className="p-6">
          {repos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No repositories found.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {repos.map((repo) => {
                const name = repo.split("/").pop() ?? repo;
                return (
                  <li key={repo}>
                    <Card>
                      <CardContent className="py-3">
                        <p className="text-sm font-semibold">{name}</p>
                        <p className="break-all text-xs text-muted-foreground">{repo}</p>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
