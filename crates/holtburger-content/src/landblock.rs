use anyhow::{Context, Result, ensure};
use holtburger_common::math::{Quaternion, Vector3};
use holtburger_dat::landblock::{CellLandblock, Frame, LandblockInfo};
use holtburger_dat::{EOR_CELL_NAMESPACE, ResourceKey};

use crate::{ActiveRegionData, ContentDecodeCache, ContentRepository, TerrainCellDiagonals};

const LANDBLOCK_GRID_SIZE: usize = 9;
const LANDBLOCK_TILE_SIZE: f32 = 24.0;

/// Normalizes any landblock-owned cell DID to its CellLandblock root DID.
pub fn normalize_landblock_id(raw_landblock_id: u32) -> u32 {
    (raw_landblock_id & 0xffff_0000) | 0xffff
}

/// Complete shallow content facts for one outdoor landblock.
#[derive(Debug, Clone)]
pub struct LandblockAsset {
    /// Normalized CellLandblock DID (`0xXXYYFFFF`).
    pub landblock_id: u32,
    /// Whether this landblock has only dungeon EnvCell traversal or any outdoor/mixed traversal.
    pub traversal_class: LandblockTraversalClass,
    /// Canonical authored terrain and resolved height samples.
    pub terrain: LandblockTerrain,
    /// Every explicit object placement authored by LandblockInfo.
    pub explicit_objects: Vec<LandblockObject>,
    /// Every building placement and its authored transition metadata.
    pub buildings: Vec<LandblockBuilding>,
    /// Ordered references to the landblock's EnvCell records.
    pub env_cell_refs: Vec<LandblockEnvCellRef>,
    /// Ordered landblock restriction-table entries.
    pub restrictions: Vec<LandblockRestriction>,
}

/// Static-data traversal classification for one normalized landblock owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LandblockTraversalClass {
    /// The owner has no traversable outdoor surface and is composed only of EnvCells.
    DungeonOnly,
    /// The owner is outdoor, mixed, empty, or otherwise not a dungeon-only owner.
    OutdoorOrMixed,
}

/// Authored landblock terrain transposed into row-major order.
#[derive(Debug, Clone)]
pub struct LandblockTerrain {
    /// Number of vertices on either side of the square terrain grid.
    pub grid_size: usize,
    /// World-space distance between neighboring terrain vertices.
    pub tile_size: f32,
    /// Authored indices into the active region's height table.
    pub height_indices: Vec<u8>,
    /// World-space heights resolved from `height_indices`.
    pub heights: Vec<f32>,
    /// Authored packed terrain samples corresponding to the height vertices.
    pub terrain_samples: Vec<u16>,
    /// Retail's canonical triangle diagonal for each of the 8x8 terrain cells.
    pub cell_diagonals: TerrainCellDiagonals,
}

/// One explicit outdoor object placement.
#[derive(Debug, Clone)]
pub struct LandblockObject {
    /// Stable ordinal in `LandblockInfo.objects`.
    pub source_index: usize,
    /// Authored object DID, including unsupported DID families.
    pub source_did: u32,
    /// Coarse DID-family classification without filtering the source record.
    pub source_family: LandblockObjectSourceFamily,
    /// Authored landblock-local placement.
    pub placement: LandblockPlacement,
}

/// One outdoor building placement and its authored portal facts.
#[derive(Debug, Clone)]
pub struct LandblockBuilding {
    /// Stable ordinal in `LandblockInfo.buildings`.
    pub source_index: usize,
    /// Authored building model DID, including unsupported DID families.
    pub source_did: u32,
    /// Coarse DID-family classification without filtering the source record.
    pub source_family: LandblockObjectSourceFamily,
    /// Authored landblock-local placement.
    pub placement: LandblockPlacement,
    /// Authored building BSP leaf count.
    pub num_leaves: u32,
    /// Ordered building-transition records.
    pub portals: Vec<LandblockBuildingPortal>,
}

