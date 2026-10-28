//! Version-one prepared product schema. Field/variant changes require a format review.
//!
//! Geometry wire records describe resolved runtime geometry, not retail byte layouts. Ordered
//! vectors/maps make generation deterministic; no model/render resources are decoded on read.

use std::{collections::BTreeMap, sync::Arc};

use holtburger_common::{Plane, Sphere, Vector3};
use holtburger_dat::physics::{BspLeaf, BspNode, BspPortal, InternalNode, PortalPoly};
use serde::{Deserialize, Serialize};

use super::{
    NavigationArchive, NavigationArchiveError, NavigationArchiveWriter, NavigationBlockKey,
    NavigationBlockKind, Result,
};
use crate::{
    BspSolid, CollisionBox, CollisionPolygon, CollisionShape, LandblockCellStructureRef,
    LandblockPlacement, LandblockSceneClass, LandblockTerrain, TerrainCellDiagonals,
};

/// One placed cell's navigation facts. Visual references and object placements are excluded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationCell {
    /// Low-word cell identity within the block's normalized owner.
    pub selector: u16,
    /// Authored cell flags, with the stripped static-object bit cleared.
    pub flags: u32,
    /// Source-authored identity, retained independently from the archive key for inspection.
    pub authored_cell_id: u32,
    /// Shared structure containing this cell's shell and containment geometry.
    pub structure: LandblockCellStructureRef,
    /// Authored placement in the owner's coordinate frame, including negative coordinates.
    pub placement: LandblockPlacement,
    /// Ordered authored portal connections; geometry resides in the shared structure.
    pub portals: Vec<NavigationPortalConnection>,
    /// Preserved restriction identity; no restriction model is loaded as an obstacle.
    pub restriction_object_id: Option<u32>,
}

/// Per-instance portal semantics, separate from the structure's shared aperture geometry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationPortalConnection {
    /// Authored side/exact/outside flags.
    pub flags: u16,
    /// Polygon identity within the shared room structure.
    pub polygon_id: u16,
    /// Target local cell selector, or authored outdoor marker.
    pub other_cell_id: u16,
    /// Reciprocal portal-vector selector for graph validation and inspection.
    pub other_portal_id: u16,
}

/// Resolved aperture in a room structure's local coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationPortalGeometry {
    /// Authored aperture plane used by traversal.
    pub plane: Plane,
    /// Resolved ordered polygon corners; no source vertex array lookup is needed.
    pub vertices: Vec<Vector3>,
}

/// Immutable room geometry shared by every cell referencing one Environment structure.
#[derive(Debug, Clone)]
pub struct NavigationRoomGeometry {
    /// Convex cell-BSP containment planes, independent of physics contacts.
    pub planes: Vec<Plane>,
    /// Prepared physics BSP, absent when the structure has no physical shell.
    pub shell: Option<Arc<CollisionShape>>,
    /// Resolved apertures keyed by source polygon identity.
    pub portals: BTreeMap<u16, NavigationPortalGeometry>,
}

/// Outdoor facts needed by the reduced scene, already resolved from region/source records.
#[derive(Debug, Clone)]
pub struct NavigationTerrain {
    /// Canonical classification used for geographic demand and activation.
    pub scene_class: LandblockSceneClass,
    /// Resolved terrain heights, material/water samples, and triangulation.
    pub terrain: LandblockTerrain,
    /// Ordered building registrations needed to associate outdoor entrances with cell portals.
    pub buildings: Vec<NavigationBuilding>,
    /// Authored restriction lookup, preserved without resolving restriction object models.
    pub restrictions: BTreeMap<u32, u32>,
}

/// Building transition metadata; model geometry and visual identity are deliberately excluded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationBuilding {
    /// Authored landblock-local building placement used by entrance registration.
    pub placement: LandblockPlacement,
    /// Ordered entrance records; their indices retain authored portal identity.
    pub portals: Vec<NavigationBuildingPortal>,
}

/// One building's registration of a cell-to-outdoor portal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationBuildingPortal {
    /// Authored transition flags.
    pub flags: u16,
    /// Local indoor destination selector.
    pub other_cell_id: u16,
    /// Portal-vector selector in that destination cell.
    pub other_portal_id: u16,
    /// Authored linked cell selectors used by entrance/topology inspection.
    pub linked_cells: Vec<u16>,
}

