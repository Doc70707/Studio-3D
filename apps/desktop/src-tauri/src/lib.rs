// The desktop shell. It stays deliberately small: the interface, viewport and
// geometry all run in the webview. The shell adds native file dialogs and
// safe file reads/writes, limited to project (.s3d) and export (.stl) files.
mod files;

use std::path::PathBuf;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_project, write_project, write_export])
        .run(tauri::generate_context!())
        .expect("error while running Studio 3D");
}
