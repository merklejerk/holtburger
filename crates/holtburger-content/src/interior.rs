use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use holtburger_dat::file_type::{EnvCell, Environment};

use crate::{
    ContentDecodeCache, ContentRepository, LandblockAsset, LandblockBuildingPortal,
    LandblockPlacement,
};

/// Complete canonical interior facts and topology for one landblock.
#[derive(Debug, Clone)]
pub struct LandblockInteriorSystemAsset {
    /// Normalized owning landblock DID.
    pub landblock_id: u32,
    /// Ordered EnvCell facts resolved from the shallow foundation.
    pub cells: Vec<LandblockEnvCell>,
    /// Deduplicated Environment assets retaining ownership of embedded CellStructs.
    pub environments: BTreeMap<u32, Arc<Environment>>,
    /// Directed authored portal records and validated cross-links.
    pub topology: LandblockPortalTopology,
}

/// Canonical shallow facts decoded from one EnvCell.
#[derive(Debug, Clone)]
pub struct LandblockEnvCell {
    /// Full EnvCell DID.
    pub env_cell_id: u32,
    /// Raw authored EnvCell flags.
    pub flags: u32,
    /// Raw authored cell identity retained independently of the source DID.
    pub authored_cell_id: u32,
    /// Owning Environment and embedded CellStruct selector.
    pub structure: LandblockCellStructureRef,
    /// Authored landblock-local placement.
    pub placement: LandblockPlacement,
    /// Full RenderSurface DIDs selected by the cell.
    pub surface_ids: Vec<u32>,
    /// Full EnvCell DIDs authored as potentially visible.
    pub visible_cell_ids: Vec<u32>,
    /// Ordered indoor static-object references.
    pub static_objects: Vec<LandblockIndoorObject>,
    /// Authored restriction object DID.
    pub restriction_object_id: Option<u32>,
    /// Whether the EnvCell authored the SeenOutside flag.
    pub seen_outside: bool,
}

/// Stable reference to a CellStruct embedded in its owning Environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LandblockCellStructureRef {
    /// Full Environment DID.
    pub environment_id: u32,
    /// Environment-local CellStruct selector.
    pub local_selector: u32,
}

/// One shallow indoor static-object placement.
#[derive(Debug, Clone)]
pub struct LandblockIndoorObject {
    /// Stable ordinal in `EnvCell.static_objects`.
    pub source_index: usize,
    /// Authored object DID.
    pub source_did: u32,
    /// Authored landblock-local placement; the EnvCell supplies residency, not a parent transform.
    pub placement: LandblockPlacement,
}

/// Directed authored portal graph for one landblock interior system.
#[derive(Debug, Clone)]
pub struct LandblockPortalTopology {
    /// One record per authored EnvCell portal, in cell and portal source order.
    pub portals: Vec<LandblockPortal>,
}

/// One directed EnvCell portal record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandblockPortal {
    /// Stable source portal identity.
    pub source: LandblockEnvCellPortalRef,
    /// Raw authored flags.
    pub flags: u16,
    /// Environment CellStruct polygon selector used for later aperture enrichment.
    pub polygon_id: u16,
    /// Authored endpoint semantics.
    pub endpoint: LandblockPortalEndpoint,
}

/// Stable reference to one portal in an EnvCell portal vector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct LandblockEnvCellPortalRef {
    /// Full EnvCell DID.
    pub env_cell_id: u32,
    /// Zero-based portal-vector selector.
    pub portal_index: usize,
}

/// Authored directed endpoint for an EnvCell portal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LandblockPortalEndpoint {
    /// Transition to another EnvCell in the same landblock.
    Internal {
        /// Raw authored local target-cell selector.
        other_cell_id: u16,
        /// Full target EnvCell DID.
        target_env_cell_id: u32,
        /// Raw authored target portal-vector selector.
        other_portal_id: u16,
        /// Reciprocal cross-link when the authored selector resolves and points back.
        validated_target: Option<LandblockEnvCellPortalRef>,
    },
    /// Transition from an EnvCell to the outdoor landblock.
    Outside {
        /// Raw authored target-cell selector.
        other_cell_id: u16,
        /// Raw authored target portal selector.
        other_portal_id: u16,
        /// Unique matching LandblockInfo building portal when one claims this endpoint.
        building_portal: Option<LandblockBuildingPortalRef>,
    },
}

/// Stable source reference to one LandblockInfo building portal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LandblockBuildingPortalRef {
    /// Stable building ordinal in `LandblockAsset.buildings`.
    pub building_index: usize,
    /// Authored building source DID needed for later aperture enrichment.
    pub building_source_did: u32,
    /// Stable portal ordinal in the building's portal vector.
    pub portal_index: usize,
}

