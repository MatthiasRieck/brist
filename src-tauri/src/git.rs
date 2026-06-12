use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

#[derive(Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub upstream: Option<String>,
    pub ahead: Option<i32>,
    pub behind: Option<i32>,
    pub is_remote: bool,
    pub gone: bool,
    pub author_email: Option<String>,
    pub committer_date: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    pub is_locked: bool,
    pub is_bare: bool,
    pub has_changes: bool,
}

#[derive(Serialize, Clone)]
pub struct AnalyzedBranch {
    pub name: String,
    pub is_main: bool,
    pub target: Option<String>,
    pub ahead_of_target: Option<i32>,
    pub behind_target: Option<i32>,
    pub is_mine: bool,
    pub mine_override: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct RepoAnalysis {
    pub default_branch: Option<String>,
    pub main_branches: Vec<String>,
    pub user_email: Option<String>,
    pub branches: Vec<AnalyzedBranch>,
}

#[derive(Serialize, Clone)]
pub struct ConflictFile {
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct RebaseSession {
    pub repo: String,
    pub branch: String,
    pub onto: String,
    pub worktree: String,
    pub is_temp: bool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OpOutcome {
    Completed,
    Conflicts {
        branch: String,
        onto: String,
        files: Vec<ConflictFile>,
    },
}

#[derive(Serialize, Clone)]
pub struct CommitSummary {
    pub hash: String,
    pub subject: String,
    pub body: String,
}

#[derive(Serialize, Clone)]
pub struct SquashPreview {
    pub base_commit: String,
    pub commits: Vec<CommitSummary>,
    pub combined_message: String,
}

#[derive(Serialize, Clone)]
pub struct GraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub date: i64,
    pub refs: Vec<String>,
    pub subject: String,
}

#[derive(Default)]
pub struct RebaseState(pub Mutex<HashMap<String, RebaseSession>>);

fn git_command(dir: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir).env("GIT_TERMINAL_PROMPT", "0");
    cmd
}

fn run_git(dir: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command(dir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn ref_exists(dir: &str, reference: &str) -> bool {
    run_git(dir, &["rev-parse", "--verify", "--quiet", reference]).is_ok()
}

/// Resolve a short branch name to a usable ref: prefer the local branch,
/// fall back to the origin remote-tracking branch.
fn resolve_ref(dir: &str, name: &str) -> Option<String> {
    if ref_exists(dir, &format!("refs/heads/{name}")) {
        return Some(name.to_string());
    }
    if ref_exists(dir, &format!("refs/remotes/origin/{name}")) {
        return Some(format!("origin/{name}"));
    }
    if ref_exists(dir, name) {
        return Some(name.to_string());
    }
    None
}

fn is_ancestor(dir: &str, ancestor: &str, descendant: &str) -> bool {
    run_git(dir, &["merge-base", "--is-ancestor", ancestor, descendant]).is_ok()
}

/// Resolve the ref to use as a BASE branch (rebase target, merge target,
/// squash base). Unlike `resolve_ref` this considers origin/<name> as well and
/// picks whichever is further ahead, so a stale local base branch doesn't
/// matter after a fetch. On divergence origin wins.
fn resolve_base_ref(dir: &str, name: &str) -> Option<String> {
    let local = ref_exists(dir, &format!("refs/heads/{name}")).then(|| name.to_string());
    let remote =
        ref_exists(dir, &format!("refs/remotes/origin/{name}")).then(|| format!("origin/{name}"));
    match (local, remote) {
        (Some(local), Some(remote)) => {
            if is_ancestor(dir, &remote, &local) {
                // local contains origin's head (or equal) -> local is current
                Some(local)
            } else {
                Some(remote)
            }
        }
        (Some(local), None) => Some(local),
        (None, Some(remote)) => Some(remote),
        (None, None) => ref_exists(dir, name).then(|| name.to_string()),
    }
}

fn rev_list_count(dir: &str, args: &[&str]) -> Option<i32> {
    let mut full = vec!["rev-list", "--count"];
    full.extend_from_slice(args);
    run_git(dir, &full).ok()?.trim().parse().ok()
}

pub fn parse_track(track: &str) -> (Option<i32>, Option<i32>, bool) {
    let trimmed = track.trim();
    if trimmed == "[gone]" {
        return (None, None, true);
    }
    let mut ahead: Option<i32> = None;
    let mut behind: Option<i32> = None;
    if let Some(pos) = trimmed.find("ahead ") {
        let rest = &trimmed[pos + 6..];
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        ahead = num.parse().ok();
    }
    if let Some(pos) = trimmed.find("behind ") {
        let rest = &trimmed[pos + 7..];
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        behind = num.parse().ok();
    }
    (ahead, behind, false)
}

pub fn list_branches(path: &str) -> Result<Vec<BranchInfo>, String> {
    const FORMAT: &str = "%(refname)\x1f%(refname:short)\x1f%(upstream:short)\x1f%(upstream:track)\x1f%(HEAD)\x1f%(authoremail)\x1f%(committerdate:unix)\x1f%(symref)";
    let stdout = run_git(
        path,
        &[
            "for-each-ref",
            &format!("--format={FORMAT}"),
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let mut branches = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() < 7 {
            continue;
        }
        let refname = parts[0];
        let short_name = parts[1];
        let upstream = parts[2];
        let track = parts[3];
        let head_marker = parts[4];
        let author_email = parts[5].trim_matches(|c| c == '<' || c == '>');
        let committer_date = parts[6].trim().parse::<i64>().ok();
        let symref = parts.get(7).copied().unwrap_or("");
        if !symref.is_empty() {
            continue;
        }
        let is_remote = refname.starts_with("refs/remotes/");
        let is_current = head_marker == "*";
        let (ahead, behind, gone) = parse_track(track);
        branches.push(BranchInfo {
            name: short_name.to_string(),
            is_current,
            upstream: if upstream.is_empty() {
                None
            } else {
                Some(upstream.to_string())
            },
            ahead,
            behind,
            is_remote,
            gone,
            author_email: if author_email.is_empty() {
                None
            } else {
                Some(author_email.to_string())
            },
            committer_date,
        });
    }
    Ok(branches)
}

pub fn list_worktrees(path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let stdout = run_git(path, &["worktree", "list", "--porcelain"])?;
    let mut worktrees = Vec::new();
    let mut is_first = true;
    for block in stdout.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut wt_path: Option<String> = None;
        let mut wt_head = String::new();
        let mut wt_branch: Option<String> = None;
        let mut wt_locked = false;
        let mut wt_bare = false;
        for line in block.lines() {
            if let Some(val) = line.strip_prefix("worktree ") {
                wt_path = Some(val.to_string());
            } else if let Some(val) = line.strip_prefix("HEAD ") {
                wt_head = val.to_string();
            } else if let Some(val) = line.strip_prefix("branch ") {
                let short = val.strip_prefix("refs/heads/").unwrap_or(val);
                wt_branch = Some(short.to_string());
            } else if line == "locked" || line.starts_with("locked ") {
                wt_locked = true;
            } else if line == "bare" {
                wt_bare = true;
            }
        }
        if let Some(p) = wt_path {
            let has_changes = !wt_bare
                && run_git(&p, &["status", "--porcelain"])
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
            worktrees.push(WorktreeInfo {
                path: p,
                branch: wt_branch,
                head: wt_head,
                is_main: is_first,
                is_locked: wt_locked,
                is_bare: wt_bare,
                has_changes,
            });
            is_first = false;
        }
    }
    Ok(worktrees)
}

/// Parse a git remote URL into (host, owner, repo).
pub fn parse_remote_url(url: &str) -> Option<(String, String, String)> {
    let url = url.trim();
    let without_scheme = if let Some(rest) = url.strip_prefix("https://") {
        rest.to_string()
    } else if let Some(rest) = url.strip_prefix("http://") {
        rest.to_string()
    } else if let Some(rest) = url.strip_prefix("ssh://") {
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        rest.to_string()
    } else if let Some(rest) = url.strip_prefix("git@") {
        rest.replacen(':', "/", 1)
    } else {
        return None;
    };
    let without_scheme = without_scheme
        .strip_prefix("git@")
        .unwrap_or(&without_scheme);
    let mut parts = without_scheme.splitn(3, '/');
    let host = parts.next()?.to_string();
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.trim_end_matches('/').to_string();
    let repo = repo.strip_suffix(".git").unwrap_or(&repo).to_string();
    if host.is_empty() || owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((host, owner, repo))
}

/// Find a token for `host` in netrc-formatted content (password preferred over login).
pub fn netrc_token_from(content: &str, host: &str) -> Option<String> {
    let tokens: Vec<&str> = content.split_whitespace().collect();
    let mut current_machine: Option<String> = None;
    let mut machines: HashMap<String, String> = HashMap::new();
    let mut i = 0;
    while i < tokens.len() {
        match tokens[i] {
            "machine" => {
                if let Some(name) = tokens.get(i + 1) {
                    current_machine = Some((*name).to_string());
                    i += 1;
                }
            }
            "default" => current_machine = Some("default".to_string()),
            "password" => {
                if let (Some(machine), Some(value)) = (&current_machine, tokens.get(i + 1)) {
                    machines.insert(machine.clone(), (*value).to_string());
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    machines
        .get(host)
        .or_else(|| machines.get("default"))
        .cloned()
}

fn netrc_token(host: &str) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let content = fs::read_to_string(Path::new(&home).join(".netrc")).ok()?;
    netrc_token_from(&content, host)
}

/// Ask the GitHub API for the repository's default branch, using a token
/// from ~/.netrc. Works for github.com and GitHub Enterprise hosts.
fn github_default_branch(path: &str) -> Option<String> {
    let url = run_git(path, &["remote", "get-url", "origin"]).ok()?;
    let (host, owner, repo) = parse_remote_url(&url)?;
    let token = netrc_token(&host)?;
    let api_url = if host == "github.com" {
        format!("https://api.github.com/repos/{owner}/{repo}")
    } else {
        format!("https://{host}/api/v3/repos/{owner}/{repo}")
    };
    let output = Command::new("curl")
        .args([
            "-fsS",
            "-m",
            "5",
            "-H",
            &format!("Authorization: Bearer {token}"),
            "-H",
            "Accept: application/vnd.github+json",
            &api_url,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    json.get("default_branch")?.as_str().map(String::from)
}

fn detect_default_branch(path: &str) -> Option<String> {
    // 1. Local symref (set on clone, instant).
    if let Ok(out) = run_git(
        path,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    ) {
        if let Some((_, name)) = out.trim().split_once('/') {
            return Some(name.to_string());
        }
    }
    // 2. GitHub API with a ~/.netrc token.
    if let Some(name) = github_default_branch(path) {
        return Some(name);
    }
    // 3. Ask the remote via git (uses git's own credentials) and persist the symref.
    if run_git(path, &["remote", "set-head", "origin", "--auto"]).is_ok() {
        if let Ok(out) = run_git(
            path,
            &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        ) {
            if let Some((_, name)) = out.trim().split_once('/') {
                return Some(name.to_string());
            }
        }
    }
    // 4. Common names.
    ["main", "master", "trunk", "develop"]
        .iter()
        .find(|name| resolve_ref(path, name).is_some())
        .map(|s| s.to_string())
}

pub fn is_main_branch_name(name: &str) -> bool {
    matches!(
        name,
        "main" | "master" | "trunk" | "develop" | "development" | "stable" | "next"
    ) || name == "release"
        || name.starts_with("release/")
        || name.starts_with("release-")
}

/// Main branches: the default branch, branches with conventional integration
/// names, and branches that accumulated several merge commits of their own
/// (i.e. things get merged INTO them) relative to the default branch.
fn detect_main_branches(
    path: &str,
    default_branch: Option<&str>,
    branches: &[BranchInfo],
) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    for b in branches {
        let short = b
            .name
            .strip_prefix("origin/")
            .unwrap_or(&b.name)
            .to_string();
        if short == "HEAD" || candidates.contains(&short) {
            continue;
        }
        candidates.push(short);
    }
    let default_ref = default_branch.and_then(|d| resolve_base_ref(path, d));
    let mut mains: Vec<String> = Vec::new();
    if let Some(d) = default_branch {
        mains.push(d.to_string());
    }
    for name in &candidates {
        if mains.contains(name) {
            continue;
        }
        if is_main_branch_name(name) {
            mains.push(name.clone());
            continue;
        }
        // Merge-heavy heuristic: at least 3 merge commits unique to this branch.
        if let (Some(default_ref), Some(branch_ref)) = (&default_ref, resolve_base_ref(path, name))
        {
            let merges = rev_list_count(
                path,
                &["--min-parents=2", &branch_ref, &format!("^{default_ref}")],
            )
            .unwrap_or(0);
            if merges >= 3 {
                mains.push(name.clone());
            }
        }
    }
    mains.retain(|name| resolve_ref(path, name).is_some());
    mains
}

/// For each local branch, find the main branch it will most likely be merged
/// into: the main branch relative to which the branch has the fewest unique
/// commits. Ties go to the earliest main branch (default branch first).
pub fn analyze_branches(
    path: &str,
    branches: &[BranchInfo],
    mains: &[String],
    user_email: Option<&str>,
    overrides: &HashMap<String, bool>,
) -> Vec<AnalyzedBranch> {
    let main_refs: Vec<(String, String)> = mains
        .iter()
        .filter_map(|m| resolve_base_ref(path, m).map(|r| (m.clone(), r)))
        .collect();
    let mut result = Vec::new();
    for b in branches.iter().filter(|b| !b.is_remote) {
        let is_main = mains.contains(&b.name);
        let mut target: Option<String> = None;
        let mut ahead: Option<i32> = None;
        let mut behind: Option<i32> = None;
        if !is_main {
            let mut best: Option<(i32, &str, &str)> = None;
            for (name, mref) in &main_refs {
                let unique = rev_list_count(path, &[&b.name, &format!("^{mref}")]);
                if let Some(count) = unique {
                    if best.is_none_or(|(c, _, _)| count < c) {
                        best = Some((count, name, mref));
                    }
                }
            }
            if let Some((count, name, mref)) = best {
                target = Some(name.to_string());
                ahead = Some(count);
                behind = rev_list_count(path, &[mref, &format!("^{}", b.name)]);
            }
        }
        let auto_mine = match (user_email, &b.author_email) {
            (Some(u), Some(a)) => u.eq_ignore_ascii_case(a),
            _ => false,
        };
        let mine_override = overrides.get(&b.name).copied();
        result.push(AnalyzedBranch {
            name: b.name.clone(),
            is_main,
            target,
            ahead_of_target: ahead,
            behind_target: behind,
            is_mine: mine_override.unwrap_or(auto_mine),
            mine_override,
        });
    }
    result
}

pub fn repo_analysis(
    path: &str,
    overrides: &HashMap<String, bool>,
) -> Result<RepoAnalysis, String> {
    let branches = list_branches(path)?;
    let user_email = run_git(path, &["config", "user.email"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let default_branch = detect_default_branch(path);
    let main_branches = detect_main_branches(path, default_branch.as_deref(), &branches);
    let analyzed = analyze_branches(
        path,
        &branches,
        &main_branches,
        user_email.as_deref(),
        overrides,
    );
    Ok(RepoAnalysis {
        default_branch,
        main_branches,
        user_email,
        branches: analyzed,
    })
}

pub fn fetch(path: &str) -> Result<(), String> {
    run_git(path, &["fetch", "--all", "--prune"]).map(|_| ())
}

/// Switch `worktree` to `branch`. Uses `git switch`, so a remote-only branch
/// name automatically gets a local tracking branch, and git itself refuses
/// when the branch is checked out in another worktree or changes would be
/// overwritten.
pub fn switch_branch(worktree: &str, branch: &str) -> Result<(), String> {
    run_git(worktree, &["switch", branch]).map(|_| ())
}

fn branch_upstream(repo: &str, branch: &str) -> Option<String> {
    run_git(
        repo,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            &format!("{branch}@{{upstream}}"),
        ],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
}

/// Update `branch` to the latest state of its upstream, fast-forward only.
/// If the branch is checked out somewhere, a `git pull --ff-only` runs in
/// that worktree; otherwise the local ref is fast-forwarded via a fetch
/// refspec (which git refuses for non-fast-forward updates).
pub fn pull_branch(repo: &str, branch: &str) -> Result<(), String> {
    let upstream = branch_upstream(repo, branch)
        .ok_or_else(|| format!("Branch '{branch}' has no upstream to pull from."))?;
    for wt in list_worktrees(repo)? {
        if wt.branch.as_deref() == Some(branch) {
            return run_git(&wt.path, &["pull", "--ff-only"]).map(|_| ());
        }
    }
    let (remote, remote_branch) = upstream
        .split_once('/')
        .ok_or_else(|| format!("Unexpected upstream '{upstream}'"))?;
    run_git(
        repo,
        &["fetch", remote, &format!("{remote_branch}:{branch}")],
    )
    .map(|_| ())
}

/// Push `branch` to its upstream (publishing with `-u origin` when it has
/// none). `force` uses --force-with-lease so a rebased branch can be pushed
/// without clobbering commits someone else pushed in the meantime.
pub fn push_branch(repo: &str, branch: &str, force: bool) -> Result<(), String> {
    let upstream = branch_upstream(repo, branch);
    let mut args: Vec<String> = vec!["push".to_string()];
    if force {
        args.push("--force-with-lease".to_string());
    }
    match upstream {
        Some(upstream) => {
            let (remote, remote_branch) = upstream
                .split_once('/')
                .ok_or_else(|| format!("Unexpected upstream '{upstream}'"))?;
            args.push(remote.to_string());
            args.push(format!("{branch}:{remote_branch}"));
        }
        None => {
            args.push("-u".to_string());
            args.push("origin".to_string());
            args.push(branch.to_string());
        }
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git(repo, &arg_refs).map(|_| ())
}

pub fn add_worktree(
    repo: &str,
    worktree_path: &str,
    branch: &str,
    create_branch: bool,
    base: Option<&str>,
) -> Result<(), String> {
    if create_branch {
        let base = base.unwrap_or("HEAD");
        run_git(
            repo,
            &["worktree", "add", "-b", branch, worktree_path, base],
        )
        .map(|_| ())
    } else {
        run_git(repo, &["worktree", "add", worktree_path, branch]).map(|_| ())
    }
}

pub fn remove_worktree(repo: &str, worktree_path: &str, force: bool) -> Result<(), String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    run_git(repo, &args).map(|_| ())
}

fn worktree_is_clean(wt: &str) -> Result<bool, String> {
    Ok(run_git(wt, &["status", "--porcelain"])?.trim().is_empty())
}

/// Find or create a worktree with `branch` checked out. Returns (path, is_temp).
fn acquire_worktree(repo: &str, branch: &str) -> Result<(String, bool), String> {
    for wt in list_worktrees(repo)? {
        if wt.branch.as_deref() == Some(branch) {
            if !worktree_is_clean(&wt.path)? {
                return Err(format!(
                    "Branch '{branch}' is checked out at {} which has uncommitted changes. Commit or stash them first.",
                    wt.path
                ));
            }
            return Ok((wt.path, false));
        }
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let safe_branch: String = branch
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let dir: PathBuf = std::env::temp_dir().join(format!("brist-{safe_branch}-{nanos}"));
    let dir_str = dir.to_string_lossy().to_string();
    run_git(repo, &["worktree", "add", &dir_str, branch])?;
    Ok((dir_str, true))
}

fn release_worktree(repo: &str, worktree: &str, is_temp: bool) {
    if is_temp {
        let _ = run_git(repo, &["worktree", "remove", "--force", worktree]);
    }
}

fn rebase_in_progress(wt: &str) -> bool {
    let merge_dir = run_git(wt, &["rev-parse", "--git-path", "rebase-merge"]);
    let apply_dir = run_git(wt, &["rev-parse", "--git-path", "rebase-apply"]);
    let exists = |p: Result<String, String>| {
        p.map(|s| {
            let p = s.trim().to_string();
            let path = Path::new(&p);
            if path.is_absolute() {
                path.exists()
            } else {
                Path::new(wt).join(path).exists()
            }
        })
        .unwrap_or(false)
    };
    exists(merge_dir) || exists(apply_dir)
}

fn conflict_files(wt: &str) -> Vec<ConflictFile> {
    run_git(wt, &["diff", "--name-only", "--diff-filter=U"])
        .map(|out| {
            out.lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| ConflictFile {
                    path: l.to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn start_rebase(
    state: &RebaseState,
    repo: &str,
    branch: &str,
    onto: &str,
) -> Result<OpOutcome, String> {
    {
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        if sessions.contains_key(repo) {
            return Err("A rebase is already in progress for this repository.".to_string());
        }
    }
    let onto_ref =
        resolve_base_ref(repo, onto).ok_or_else(|| format!("Cannot resolve ref '{onto}'"))?;
    let (wt, is_temp) = acquire_worktree(repo, branch)?;
    // core.editor/sequence.editor are passed per-invocation so the user's git
    // config is never touched; commit messages are edited in the app instead.
    let result = run_git(
        &wt,
        &[
            "-c",
            "core.editor=true",
            "-c",
            "sequence.editor=true",
            "rebase",
            &onto_ref,
        ],
    );
    match result {
        Ok(_) => {
            release_worktree(repo, &wt, is_temp);
            Ok(OpOutcome::Completed)
        }
        Err(err) => {
            if rebase_in_progress(&wt) {
                let files = conflict_files(&wt);
                let session = RebaseSession {
                    repo: repo.to_string(),
                    branch: branch.to_string(),
                    onto: onto.to_string(),
                    worktree: wt,
                    is_temp,
                };
                state
                    .0
                    .lock()
                    .map_err(|e| e.to_string())?
                    .insert(repo.to_string(), session);
                Ok(OpOutcome::Conflicts {
                    branch: branch.to_string(),
                    onto: onto.to_string(),
                    files,
                })
            } else {
                release_worktree(repo, &wt, is_temp);
                Err(err)
            }
        }
    }
}

fn take_session(state: &RebaseState, repo: &str) -> Result<RebaseSession, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(repo)
        .cloned()
        .ok_or_else(|| "No rebase in progress for this repository.".to_string())
}

fn finish_session(state: &RebaseState, repo: &str) {
    if let Ok(mut sessions) = state.0.lock() {
        if let Some(session) = sessions.remove(repo) {
            release_worktree(&session.repo, &session.worktree, session.is_temp);
        }
    }
}

pub fn continue_rebase(state: &RebaseState, repo: &str) -> Result<OpOutcome, String> {
    let session = take_session(state, repo)?;
    let result = run_git(
        &session.worktree,
        &["-c", "core.editor=true", "rebase", "--continue"],
    );
    match result {
        Ok(_) => {
            finish_session(state, repo);
            Ok(OpOutcome::Completed)
        }
        Err(err) => {
            if rebase_in_progress(&session.worktree) {
                Ok(OpOutcome::Conflicts {
                    branch: session.branch,
                    onto: session.onto,
                    files: conflict_files(&session.worktree),
                })
            } else {
                finish_session(state, repo);
                Err(err)
            }
        }
    }
}

pub fn abort_rebase(state: &RebaseState, repo: &str) -> Result<(), String> {
    let session = take_session(state, repo)?;
    let result = run_git(&session.worktree, &["rebase", "--abort"]);
    finish_session(state, repo);
    result.map(|_| ())
}

pub fn current_session(state: &RebaseState, repo: &str) -> Option<RebaseSession> {
    state.0.lock().ok()?.get(repo).cloned()
}

pub fn session_conflicts(state: &RebaseState, repo: &str) -> Result<Vec<ConflictFile>, String> {
    let session = take_session(state, repo)?;
    Ok(conflict_files(&session.worktree))
}

pub fn read_conflict(state: &RebaseState, repo: &str, file: &str) -> Result<String, String> {
    let session = take_session(state, repo)?;
    let full = Path::new(&session.worktree).join(file);
    fs::read_to_string(full).map_err(|e| e.to_string())
}

pub fn save_conflict(
    state: &RebaseState,
    repo: &str,
    file: &str,
    content: &str,
) -> Result<(), String> {
    let session = take_session(state, repo)?;
    let full = Path::new(&session.worktree).join(file);
    fs::write(full, content).map_err(|e| e.to_string())?;
    run_git(&session.worktree, &["add", "--", file]).map(|_| ())
}

pub fn squash_preview(repo: &str, branch: &str, base: &str) -> Result<SquashPreview, String> {
    let base_ref =
        resolve_base_ref(repo, base).ok_or_else(|| format!("Cannot resolve ref '{base}'"))?;
    let merge_base = run_git(repo, &["merge-base", &base_ref, branch])?
        .trim()
        .to_string();
    let log = run_git(
        repo,
        &[
            "log",
            "--reverse",
            "--format=%H%x1f%s%x1f%b%x1e",
            &format!("{merge_base}..{branch}"),
        ],
    )?;
    let mut commits = Vec::new();
    for record in log.split('\x1e') {
        let record = record.trim_matches(['\n', ' ']);
        if record.is_empty() {
            continue;
        }
        let parts: Vec<&str> = record.splitn(3, '\x1f').collect();
        if parts.len() < 2 {
            continue;
        }
        commits.push(CommitSummary {
            hash: parts[0].to_string(),
            subject: parts[1].to_string(),
            body: parts
                .get(2)
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
        });
    }
    let combined_message = commits
        .iter()
        .map(|c| {
            if c.body.is_empty() {
                c.subject.clone()
            } else {
                format!("{}\n\n{}", c.subject, c.body)
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(SquashPreview {
        base_commit: merge_base,
        commits,
        combined_message,
    })
}

pub fn squash_branch(repo: &str, branch: &str, base: &str, message: &str) -> Result<(), String> {
    let base_ref =
        resolve_base_ref(repo, base).ok_or_else(|| format!("Cannot resolve ref '{base}'"))?;
    let (wt, is_temp) = acquire_worktree(repo, branch)?;
    let original_tip = run_git(&wt, &["rev-parse", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let do_squash = || -> Result<(), String> {
        let merge_base = run_git(&wt, &["merge-base", &base_ref, "HEAD"])?
            .trim()
            .to_string();
        run_git(&wt, &["reset", "--soft", &merge_base])?;
        run_git(&wt, &["commit", "-m", message]).map(|_| ())
    };
    let result = do_squash();
    if result.is_err() && !original_tip.is_empty() {
        let _ = run_git(&wt, &["reset", "--hard", &original_tip]);
    }
    release_worktree(repo, &wt, is_temp);
    result
}

pub fn graph(
    repo: &str,
    refs: Option<Vec<String>>,
    limit: Option<u32>,
) -> Result<Vec<GraphCommit>, String> {
    let limit = limit.unwrap_or(400);
    let limit_arg = format!("-n{limit}");
    let mut args: Vec<String> = vec![
        "log".to_string(),
        "--topo-order".to_string(),
        limit_arg,
        "--format=%H\x1f%P\x1f%an\x1f%ae\x1f%at\x1f%D\x1f%s".to_string(),
    ];
    match refs {
        Some(refs) if !refs.is_empty() => {
            for r in refs {
                args.push(r);
            }
        }
        _ => {
            args.push("--branches".to_string());
            args.push("--remotes".to_string());
        }
    }
    args.push("--".to_string());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let stdout = run_git(repo, &arg_refs)?;
    let mut commits = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() < 7 {
            continue;
        }
        commits.push(GraphCommit {
            hash: parts[0].to_string(),
            parents: parts[1].split_whitespace().map(String::from).collect(),
            author: parts[2].to_string(),
            email: parts[3].to_string(),
            date: parts[4].trim().parse().unwrap_or(0),
            refs: parse_decorations(parts[5]),
            subject: parts[6].to_string(),
        });
    }
    Ok(commits)
}

pub fn parse_decorations(decorations: &str) -> Vec<String> {
    decorations
        .split(", ")
        .flat_map(|d| {
            let d = d.trim();
            if d.is_empty() {
                return Vec::new();
            }
            if let Some((head, branch)) = d.split_once(" -> ") {
                vec![head.trim().to_string(), branch.trim().to_string()]
            } else {
                vec![d.to_string()]
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_track_handles_gone_ahead_behind() {
        assert_eq!(parse_track("[gone]"), (None, None, true));
        assert_eq!(parse_track("[ahead 3]"), (Some(3), None, false));
        assert_eq!(parse_track("[behind 2]"), (None, Some(2), false));
        assert_eq!(
            parse_track("[ahead 3, behind 2]"),
            (Some(3), Some(2), false)
        );
        assert_eq!(parse_track(""), (None, None, false));
    }

    #[test]
    fn parse_remote_url_handles_common_formats() {
        assert_eq!(
            parse_remote_url("git@github.com:owner/repo.git"),
            Some(("github.com".into(), "owner".into(), "repo".into()))
        );
        assert_eq!(
            parse_remote_url("https://github.com/owner/repo"),
            Some(("github.com".into(), "owner".into(), "repo".into()))
        );
        assert_eq!(
            parse_remote_url("ssh://git@ghe.company.com/owner/repo.git"),
            Some(("ghe.company.com".into(), "owner".into(), "repo".into()))
        );
        assert_eq!(parse_remote_url("not a url"), None);
    }

    #[test]
    fn netrc_token_finds_host_password() {
        let content = "machine github.com\n  login user\n  password ghp_abc123\nmachine other.com login u password p\n";
        assert_eq!(
            netrc_token_from(content, "github.com"),
            Some("ghp_abc123".to_string())
        );
        assert_eq!(
            netrc_token_from(content, "other.com"),
            Some("p".to_string())
        );
        assert_eq!(netrc_token_from(content, "missing.com"), None);
    }

    #[test]
    fn netrc_token_falls_back_to_default() {
        let content = "machine github.com password tok\ndefault password fallback\n";
        assert_eq!(
            netrc_token_from(content, "unknown.com"),
            Some("fallback".to_string())
        );
    }

    #[test]
    fn main_branch_names_are_recognized() {
        for name in [
            "main",
            "master",
            "trunk",
            "develop",
            "release/1.2",
            "release-2024",
        ] {
            assert!(is_main_branch_name(name), "{name} should be main");
        }
        for name in ["feature/x", "bugfix-1", "released"] {
            assert!(!is_main_branch_name(name), "{name} should not be main");
        }
    }

    #[test]
    fn parse_decorations_splits_head_arrow() {
        assert_eq!(
            parse_decorations("HEAD -> main, origin/main, tag: v1.0"),
            vec!["HEAD", "main", "origin/main", "tag: v1.0"]
        );
        assert_eq!(parse_decorations(""), Vec::<String>::new());
    }

    fn git(dir: &str, args: &[&str]) {
        run_git(dir, args).unwrap_or_else(|e| panic!("git {args:?} failed: {e}"));
    }

    fn init_repo() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        git(&path, &["init", "-b", "main"]);
        git(&path, &["config", "user.email", "me@example.com"]);
        git(&path, &["config", "user.name", "Me"]);
        git(&path, &["config", "commit.gpgsign", "false"]);
        (dir, path)
    }

    fn commit_file(dir: &str, name: &str, content: &str, message: &str) {
        fs::write(Path::new(dir).join(name), content).unwrap();
        git(dir, &["add", "--", name]);
        git(dir, &["commit", "-m", message]);
    }

    #[test]
    fn repo_analysis_detects_default_branch_and_merge_targets() {
        let (_tmp, repo) = init_repo();
        commit_file(&repo, "a.txt", "1", "init");
        git(&repo, &["checkout", "-b", "feature/x"]);
        commit_file(&repo, "b.txt", "2", "feat");
        git(&repo, &["checkout", "main"]);

        let analysis = repo_analysis(&repo, &HashMap::new()).unwrap();
        assert_eq!(analysis.default_branch.as_deref(), Some("main"));
        assert_eq!(analysis.main_branches, vec!["main"]);
        assert_eq!(analysis.user_email.as_deref(), Some("me@example.com"));

        let feature = analysis
            .branches
            .iter()
            .find(|b| b.name == "feature/x")
            .unwrap();
        assert!(!feature.is_main);
        assert_eq!(feature.target.as_deref(), Some("main"));
        assert_eq!(feature.ahead_of_target, Some(1));
        assert_eq!(feature.behind_target, Some(0));
        assert!(feature.is_mine);

        let main = analysis.branches.iter().find(|b| b.name == "main").unwrap();
        assert!(main.is_main);
        assert_eq!(main.target, None);
    }

    #[test]
    fn mine_override_wins_over_author_email() {
        let (_tmp, repo) = init_repo();
        commit_file(&repo, "a.txt", "1", "init");
        let overrides = HashMap::from([("main".to_string(), false)]);
        let analysis = repo_analysis(&repo, &overrides).unwrap();
        let main = analysis.branches.iter().find(|b| b.name == "main").unwrap();
        assert!(!main.is_mine);
        assert_eq!(main.mine_override, Some(false));
    }

    #[test]
    fn squash_collapses_branch_into_one_commit_with_message() {
        let (_tmp, repo) = init_repo();
        commit_file(&repo, "a.txt", "1", "init");
        git(&repo, &["checkout", "-b", "feature"]);
        commit_file(&repo, "b.txt", "2", "feat 1");
        commit_file(&repo, "c.txt", "3", "feat 2");
        git(&repo, &["checkout", "main"]);

        let preview = squash_preview(&repo, "feature", "main").unwrap();
        assert_eq!(preview.commits.len(), 2);
        assert_eq!(preview.combined_message, "feat 1\n\nfeat 2");

        // feature is not checked out anywhere -> exercises the temp worktree path
        squash_branch(&repo, "feature", "main", "feat: squashed\n\ndetails").unwrap();
        assert_eq!(rev_list_count(&repo, &["main..feature"]), Some(1));
        let subject = run_git(&repo, &["log", "-1", "--format=%s", "feature"]).unwrap();
        assert_eq!(subject.trim(), "feat: squashed");
        // temp worktree was cleaned up again
        assert_eq!(list_worktrees(&repo).unwrap().len(), 1);
    }

    #[test]
    fn rebase_without_conflicts_completes() {
        let (_tmp, repo) = init_repo();
        commit_file(&repo, "a.txt", "1", "init");
        git(&repo, &["checkout", "-b", "feature"]);
        commit_file(&repo, "b.txt", "2", "feat");
        git(&repo, &["checkout", "main"]);
        commit_file(&repo, "c.txt", "3", "main moves on");

        let state = RebaseState::default();
        let outcome = start_rebase(&state, &repo, "feature", "main").unwrap();
        assert!(matches!(outcome, OpOutcome::Completed));
        // feature now contains main's tip
        let main_tip = run_git(&repo, &["rev-parse", "main"]).unwrap();
        let merge_base = run_git(&repo, &["merge-base", "main", "feature"]).unwrap();
        assert_eq!(main_tip.trim(), merge_base.trim());
        assert!(current_session(&state, &repo).is_none());
    }

    #[test]
    fn rebase_conflict_can_be_resolved_and_continued() {
        let (_tmp, repo) = init_repo();
        commit_file(&repo, "file.txt", "base\n", "init");
        git(&repo, &["checkout", "-b", "feature"]);
        commit_file(&repo, "file.txt", "feature\n", "feature change");
        git(&repo, &["checkout", "main"]);
        commit_file(&repo, "file.txt", "main\n", "main change");

        let state = RebaseState::default();
        let outcome = start_rebase(&state, &repo, "feature", "main").unwrap();
        match outcome {
            OpOutcome::Conflicts { files, .. } => {
                assert_eq!(files.len(), 1);
                assert_eq!(files[0].path, "file.txt");
            }
            OpOutcome::Completed => panic!("expected conflicts"),
        }
        let content = read_conflict(&state, &repo, "file.txt").unwrap();
        assert!(content.contains("<<<<<<<"));

        save_conflict(&state, &repo, "file.txt", "resolved\n").unwrap();
        let outcome = continue_rebase(&state, &repo).unwrap();
        assert!(matches!(outcome, OpOutcome::Completed));
        assert!(current_session(&state, &repo).is_none());

        let main_tip = run_git(&repo, &["rev-parse", "main"]).unwrap();
        let merge_base = run_git(&repo, &["merge-base", "main", "feature"]).unwrap();
        assert_eq!(main_tip.trim(), merge_base.trim());
        let blob = run_git(&repo, &["show", "feature:file.txt"]).unwrap();
        assert_eq!(blob, "resolved\n");
        assert_eq!(list_worktrees(&repo).unwrap().len(), 1);
    }

    #[test]
    fn rebase_conflict_can_be_aborted() {
        let (_tmp, repo) = init_repo();
        commit_file(&repo, "file.txt", "base\n", "init");
        git(&repo, &["checkout", "-b", "feature"]);
        commit_file(&repo, "file.txt", "feature\n", "feature change");
        git(&repo, &["checkout", "main"]);
        commit_file(&repo, "file.txt", "main\n", "main change");

        let state = RebaseState::default();
        let tip_before = run_git(&repo, &["rev-parse", "feature"]).unwrap();
        let outcome = start_rebase(&state, &repo, "feature", "main").unwrap();
        assert!(matches!(outcome, OpOutcome::Conflicts { .. }));
        abort_rebase(&state, &repo).unwrap();
        assert!(current_session(&state, &repo).is_none());
        let tip_after = run_git(&repo, &["rev-parse", "feature"]).unwrap();
        assert_eq!(tip_before, tip_after);
        assert_eq!(list_worktrees(&repo).unwrap().len(), 1);
    }

    #[test]
    fn switch_branch_changes_worktree_head() {
        let (_tmp, repo) = init_repo();
        commit_file(&repo, "a.txt", "1", "init");
        git(&repo, &["branch", "feature"]);

        switch_branch(&repo, "feature").unwrap();
        let head = run_git(&repo, &["symbolic-ref", "--short", "HEAD"]).unwrap();
        assert_eq!(head.trim(), "feature");

        // switching to a branch checked out in another worktree must fail
        let wt_dir = tempfile::tempdir().unwrap();
        let wt_path = wt_dir.path().join("wt").to_str().unwrap().to_string();
        add_worktree(&repo, &wt_path, "main", false, None).unwrap();
        assert!(switch_branch(&repo, "main").is_err());
        // ...but the worktree itself can switch back and forth
        switch_branch(&repo, "feature").unwrap();
    }

    #[test]
    fn switch_branch_creates_tracking_branch_for_remote_only_branch() {
        let (_tmp, origin) = init_repo();
        commit_file(&origin, "a.txt", "1", "init");
        git(&origin, &["branch", "feature"]);

        let clone_dir = tempfile::tempdir().unwrap();
        let clone = clone_dir.path().join("clone").to_str().unwrap().to_string();
        git(&origin, &["clone", &origin, &clone]);
        git(&clone, &["config", "user.email", "me@example.com"]);
        git(&clone, &["config", "user.name", "Me"]);

        // only origin/feature exists locally
        assert!(!ref_exists(&clone, "refs/heads/feature"));
        switch_branch(&clone, "feature").unwrap();
        assert!(ref_exists(&clone, "refs/heads/feature"));
        let head = run_git(&clone, &["symbolic-ref", "--short", "HEAD"]).unwrap();
        assert_eq!(head.trim(), "feature");
    }

    #[test]
    fn rebase_and_analysis_use_origin_base_when_local_base_is_stale() {
        let bare_dir = tempfile::tempdir().unwrap();
        let bare = bare_dir.path().to_str().unwrap().to_string();
        git(&bare, &["init", "--bare", "-b", "main"]);

        let work_parent = tempfile::tempdir().unwrap();
        let work = work_parent
            .path()
            .join("work")
            .to_str()
            .unwrap()
            .to_string();
        git(
            work_parent.path().to_str().unwrap(),
            &["clone", &bare, &work],
        );
        git(&work, &["config", "user.email", "me@example.com"]);
        git(&work, &["config", "user.name", "Me"]);
        git(&work, &["config", "commit.gpgsign", "false"]);
        git(&work, &["switch", "-C", "main"]);

        commit_file(&work, "base.txt", "base", "init");
        git(&work, &["push", "-u", "origin", "main"]);
        git(&work, &["switch", "-c", "feature"]);
        commit_file(&work, "feat.txt", "feat", "feature work");
        git(&work, &["switch", "main"]);
        commit_file(&work, "advance.txt", "new", "main advance");
        git(&work, &["push"]);
        // local main becomes stale: origin/main is one commit ahead of it
        git(&work, &["reset", "--hard", "HEAD~1"]);

        // behind_target is measured against origin/main, not the stale local main
        let analysis = repo_analysis(&work, &HashMap::new()).unwrap();
        let feature = analysis
            .branches
            .iter()
            .find(|b| b.name == "feature")
            .unwrap();
        assert_eq!(feature.target.as_deref(), Some("main"));
        assert_eq!(feature.behind_target, Some(1));

        // rebasing onto "main" rebases onto origin/main's head
        let state = RebaseState::default();
        let outcome = start_rebase(&state, &work, "feature", "main").unwrap();
        assert!(matches!(outcome, OpOutcome::Completed));
        let origin_tip = run_git(&work, &["rev-parse", "origin/main"]).unwrap();
        let merge_base = run_git(&work, &["merge-base", "origin/main", "feature"]).unwrap();
        assert_eq!(origin_tip.trim(), merge_base.trim());
    }

    #[test]
    fn local_base_wins_when_it_is_ahead_of_origin() {
        let bare_dir = tempfile::tempdir().unwrap();
        let bare = bare_dir.path().to_str().unwrap().to_string();
        git(&bare, &["init", "--bare", "-b", "main"]);

        let work_parent = tempfile::tempdir().unwrap();
        let work = work_parent
            .path()
            .join("work")
            .to_str()
            .unwrap()
            .to_string();
        git(
            work_parent.path().to_str().unwrap(),
            &["clone", &bare, &work],
        );
        git(&work, &["config", "user.email", "me@example.com"]);
        git(&work, &["config", "user.name", "Me"]);
        git(&work, &["config", "commit.gpgsign", "false"]);
        git(&work, &["switch", "-C", "main"]);

        commit_file(&work, "base.txt", "base", "init");
        git(&work, &["push", "-u", "origin", "main"]);
        // local main moves ahead of origin/main
        commit_file(&work, "local.txt", "l", "local only");

        assert_eq!(resolve_base_ref(&work, "main").as_deref(), Some("main"));
    }

    #[test]
    fn pull_branch_fast_forwards_checked_out_and_other_branches() {
        let bare_dir = tempfile::tempdir().unwrap();
        let bare = bare_dir.path().to_str().unwrap().to_string();
        git(&bare, &["init", "--bare", "-b", "main"]);

        let parent = tempfile::tempdir().unwrap();
        let parent_path = parent.path().to_str().unwrap();
        let work1 = parent.path().join("work1").to_str().unwrap().to_string();
        let work2 = parent.path().join("work2").to_str().unwrap().to_string();
        git(parent_path, &["clone", &bare, &work1]);
        for repo in [&work1] {
            git(repo, &["config", "user.email", "me@example.com"]);
            git(repo, &["config", "user.name", "Me"]);
            git(repo, &["config", "commit.gpgsign", "false"]);
        }
        git(&work1, &["switch", "-C", "main"]);
        commit_file(&work1, "a.txt", "1", "init");
        git(&work1, &["push", "-u", "origin", "main"]);

        git(parent_path, &["clone", &bare, &work2]);
        // a second local branch tracking origin/main, not checked out
        git(&work2, &["branch", "--track", "mirror", "origin/main"]);

        // remote moves ahead
        commit_file(&work1, "b.txt", "2", "second");
        git(&work1, &["push"]);

        // checked-out branch: pull --ff-only in its worktree
        pull_branch(&work2, "main").unwrap();
        let main_tip = run_git(&work2, &["rev-parse", "main"]).unwrap();
        let origin_tip = run_git(&work2, &["rev-parse", "origin/main"]).unwrap();
        assert_eq!(main_tip, origin_tip);

        // not checked out: fast-forwarded via fetch refspec
        pull_branch(&work2, "mirror").unwrap();
        let mirror_tip = run_git(&work2, &["rev-parse", "mirror"]).unwrap();
        assert_eq!(mirror_tip, origin_tip);

        // a branch without upstream is rejected
        git(&work2, &["branch", "standalone"]);
        assert!(pull_branch(&work2, "standalone").is_err());
    }

    #[test]
    fn push_branch_publishes_and_force_pushes_after_rewrite() {
        let bare_dir = tempfile::tempdir().unwrap();
        let bare = bare_dir.path().to_str().unwrap().to_string();
        git(&bare, &["init", "--bare", "-b", "main"]);

        let work_parent = tempfile::tempdir().unwrap();
        let work = work_parent
            .path()
            .join("work")
            .to_str()
            .unwrap()
            .to_string();
        git(
            work_parent.path().to_str().unwrap(),
            &["clone", &bare, &work],
        );
        git(&work, &["config", "user.email", "me@example.com"]);
        git(&work, &["config", "user.name", "Me"]);
        git(&work, &["config", "commit.gpgsign", "false"]);
        git(&work, &["switch", "-C", "main"]);
        commit_file(&work, "a.txt", "1", "init");

        // no upstream yet -> publishes with -u origin
        push_branch(&work, "main", false).unwrap();
        assert!(ref_exists(&bare, "refs/heads/main"));
        let upstream = run_git(&work, &["rev-parse", "--abbrev-ref", "main@{upstream}"]).unwrap();
        assert_eq!(upstream.trim(), "origin/main");

        // fast-forward push works without force
        commit_file(&work, "b.txt", "2", "second");
        push_branch(&work, "main", false).unwrap();

        // history rewrite (as after a rebase): plain push refused, force succeeds
        git(&work, &["commit", "--amend", "-m", "rewritten"]);
        assert!(push_branch(&work, "main", false).is_err());
        push_branch(&work, "main", true).unwrap();
        let subject = run_git(&bare, &["log", "-1", "--format=%s", "main"]).unwrap();
        assert_eq!(subject.trim(), "rewritten");
    }

    #[test]
    fn worktrees_can_be_added_and_removed() {
        let (_tmp, repo) = init_repo();
        commit_file(&repo, "a.txt", "1", "init");
        git(&repo, &["branch", "feature"]);

        let wt_dir = tempfile::tempdir().unwrap();
        let wt_path = wt_dir.path().join("wt").to_str().unwrap().to_string();
        add_worktree(&repo, &wt_path, "feature", false, None).unwrap();
        let worktrees = list_worktrees(&repo).unwrap();
        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[1].branch.as_deref(), Some("feature"));
        assert!(!worktrees[1].has_changes);

        // dirty worktree is flagged
        fs::write(Path::new(&wt_path).join("a.txt"), "dirty").unwrap();
        let worktrees = list_worktrees(&repo).unwrap();
        assert!(worktrees[1].has_changes);

        remove_worktree(&repo, &wt_path, true).unwrap();
        assert_eq!(list_worktrees(&repo).unwrap().len(), 1);
    }
}
