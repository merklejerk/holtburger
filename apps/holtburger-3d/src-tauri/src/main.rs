mod adapter;
mod contracts;

use adapter::{HostRuntimeService, RUNTIME_NOTIFICATION_EVENT};
use contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, CameraHintAckDto, CameraHintDto, DebugConfigDto,
    FrontendStateFeedDto, HostBoundaryOverviewDto, LifecycleStateDto, RayPickRequestDto,
    RayPickResponseDto, RuntimeBatchDto,
};
use tauri::Emitter;

const RUNTIME_UPDATE_INTERVAL_MS: u64 = 1_000;

#[tauri::command]
fn get_lifecycle_state(runtime: tauri::State<'_, HostRuntimeService>) -> LifecycleStateDto {
    runtime.lifecycle_state()
}

#[tauri::command]
fn get_runtime_batch(runtime: tauri::State<'_, HostRuntimeService>) -> RuntimeBatchDto {
    runtime.runtime_batch()
}

#[tauri::command]
fn get_view_model_feed(runtime: tauri::State<'_, HostRuntimeService>) -> FrontendStateFeedDto {
    runtime.view_model_feed()
}

#[tauri::command]
async fn lookup_asset(
    runtime: tauri::State<'_, HostRuntimeService>,
    request: AssetLookupRequestDto,
) -> Result<AssetLookupResponseDto, String> {
    let runtime = runtime.inner().clone();
    Ok(runtime.asset_lookup(request).await)
}

#[tauri::command]
fn get_host_boundary_overview(
    runtime: tauri::State<'_, HostRuntimeService>,
) -> HostBoundaryOverviewDto {
    runtime.boundary_overview()
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
fn resolve_ray_pick(
    runtime: tauri::State<'_, HostRuntimeService>,
    request: RayPickRequestDto,
) -> RayPickResponseDto {
    runtime.resolve_ray_pick(request)
}

fn main() {
    let verbose = verbose_logging_enabled();
    if verbose {
        eprintln!("[holtburger-3d][debug] verbose diagnostics enabled");
    }
    let runtime = HostRuntimeService::new(verbose);

    tauri::Builder::default()
        .manage(runtime.clone())
        .setup(move |app| {
            for notification in runtime.startup_notifications() {
                app.emit(RUNTIME_NOTIFICATION_EVENT, notification)?;
            }

            let app_handle = app.handle().clone();
            let runtime = runtime.clone();

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(
                    RUNTIME_UPDATE_INTERVAL_MS,
                ));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                interval.tick().await;

                loop {
                    interval.tick().await;

                    if let Err(error) = app_handle.emit(
                        RUNTIME_NOTIFICATION_EVENT,
                        runtime.advance_runtime_notification(),
                    ) {
                        eprintln!("failed to emit runtime notification: {error}");
                        break;
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_lifecycle_state,
            get_runtime_batch,
            get_view_model_feed,
            lookup_asset,
            get_host_boundary_overview,
            get_debug_config,
            submit_camera_hint,
            resolve_ray_pick,
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