/// One building transition record authored in LandblockInfo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandblockBuildingPortal {
    /// Stable ordinal in the owning building's portal vector.
    pub source_index: usize,
    /// Raw authored portal flags.
    pub flags: u16,
    /// Raw authored target cell selector.
    pub other_cell_id: u16,
    /// Raw authored target portal selector.
    pub other_portal_id: u16,
    /// Raw authored local EnvCell selectors.
    pub stab_cell_ids: Vec<u16>,
    /// Full EnvCell DIDs derived from `stab_cell_ids`.
    pub linked_env_cell_ids: Vec<u32>,
}

/// Shallow reference to one EnvCell owned by the landblock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LandblockEnvCellRef {
    /// Stable ordinal in the contiguous LandblockInfo EnvCell range.
    pub source_index: u32,
    /// Full EnvCell DID.
    pub env_cell_id: u32,
}

/// One restriction-table association.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LandblockRestriction {
    /// Authored cell identity used as the restriction-table key.
    pub cell_id: u32,
    /// Authored restriction object DID.
    pub restriction_object_id: u32,
}

/// Authored placement in Asheron's Call landblock-local coordinates.
#[derive(Debug, Clone, Copy)]
pub struct LandblockPlacement {
    /// Local translation.
    pub origin: Vector3,
    /// Local rotation.
    pub orientation: Quaternion,
}

impl LandblockPlacement {
    /// Transforms a landblock-local point into the placed asset's authored coordinate space.
    pub fn to_local_space(&self, landblock_point: Vector3) -> Vector3 {
        self.orientation
            .conjugate()
            .rotate_vector(landblock_point - self.origin)
    }
}

/// Coarse identity family for an authored outdoor object DID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LandblockObjectSourceFamily {
    /// Direct GfxObj (`0x01`) reference.
    GfxObj,
    /// SetupModel (`0x02`) reference.
    SetupModel,
    /// Any other authored DID family, preserved losslessly.
    Other(u8),
}

impl LandblockObjectSourceFamily {
    pub(crate) fn from_did(did: u32) -> Self {
        match (did >> 24) as u8 {
            0x01 => Self::GfxObj,
            0x02 => Self::SetupModel,
            family => Self::Other(family),
        }
    }
}

/// Builds shallow landblock facts without opening referenced deep assets.
#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockAssetAssembler;

impl LandblockAssetAssembler {
    /// Loads and assembles one normalized landblock.
    ///
    /// `None` means the CellLandblock itself is absent. Once that source exists, decode and
    /// invariant failures are errors. `CellLandblock.has_objects` controls whether the matching
    /// LandblockInfo is required and prevents an unnecessary missing-record read for empty blocks.
    pub fn assemble(
        self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        active_region: &ActiveRegionData,
        raw_landblock_id: u32,
    ) -> Result<Option<LandblockAsset>> {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_key = ResourceKey::new(EOR_CELL_NAMESPACE, landblock_id);
        if content.resource_metadata(landblock_key).is_none() {
            return Ok(None);
        }

        let landblock = decode_cache
            .cell_landblock(content, landblock_id)
            .with_context(|| format!("Could not load CellLandblock 0x{landblock_id:08X}"))?;
        ensure!(
            landblock.id == landblock_id,
            "CellLandblock source 0x{landblock_id:08X} decoded record id 0x{:08X}",
            landblock.id
        );

        let terrain = assemble_terrain(&landblock, &active_region.descriptor)?;
        let info = if landblock.has_objects == 0 {
            None
        } else {
            let info_id = landblock_id & 0xffff_fffe;
            Some(
                decode_cache
                    .landblock_info(content, info_id)
                    .with_context(|| {
                        format!(
                            "CellLandblock 0x{landblock_id:08X} promises required LandblockInfo 0x{info_id:08X}"
                        )
                    })?,
            )
        };

        if let Some(info) = &info {
            let expected_id = landblock_id & 0xffff_fffe;
            ensure!(
                info.id == expected_id,
                "LandblockInfo source 0x{expected_id:08X} decoded record id 0x{:08X}",
                info.id
            );
        }

        Ok(Some(assemble_from_records(
            landblock_id,
            terrain,
            info.as_deref(),
        )))
    }
}

