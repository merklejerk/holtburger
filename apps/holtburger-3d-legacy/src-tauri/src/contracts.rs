use serde::{Deserialize, Serialize};

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
pub struct WeenieLookupCapabilityDto {
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWeenieSpawnSeedRequestDto {
    pub weenie_class_id: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeenieSpawnSeedSourceDidDto {
    pub combat_table_id: Option<u32>,
    pub clothing_base_id: Option<u32>,
    pub default_eyes_texture_id: Option<u32>,
    pub default_mouth_texture_id: Option<u32>,
    pub default_nose_texture_id: Option<u32>,
    pub eyes_palette_id: Option<u32>,
    pub eyes_texture_id: Option<u32>,
    pub hair_palette_id: Option<u32>,
    pub head_object_id: Option<u32>,
    pub icon_id: Option<u32>,
    pub motion_table_id: Option<u32>,
    pub mouth_texture_id: Option<u32>,
    pub nose_texture_id: Option<u32>,
    pub palette_base_id: Option<u32>,
    pub physics_effect_table_id: Option<u32>,
    pub setup_model_id: u32,
    pub skin_palette_id: Option<u32>,
    pub sound_table_id: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeenieSpawnSeedSourceIntDto {
    pub creature_type: Option<i32>,
    pub gender: Option<i32>,
    pub item_type: Option<i32>,
    pub material_type: Option<i32>,
    pub palette_template: Option<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeenieSpawnSeedDto {
    pub weenie_class_id: u32,
    pub class_name: String,
    pub label: String,
    pub long_description: Option<String>,
    pub weenie_type: i32,
    pub source_dids: WeenieSpawnSeedSourceDidDto,
    pub source_ints: WeenieSpawnSeedSourceIntDto,
    pub default_scale: Option<f64>,
    pub shade: Option<f64>,
    pub appearance: RuntimeAppearanceObjDescDto,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAppearanceSubPaletteDto {
    pub sub_id: u32,
    pub offset: u32,
    pub num_colors: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAppearanceTextureChangeDto {
    pub part_index: u8,
    pub old_texture: u32,
    pub new_texture: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAppearanceAnimPartChangeDto {
    pub part_index: u8,
    pub part_id: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAppearanceObjDescDto {
    pub palette_id: Option<u32>,
    pub sub_palettes: Vec<RuntimeAppearanceSubPaletteDto>,
    pub texture_changes: Vec<RuntimeAppearanceTextureChangeDto>,
    pub anim_part_changes: Vec<RuntimeAppearanceAnimPartChangeDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAppearanceRequestDto {
    pub setup_model_id: u32,
    pub obj_desc: Option<RuntimeAppearanceObjDescDto>,
}
