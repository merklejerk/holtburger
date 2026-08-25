// CEF re-invokes this binary for its renderer, GPU and utility processes rather than shipping a
// separate helper executable. The macro routes those invocations to the helper entry point, which
// is why `main` must carry it even though the browser-process path is just `run()`.
#[tauri::cef_entry_point]
fn main() {
    holtburger_3d::run();
}
