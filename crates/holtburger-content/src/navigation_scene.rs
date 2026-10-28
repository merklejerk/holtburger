//! Prepared empty-room scenes, projected into the existing collision/containment products.
//!
//! This layer owns archive decoding and shared geometry residency, never movement policy. The
//! simulation coordinator continues to own scene scheduling and active landblock retention.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result, ensure};

use crate::{
    CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale, LandblockColliders,
    LandblockCollisionAsset, LandblockSceneClass, OutdoorBuildingTransit, PlacedCollider,
    StaticColliderPlacement, TerrainCollisionSurface,
    navigation_bundle::{
        NavigationArchive, NavigationCell, NavigationRoomGeometry, NavigationTerrain,
    },
    normalize_landblock_id,
};

type EnvironmentGeometry = BTreeMap<u32, NavigationRoomGeometry>;

/// Thread-safe prepared navigation source, with immutable shapes shared across cell instances.
pub struct NavigationSceneSource {
    archive: NavigationArchive,
    /// Source Environment identities bound this cache; the full corpus has 769 small chunks.
    environments: Mutex<BTreeMap<u32, Arc<EnvironmentGeometry>>>,
}

impl NavigationSceneSource {
    /// Uses an already selected archive; callers verify its bootstrap companion when opening it.
    pub fn new(archive: NavigationArchive) -> Self {
        Self {
            archive,
            environments: Mutex::new(BTreeMap::new()),
        }
    }

    /// Resolves geographic coverage without loading room structures or retail records.
    pub fn load_scene_class(&self, raw_owner: u32) -> Result<Option<LandblockSceneClass>> {
        Ok(self
            .archive
            .terrain(normalize_landblock_id(raw_owner))?
            .map(|terrain| terrain.scene_class))
    }

    /// Loads terrain, placed room shells, and containment; missing coverage returns `None`.
    /// Missing references inside available coverage are errors, never open space.
    pub fn load_collision(&self, raw_owner: u32) -> Result<Option<LandblockCollisionAsset>> {
        let owner = normalize_landblock_id(raw_owner);
        let Some(terrain) = self.archive.terrain(owner)? else {
            return Ok(None);
        };
        let cells = match self.archive.cells(owner)? {
            Some(cells) => cells,
            None if terrain.scene_class == LandblockSceneClass::OutdoorOnly => Vec::new(),
            None => anyhow::bail!("navigation owner 0x{owner:08X} is missing its cell block"),
        };
        ensure!(
            cells.is_empty() == (terrain.scene_class == LandblockSceneClass::OutdoorOnly),
            "navigation owner 0x{owner:08X} cell coverage contradicts its scene class"
        );
        let claims = building_claims(&terrain, &cells)?;
        let mut colliders = Vec::new();
        let mut volumes = Vec::with_capacity(cells.len());
        for cell in &cells {
            let environment = self.environment(cell.structure.environment_id)?;
            let room = environment
                .get(&cell.structure.local_selector)
                .with_context(|| {
                    format!(
                        "navigation cell {:08X}/{:04X} references missing structure {:?}",
                        owner, cell.selector, cell.structure
                    )
                })?;
            if let Some(shape) = &room.shell {
                colliders.push(PlacedCollider::new(
                    Arc::clone(shape),
                    cell.placement,
                    ColliderScale::uniform(1.0)?,
                    StaticColliderPlacement::EnvCellShell {
                        cell_id: (owner & 0xffff_0000) | u32::from(cell.selector),
                    },
                )?);
            }
            let portals = cell.portals.iter().enumerate().map(|(index, portal)| {
                let aperture = room.portals.get(&portal.polygon_id).with_context(|| {
                    format!("navigation cell {:08X}/{:04X} portal {index} has no aperture {}",
                        owner, cell.selector, portal.polygon_id)
                })?;
                let target = if portal.flags & 0x04 != 0 {
                    CellCollisionPortalTarget::Outdoor
                } else {
                    ensure!(cells.binary_search_by_key(&portal.other_cell_id, |cell| cell.selector).is_ok(),
                        "navigation cell {:08X}/{:04X} portal {index} targets missing cell {:04X}",
                        owner, cell.selector, portal.other_cell_id);
                    CellCollisionPortalTarget::EnvCell(portal.other_cell_id)
                };
                Ok(CellCollisionPortal {
                    plane: aperture.plane,
                    aperture_vertices: aperture.vertices.clone(),
                    // Reciprocal clipping is a visibility product, not a contact/traversal input.
                    reciprocal_visibility_vertices: None,
                    positive_side: portal.flags & 0x02 == 0,
                    target,
                    outdoor_building: claims.get(&(cell.selector, index)).copied(),
                })
            }).collect::<Result<Vec<_>>>()?;
            volumes.push(CellVolume {
                cell_selector: cell.selector,
                placement: cell.placement,
                planes: room.planes.clone(),
                portals,
            });
        }
        let surface = match terrain.scene_class {
            LandblockSceneClass::DungeonOnly => TerrainCollisionSurface::empty(),
            LandblockSceneClass::OutdoorOnly | LandblockSceneClass::OutdoorWithEnvCells => {
                TerrainCollisionSurface::from_terrain(&terrain.terrain)?
            }
        };
        Ok(Some(LandblockCollisionAsset {
            landblock_id: owner,
            terrain: surface,
            static_geometry: LandblockColliders::new(colliders, volumes),
        }))
    }

    fn environment(&self, id: u32) -> Result<Arc<EnvironmentGeometry>> {
        if let Some(rooms) = self
            .environments
            .lock()
            .expect("navigation geometry cache lock should not be poisoned")
            .get(&id)
        {
            return Ok(Arc::clone(rooms));
        }
        // Positioned reads and decoding do not hold the cache lock. If workers race, return the
        // first inserted product so every instance still shares the same immutable shapes.
        let rooms = Arc::new(
            self.archive
                .room_geometry(id)?
                .with_context(|| format!("navigation is missing Environment 0x{id:08X}"))?,
        );
        Ok(Arc::clone(
            self.environments
                .lock()
                .expect("navigation geometry cache lock should not be poisoned")
                .entry(id)
                .or_insert(rooms),
        ))
    }
}

fn building_claims(
    terrain: &NavigationTerrain,
    cells: &[NavigationCell],
) -> Result<BTreeMap<(u16, usize), OutdoorBuildingTransit>> {
    let mut claims = BTreeMap::new();
    for (building_index, building) in terrain.buildings.iter().enumerate() {
        for portal in &building.portals {
            let target = cells
                .binary_search_by_key(&portal.other_cell_id, |cell| cell.selector)
                .ok()
                .and_then(|index| cells.get(index))
                .with_context(|| {
                    format!(
                        "navigation building {building_index} targets missing cell {:04X}",
                        portal.other_cell_id
                    )
                })?;
            let portal_index = usize::from(portal.other_portal_id);
            let entry = target.portals.get(portal_index).with_context(|| {
                format!(
                    "navigation building {building_index} targets missing portal {portal_index}"
                )
            })?;
            ensure!(
                entry.flags & 0x04 != 0,
                "navigation building {building_index} targets a non-outside portal"
            );
            ensure!(
                claims
                    .insert(
                        (target.selector, portal_index),
                        OutdoorBuildingTransit {
                            building_index,
                            building_origin: building.placement.origin,
                        }
                    )
                    .is_none(),
                "multiple navigation buildings claim cell {:04X} portal {portal_index}",
                target.selector
            );
        }
    }
    Ok(claims)
}

#[cfg(test)]
mod tests;
