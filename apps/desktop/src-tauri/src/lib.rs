// The desktop shell. It stays deliberately small: the interface, viewport and
// geometry all run in the webview. File access and slicer hand-off arrive in
// later milestones as narrowly scoped commands.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Studio 3D");
}
