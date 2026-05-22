mod adapter;
mod contracts;

use std::fs;
use std::path::{Path, PathBuf};

use adapter::HostRuntimeService;
use contracts::{
    AssetLookupBatchRequestDto, AssetLookupRequestDto, AssetLookupResponseDto, CameraHintAckDto,
    CameraHintDto, DebugConfigDto,
};

#[tauri::command]
async fn lookup_asset(
    runtime: tauri::State<'_, HostRuntimeService>,
    request: AssetLookupRequestDto,
) -> Result<AssetLookupResponseDto, String> {
    let runtime = runtime.inner().clone();
    Ok(runtime.asset_lookup(request).await)
}

#[tauri::command]
async fn lookup_assets_binary(
    runtime: tauri::State<'_, HostRuntimeService>,
    batch: AssetLookupBatchRequestDto,
) -> Result<tauri::ipc::Response, String> {
    let runtime = runtime.inner().clone();
    runtime
        .asset_lookup_binary_batch(batch.requests)
        .await
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_debug_config(runtime: tauri::State<'_, HostRuntimeService>) -> DebugConfigDto {
    runtime.debug_config()
}

#[tauri::command]
fn submit_camera_hint(
    runtime: tauri::State<'_, HostRuntimeService>,
    hint: CameraHintDto,
) -> CameraHintAckDto {
    runtime.submit_camera_hint(hint)
}

#[tauri::command]
fn save_frontend_profile_summary(summary: serde_json::Value) -> Result<String, String> {
    let output_dir = profile_output_dir()?;
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("failed to create profile output dir: {error}"))?;

    let bytes = serde_json::to_vec_pretty(&summary)
        .map_err(|error| format!("failed to serialize frontend profile summary: {error}"))?;
    let path = output_dir.join("holtburger-3d-frontend-profile.json");
    fs::write(&path, bytes)
        .map_err(|error| format!("failed to write frontend profile summary: {error}"))?;

    Ok(path.display().to_string())
}

fn main() {
    let verbose = verbose_logging_enabled();
    if verbose {
        eprintln!("[holtburger-3d][debug] verbose diagnostics enabled");
    }
    let runtime = HostRuntimeService::new(verbose);

    tauri::Builder::default()
        .manage(runtime.clone())
        .setup(move |_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            lookup_asset,
            lookup_assets_binary,
            get_debug_config,
            submit_camera_hint,
            save_frontend_profile_summary,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Holtburger 3D host");
}

fn verbose_logging_enabled() -> bool {
    std::env::var("HOLTBURGER_3D_VERBOSE")
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
        || std::env::args().any(|arg| arg == "--verbose" || arg == "-v")
}

fn profile_output_dir() -> Result<PathBuf, String> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .ancestors()
        .nth(3)
        .ok_or_else(|| "failed to resolve repository root from manifest dir".to_string())?;
    Ok(repo_root.join("target").join("profiles"))
}