fn assemble_terrain(
    landblock: &CellLandblock,
    active_region: &holtburger_dat::file_type::RegionDesc,
) -> Result<LandblockTerrain> {
    let expected_sample_count = LANDBLOCK_GRID_SIZE * LANDBLOCK_GRID_SIZE;
    ensure!(
        landblock.height.len() == expected_sample_count,
        "CellLandblock 0x{:08X} has {} height indices; expected {expected_sample_count}",
        landblock.id,
        landblock.height.len()
    );
    ensure!(
        landblock.terrain.len() == expected_sample_count,
        "CellLandblock 0x{:08X} has {} terrain samples; expected {expected_sample_count}",
        landblock.id,
        landblock.terrain.len()
    );
    ensure!(
        active_region
            .land_defs
            .land_height_table
            .iter()
            .all(|height| height.is_finite()),
        "RegionDesc LandDefs.LandHeightTable contains a non-finite height"
    );

    let mut height_indices = Vec::with_capacity(expected_sample_count);
    let mut heights = Vec::with_capacity(expected_sample_count);
    let mut terrain_samples = Vec::with_capacity(expected_sample_count);
    for row in 0..LANDBLOCK_GRID_SIZE {
        for column in 0..LANDBLOCK_GRID_SIZE {
            let dat_index = column * LANDBLOCK_GRID_SIZE + row;
            let height_index = landblock.height[dat_index];
            height_indices.push(height_index);
            heights.push(active_region.land_defs.land_height_table[usize::from(height_index)]);
            terrain_samples.push(landblock.terrain[dat_index]);
        }
    }

    Ok(LandblockTerrain {
        grid_size: LANDBLOCK_GRID_SIZE,
        tile_size: LANDBLOCK_TILE_SIZE,
        height_indices,
        heights,
        terrain_samples,
        cell_diagonals: TerrainCellDiagonals::for_landblock(landblock.id),
    })
}

fn assemble_from_records(
    landblock_id: u32,
    terrain: LandblockTerrain,
    info: Option<&LandblockInfo>,
) -> LandblockAsset {
    let explicit_objects = info
        .into_iter()
        .flat_map(|info| info.objects.iter())
        .enumerate()
        .map(|(source_index, object)| LandblockObject {
            source_index,
            source_did: object.id,
            source_family: LandblockObjectSourceFamily::from_did(object.id),
            placement: placement_from_frame(&object.frame),
        })
        .collect();
    let buildings: Vec<LandblockBuilding> = info
        .into_iter()
        .flat_map(|info| info.buildings.iter())
        .enumerate()
        .map(|(source_index, building)| LandblockBuilding {
            source_index,
            source_did: building.model_id,
            source_family: LandblockObjectSourceFamily::from_did(building.model_id),
            placement: placement_from_frame(&building.frame),
            num_leaves: building.num_leaves,
            portals: building
                .portals
                .iter()
                .enumerate()
                .map(|(portal_index, portal)| LandblockBuildingPortal {
                    source_index: portal_index,
                    flags: portal.flags,
                    other_cell_id: portal.other_cell_id,
                    other_portal_id: portal.other_portal_id,
                    stab_cell_ids: portal.stab_list.clone(),
                    linked_env_cell_ids: portal
                        .stab_list
                        .iter()
                        .map(|cell_id| (landblock_id & 0xffff_0000) | u32::from(*cell_id))
                        .collect(),
                })
                .collect(),
        })
        .collect();
    let env_cell_refs = (0..info.map_or(0, |info| info.num_cells))
        .map(|source_index| LandblockEnvCellRef {
            source_index,
            env_cell_id: (landblock_id & 0xffff_0000) | (0x0100 + source_index),
        })
        .collect();
    let traversal_class = classify_landblock_traversal(
        landblock_id,
        &terrain.height_indices,
        info.map_or(0, |info| info.num_cells),
        buildings.len(),
    );
    let mut restrictions = info
        .and_then(|info| info.restriction_tables.as_ref())
        .into_iter()
        .flat_map(|table| table.tables.iter())
        .map(|(cell_id, restriction_object_id)| LandblockRestriction {
            cell_id: *cell_id,
            restriction_object_id: *restriction_object_id,
        })
        .collect::<Vec<_>>();
    restrictions.sort_by_key(|restriction| restriction.cell_id);

    LandblockAsset {
        landblock_id,
        traversal_class,
        terrain,
        explicit_objects,
        buildings,
        env_cell_refs,
        restrictions,
    }
}

