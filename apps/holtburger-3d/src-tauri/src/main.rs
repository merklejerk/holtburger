mod adapter;
mod contracts;

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
