use holtburger_content::{LandblockSceneLodLevel, LandblockSceneLodRequest};
use holtburger_core::{ContentAssetRequest, SetupAppearanceRequest};
use holtburger_dat::file_type::DatFileType;

pub fn parse_gfx_obj_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "gfx-obj/", DatFileType::Model as u32)
}

pub fn parse_setup_model_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "setup-model/", DatFileType::SetupModel as u32)
}

pub fn parse_animation_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "animation/", DatFileType::Animation as u32)
}

pub fn parse_setup_appearance_asset_id(asset_id: &str) -> Option<SetupAppearanceRequest> {
    parse_prefixed_data_id(
        asset_id,
        "setup-appearance/",
        DatFileType::SetupModel as u32,
    )
    .map(SetupAppearanceRequest::base)
}

pub fn parse_material_recipe_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "material/", DatFileType::Surface as u32)
}

pub fn parse_surface_texture_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(
        asset_id,
        "surface-texture/",
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
    parse_typed_hex_data_id(raw_hex, expected_type)
}

fn parse_typed_hex_data_id(raw_hex: &str, expected_type: u32) -> Option<u32> {
    let hex = raw_hex
        .strip_prefix("0x")
        .or_else(|| raw_hex.strip_prefix("0X"))
        .unwrap_or(raw_hex);

    (hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(hex, 16).ok())
        .flatten()
        .filter(|id| (id >> 24) == expected_type)
}

pub fn parse_landblock_scene_lod_asset_id(asset_id: &str) -> Option<LandblockSceneLodRequest> {
    let rest = asset_id.strip_prefix("landblock/")?;
    let (raw_hex, raw_level) = rest.split_once("/lod/")?;
    let landblock_id = (raw_hex.len() == 8 && raw_hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(raw_hex, 16).ok())
        .flatten()?;
    let level = (raw_level.len() == 1)
        .then(|| raw_level.parse::<u8>().ok())
        .flatten()
        .and_then(LandblockSceneLodLevel::from_u8)?;
    Some(LandblockSceneLodRequest::outdoor(landblock_id, level))
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

pub fn parse_region_render_profile_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("region-render-profile/")
        .filter(|raw| !raw.is_empty() && raw.chars().all(|ch| ch.is_ascii_digit()))
        .and_then(|raw| raw.parse::<u32>().ok())
}

pub fn content_asset_request_from_asset_id(asset_id: &str) -> Option<ContentAssetRequest> {
    parse_landblock_scene_lod_asset_id(asset_id)
        .map(ContentAssetRequest::LandblockSceneLod)
        .or_else(|| parse_env_cell_asset_id(asset_id).map(ContentAssetRequest::EnvCell))
        .or_else(|| {
            parse_terrain_material_asset_id(asset_id).map(ContentAssetRequest::TerrainMaterial)
        })
        .or_else(|| {
            parse_region_render_profile_asset_id(asset_id)
                .map(ContentAssetRequest::RegionRenderProfile)
        })
        .or_else(|| parse_animation_asset_id(asset_id).map(ContentAssetRequest::Animation))
        .or_else(|| parse_gfx_obj_asset_id(asset_id).map(ContentAssetRequest::GfxObj))
        .or_else(|| parse_setup_model_asset_id(asset_id).map(ContentAssetRequest::SetupModel))
        .or_else(|| {
            parse_material_recipe_asset_id(asset_id).map(ContentAssetRequest::MaterialRecipe)
        })
        .or_else(|| {
            parse_setup_appearance_asset_id(asset_id).map(ContentAssetRequest::SetupAppearance)
        })
        .or_else(|| {
            parse_surface_texture_asset_id(asset_id).map(ContentAssetRequest::SurfaceTexture)
        })
        .or_else(|| parse_render_surface_asset_id(asset_id).map(ContentAssetRequest::RenderSurface))
        .or_else(|| parse_palette_asset_id(asset_id).map(ContentAssetRequest::Palette))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_landblock_scene_lod_route_with_supported_levels() {
        for level in 0..=4 {
            assert_eq!(
                parse_landblock_scene_lod_asset_id(&format!("landblock/da550123/lod/{level}")),
                Some(LandblockSceneLodRequest::outdoor(
                    0xda55ffff,
                    LandblockSceneLodLevel::from_u8(level).expect("level should be supported")
                ))
            );
        }

        assert_eq!(
            content_asset_request_from_asset_id("landblock/da550123/lod/2"),
            Some(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(0xda55ffff, LandblockSceneLodLevel::Level2)
            ))
        );
    }

    #[test]
    fn rejects_malformed_landblock_scene_lod_routes() {
        for asset_id in [
            "landblock/da550123/lod/5",
            "landblock/da550123/lod/-1",
            "landblock/da550123/lod/02",
            "landblock/da55012/lod/2",
            "landblock/not-hex/lod/2",
            "landblock/da550123/lod/2/extra",
        ] {
            assert_eq!(parse_landblock_scene_lod_asset_id(asset_id), None);
            assert_eq!(content_asset_request_from_asset_id(asset_id), None);
        }
    }

    #[test]
    fn parses_animation_route_as_portal_animation_asset() {
        assert_eq!(
            parse_animation_asset_id("animation/0300061b"),
            Some(0x0300_061b)
        );
        assert_eq!(
            content_asset_request_from_asset_id("animation/0300061b"),
            Some(ContentAssetRequest::Animation(0x0300_061b))
        );
        assert_eq!(parse_animation_asset_id("animation/0200061b"), None);
    }
}
