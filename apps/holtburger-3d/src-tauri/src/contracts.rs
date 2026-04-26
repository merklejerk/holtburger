use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vec3Dto {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LifecyclePhaseDto {
    Booting,
    Ready,
    Disconnected,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModeHintDto {
    Browser,
    Client,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionStateDto {
    Unavailable,
    Disconnected,
    Connected,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStateDto {
    pub phase: LifecyclePhaseDto,
    pub active_mode_hint: Option<ModeHintDto>,
    pub session_state: SessionStateDto,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEntitySnapshotDto {
    pub entity_id: u64,
    pub label: String,
    pub position: Vec3Dto,
    pub heading_radians: f32,
    pub appearance_id: String,
    pub landblock_id: u32,
    pub cell_id: Option<u32>,
    pub location_label: String,
    pub is_local_player: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResidencyDto {
    pub focus_entity_id: Option<u64>,
    pub focus_landblock_id: u32,
    pub focus_cell_id: Option<u32>,
    pub focus_location_label: String,
    pub indoors: bool,
    pub tracked_body_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBatchDto {
    pub tick: u64,
    pub entities: Vec<RuntimeEntitySnapshotDto>,
    pub residency: RuntimeResidencyDto,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InteractionModeDto {
    None,
    Inspect,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BusyStateDto {
    Idle,
    Loading,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendStateFeedDto {
    pub selected_entity_id: Option<u64>,
    pub interaction_mode: InteractionModeDto,
    pub busy_state: BusyStateDto,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetPriorityDto {
    Bootstrap,
    Streaming,
    Prefetch,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLookupRequestDto {
    pub request_id: String,
    pub asset_id: String,
    pub priority: AssetPriorityDto,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetPayloadKindDto {
    Bytes,
    Json,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLookupResponseDto {
    pub request_id: String,
    pub asset_id: String,
    pub payload_kind: AssetPayloadKindDto,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeNotificationEnvelopeDto {
    pub channel: &'static str,
    pub topic: &'static str,
    pub lifecycle_state: Option<LifecycleStateDto>,
    pub runtime_batch: Option<RuntimeBatchDto>,
    pub view_model_feed: Option<FrontendStateFeedDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostBoundaryOverviewDto {
    pub runtime_channel: &'static str,
    pub runtime_notification_event: &'static str,
    pub runtime_lifecycle_topic: &'static str,
    pub runtime_batch_command: &'static str,
    pub asset_lookup_command: &'static str,
    pub notes: Vec<String>,
}