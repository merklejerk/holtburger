use holtburger_content::{LandblockAsset, LandblockTraversalClass};
use serde::Serialize;

/// Minimal host projection used to choose scene-interest coverage before deep materialization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandblockProfile {
    /// Normalized owner identity echoed to the caller.
    pub landblock_id: String,
    /// Canonical content-owned traversal classification.
    pub traversal_class: LandblockTraversalClassWire,
}

/// Wire spelling for the content-owned traversal classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LandblockTraversalClassWire {
    DungeonOnly,
    OutdoorOrMixed,
}

impl From<LandblockTraversalClass> for LandblockTraversalClassWire {
    fn from(value: LandblockTraversalClass) -> Self {
        match value {
            LandblockTraversalClass::DungeonOnly => Self::DungeonOnly,
            LandblockTraversalClass::OutdoorOrMixed => Self::OutdoorOrMixed,
        }
    }
}

/// Projects the canonical shallow asset without requesting any deep landblock products.
pub fn project_landblock_profile(asset: &LandblockAsset) -> LandblockProfile {
    LandblockProfile {
        landblock_id: format!("0x{:08x}", asset.landblock_id),
        traversal_class: asset.traversal_class.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_projection_uses_stable_wire_spelling() {
        let asset = LandblockAsset {
            landblock_id: 0x0005_ffff,
            traversal_class: LandblockTraversalClass::DungeonOnly,
            terrain: synthetic_terrain(),
            explicit_objects: Vec::new(),
            buildings: Vec::new(),
            env_cell_refs: Vec::new(),
            restrictions: Vec::new(),
        };

        let profile = project_landblock_profile(&asset);
        assert_eq!(profile.landblock_id, "0x0005ffff");
        assert_eq!(
            profile.traversal_class,
            LandblockTraversalClassWire::DungeonOnly
        );
        assert_eq!(
            serde_json::to_value(&profile).expect("profile should serialize"),
            serde_json::json!({
                "landblockId": "0x0005ffff",
                "traversalClass": "dungeon-only",
            })
        );
    }

    fn synthetic_terrain() -> holtburger_content::LandblockTerrain {
        holtburger_content::LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![0.0; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(0x0005_ffff),
        }
    }
}