/// Resolves the complete interior fanout without render preparation.
#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockInteriorSystemAssembler;

impl LandblockInteriorSystemAssembler {
    /// Resolves every EnvCell and deduplicated Environment referenced by `landblock`.
    pub fn assemble(
        self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        landblock: &LandblockAsset,
    ) -> Result<LandblockInteriorSystemAsset> {
        let mut decoded_cells = Vec::with_capacity(landblock.env_cell_refs.len());
        let mut environments = BTreeMap::new();
        for cell_ref in &landblock.env_cell_refs {
            let env_cell = decode_cache
                .env_cell(content, cell_ref.env_cell_id)
                .with_context(|| {
                    format!(
                        "Could not load required EnvCell 0x{:08X} for landblock 0x{:08X}",
                        cell_ref.env_cell_id, landblock.landblock_id
                    )
                })?;
            ensure!(
                env_cell.id == cell_ref.env_cell_id,
                "EnvCell source 0x{:08X} decoded record id 0x{:08X}",
                cell_ref.env_cell_id,
                env_cell.id
            );
            let environment_id = 0x0d00_0000 | u32::from(env_cell.environment_id);
            let environment = if let Some(environment) = environments.get(&environment_id) {
                Arc::clone(environment)
            } else {
                let environment = decode_cache
                    .environment(content, environment_id)
                    .with_context(|| {
                        format!(
                            "Could not load Environment 0x{environment_id:08X} for EnvCell 0x{:08X}",
                            env_cell.id
                        )
                    })?;
                ensure!(
                    environment.id == environment_id,
                    "Environment source 0x{environment_id:08X} decoded record id 0x{:08X}",
                    environment.id
                );
                environments.insert(environment_id, Arc::clone(&environment));
                environment
            };
            let local_selector = u32::from(env_cell.cell_structure);
            ensure!(
                environment.cells.contains_key(&local_selector),
                "Environment 0x{environment_id:08X} has no CellStruct selector 0x{local_selector:04X} required by EnvCell 0x{:08X}",
                env_cell.id
            );
            decoded_cells.push(env_cell);
        }

        let topology = build_portal_topology(landblock, &decoded_cells)?;
        let cells = decoded_cells
            .iter()
            .map(|env_cell| project_env_cell(landblock.landblock_id, env_cell))
            .collect();
        Ok(LandblockInteriorSystemAsset {
            landblock_id: landblock.landblock_id,
            cells,
            environments,
            topology,
        })
    }
}

fn project_env_cell(landblock_id: u32, env_cell: &EnvCell) -> LandblockEnvCell {
    LandblockEnvCell {
        env_cell_id: env_cell.id,
        flags: env_cell.flags,
        authored_cell_id: env_cell.cell_id,
        structure: LandblockCellStructureRef {
            environment_id: 0x0d00_0000 | u32::from(env_cell.environment_id),
            local_selector: u32::from(env_cell.cell_structure),
        },
        placement: LandblockPlacement {
            origin: env_cell.position.origin,
            orientation: env_cell.position.orientation,
        },
        surface_ids: env_cell
            .surfaces
            .iter()
            .map(|surface_id| 0x0800_0000 | u32::from(*surface_id))
            .collect(),
        visible_cell_ids: env_cell
            .visible_cells
            .iter()
            .map(|cell_id| (landblock_id & 0xffff_0000) | u32::from(*cell_id))
            .collect(),
        static_objects: env_cell
            .static_objects
            .iter()
            .enumerate()
            .map(|(source_index, object)| LandblockIndoorObject {
                source_index,
                source_did: object.stab_id,
                placement: LandblockPlacement {
                    origin: object.position.origin,
                    orientation: object.position.orientation,
                },
            })
            .collect(),
        restriction_object_id: env_cell.restriction_obj,
        seen_outside: (env_cell.flags & 0x01) != 0,
    }
}

