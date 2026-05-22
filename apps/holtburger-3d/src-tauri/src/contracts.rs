use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vec3Dto {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuaternionDto {
    pub w: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementTransformDto {
    pub origin: Vec3Dto,
    pub orientation: QuaternionDto,
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
pub struct DebugConfigDto {
    pub verbose: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraHintDto {
    pub source: String,
    pub position: Vec3Dto,
    pub forward: Vec3Dto,
    pub viewport_normalized_x: f32,
    pub viewport_normalized_y: f32,
    pub destination_label: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraHintAckDto {
    pub accepted: bool,
    pub sequence: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RayPickRequestDto {
    pub request_id: String,
    pub origin: Vec3Dto,
    pub direction: Vec3Dto,
    pub screen_x_normalized: f32,
    pub screen_y_normalized: f32,
    pub destination_label: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RayPickHitDto {
    pub entity_id: u64,
    pub label: String,
    pub location_label: String,
    pub distance: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RayPickResponseDto {
    pub request_id: String,
    pub resolved: bool,
    pub camera_hint_sequence: Option<u64>,
    pub hit: Option<RayPickHitDto>,
}
