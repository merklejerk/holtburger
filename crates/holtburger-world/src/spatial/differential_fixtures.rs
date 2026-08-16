//! Shared input fixtures for the retail differential suites.
//!
//! Differential oracles must transliterate retail *logic* independently of production; the
//! authored *inputs* they drive production with — the retail creature body pair, the
//! retail-default grounded config, flat synthetic terrain — are shared here so the suites stay
//! comparable and a new config field is a one-line change instead of a per-suite sweep.

use holtburger_common::Vector3;
use holtburger_content::{LandblockTerrain, TerrainCollisionSurface};

use super::grounded::{
    EdgeProtection, GroundedBodySpheres, GroundedConfig, GroundedSphere,
    RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z,
};

/// The retail-default grounded config used by the human-pair differential scenarios.
pub(crate) fn retail_creature_config() -> GroundedConfig {
    GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        landing_normal_z: RETAIL_LANDING_NORMAL_Z,
        airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
        step_up_height: 0.6,
        step_down_height: 1.5,
        edge_protection: EdgeProtection::None,
        maximum_substep_distance: 0.24,
        maximum_substeps: 32,
        maximum_contact_passes: 8,
        separation_epsilon: 0.000_5,
    }
}

/// Retail's authored human sphere pair (`SPHEREPATH::init_sphere`, acclient.c:302241-302291).
pub(crate) fn retail_creature_pair() -> GroundedBodySpheres {
    GroundedBodySpheres {
        support: GroundedSphere {
            center: Vector3::new(0.0, 0.0, 0.475),
            radius: 0.48,
        },
        upper: Some(GroundedSphere {
            center: Vector3::new(0.0, 0.0, 1.35),
            radius: 0.48,
        }),
    }
}

/// A full flat 8x8 synthetic terrain surface at z = 0 for one landblock.
pub(crate) fn flat_terrain(landblock_id: u32) -> TerrainCollisionSurface {
    TerrainCollisionSurface::from_terrain(&LandblockTerrain {
        grid_size: 9,
        tile_size: 24.0,
        height_indices: vec![0; 81],
        heights: vec![0.0; 81],
        terrain_samples: vec![0; 81],
        cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(landblock_id),
    })
    .unwrap()
}
