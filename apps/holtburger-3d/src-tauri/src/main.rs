use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppLifecycleState {
    phase: &'static str,
    active_mode: &'static str,
    summary: &'static str,
}

#[tauri::command]
fn phase_zero_lifecycle() -> AppLifecycleState {
    AppLifecycleState {
        phase: "phase-0",
        active_mode: "browser",
        summary: "Scaffolded Tauri host and frontend shell with contract worksheet anchors.",
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![phase_zero_lifecycle])
        .run(tauri::generate_context!())
        .expect("failed to run Holtburger 3D host");
}