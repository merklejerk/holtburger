use holtburger_content::{LandblockAsset, LandblockSceneClass};
use serde::Serialize;

/// Minimal host projection used to choose scene-interest coverage before deep materialization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandblockProfile {
    /// Normalized owner identity echoed to the caller.
    pub landblock_id: String,
    /// Canonical content-owned scene classification.
    pub scene_class: LandblockSceneClassWire,
}

/// Wire spelling for the content-owned scene classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LandblockSceneClassWire {
    DungeonOnly,
    OutdoorOnly,
    OutdoorWithEnvCells,
}

impl From<LandblockSceneClass> for LandblockSceneClassWire {
    fn from(value: LandblockSceneClass) -> Self {
        match value {
            LandblockSceneClass::DungeonOnly => Self::DungeonOnly,
            LandblockSceneClass::OutdoorOnly => Self::OutdoorOnly,
            LandblockSceneClass::OutdoorWithEnvCells => Self::OutdoorWithEnvCells,
        }
    }
}

/// Projects the canonical shallow asset without requesting any deep landblock products.
pub fn project_landblock_profile(asset: &LandblockAsset) -> LandblockProfile {
    LandblockProfile {
        landblock_id: format!("0x{:08x}", asset.landblock_id),
        scene_class: asset.scene_class.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_projection_uses_stable_wire_spelling() {
        let asset = LandblockAsset {
            landblock_id: 0x0005_ffff,
            scene_class: LandblockSceneClass::DungeonOnly,
            terrain: synthetic_terrain(),
            explicit_objects: Vec::new(),
            buildings: Vec::new(),
            env_cell_refs: Vec::new(),
            restrictions: Vec::new(),
        };

        let profile = project_landblock_profile(&asset);
        assert_eq!(profile.landblock_id, "0x0005ffff");
        assert_eq!(profile.scene_class, LandblockSceneClassWire::DungeonOnly);
        assert_eq!(
            serde_json::to_value(&profile).expect("profile should serialize"),
            serde_json::json!({
                "landblockId": "0x0005ffff",
                "sceneClass": "dungeon-only",
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
