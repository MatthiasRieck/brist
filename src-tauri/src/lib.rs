mod git;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

use git::{
    BranchInfo, ConflictFile, GraphCommit, OpOutcome, RebaseSession, RebaseState, RepoAnalysis,
    SquashPreview, WorktreeInfo,
};

#[derive(Serialize, Deserialize, Default)]
struct Config {
    folders: Vec<String>,
    #[serde(default)]
    branch_owners: HashMap<String, HashMap<String, bool>>,
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
        let git_path = path.join(".git");
        if git_path.exists() {
            // A real repository has a .git directory; linked worktrees (and
            // submodules) have a .git file instead and must not be listed.
            if git_path.is_dir() {
                repos.push(path);
            }
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

#[tauri::command]
fn get_branches(path: String) -> Result<Vec<BranchInfo>, String> {
    git::list_branches(&path)
}

#[tauri::command]
fn get_worktrees(path: String) -> Result<Vec<WorktreeInfo>, String> {
    git::list_worktrees(&path)
}

#[tauri::command]
fn fetch_repo(path: String) -> Result<(), String> {
    git::fetch(&path)
}

#[tauri::command]
fn get_repo_analysis(app: tauri::AppHandle, path: String) -> Result<RepoAnalysis, String> {
    let config = read_config(&app);
    let overrides = config.branch_owners.get(&path).cloned().unwrap_or_default();
    git::repo_analysis(&path, &overrides)
}

#[tauri::command]
fn set_branch_owner(
    app: tauri::AppHandle,
    repo: String,
    branch: String,
    mine: Option<bool>,
) -> Result<(), String> {
    let mut config = read_config(&app);
    let repo_overrides = config.branch_owners.entry(repo).or_default();
    match mine {
        Some(value) => {
            repo_overrides.insert(branch, value);
        }
        None => {
            repo_overrides.remove(&branch);
        }
    }
    write_config(&app, &config)
}

#[tauri::command]
fn add_worktree(
    repo: String,
    worktree_path: String,
    branch: String,
    create_branch: bool,
    base: Option<String>,
) -> Result<(), String> {
    git::add_worktree(
        &repo,
        &worktree_path,
        &branch,
        create_branch,
        base.as_deref(),
    )
}

#[tauri::command]
fn remove_worktree(repo: String, worktree_path: String, force: bool) -> Result<(), String> {
    git::remove_worktree(&repo, &worktree_path, force)
}

#[tauri::command]
fn switch_branch(worktree: String, branch: String) -> Result<(), String> {
    git::switch_branch(&worktree, &branch)
}

#[tauri::command]
fn push_branch(repo: String, branch: String, force: bool) -> Result<(), String> {
    git::push_branch(&repo, &branch, force)
}

#[tauri::command]
fn pull_branch(repo: String, branch: String) -> Result<(), String> {
    git::pull_branch(&repo, &branch)
}

#[tauri::command]
fn rebase_branch(
    state: tauri::State<RebaseState>,
    repo: String,
    branch: String,
    onto: String,
) -> Result<OpOutcome, String> {
    git::start_rebase(&state, &repo, &branch, &onto)
}

#[tauri::command]
fn rebase_continue(state: tauri::State<RebaseState>, repo: String) -> Result<OpOutcome, String> {
    git::continue_rebase(&state, &repo)
}

#[tauri::command]
fn rebase_abort(state: tauri::State<RebaseState>, repo: String) -> Result<(), String> {
    git::abort_rebase(&state, &repo)
}

#[tauri::command]
fn get_rebase_session(state: tauri::State<RebaseState>, repo: String) -> Option<RebaseSession> {
    git::current_session(&state, &repo)
}

#[tauri::command]
fn get_conflict_files(
    state: tauri::State<RebaseState>,
    repo: String,
) -> Result<Vec<ConflictFile>, String> {
    git::session_conflicts(&state, &repo)
}

#[tauri::command]
fn read_conflict_file(
    state: tauri::State<RebaseState>,
    repo: String,
    file: String,
) -> Result<String, String> {
    git::read_conflict(&state, &repo, &file)
}

#[tauri::command]
fn save_conflict_file(
    state: tauri::State<RebaseState>,
    repo: String,
    file: String,
    content: String,
) -> Result<(), String> {
    git::save_conflict(&state, &repo, &file, &content)
}

#[tauri::command]
fn get_squash_preview(repo: String, branch: String, base: String) -> Result<SquashPreview, String> {
    git::squash_preview(&repo, &branch, &base)
}

#[tauri::command]
fn squash_branch(
    repo: String,
    branch: String,
    base: String,
    message: String,
) -> Result<(), String> {
    git::squash_branch(&repo, &branch, &base, &message)
}

#[tauri::command]
fn get_graph(
    repo: String,
    refs: Option<Vec<String>>,
    limit: Option<u32>,
) -> Result<Vec<GraphCommit>, String> {
    git::graph(&repo, refs, limit)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RebaseState::default())
        .invoke_handler(tauri::generate_handler![
            get_folders,
            add_folder,
            remove_folder,
            scan_repositories,
            get_branches,
            get_worktrees,
            fetch_repo,
            get_repo_analysis,
            set_branch_owner,
            add_worktree,
            remove_worktree,
            switch_branch,
            push_branch,
            pull_branch,
            rebase_branch,
            rebase_continue,
            rebase_abort,
            get_rebase_session,
            get_conflict_files,
            read_conflict_file,
            save_conflict_file,
            get_squash_preview,
            squash_branch,
            get_graph
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
    fn read_config_accepts_legacy_format_without_branch_owners() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, br#"{"folders": ["/home/user/docs"]}"#).unwrap();
        let config = read_config_from_path(&path);
        assert_eq!(config.folders, vec!["/home/user/docs"]);
        assert!(config.branch_owners.is_empty());
    }

    #[test]
    fn write_and_read_config_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let mut branch_owners = HashMap::new();
        branch_owners.insert(
            "/repo".to_string(),
            HashMap::from([("feature/x".to_string(), true)]),
        );
        let original = Config {
            folders: vec!["/home/user/docs".to_string(), "/home/user/pics".to_string()],
            branch_owners,
        };
        write_config_to_path(&path, &original).unwrap();
        let loaded = read_config_from_path(&path);
        assert_eq!(loaded.folders, original.folders);
        assert_eq!(loaded.branch_owners, original.branch_owners);
    }

    #[test]
    fn write_config_creates_parent_directories() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested").join("dirs").join("config.json");
        let config = Config::default();
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
            ..Config::default()
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
            ..Config::default()
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
    fn find_git_repos_skips_linked_worktrees_with_git_file() {
        let dir = tempdir().unwrap();
        // real repository: .git directory
        let repo = dir.path().join("org").join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        // linked worktree next to it: .git is a file
        let worktree = dir.path().join("org").join("repo-feature-x");
        fs::create_dir_all(&worktree).unwrap();
        fs::write(worktree.join(".git"), "gitdir: /somewhere/.git/worktrees/x").unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert!(repos[0].ends_with("org/repo"));
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
