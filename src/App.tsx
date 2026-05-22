import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function App() {
  const [folders, setFolders] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>("get_folders").then(setFolders);
  }, []);

  async function addFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const updated = await invoke<string[]>("add_folder", { path: selected });
      setFolders(updated);
    }
  }

  async function removeFolder(path: string) {
    const updated = await invoke<string[]>("remove_folder", { path });
    setFolders(updated);
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">brist</h1>
      <Button onClick={addFolder}>+ Add Folder</Button>
      {folders.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No folders added yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {folders.map((folder) => (
            <li key={folder}>
              <Card>
                <CardContent className="flex items-center justify-between py-3">
                  <span className="break-all text-sm">{folder}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-4 shrink-0 hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => removeFolder(folder)}
                  >
                    Remove
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default App;