/// Applies ACE's proven dungeon-only predicate to normalized shallow landblock facts.
///
/// The northwest exception is evaluated before the authored terrain signature because those
/// water-cell edges are known to contain inconsistent height authoring. All other clauses are
/// jointly necessary: flat terrain alone, EnvCell presence alone, and an interior building alone
/// do not establish dungeon-only traversal.
fn classify_landblock_traversal(
    landblock_id: u32,
    height_indices: &[u8],
    env_cell_count: u32,
    building_count: usize,
) -> LandblockTraversalClass {
    let landblock_x = ((landblock_id >> 24) & 0xff) as u8;
    let landblock_y = ((landblock_id >> 16) & 0xff) as u8;
    if landblock_x < 0x08 && landblock_y > 0xf8 {
        return LandblockTraversalClass::OutdoorOrMixed;
    }

    if height_indices.iter().any(|height| *height != 0)
        || env_cell_count == 0
        || building_count != 0
    {
        LandblockTraversalClass::OutdoorOrMixed
    } else {
        LandblockTraversalClass::DungeonOnly
    }
}

fn placement_from_frame(frame: &Frame) -> LandblockPlacement {
    LandblockPlacement {
        origin: frame.origin,
        orientation: frame.orientation,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use holtburger_common::math::{Quaternion, Vector3};
    use holtburger_dat::file_type::region::{GameTime, LandDefs, RegionDesc};
    use holtburger_dat::landblock::{BuildInfo, PortalInternal, RestrictionTable, Stab};

    use super::*;

    #[test]
    fn shallow_assembly_transposes_terrain_and_preserves_all_authored_facts() {
        let mut height_table = [0.0; 256];
        for (index, height) in height_table.iter_mut().enumerate() {
            *height = index as f32 * 0.5;
        }
        let region = synthetic_region(height_table);
        let landblock = CellLandblock {
            id: 0xda55_ffff,
            has_objects: 1,
            terrain: (0..81).map(|index| 1_000 + index).collect(),
            height: (0..81).map(|index| index as u8).collect(),
            _align: (),
        };
        let info = LandblockInfo {
            id: 0xda55_fffe,
            num_cells: 2,
            objects: vec![Stab {
                id: 0x9900_0001,
                frame: identity_frame(1.0),
            }],
            pack_mask: 1,
            buildings: vec![BuildInfo {
                model_id: 0x0200_0001,
                frame: identity_frame(2.0),
                num_leaves: 3,
                portals: vec![PortalInternal {
                    flags: 4,
                    other_cell_id: 0x0100,
                    other_portal_id: 7,
                    stab_list: vec![0x0100, 0x0101],
                    _align: (),
                }],
            }],
            restriction_tables: Some(RestrictionTable {
                tables: HashMap::from([(0x0101, 0x5000_0002), (0x0100, 0x5000_0001)]),
            }),
        };

        let terrain =
            assemble_terrain(&landblock, &region).expect("synthetic terrain should assemble");
        let asset = assemble_from_records(landblock.id, terrain, Some(&info));

        assert_eq!(
            asset.traversal_class,
            LandblockTraversalClass::OutdoorOrMixed
        );
        assert_eq!(asset.terrain.height_indices[1], 9);
        assert_eq!(asset.terrain.heights[1], 4.5);
        assert_eq!(asset.terrain.terrain_samples[1], 1_009);
        assert_eq!(asset.explicit_objects.len(), 1);
        assert_eq!(
            asset.explicit_objects[0].source_family,
            LandblockObjectSourceFamily::Other(0x99)
        );
        assert_eq!(asset.buildings.len(), 1);
        assert_eq!(
            asset.buildings[0].portals[0].linked_env_cell_ids,
            vec![0xda55_0100, 0xda55_0101]
        );
        assert_eq!(
            asset.env_cell_refs,
            vec![
                LandblockEnvCellRef {
                    source_index: 0,
                    env_cell_id: 0xda55_0100,
                },
                LandblockEnvCellRef {
                    source_index: 1,
                    env_cell_id: 0xda55_0101,
                },
            ]
        );
        assert_eq!(asset.restrictions[0].cell_id, 0x0100);
        assert_eq!(asset.restrictions[1].cell_id, 0x0101);
    }

    #[test]
    fn shallow_assembly_rejects_non_finite_active_region_heights() {
        let mut height_table = [0.0; 256];
        height_table[2] = f32::NAN;
        let landblock = CellLandblock {
            id: 0xda55_ffff,
            has_objects: 0,
            terrain: vec![0; 81],
            height: vec![0; 81],
            _align: (),
        };

        let error = assemble_terrain(&landblock, &synthetic_region(height_table))
            .expect_err("non-finite region height tables should fail loudly");

        assert!(error.to_string().contains("non-finite"));
    }

    #[test]
    fn traversal_class_matches_ace_predicate_and_northwest_exception() {
        let flat_heights = vec![0; LANDBLOCK_GRID_SIZE * LANDBLOCK_GRID_SIZE];

        assert_eq!(
            classify_landblock_traversal(0x0005_ffff, &flat_heights, 817, 0),
            LandblockTraversalClass::DungeonOnly
        );
        assert_eq!(
            classify_landblock_traversal(0x0005_ffff, &flat_heights, 0, 0),
            LandblockTraversalClass::OutdoorOrMixed
        );
        assert_eq!(
            classify_landblock_traversal(0x0005_ffff, &flat_heights, 817, 1),
            LandblockTraversalClass::OutdoorOrMixed
        );

        let mut non_flat_heights = flat_heights.clone();
        non_flat_heights[0] = 1;
        assert_eq!(
            classify_landblock_traversal(0x0005_ffff, &non_flat_heights, 817, 0),
            LandblockTraversalClass::OutdoorOrMixed
        );
        assert_eq!(
            classify_landblock_traversal(0x07f9_ffff, &flat_heights, 817, 0),
            LandblockTraversalClass::OutdoorOrMixed
        );
    }

    fn identity_frame(x: f32) -> Frame {
        Frame {
            origin: Vector3::new(x, 0.0, 0.0),
            orientation: Quaternion {
                w: 1.0,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
        }
    }

    fn synthetic_region(land_height_table: [f32; 256]) -> RegionDesc {
        RegionDesc {
            id: 0x1300_0000,
            region_number: 1,
            version: 1,
            region_name: "test".to_string(),
            land_defs: LandDefs {
                num_block_length: 255,
                num_block_width: 255,
                square_length: 24.0,
                lblock_length: 192,
                vertex_per_cell: 1,
                max_obj_height: 48.0,
                sky_height: 400.0,
                road_width: 6.0,
                land_height_table,
            },
            game_time: GameTime {
                zero_time_of_year: 0.0,
                zero_year: 0,
                day_length: 0.0,
                days_per_year: 0,
                year_spec: String::new(),
                times_of_day: Vec::new(),
                days_of_the_week: Vec::new(),
                seasons: Vec::new(),
            },
            parts_mask: 0,
            sky_info: None,
            sound_info: None,
            scene_info: None,
            terrain_info: None,
            region_misc: None,
        }
    }
}