/// Stable version-one tree schema, preserving all runtime physics-node facts.
#[derive(Serialize, Deserialize)]
enum TreeWire {
    Portal {
        plane: Plane,
        positive: Box<TreeWire>,
        negative: Box<TreeWire>,
        sphere: Option<Sphere>,
        polygons: Vec<u16>,
        portal_polygons: Vec<(i16, i16)>,
    },
    Leaf {
        index: i32,
        solid: i32,
        sphere: Option<Sphere>,
        polygons: Vec<u16>,
    },
    Internal {
        tag: [u8; 4],
        plane: Plane,
        positive: Option<Box<TreeWire>>,
        negative: Option<Box<TreeWire>>,
        sphere: Option<Sphere>,
        polygons: Vec<u16>,
    },
}

impl From<&BspNode> for TreeWire {
    fn from(node: &BspNode) -> Self {
        match node {
            BspNode::Port(node) => Self::Portal {
                plane: node.plane,
                positive: Box::new(Self::from(node.pos.as_ref())),
                negative: Box::new(Self::from(node.neg.as_ref())),
                sphere: node.sphere,
                polygons: node.poly_ids.clone(),
                portal_polygons: node
                    .portal_polys
                    .iter()
                    .map(|p| (p.poly_id, p.portal_index))
                    .collect(),
            },
            BspNode::Leaf(node) => Self::Leaf {
                index: node.index,
                solid: node.solid,
                sphere: node.sphere,
                polygons: node.poly_ids.clone(),
            },
            BspNode::Internal(node) => Self::Internal {
                tag: node.tag,
                plane: node.plane,
                positive: node.pos.as_deref().map(|n| Box::new(Self::from(n))),
                negative: node.neg.as_deref().map(|n| Box::new(Self::from(n))),
                sphere: node.sphere,
                polygons: node.poly_ids.clone(),
            },
        }
    }
}

impl From<TreeWire> for BspNode {
    fn from(node: TreeWire) -> Self {
        match node {
            TreeWire::Portal {
                plane,
                positive,
                negative,
                sphere,
                polygons,
                portal_polygons,
            } => Self::Port(BspPortal {
                plane,
                pos: Box::new(Self::from(*positive)),
                neg: Box::new(Self::from(*negative)),
                sphere,
                poly_ids: polygons,
                portal_polys: portal_polygons
                    .into_iter()
                    .map(|(poly_id, portal_index)| PortalPoly {
                        poly_id,
                        portal_index,
                    })
                    .collect(),
            }),
            TreeWire::Leaf {
                index,
                solid,
                sphere,
                polygons,
            } => Self::Leaf(BspLeaf {
                index,
                solid,
                sphere,
                poly_ids: polygons,
            }),
            TreeWire::Internal {
                tag,
                plane,
                positive,
                negative,
                sphere,
                polygons,
            } => Self::Internal(InternalNode {
                tag,
                plane,
                pos: positive.map(|n| Box::new(Self::from(*n))),
                neg: negative.map(|n| Box::new(Self::from(*n))),
                sphere,
                poly_ids: polygons,
            }),
        }
    }
}

/// Resolved polygon schema; normals and plane constants are not recomputed while loading.
#[derive(Serialize, Deserialize)]
struct PolygonWire {
    vertices: Vec<Vector3>,
    normal: Vector3,
    d: f32,
}

/// Prepared BSP schema with source-independent bounds and ordered physics polygons.
#[derive(Serialize, Deserialize)]
struct SolidWire {
    tree: TreeWire,
    sphere: Sphere,
    minimum: Vector3,
    maximum: Vector3,
    polygons: BTreeMap<u16, PolygonWire>,
}

impl SolidWire {
    fn from_shape(shape: &CollisionShape) -> Result<Self> {
        let solid = shape
            .as_bsp()
            .ok_or_else(|| NavigationArchiveError::Product("room shell must be a BSP".into()))?;
        Ok(Self {
            tree: TreeWire::from(&solid.bsp),
            sphere: solid.bounds,
            minimum: solid.box_bounds.minimum(),
            maximum: solid.box_bounds.maximum(),
            polygons: solid
                .polygons
                .iter()
                .map(|(id, p)| {
                    (
                        *id,
                        PolygonWire {
                            vertices: p.vertices.clone(),
                            normal: p.normal,
                            d: p.d,
                        },
                    )
                })
                .collect(),
        })
    }

