//! Lossless source-neutral appearance facts owned by a live entity.

use holtburger_protocol::messages::object::types::ModelData;

/// Ordered semantic appearance substitutions for one live entity.
///
/// Values use expanded palette color units and full content identities. Protocol packing and
/// catalog storage conventions are normalized by their source adapters before this value is built.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct EntityAppearance {
    /// Optional base palette applied before subpalette ranges.
    pub palette_did: Option<u32>,
    /// Ordered palette range substitutions.
    pub sub_palettes: Vec<EntitySubPalette>,
    /// Ordered setup-part texture substitutions.
    pub texture_changes: Vec<EntityTextureChange>,
    /// Ordered setup-part GfxObj substitutions.
    pub part_changes: Vec<EntityPartChange>,
}

/// One replacement palette applied to an expanded color interval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntitySubPalette {
    /// Replacement palette resource id.
    pub palette_did: u32,
    /// First color in the base palette.
    pub offset: u32,
    /// Number of colors replaced; zero is an explicit no-op interval.
    pub color_count: u32,
}

/// One texture substitution addressed within a setup part.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntityTextureChange {
    /// Zero-based setup part index.
    pub part_index: u8,
    /// Authored texture resource to replace.
    pub old_texture_did: u32,
    /// Replacement texture resource.
    pub new_texture_did: u32,
}

/// One setup-part GfxObj substitution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntityPartChange {
    /// Zero-based setup part index.
    pub part_index: u8,
    /// Replacement GfxObj resource id.
    pub gfx_obj_did: u32,
}

impl From<&ModelData> for EntityAppearance {
    fn from(model: &ModelData) -> Self {
        Self {
            palette_did: model.palette_id,
            sub_palettes: model
                .sub_palettes
                .iter()
                .map(|palette| EntitySubPalette {
                    palette_did: palette.id,
                    offset: u32::from(palette.offset) * 8,
                    // Retail's packed zero byte represents all 256 eight-color groups.
                    color_count: u32::from(if palette.length == 0 {
                        256
                    } else {
                        u16::from(palette.length)
                    }) * 8,
                })
                .collect(),
            texture_changes: model
                .texture_changes
                .iter()
                .map(|change| EntityTextureChange {
                    part_index: change.part_index,
                    old_texture_did: change.old_id,
                    new_texture_did: change.new_id,
                })
                .collect(),
            part_changes: model
                .model_changes
                .iter()
                .map(|change| EntityPartChange {
                    part_index: change.index,
                    gfx_obj_did: change.animation_id,
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::object::types::{ModelChange, SubPalette, TextureChange};

    #[test]
    fn wire_model_data_normalizes_units_without_reordering() {
        let model = ModelData {
            header: 0x11,
            extra: [2, 1, 1],
            palette_id: Some(0x0400_0001),
            sub_palettes: vec![
                SubPalette {
                    id: 0x0400_0002,
                    offset: 3,
                    length: 4,
                },
                SubPalette {
                    id: 0x0400_0003,
                    offset: 0,
                    length: 0,
                },
            ],
            texture_changes: vec![TextureChange {
                part_index: 5,
                old_id: 0x0500_0001,
                new_id: 0x0500_0002,
            }],
            model_changes: vec![ModelChange {
                index: 6,
                animation_id: 0x0100_0001,
            }],
        };

        let appearance = EntityAppearance::from(&model);

        assert_eq!(appearance.palette_did, Some(0x0400_0001));
        assert_eq!(appearance.sub_palettes[0].offset, 24);
        assert_eq!(appearance.sub_palettes[0].color_count, 32);
        assert_eq!(appearance.sub_palettes[1].color_count, 2048);
        assert_eq!(appearance.texture_changes[0].part_index, 5);
        assert_eq!(appearance.part_changes[0].part_index, 6);
    }
}
