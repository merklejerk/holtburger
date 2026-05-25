use holtburger_content::MaterialAppearanceInput;
use holtburger_content::normalize_landblock_id;
use holtburger_core::{ContentAssetRequest, SetupAppearanceRequest};
use holtburger_dat::file_type::{
    AnimationPartChange, DatFileType, ObjDesc, SubPalette, TextureMapChange,
};

pub fn parse_gfx_obj_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "gfx-obj/", DatFileType::Model as u32)
}

pub fn parse_setup_model_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "setup-model/", DatFileType::SetupModel as u32)
}

pub fn parse_setup_appearance_asset_id(asset_id: &str) -> Option<SetupAppearanceRequest> {
    let rest = asset_id.strip_prefix("setup-appearance/")?;
    let (setup_hex, variant) = rest
        .split_once('/')
        .map_or((rest, None), |(setup_hex, variant)| {
            (setup_hex, Some(variant))
        });
    let setup_model_id = parse_typed_hex_data_id(setup_hex, DatFileType::SetupModel as u32)?;
    let Some(variant) = variant else {
        return Some(SetupAppearanceRequest::base(setup_model_id));
    };
    let obj_desc = parse_setup_appearance_obj_desc_variant(variant)?;
    Some(SetupAppearanceRequest {
        setup_model_id,
        appearance: MaterialAppearanceInput {
            obj_desc: Some(obj_desc),
        },
    })
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

fn parse_setup_appearance_obj_desc_variant(variant: &str) -> Option<ObjDesc> {
    let rest = variant.strip_prefix("obj-desc")?;
    let rest = rest.strip_prefix('/').unwrap_or(rest);
    let mut palette_id = None;
    let mut sub_palettes = Vec::new();
    let mut texture_changes = Vec::new();
    let mut anim_part_changes = Vec::new();
    if rest.is_empty() {
        return Some(ObjDesc {
            palette_id,
            sub_palettes,
            texture_changes,
            anim_part_changes,
        });
    }

    for segment in rest.split('/') {
        if let Some(raw_palette_id) = segment.strip_prefix("pal-") {
            if palette_id.is_some() {
                return None;
            }
            palette_id = Some(parse_typed_hex_data_id(
                raw_palette_id,
                DatFileType::Palette as u32,
            )?);
            continue;
        }
        if let Some(raw_sub_palette) = segment.strip_prefix("sub-") {
            let [sub_id, offset, num_colors] = parse_three_hex_fields(raw_sub_palette)?;
            if (sub_id >> 24) != DatFileType::Palette as u32 {
                return None;
            }
            sub_palettes.push(SubPalette {
                sub_id,
                offset,
                num_colors,
            });
            continue;
        }
        if let Some(raw_texture_change) = segment.strip_prefix("tex-") {
            let [part_index, old_texture, new_texture] =
                parse_three_hex_fields(raw_texture_change)?;
            if part_index > u32::from(u8::MAX)
                || (old_texture >> 24) != DatFileType::SurfaceTexture as u32
                || (new_texture >> 24) != DatFileType::SurfaceTexture as u32
            {
                return None;
            }
            texture_changes.push(TextureMapChange {
                part_index: part_index as u8,
                old_texture,
                new_texture,
            });
            continue;
        }
        if let Some(raw_anim_part_change) = segment.strip_prefix("anim-") {
            let [part_index, part_id] = parse_two_hex_fields(raw_anim_part_change)?;
            if part_index > u32::from(u8::MAX) || (part_id >> 24) != DatFileType::Model as u32 {
                return None;
            }
            anim_part_changes.push(AnimationPartChange {
                part_index: part_index as u8,
                part_id,
            });
            continue;
        }
        return None;
    }

    Some(ObjDesc {
        palette_id,
        sub_palettes,
        texture_changes,
        anim_part_changes,
    })
}

fn parse_two_hex_fields(raw: &str) -> Option<[u32; 2]> {
    let mut fields = raw.split('-');
    let first = parse_hex_u32(fields.next()?)?;
    let second = parse_hex_u32(fields.next()?)?;
    fields.next().is_none().then_some([first, second])
}

fn parse_three_hex_fields(raw: &str) -> Option<[u32; 3]> {
    let mut fields = raw.split('-');
    let first = parse_hex_u32(fields.next()?)?;
    let second = parse_hex_u32(fields.next()?)?;
    let third = parse_hex_u32(fields.next()?)?;
    fields.next().is_none().then_some([first, second, third])
}

fn parse_hex_u32(raw: &str) -> Option<u32> {
    let hex = raw
        .strip_prefix("0x")
        .or_else(|| raw.strip_prefix("0X"))
        .unwrap_or(raw);
    (!hex.is_empty() && hex.len() <= 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(hex, 16).ok())
        .flatten()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_setup_appearance_obj_desc_variant() {
        let request = parse_setup_appearance_asset_id(
            "setup-appearance/02000001/obj-desc/pal-04000001/sub-04000002-10-8/tex-00-05000001-05000002/anim-01-01000003",
        )
        .expect("variant asset id should parse");
        let obj_desc = request
            .appearance
            .obj_desc
            .expect("variant should carry ObjDesc");

        assert_eq!(request.setup_model_id, 0x02000001);
        assert_eq!(obj_desc.palette_id, Some(0x04000001));
        assert_eq!(obj_desc.sub_palettes.len(), 1);
        assert_eq!(obj_desc.sub_palettes[0].sub_id, 0x04000002);
        assert_eq!(obj_desc.sub_palettes[0].offset, 0x10);
        assert_eq!(obj_desc.sub_palettes[0].num_colors, 0x8);
        assert_eq!(obj_desc.texture_changes.len(), 1);
        assert_eq!(obj_desc.texture_changes[0].part_index, 0);
        assert_eq!(obj_desc.texture_changes[0].old_texture, 0x05000001);
        assert_eq!(obj_desc.texture_changes[0].new_texture, 0x05000002);
        assert_eq!(obj_desc.anim_part_changes.len(), 1);
        assert_eq!(obj_desc.anim_part_changes[0].part_index, 1);
        assert_eq!(obj_desc.anim_part_changes[0].part_id, 0x01000003);
    }

    #[test]
    fn rejects_setup_appearance_variant_with_wrong_resource_types() {
        assert!(
            parse_setup_appearance_asset_id(
                "setup-appearance/02000001/obj-desc/tex-00-06000001-05000002"
            )
            .is_none()
        );
        assert!(
            parse_setup_appearance_asset_id("setup-appearance/02000001/obj-desc/anim-00-02000002")
                .is_none()
        );
        assert!(
            parse_setup_appearance_asset_id(
                "setup-appearance/01000001/obj-desc/tex-00-05000001-05000002"
            )
            .is_none()
        );
    }
}
