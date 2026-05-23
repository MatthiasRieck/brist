use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize, Deserialize, Default)]
struct Config {
    folders: Vec<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".brist").join("config.json"))
}

fn read_config_from_path(path: &Path) -> Config {
    let Ok(data) = fs::read_to_string(path) else {
        return Config::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn write_config_to_path(path: &Path, config: &Config) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

fn read_config(app: &tauri::AppHandle) -> Config {
    let Ok(path) = config_path(app) else {
        return Config::default();
    };
    read_config_from_path(&path)
}

fn write_config(app: &tauri::AppHandle, config: &Config) -> Result<(), String> {
    let path = config_path(app)?;
    write_config_to_path(&path, config)
}

#[tauri::command]
fn get_folders(app: tauri::AppHandle) -> Vec<String> {
    read_config(&app).folders
}

#[tauri::command]
fn add_folder(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    let mut config = read_config(&app);
    if !config.folders.contains(&path) {
        config.folders.push(path);
        write_config(&app, &config)?;
    }
    Ok(config.folders)
}

#[tauri::command]
fn remove_folder(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    let mut config = read_config(&app);
    config.folders.retain(|f| f != &path);
    write_config(&app, &config)?;
    Ok(config.folders)
}

fn find_git_repos(root: &Path) -> Vec<PathBuf> {
    let mut repos = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return repos,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str == "node_modules" || name_str == "target" {
            continue;
        }
        if path.join(".git").exists() {
            repos.push(path);
        } else {
            repos.extend(find_git_repos(&path));
        }
    }
    repos
}

#[tauri::command]
fn scan_repositories(app: tauri::AppHandle) -> Vec<String> {
    let config = read_config(&app);
    let mut repos: Vec<String> = config
        .folders
        .iter()
        .flat_map(|folder| find_git_repos(Path::new(folder)))
        .filter_map(|p| p.to_str().map(String::from))
        .collect();
    repos.sort();
    repos.dedup();
    repos
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_folders,
            add_folder,
            remove_folder,
            scan_repositories
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn read_config_returns_default_when_file_is_missing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let config = read_config_from_path(&path);
        assert!(config.folders.is_empty());
    }

    #[test]
    fn read_config_returns_default_on_invalid_json() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, b"not valid json").unwrap();
        let config = read_config_from_path(&path);
        assert!(config.folders.is_empty());
    }

    #[test]
    fn write_and_read_config_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let original = Config {
            folders: vec!["/home/user/docs".to_string(), "/home/user/pics".to_string()],
        };
        write_config_to_path(&path, &original).unwrap();
        let loaded = read_config_from_path(&path);
        assert_eq!(loaded.folders, original.folders);
    }

    #[test]
    fn write_config_creates_parent_directories() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested").join("dirs").join("config.json");
        let config = Config { folders: vec![] };
        write_config_to_path(&path, &config).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn add_folder_prevents_duplicates() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let folder = "/home/user/docs".to_string();

        let mut config = Config::default();
        if !config.folders.contains(&folder) {
            config.folders.push(folder.clone());
            write_config_to_path(&path, &config).unwrap();
        }

        let mut config2 = read_config_from_path(&path);
        if !config2.folders.contains(&folder) {
            config2.folders.push(folder.clone());
            write_config_to_path(&path, &config2).unwrap();
        }

        let final_config = read_config_from_path(&path);
        assert_eq!(final_config.folders.len(), 1);
        assert_eq!(final_config.folders[0], folder);
    }

    #[test]
    fn remove_folder_deletes_the_entry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let mut config = Config {
            folders: vec!["/home/user/docs".to_string(), "/home/user/pics".to_string()],
        };
        config.folders.retain(|f| f != "/home/user/docs");
        write_config_to_path(&path, &config).unwrap();
        let loaded = read_config_from_path(&path);
        assert_eq!(loaded.folders, vec!["/home/user/pics"]);
    }

    #[test]
    fn remove_nonexistent_folder_is_a_noop() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let original = Config {
            folders: vec!["/home/user/docs".to_string()],
        };
        write_config_to_path(&path, &original).unwrap();

        let mut config = read_config_from_path(&path);
        config.folders.retain(|f| f != "/does/not/exist");
        write_config_to_path(&path, &config).unwrap();

        let loaded = read_config_from_path(&path);
        assert_eq!(loaded.folders, vec!["/home/user/docs"]);
    }

    #[test]
    fn find_git_repos_discovers_repos_at_various_depths() {
        let dir = tempdir().unwrap();
        // shallow repo
        let shallow = dir.path().join("shallow");
        fs::create_dir_all(shallow.join(".git")).unwrap();
        // nested repo
        let nested = dir.path().join("a").join("b").join("deep");
        fs::create_dir_all(nested.join(".git")).unwrap();
        // non-repo directory
        fs::create_dir_all(dir.path().join("empty")).unwrap();

        let mut repos = find_git_repos(dir.path());
        repos.sort();
        assert_eq!(repos.len(), 2);
        assert!(repos.iter().any(|p| p.ends_with("shallow")));
        assert!(repos.iter().any(|p| p.ends_with("deep")));
    }

    #[test]
    fn find_git_repos_skips_dot_dirs_node_modules_and_target() {
        let dir = tempdir().unwrap();
        // these should be skipped
        fs::create_dir_all(dir.path().join(".hidden").join(".git")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules").join(".git")).unwrap();
        fs::create_dir_all(dir.path().join("target").join(".git")).unwrap();
        // this should be found
        let visible = dir.path().join("visible");
        fs::create_dir_all(visible.join(".git")).unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert!(repos[0].ends_with("visible"));
    }

    #[test]
    fn find_git_repos_does_not_recurse_into_git_repos() {
        let dir = tempdir().unwrap();
        // outer repo — should be found
        let outer = dir.path().join("outer");
        fs::create_dir_all(outer.join(".git")).unwrap();
        // inner repo nested inside outer — should NOT be found
        let inner = outer.join("inner");
        fs::create_dir_all(inner.join(".git")).unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert!(repos[0].ends_with("outer"));
    }
}
