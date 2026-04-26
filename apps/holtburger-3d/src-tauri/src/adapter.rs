use std::f32::consts::FRAC_PI_2;

use crate::contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, AssetPayloadKindDto, BusyStateDto,
    FrontendStateFeedDto, HostBoundaryOverviewDto, InteractionModeDto, LifecyclePhaseDto,
    LifecycleStateDto, ModeHintDto, RuntimeBatchDto, RuntimeEntitySnapshotDto,
    RuntimeNotificationEnvelopeDto, SessionStateDto, Vec3Dto,
};

#[derive(Default)]
pub struct HostBoundaryAdapter;

impl HostBoundaryAdapter {
    pub fn lifecycle_state(&self) -> LifecycleStateDto {
        LifecycleStateDto {
            phase: LifecyclePhaseDto::Ready,
            active_mode_hint: Some(ModeHintDto::Browser),
            session_state: SessionStateDto::Unavailable,
            summary: "Host boundary is online with typed lifecycle, runtime, and asset stubs."
                .to_string(),
        }
    }

    pub fn runtime_batch(&self) -> RuntimeBatchDto {
        RuntimeBatchDto {
            tick: 1,
            entities: vec![
                RuntimeEntitySnapshotDto {
                    entity_id: 0x0102_0304,
                    position: Vec3Dto {
                        x: 12.0,
                        y: -4.5,
                        z: 1.0,
                    },
                    heading_radians: 0.0,
                    appearance_id: "stub/world-anchor".to_string(),
                },
                RuntimeEntitySnapshotDto {
                    entity_id: 0x0102_0305,
                    position: Vec3Dto {
                        x: 18.0,
                        y: -1.0,
                        z: 0.0,
                    },
                    heading_radians: FRAC_PI_2,
                    appearance_id: "stub/browser-probe".to_string(),
                },
            ],
        }
    }

    pub fn view_model_feed(&self) -> FrontendStateFeedDto {
        FrontendStateFeedDto {
            selected_entity_id: Some(0x0102_0304),
            interaction_mode: InteractionModeDto::Inspect,
            busy_state: BusyStateDto::Idle,
        }
    }

    pub fn startup_notification(&self) -> RuntimeNotificationEnvelopeDto {
        RuntimeNotificationEnvelopeDto {
            channel: "runtime",
            topic: "lifecycle.state",
            lifecycle_state: Some(self.lifecycle_state()),
            runtime_batch: None,
            view_model_feed: None,
        }
    }

    pub fn asset_lookup(&self, request: AssetLookupRequestDto) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id.clone(),
            payload_kind: AssetPayloadKindDto::Json,
            payload: serde_json::json!({
                "assetId": request.asset_id,
                "priority": request.priority,
                "kind": "stub-asset-metadata",
                "notes": [
                    "App-local adapter response.",
                    "Shared crate seams are not widened until real runtime or content pressure proves they belong below the app boundary."
                ]
            }),
        }
    }

    pub fn boundary_overview(&self) -> HostBoundaryOverviewDto {
        HostBoundaryOverviewDto {
            runtime_channel: "runtime",
            runtime_lifecycle_topic: "lifecycle.state",
            runtime_batch_command: "get_runtime_batch",
            asset_lookup_command: "lookup_asset",
            notes: vec![
                "DTOs live in the app-local host crate, not shared crates.".to_string(),
                "Lifecycle state is emitted as a startup runtime notification and is also queryable by command."
                    .to_string(),
                "Asset lookup currently returns typed stub metadata so the command surface is exercised before real content plumbing lands."
                    .to_string(),
            ],
        }
    }
}