import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

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
    <main className="container">
      <h1>brist</h1>
      <button className="add-btn" onClick={addFolder}>
        + Add Folder
      </button>
      {folders.length === 0 ? (
        <p className="empty">No folders added yet.</p>
      ) : (
        <ul className="folder-list">
          {folders.map((folder) => (
            <li key={folder} className="folder-item">
              <span className="folder-path">{folder}</span>
              <button className="remove-btn" onClick={() => removeFolder(folder)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default App;
