//! One exact live-entity SetupModel appearance projected for frontend visual realization.

use anyhow::Result;
use holtburger_content::MaterialAppearanceInput;
use holtburger_core::{ContentAssetRuntime, SetupAppearanceRequest};
use holtburger_dat::file_type::{AnimationPartChange, ObjDesc, SubPalette, TextureMapChange};
use holtburger_world::EntityAppearance;
use serde::Serialize;
use serde_json::Value;

use crate::binary_source_record::{
    BinarySectionManifest, BinarySectionWriter, serialize_binary_envelope,
};
use crate::object_resource_closure::ObjectResourceClosure;

pub(crate) const DYNAMIC_ENTITY_VISUAL_BINARY_MAGIC: &[u8; 4] = b"HBDV";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DynamicEntityVisualManifest {
    transport: &'static str,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    definition_id: String,
    definitions: Vec<Value>,
    geometries: Vec<Value>,
    materials: Vec<Value>,
    texture_dependencies: Vec<Value>,
    sections: Vec<BinarySectionManifest>,
}

/// Resolve and serialize every immutable visual dependency for one exact entity appearance.
pub(crate) async fn load_dynamic_entity_visual_source_bytes(
    runtime: &ContentAssetRuntime,
    setup_did: u32,
    appearance: EntityAppearance,
) -> Result<Vec<u8>> {
    let mut closure = ObjectResourceClosure::default();
    let definition_id = closure
        .add_setup_model_appearance(
            runtime,
            SetupAppearanceRequest {
                setup_model_id: setup_did,
                appearance: material_appearance(appearance),
            },
        )
        .await?;
    closure.validate()?;
    let mut writer = BinarySectionWriter::default();
    closure.buffers.append_sections(&mut writer, "")?;
    let (sections, section_bytes) = writer.finish();
    serialize_binary_envelope(
        DYNAMIC_ENTITY_VISUAL_BINARY_MAGIC,
        &DynamicEntityVisualManifest {
            transport: "holtburger-dynamic-entity-visual",
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            definition_id,
            definitions: closure.definitions,
            geometries: closure.geometries,
            materials: closure.materials.into_values().collect(),
            texture_dependencies: closure.texture_dependencies.into_values().collect(),
            sections,
        },
        &section_bytes,
    )
}

fn material_appearance(appearance: EntityAppearance) -> MaterialAppearanceInput {
    if appearance == EntityAppearance::default() {
        return MaterialAppearanceInput::default();
    }
    MaterialAppearanceInput {
        obj_desc: Some(ObjDesc {
            palette_id: appearance.palette_did,
            sub_palettes: appearance
                .sub_palettes
                .into_iter()
                .map(|palette| SubPalette {
                    sub_id: palette.palette_did,
                    offset: palette.offset,
                    num_colors: palette.color_count,
                })
                .collect(),
            texture_changes: appearance
                .texture_changes
                .into_iter()
                .map(|change| TextureMapChange {
                    part_index: change.part_index,
                    old_texture: change.old_texture_did,
                    new_texture: change.new_texture_did,
                })
                .collect(),
            anim_part_changes: appearance
                .part_changes
                .into_iter()
                .map(|change| AnimationPartChange {
                    part_index: change.part_index,
                    part_id: change.gfx_obj_did,
                })
                .collect(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::material_appearance;
    use holtburger_world::{
        EntityAppearance, EntityPartChange, EntitySubPalette, EntityTextureChange,
    };

    #[test]
    fn projects_lossless_ordered_entity_appearance() {
        let projected = material_appearance(EntityAppearance {
            palette_did: Some(0x0400_0001),
            sub_palettes: vec![EntitySubPalette {
                palette_did: 0x0400_0002,
                offset: 16,
                color_count: 24,
            }],
            texture_changes: vec![EntityTextureChange {
                part_index: 2,
                old_texture_did: 0x0500_0001,
                new_texture_did: 0x0500_0002,
            }],
            part_changes: vec![EntityPartChange {
                part_index: 3,
                gfx_obj_did: 0x0100_0001,
            }],
        });
        let obj_desc = projected
            .obj_desc
            .expect("non-base appearance should project");
        assert_eq!(obj_desc.palette_id, Some(0x0400_0001));
        assert_eq!(obj_desc.sub_palettes[0].offset, 16);
        assert_eq!(obj_desc.texture_changes[0].part_index, 2);
        assert_eq!(obj_desc.anim_part_changes[0].part_index, 3);
    }

    #[test]
    fn preserves_base_appearance_cache_identity() {
        assert!(
            material_appearance(EntityAppearance::default())
                .obj_desc
                .is_none()
        );
    }
}
