mod adapter;
mod contracts;

use adapter::HostBoundaryAdapter;
use contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, FrontendStateFeedDto,
    HostBoundaryOverviewDto, LifecycleStateDto, RuntimeBatchDto,
};
use tauri::Emitter;

const RUNTIME_LIFECYCLE_EVENT: &str = "runtime:lifecycle-state";

#[tauri::command]
fn get_lifecycle_state() -> LifecycleStateDto {
    HostBoundaryAdapter.lifecycle_state()
}

#[tauri::command]
fn get_runtime_batch() -> RuntimeBatchDto {
    HostBoundaryAdapter.runtime_batch()
}

#[tauri::command]
fn get_view_model_feed() -> FrontendStateFeedDto {
    HostBoundaryAdapter.view_model_feed()
}

#[tauri::command]
fn lookup_asset(request: AssetLookupRequestDto) -> AssetLookupResponseDto {
    HostBoundaryAdapter.asset_lookup(request)
}

#[tauri::command]
fn get_host_boundary_overview() -> HostBoundaryOverviewDto {
    HostBoundaryAdapter.boundary_overview()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let notification = HostBoundaryAdapter.startup_notification();
            app.emit(RUNTIME_LIFECYCLE_EVENT, notification)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_lifecycle_state,
            get_runtime_batch,
            get_view_model_feed,
            lookup_asset,
            get_host_boundary_overview,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Holtburger 3D host");
}