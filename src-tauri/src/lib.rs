use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize, Default)]
struct Config {
    folders: Vec<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".brist").join("config.json"))
}

fn read_config(app: &tauri::AppHandle) -> Config {
    let Ok(path) = config_path(app) else {
        return Config::default();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return Config::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn write_config(app: &tauri::AppHandle, config: &Config) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_folders, add_folder, remove_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
