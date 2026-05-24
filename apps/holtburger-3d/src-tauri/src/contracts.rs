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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLookupBatchRequestDto {
    pub requests: Vec<AssetLookupRequestDto>,
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