fn build_portal_topology(
    landblock: &LandblockAsset,
    cells: &[Arc<EnvCell>],
) -> Result<LandblockPortalTopology> {
    let cells_by_id = cells
        .iter()
        .map(|cell| (cell.id, Arc::clone(cell)))
        .collect::<HashMap<_, _>>();
    let building_claims = build_building_portal_claims(landblock, &cells_by_id)?;
    let mut portals = Vec::new();

    for cell in cells {
        for (portal_index, portal) in cell.portals.iter().enumerate() {
            let source = LandblockEnvCellPortalRef {
                env_cell_id: cell.id,
                portal_index,
            };
            let endpoint = if (portal.flags & 0x04) != 0 {
                LandblockPortalEndpoint::Outside {
                    other_cell_id: portal.other_cell_id,
                    other_portal_id: portal.other_portal_id,
                    building_portal: building_claims.get(&source).copied(),
                }
            } else {
                let target_env_cell_id =
                    (landblock.landblock_id & 0xffff_0000) | u32::from(portal.other_cell_id);
                let target_cell = cells_by_id.get(&target_env_cell_id).with_context(|| {
                    format!(
                        "EnvCell 0x{:08X} portal {portal_index} targets missing EnvCell 0x{target_env_cell_id:08X}",
                        cell.id
                    )
                })?;
                let target_index = usize::from(portal.other_portal_id);
                let validated_target = target_cell
                    .portals
                    .get(target_index)
                    .filter(|target| {
                        (target.flags & 0x04) == 0
                            && ((landblock.landblock_id & 0xffff_0000)
                                | u32::from(target.other_cell_id))
                                == cell.id
                            && usize::from(target.other_portal_id) == portal_index
                    })
                    .map(|_| LandblockEnvCellPortalRef {
                        env_cell_id: target_env_cell_id,
                        portal_index: target_index,
                    });
                LandblockPortalEndpoint::Internal {
                    other_cell_id: portal.other_cell_id,
                    target_env_cell_id,
                    other_portal_id: portal.other_portal_id,
                    validated_target,
                }
            };
            portals.push(LandblockPortal {
                source,
                flags: portal.flags,
                polygon_id: portal.polygon_id,
                endpoint,
            });
        }
    }
    Ok(LandblockPortalTopology { portals })
}

fn build_building_portal_claims(
    landblock: &LandblockAsset,
    cells_by_id: &HashMap<u32, Arc<EnvCell>>,
) -> Result<HashMap<LandblockEnvCellPortalRef, LandblockBuildingPortalRef>> {
    let mut claims = HashMap::new();
    for building in &landblock.buildings {
        for portal in &building.portals {
            let target = building_portal_target(landblock, portal);
            let target_cell = cells_by_id.get(&target.env_cell_id).with_context(|| {
                format!(
                    "Landblock building {} portal {} targets missing EnvCell 0x{:08X}",
                    building.source_index, portal.source_index, target.env_cell_id
                )
            })?;
            let target_portal = target_cell.portals.get(target.portal_index).with_context(|| {
                format!(
                    "Landblock building {} portal {} targets missing portal {} in EnvCell 0x{:08X}",
                    building.source_index,
                    portal.source_index,
                    target.portal_index,
                    target.env_cell_id
                )
            })?;
            ensure!(
                (target_portal.flags & 0x04) != 0,
                "Landblock building {} portal {} targets non-outside EnvCell portal 0x{:08X}/{}",
                building.source_index,
                portal.source_index,
                target.env_cell_id,
                target.portal_index
            );
            let claim = LandblockBuildingPortalRef {
                building_index: building.source_index,
                building_source_did: building.source_did,
                portal_index: portal.source_index,
            };
            ensure!(
                claims.insert(target, claim).is_none(),
                "multiple building portals claim outside EnvCell portal 0x{:08X}/{}",
                target.env_cell_id,
                target.portal_index
            );
        }
    }
    Ok(claims)
}

