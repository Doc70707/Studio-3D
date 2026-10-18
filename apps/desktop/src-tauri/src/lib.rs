// The desktop shell. It stays deliberately small: the interface, viewport and
// geometry all run in the webview. The shell adds native file dialogs and
// safe file reads/writes, limited to project (.s3d) and export (.stl, .3mf) files,
// a crash-recovery copy of unsaved work in the app's own data folder, and handing
// a part to a slicer the user installed (run as its own program, never linked).
mod files;
mod slicers;

use std::collections::HashMap;
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
    files::check_extension(&path, &["stl", "3mf"])?;
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

#[tauri::command]
fn find_slicers() -> Vec<HashMap<&'static str, String>> {
    slicers::find(&slicers::program_folders())
        .into_iter()
        .map(|f| {
            HashMap::from([("id", f.id), ("name", f.name), ("path", f.path.to_string_lossy().into_owned())])
        })
        .collect()
}

/// Writes the part to the app's hand-off folder and opens it with `program`. Returns where the file went.
#[tauri::command]
fn open_in_slicer(
    app: tauri::AppHandle,
    program: PathBuf,
    name: String,
    ext: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    slicers::check_program(&program)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Couldn't find a folder for the file: {e}"))?
        .join("handoff");
    let file = slicers::write_handoff(&dir, &name, &ext, &bytes)?;
    let mut child = slicers::open(&program, &file)?;
    // The slicer carries on by itself; this only tidies up after it closes.
    std::thread::spawn(move || child.wait());
    Ok(file.to_string_lossy().into_owned())
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
            clear_recovery,
            find_slicers,
            open_in_slicer
        ])
        .run(tauri::generate_context!())
        .expect("error while running Studio 3D");
}