    fn into_shape(self) -> Result<Arc<CollisionShape>> {
        if self.minimum.x > self.maximum.x
            || self.minimum.y > self.maximum.y
            || self.minimum.z > self.maximum.z
        {
            return Err(NavigationArchiveError::Product(
                "inverted room-shell bounds".into(),
            ));
        }
        let box_bounds = CollisionBox::from_points([self.minimum, self.maximum])
            .ok_or_else(|| NavigationArchiveError::Product("invalid room-shell bounds".into()))?;
        Ok(Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: BspNode::from(self.tree),
            bounds: self.sphere,
            box_bounds,
            polygons: self
                .polygons
                .into_iter()
                .map(|(id, p)| {
                    (
                        id,
                        CollisionPolygon {
                            vertices: p.vertices,
                            normal: p.normal,
                            d: p.d,
                        },
                    )
                })
                .collect(),
        })))
    }
}

/// A shared structure's complete reduced navigation product.
#[derive(Serialize, Deserialize)]
struct RoomWire {
    planes: Vec<Plane>,
    shell: Option<SolidWire>,
    portals: BTreeMap<u16, NavigationPortalGeometry>,
}

impl RoomWire {
    fn from_geometry(room: &NavigationRoomGeometry) -> Result<Self> {
        Ok(Self {
            planes: room.planes.clone(),
            shell: room
                .shell
                .as_deref()
                .map(SolidWire::from_shape)
                .transpose()?,
            portals: room.portals.clone(),
        })
    }

    fn into_geometry(self) -> Result<NavigationRoomGeometry> {
        Ok(NavigationRoomGeometry {
            planes: self.planes,
            shell: self.shell.map(SolidWire::into_shape).transpose()?,
            portals: self.portals,
        })
    }
}

/// Fixed version-one outdoor classification, avoiding dependency on enum source order.
#[derive(Serialize, Deserialize)]
enum SceneClassWire {
    Dungeon,
    Outdoor,
    Mixed,
}

/// Prepared terrain schema, retaining source samples and resolved triangulation.
#[derive(Serialize, Deserialize)]
struct TerrainWire {
    class: SceneClassWire,
    grid_size: u32,
    tile_size: f32,
    height_indices: Vec<u8>,
    heights: Vec<f32>,
    samples: Vec<u16>,
    diagonals: Vec<u8>,
    buildings: Vec<NavigationBuilding>,
    restrictions: BTreeMap<u32, u32>,
}

impl NavigationArchiveWriter {
    /// Writes sorted per-instance cell facts; the key carries their shared owner identity.
    pub fn add_cells(&mut self, owner: u32, cells: &[NavigationCell]) -> Result<()> {
        validate_cells(cells)?;
        self.add_block(
            NavigationBlockKey {
                kind: NavigationBlockKind::Cells,
                id: owner,
            },
            &rmp_serde::to_vec(cells)?,
        )
    }

    /// Writes prepared structures in stable selector order, sharing their source Environment key.
    pub fn add_room_geometry(
        &mut self,
        environment: u32,
        rooms: &BTreeMap<u32, NavigationRoomGeometry>,
    ) -> Result<()> {
        let wire = rooms
            .iter()
            .map(|(id, room)| Ok((*id, RoomWire::from_geometry(room)?)))
            .collect::<Result<BTreeMap<_, _>>>()?;
        self.add_block(
            NavigationBlockKey {
                kind: NavigationBlockKind::SharedGeometry,
                id: environment,
            },
            &rmp_serde::to_vec(&wire)?,
        )
    }

    /// Writes resolved outdoor facts without source DAT records or region lookups.
    pub fn add_terrain(&mut self, owner: u32, terrain: &NavigationTerrain) -> Result<()> {
        let t = &terrain.terrain;
        let wire = TerrainWire {
            class: match terrain.scene_class {
                LandblockSceneClass::DungeonOnly => SceneClassWire::Dungeon,
                LandblockSceneClass::OutdoorOnly => SceneClassWire::Outdoor,
                LandblockSceneClass::OutdoorWithEnvCells => SceneClassWire::Mixed,
            },
            grid_size: u32::try_from(t.grid_size).map_err(|_| NavigationArchiveError::Size)?,
            tile_size: t.tile_size,
            height_indices: t.height_indices.clone(),
            heights: t.heights.clone(),
            samples: t.terrain_samples.clone(),
            diagonals: t.cell_diagonals.to_cell_bytes(),
            buildings: terrain.buildings.clone(),
            restrictions: terrain.restrictions.clone(),
        };
        validate_terrain(&wire)?;
        self.add_block(
            NavigationBlockKey {
                kind: NavigationBlockKind::Terrain,
                id: owner,
            },
            &rmp_serde::to_vec(&wire)?,
        )
    }
}