fn building_portal_target(
    landblock: &LandblockAsset,
    portal: &LandblockBuildingPortal,
) -> LandblockEnvCellPortalRef {
    LandblockEnvCellPortalRef {
        env_cell_id: (landblock.landblock_id & 0xffff_0000) | u32::from(portal.other_cell_id),
        portal_index: usize::from(portal.other_portal_id),
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use binrw::BinWrite;
    use holtburger_dat::file_type::env_cell::CellPortal;
    use holtburger_dat::graphics::Frame;
    use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE};

    use crate::{
        LandblockBuilding, LandblockEnvCellRef, LandblockObjectSourceFamily, LandblockTerrain,
        test_support::CountingSource,
    };

    use super::*;

    #[test]
    fn topology_preserves_authored_records_and_validates_only_reciprocal_links() {
        let mut landblock = synthetic_landblock();
        landblock.buildings.push(LandblockBuilding {
            source_index: 0,
            source_did: 0x0100_1234,
            source_family: LandblockObjectSourceFamily::GfxObj,
            placement: synthetic_placement(),
            num_leaves: 0,
            portals: vec![LandblockBuildingPortal {
                source_index: 0,
                flags: 0x04,
                other_cell_id: 0x0100,
                other_portal_id: 1,
                stab_cell_ids: vec![0x0100],
                linked_env_cell_ids: vec![0xda55_0100],
            }],
        });
        let cells = vec![
            Arc::new(synthetic_env_cell(
                0xda55_0100,
                vec![internal_portal(10, 0x0101, 0), outside_portal(11, 0, 0)],
            )),
            Arc::new(synthetic_env_cell(
                0xda55_0101,
                vec![
                    internal_portal(20, 0x0100, 0),
                    internal_portal(21, 0x0100, 9),
                    outside_portal(22, 0, 0),
                ],
            )),
        ];

        let topology =
            build_portal_topology(&landblock, &cells).expect("synthetic topology should resolve");

        assert_eq!(topology.portals.len(), 5);
        assert_eq!(
            topology.portals[0].endpoint,
            LandblockPortalEndpoint::Internal {
                other_cell_id: 0x0101,
                target_env_cell_id: 0xda55_0101,
                other_portal_id: 0,
                validated_target: Some(LandblockEnvCellPortalRef {
                    env_cell_id: 0xda55_0101,
                    portal_index: 0,
                }),
            }
        );
        assert_eq!(
            topology.portals[1].endpoint,
            LandblockPortalEndpoint::Outside {
                other_cell_id: 0,
                other_portal_id: 0,
                building_portal: Some(LandblockBuildingPortalRef {
                    building_index: 0,
                    building_source_did: 0x0100_1234,
                    portal_index: 0,
                }),
            }
        );
        assert_eq!(
            topology.portals[3].endpoint,
            LandblockPortalEndpoint::Internal {
                other_cell_id: 0x0100,
                target_env_cell_id: 0xda55_0100,
                other_portal_id: 9,
                validated_target: None,
            }
        );
        assert_eq!(
            topology.portals[4].endpoint,
            LandblockPortalEndpoint::Outside {
                other_cell_id: 0,
                other_portal_id: 0,
                building_portal: None,
            }
        );
    }

    #[test]
    fn topology_rejects_missing_internal_cells_and_invalid_building_claims() {
        let landblock = synthetic_landblock();
        let missing_target = vec![Arc::new(synthetic_env_cell(
            0xda55_0100,
            vec![internal_portal(10, 0x0101, 0)],
        ))];
        let error = build_portal_topology(&landblock, &missing_target)
            .expect_err("missing internal target cells should fail");
        assert!(error.to_string().contains("targets missing EnvCell"));

        let mut claimed_landblock = synthetic_landblock();
        claimed_landblock.buildings.push(LandblockBuilding {
            source_index: 0,
            source_did: 0x0100_1234,
            source_family: LandblockObjectSourceFamily::GfxObj,
            placement: synthetic_placement(),
            num_leaves: 0,
            portals: vec![LandblockBuildingPortal {
                source_index: 0,
                flags: 0x04,
                other_cell_id: 0x0100,
                other_portal_id: 0,
                stab_cell_ids: vec![0x0100],
                linked_env_cell_ids: vec![0xda55_0100],
            }],
        });
        let non_outside_target = vec![Arc::new(synthetic_env_cell(
            0xda55_0100,
            vec![internal_portal(10, 0x0100, 0)],
        ))];
        let error = build_portal_topology(&claimed_landblock, &non_outside_target)
            .expect_err("building claims must target outside portals");
        assert!(
            error
                .to_string()
                .contains("targets non-outside EnvCell portal")
        );
    }

    #[test]
    fn interior_assembly_deduplicates_environment_ownership() {
        let environment_id = 0x0d00_0001;
        let first_cell = synthetic_env_cell(0xda55_0100, Vec::new());
        let second_cell = EnvCell {
            id: 0xda55_0101,
            cell_id: 0xda55_0101,
            cell_structure: 0x11,
            ..synthetic_env_cell(0xda55_0101, Vec::new())
        };
        let source = Arc::new(CountingSource::new(HashMap::from([
            (
                (EOR_CELL_NAMESPACE.to_string(), first_cell.id),
                pack_env_cell(&first_cell),
            ),
            (
                (EOR_CELL_NAMESPACE.to_string(), second_cell.id),
                pack_env_cell(&second_cell),
            ),
            (
                (EOR_PORTAL_NAMESPACE.to_string(), environment_id),
                minimal_environment_bytes(environment_id, &[0x10, 0x11]),
            ),
        ])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let decode_cache = ContentDecodeCache::new();
        let mut landblock = synthetic_landblock();
        landblock.env_cell_refs = vec![
            LandblockEnvCellRef {
                source_index: 0,
                env_cell_id: first_cell.id,
            },
            LandblockEnvCellRef {
                source_index: 1,
                env_cell_id: second_cell.id,
            },
        ];

        let asset = LandblockInteriorSystemAssembler
            .assemble(&repository, &decode_cache, &landblock)
            .expect("complete synthetic interior should assemble");

        assert_eq!(asset.cells.len(), 2);
        assert_eq!(asset.environments.len(), 1);
        assert_eq!(source.read_count(EOR_PORTAL_NAMESPACE, environment_id), 1);
        let cached_environment = decode_cache
            .environment(&repository, environment_id)
            .expect("environment should remain in the shared decode cache");
        assert!(Arc::ptr_eq(
            asset
                .environments
                .get(&environment_id)
                .expect("interior should retain the shared environment"),
            &cached_environment
        ));
        assert_eq!(
            asset.cells[1].structure,
            LandblockCellStructureRef {
                environment_id,
                local_selector: 0x11,
            }
        );
    }

    fn synthetic_landblock() -> LandblockAsset {
        LandblockAsset {
            landblock_id: 0xda55_ffff,
            terrain: LandblockTerrain {
                grid_size: 9,
                tile_size: 24.0,
                height_indices: vec![0; 81],
                heights: vec![0.0; 81],
                terrain_samples: vec![0; 81],
                cell_diagonals: crate::TerrainCellDiagonals::for_landblock(0xda55_ffff),
            },
            explicit_objects: Vec::new(),
            buildings: Vec::new(),
            env_cell_refs: Vec::new(),
            restrictions: Vec::new(),
        }
    }

    fn synthetic_env_cell(id: u32, portals: Vec<CellPortal>) -> EnvCell {
        EnvCell {
            id,
            flags: 0,
            cell_id: id,
            surfaces: vec![1, 2],
            environment_id: 1,
            cell_structure: 0x10,
            position: Frame::default(),
            portals,
            visible_cells: Vec::new(),
            static_objects: Vec::new(),
            restriction_obj: None,
        }
    }

    fn synthetic_placement() -> LandblockPlacement {
        LandblockPlacement {
            origin: holtburger_common::Vector3::zero(),
            orientation: holtburger_common::Quaternion::identity(),
        }
    }

    fn internal_portal(polygon_id: u16, other_cell_id: u16, other_portal_id: u16) -> CellPortal {
        CellPortal {
            flags: 0,
            polygon_id,
            other_cell_id,
            other_portal_id,
        }
    }

    fn outside_portal(polygon_id: u16, other_cell_id: u16, other_portal_id: u16) -> CellPortal {
        CellPortal {
            flags: 0x04,
            polygon_id,
            other_cell_id,
            other_portal_id,
        }
    }

    fn pack_env_cell(cell: &EnvCell) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        cell.pack(&mut bytes)
            .expect("synthetic EnvCell should pack");
        bytes.into_inner()
    }

    fn minimal_environment_bytes(environment_id: u32, selectors: &[u32]) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        environment_id
            .write_le(&mut bytes)
            .expect("environment id should write");
        (selectors.len() as u32)
            .write_le(&mut bytes)
            .expect("cell count should write");
        for selector in selectors {
            selector
                .write_le(&mut bytes)
                .expect("cell selector should write");
            0u32.write_le(&mut bytes)
                .expect("polygon count should write");
            0u32.write_le(&mut bytes)
                .expect("physics polygon count should write");
            0u32.write_le(&mut bytes)
                .expect("portal count should write");
            1i32.write_le(&mut bytes).expect("vertex type should write");
            0u32.write_le(&mut bytes)
                .expect("vertex count should write");

            bytes.write_all(b"FAEL").expect("cell BSP tag should write");
            0i32.write_le(&mut bytes)
                .expect("cell BSP leaf index should write");

            bytes
                .write_all(b"FAEL")
                .expect("physics BSP tag should write");
            0i32.write_le(&mut bytes)
                .expect("physics BSP leaf index should write");
            0i32.write_le(&mut bytes)
                .expect("physics BSP solid flag should write");
            for _ in 0..4 {
                0f32.write_le(&mut bytes)
                    .expect("physics BSP sphere component should write");
            }
            0u32.write_le(&mut bytes)
                .expect("physics BSP polygon count should write");
            0u32.write_le(&mut bytes)
                .expect("drawing BSP presence should write");
        }
        bytes.into_inner()
    }
}
