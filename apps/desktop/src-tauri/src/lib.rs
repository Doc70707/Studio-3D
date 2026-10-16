// The desktop shell. It stays deliberately small: the interface, viewport and
// geometry all run in the webview. The shell adds native file dialogs and
// safe file reads/writes, limited to project (.s3d) and export (.stl) files,
// plus a crash-recovery copy of unsaved work in the app's own data folder.
mod files;

use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn read_project(path: PathBuf) -> Result<String, String> {
    files::check_extension(&path, &["s3d"])?;
    let bytes = files::read_limited(&path, files::MAX_PROJECT_BYTES)?;
    String::from_utf8(bytes).map_err(|_| "This file is damaged or isn't a Studio 3D project.".into())
}

#[tauri::command]
fn write_project(path: PathBuf, text: String) -> Result<(), String> {
    files::check_extension(&path, &["s3d"])?;
    files::write_atomic(&path, text.as_bytes())
}

#[tauri::command]
fn write_export(path: PathBuf, bytes: Vec<u8>) -> Result<(), String> {
    files::check_extension(&path, &["stl"])?;
    files::write_atomic(&path, &bytes)
}

fn recovery_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't find a folder to back up your work: {e}"))
}

#[tauri::command]
fn read_recovery(app: tauri::AppHandle) -> Result<Option<String>, String> {
    files::read_recovery(&recovery_dir(&app)?)
}

#[tauri::command]
fn write_recovery(app: tauri::AppHandle, text: String) -> Result<(), String> {
    files::write_recovery(&recovery_dir(&app)?, &text)
}

#[tauri::command]
fn clear_recovery(app: tauri::AppHandle) -> Result<(), String> {
    files::clear_recovery(&recovery_dir(&app)?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_project,
            write_project,
            write_export,
            read_recovery,
            write_recovery,
            clear_recovery
        ])
        .run(tauri::generate_context!())
        .expect("error while running Studio 3D");
}
