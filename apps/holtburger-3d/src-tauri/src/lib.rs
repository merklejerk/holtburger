mod commands {
    use serde::Serialize;

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct HostStatus {
        /// Stable label used by the frontend to identify the active host shell.
        pub app_name: &'static str,
        /// Human-readable lifecycle state for diagnostics.
        pub status: &'static str,
    }

    #[tauri::command]
    pub fn host_status() -> HostStatus {
        HostStatus {
            app_name: "holtburger-3d",
            status: "fresh-host-ready",
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::host_status])
        .run(tauri::generate_context!())
        .expect("failed to run Holtburger 3D host");
}
