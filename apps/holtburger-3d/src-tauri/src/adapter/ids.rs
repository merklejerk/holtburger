use holtburger_content::normalize_landblock_id;
use holtburger_core::ContentAssetRequest;
use holtburger_dat::file_type::DatFileType;

pub fn parse_gfx_obj_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "gfx-obj/", DatFileType::Model as u32)
}

pub fn parse_setup_model_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "setup-model/", DatFileType::SetupModel as u32)
}

pub fn parse_setup_appearance_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(
        asset_id,
        "setup-appearance/",
        DatFileType::SetupModel as u32,
    )
}

pub fn parse_material_recipe_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "material/", DatFileType::Surface as u32)
}

pub fn parse_render_texture_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(
        asset_id,
        "render-texture/",
        DatFileType::SurfaceTexture as u32,
    )
}

pub fn parse_render_surface_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "render-surface/", DatFileType::Texture as u32)
        .or_else(|| parse_prefixed_data_id(asset_id, "render-surface/", 0x07))
}

pub fn parse_palette_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "palette/", DatFileType::Palette as u32)
}

fn parse_prefixed_data_id(asset_id: &str, prefix: &str, expected_type: u32) -> Option<u32> {
    let raw_hex = asset_id.strip_prefix(prefix)?;
    let hex = raw_hex
        .strip_prefix("0x")
        .or_else(|| raw_hex.strip_prefix("0X"))
        .unwrap_or(raw_hex);

    (hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(hex, 16).ok())
        .flatten()
        .filter(|id| (id >> 24) == expected_type)
}

pub fn parse_landblock_child_asset_id(asset_id: &str, suffix: &str) -> Option<u32> {
    let rest = asset_id.strip_prefix("landblock/")?;
    let raw_hex = rest.strip_suffix(suffix)?;
    (raw_hex.len() == 8 && raw_hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(raw_hex, 16).ok())
        .flatten()
        .map(normalize_landblock_id)
}

pub fn parse_landblock_outdoor_asset_id(asset_id: &str) -> Option<u32> {
    parse_landblock_child_asset_id(asset_id, "/outdoor")
}

pub fn parse_landblock_topology_asset_id(asset_id: &str) -> Option<u32> {
    parse_landblock_child_asset_id(asset_id, "/topology")
}

pub fn parse_env_cell_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("env-cell/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .filter(|id| (*id & 0xffff) >= 0x0100 && (*id & 0xffff) <= 0xfffd)
}

pub fn parse_terrain_material_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("terrain-material/")
        .filter(|raw| !raw.is_empty() && raw.chars().all(|ch| ch.is_ascii_digit()))
        .and_then(|raw| raw.parse::<u32>().ok())
}

pub fn content_asset_request_from_asset_id(asset_id: &str) -> Option<ContentAssetRequest> {
    parse_landblock_outdoor_asset_id(asset_id)
        .map(ContentAssetRequest::LandblockOutdoor)
        .or_else(|| {
            parse_landblock_topology_asset_id(asset_id).map(ContentAssetRequest::LandblockTopology)
        })
        .or_else(|| parse_env_cell_asset_id(asset_id).map(ContentAssetRequest::EnvCell))
        .or_else(|| {
            parse_terrain_material_asset_id(asset_id).map(ContentAssetRequest::TerrainMaterial)
        })
        .or_else(|| parse_gfx_obj_asset_id(asset_id).map(ContentAssetRequest::GfxObj))
        .or_else(|| parse_setup_model_asset_id(asset_id).map(ContentAssetRequest::SetupModel))
        .or_else(|| {
            parse_material_recipe_asset_id(asset_id).map(ContentAssetRequest::MaterialRecipe)
        })
        .or_else(|| {
            parse_setup_appearance_asset_id(asset_id).map(ContentAssetRequest::SetupAppearance)
        })
        .or_else(|| parse_render_texture_asset_id(asset_id).map(ContentAssetRequest::RenderTexture))
        .or_else(|| parse_render_surface_asset_id(asset_id).map(ContentAssetRequest::RenderSurface))
        .or_else(|| parse_palette_asset_id(asset_id).map(ContentAssetRequest::Palette))
}