impl NavigationArchive {
    /// Decodes the selected owner's cell instances, preserving portal-vector order.
    pub fn cells(&self, owner: u32) -> Result<Option<Vec<NavigationCell>>> {
        let Some(bytes) = self.read_block(NavigationBlockKey {
            kind: NavigationBlockKind::Cells,
            id: owner,
        })?
        else {
            return Ok(None);
        };
        let cells: Vec<NavigationCell> = rmp_serde::from_slice(&bytes)?;
        validate_cells(&cells)?;
        Ok(Some(cells))
    }

    /// Loads one Environment's prepared structures; callers cache the immutable shared result.
    pub fn room_geometry(
        &self,
        environment: u32,
    ) -> Result<Option<BTreeMap<u32, NavigationRoomGeometry>>> {
        let Some(bytes) = self.read_block(NavigationBlockKey {
            kind: NavigationBlockKind::SharedGeometry,
            id: environment,
        })?
        else {
            return Ok(None);
        };
        let wire: BTreeMap<u32, RoomWire> = rmp_serde::from_slice(&bytes)?;
        Ok(Some(
            wire.into_iter()
                .map(|(id, room)| Ok((id, room.into_geometry()?)))
                .collect::<Result<_>>()?,
        ))
    }

    /// Loads resolved terrain; source region data is not involved.
    pub fn terrain(&self, owner: u32) -> Result<Option<NavigationTerrain>> {
        let Some(bytes) = self.read_block(NavigationBlockKey {
            kind: NavigationBlockKind::Terrain,
            id: owner,
        })?
        else {
            return Ok(None);
        };
        let wire: TerrainWire = rmp_serde::from_slice(&bytes)?;
        let cell_diagonals = validate_terrain(&wire)?;
        Ok(Some(NavigationTerrain {
            scene_class: match wire.class {
                SceneClassWire::Dungeon => LandblockSceneClass::DungeonOnly,
                SceneClassWire::Outdoor => LandblockSceneClass::OutdoorOnly,
                SceneClassWire::Mixed => LandblockSceneClass::OutdoorWithEnvCells,
            },
            terrain: LandblockTerrain {
                grid_size: wire.grid_size as usize,
                tile_size: wire.tile_size,
                height_indices: wire.height_indices,
                heights: wire.heights,
                terrain_samples: wire.samples,
                cell_diagonals,
            },
            buildings: wire.buildings,
            restrictions: wire.restrictions,
        }))
    }
}

fn validate_cells(cells: &[NavigationCell]) -> Result<()> {
    if cells
        .windows(2)
        .any(|pair| pair[0].selector >= pair[1].selector)
    {
        return Err(NavigationArchiveError::Product(
            "cell selectors must be strictly increasing".into(),
        ));
    }
    Ok(())
}

fn validate_terrain(terrain: &TerrainWire) -> Result<TerrainCellDiagonals> {
    if terrain.grid_size as usize != crate::terrain_topology::TERRAIN_GRID_CELLS + 1 {
        return Err(NavigationArchiveError::Product(
            "unsupported terrain grid size".into(),
        ));
    }
    let count = (crate::terrain_topology::TERRAIN_GRID_CELLS + 1).pow(2);
    if terrain.height_indices.len() != count
        || terrain.heights.len() != count
        || terrain.samples.len() != count
    {
        return Err(NavigationArchiveError::Product(
            "terrain sample counts do not match the grid".into(),
        ));
    }
    if !terrain.tile_size.is_finite() || terrain.tile_size <= 0.0 {
        return Err(NavigationArchiveError::Product(
            "invalid terrain tile size".into(),
        ));
    }
    TerrainCellDiagonals::from_cell_bytes(&terrain.diagonals)
        .ok_or_else(|| NavigationArchiveError::Product("invalid terrain diagonal choices".into()))
}

#[cfg(test)]
mod tests;
