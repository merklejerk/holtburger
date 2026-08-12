//! Static solid collision geometry placed in a landblock.
//!
//! Retail collides a moving sphere against the physics BSP of each placed part
//! (`CPhysicsPart::find_obj_collisions`, `acclient.c:7214` `BSPTREE::check_walkable`), so solids
//! here are the authored `GfxObj.physics_bsp` trees positioned by their placements. Objects
//! without a physics BSP are not collision participants and are skipped rather than approximated
//! by their draw geometry.
//!
//! Shapes are shared by `GfxObj` identity: a landblock full of one tree holds one tree's BSP.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use holtburger_common::attachment::Placement;
use holtburger_common::{Plane, Quaternion, Sphere, Vector3};
use holtburger_dat::graphics::{CVertexArray, Polygon};
use holtburger_dat::physics::BspNode;

use crate::TerrainCollisionSurface;
use crate::landblock::{LandblockAsset, LandblockObjectSourceFamily, LandblockPlacement};
use crate::source_reader::ContentSourceReader;

/// One authored physics shape, shared by every placement that references it.
#[derive(Debug)]
pub struct CollisionShape {
    /// Physics BSP in object-local space.
    pub bsp: BspNode,
    /// Object-local bounding sphere from the BSP root, used for broad-phase rejection.
    pub bounds: Sphere,
    /// Object-local axis-aligned vertex bounds used by retail's static cell-shadow traversal.
    pub box_bounds: CollisionBox,
    /// Physics polygons keyed by the ids the BSP's leaves reference.
    ///
    /// Held beside the tree because the tree alone cannot answer what a body stands on: leaves
    /// carry polygon *ids*, and the geometry lives in the owning record's shared vertex array.
    pub polygons: HashMap<u16, CollisionPolygon>,
}

/// Axis-aligned bounds of one authored collision part in object-local space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CollisionBox {
    minimum: Vector3,
    maximum: Vector3,
}

impl CollisionBox {
    /// Resolves bounds from an authored vertex stream.
    pub fn from_points(points: impl IntoIterator<Item = Vector3>) -> Option<Self> {
        let mut points = points.into_iter();
        let first = points.next()?;
        let mut bounds = Self {
            minimum: first,
            maximum: first,
        };
        for point in points {
            bounds.minimum.x = bounds.minimum.x.min(point.x);
            bounds.minimum.y = bounds.minimum.y.min(point.y);
            bounds.minimum.z = bounds.minimum.z.min(point.z);
            bounds.maximum.x = bounds.maximum.x.max(point.x);
            bounds.maximum.y = bounds.maximum.y.max(point.y);
            bounds.maximum.z = bounds.maximum.z.max(point.z);
        }
        Some(bounds)
    }

    /// Returns all eight object-local corners.
    pub fn corners(self) -> [Vector3; 8] {
        let min = self.minimum;
        let max = self.maximum;
        [
            Vector3::new(min.x, min.y, min.z),
            Vector3::new(min.x, min.y, max.z),
            Vector3::new(min.x, max.y, min.z),
            Vector3::new(min.x, max.y, max.z),
            Vector3::new(max.x, min.y, min.z),
            Vector3::new(max.x, min.y, max.z),
            Vector3::new(max.x, max.y, min.z),
            Vector3::new(max.x, max.y, max.z),
        ]
    }
}

/// One physics polygon resolved into landblock-ready geometry.
///
/// Retail decides what a body can stand on by testing the **polygons** in a BSP leaf, not by asking
/// whether a region is solid (`BSPLeaf::find_walkable`, mirrored in ACE's
/// `ACE.Server/Physics/BSP/BSPLeaf.cs`). The authored records store polygons as vertex indices into
/// a shared array, so they are resolved once here rather than re-dereferenced per query.
#[derive(Debug, Clone)]
pub struct CollisionPolygon {
    /// Polygon corners in the shape's own authored space, in winding order.
    pub vertices: Vec<Vector3>,
    /// Outward plane normal.
    pub normal: Vector3,
    /// Plane constant, such that `normal . point + d == 0` on the plane.
    pub d: f32,
}

impl CollisionPolygon {
    /// Resolve a polygon's vertices and derive its plane.
    ///
    /// The authored record carries no plane — retail computes one when it builds the polygon — so
    /// it is derived here with Newell's method, which is stable for the non-planar-by-a-hair
    /// polygons authored geometry actually contains.
    fn resolve(polygon: &Polygon, vertices: &CVertexArray) -> Option<Self> {
        let points: Vec<Vector3> = polygon
            .vertex_ids
            .iter()
            .map(|id| vertices.vertices.get(id).map(|vertex| vertex.origin))
            .collect::<Option<_>>()?;
        if points.len() < 3 {
            return None;
        }

        let mut normal = Vector3::zero();
        for index in 0..points.len() {
            let current = points[index];
            let next = points[(index + 1) % points.len()];
            normal.x += (current.y - next.y) * (current.z + next.z);
            normal.y += (current.z - next.z) * (current.x + next.x);
            normal.z += (current.x - next.x) * (current.y + next.y);
        }
        if normal.length_squared() < 1e-12 {
            // A degenerate polygon has no plane to stand on.
            return None;
        }
        let normal = normal.normalize();
        let d = -normal.dot(&points[0]);
        Some(Self {
            vertices: points,
            normal,
            d,
        })
    }
}

/// Resolve every physics polygon of one authored record.
fn resolve_polygons(
    polygons: &HashMap<u16, Polygon>,
    vertices: &CVertexArray,
) -> HashMap<u16, CollisionPolygon> {
    polygons
        .iter()
        .filter_map(|(id, polygon)| {
            CollisionPolygon::resolve(polygon, vertices).map(|resolved| (*id, resolved))
        })
        .collect()
}

/// Component-wise geometry scale applied to one placed collision shape.
///
/// SetupModel default part scales are vectors, and retail composes them component-wise with the
/// whole-object scale (`CPartArray::SetScaleInternal`, `acclient.c:313765`). Collapsing this to a
/// scalar silently changes authored collision on hundreds of setup models.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ColliderScale {
    components: Vector3,
}

impl ColliderScale {
    /// Builds a uniform positive scale.
    pub fn uniform(value: f32) -> Result<Self> {
        Self::from_components(Vector3::new(value, value, value))
    }

    /// Builds a finite, component-wise positive scale.
    pub fn from_components(components: Vector3) -> Result<Self> {
        ensure!(
            components.x.is_finite()
                && components.y.is_finite()
                && components.z.is_finite()
                && components.x > 0.0
                && components.y > 0.0
                && components.z > 0.0,
            "collision scale must contain finite positive components; got {components:?}"
        );
        Ok(Self { components })
    }

    /// Returns the authored component scale.
    pub fn components(self) -> Vector3 {
        self.components
    }

    fn apply(self, value: Vector3) -> Vector3 {
        Vector3::new(
            value.x * self.components.x,
            value.y * self.components.y,
            value.z * self.components.z,
        )
    }

    fn inverse_apply(self, value: Vector3) -> Vector3 {
        Vector3::new(
            value.x / self.components.x,
            value.y / self.components.y,
            value.z / self.components.z,
        )
    }

    fn compose(self, local: Vector3) -> Result<Self> {
        Self::from_components(self.apply(local))
    }

    fn maximum_component(self) -> f32 {
        self.components
            .x
            .max(self.components.y)
            .max(self.components.z)
    }
}

/// Stable authored placement shared by every collidable part of one static object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum StaticColliderPlacement {
    /// Explicit scenery authored in `LandblockInfo.objects`.
    OutdoorExplicit {
        /// Stable ordinal in the source object vector.
        source_index: usize,
    },
    /// Deterministically generated scenery supplied by terrain generation.
    OutdoorGenerated {
        /// Stable ordinal in the generated placement stream.
        source_index: usize,
    },
    /// Building model authored in `LandblockInfo.buildings`.
    BuildingShell {
        /// Stable ordinal in the source building vector.
        source_index: usize,
    },
    /// Physics shell authored by one EnvCell.
    EnvCellShell {
        /// Full source EnvCell DID.
        cell_id: u32,
    },
    /// Furniture, fixture, or prop authored by one EnvCell.
    IndoorStatic {
        /// Full source EnvCell DID.
        source_cell_id: u32,
        /// Stable ordinal in the source EnvCell's static-object vector.
        source_index: usize,
    },
}

/// One placed instance of a shared shape, in landblock-local space.
#[derive(Debug, Clone)]
pub struct PlacedCollider {
    /// Shared authored shape.
    pub shape: Arc<CollisionShape>,
    /// Landblock-local placement of the shape's origin.
    pub placement: LandblockPlacement,
    /// Component-wise scale applied to the shape.
    pub scale: ColliderScale,
    /// Landblock-local bounding sphere, precomputed for broad-phase rejection.
    pub bounds_center: Vector3,
    /// Landblock-local bounding radius, including scale.
    pub bounds_radius: f32,
    /// Authored placement identity used to compile runtime cell residency for every part together.
    pub source_placement: StaticColliderPlacement,
}

impl PlacedCollider {
    /// Transforms an object-local normal with the inverse-transpose scale rule.
    pub fn normal_to_landblock_space(&self, object_normal: Vector3) -> Vector3 {
        self.placement
            .orientation
            .rotate_vector(self.scale.inverse_apply(object_normal))
            .normalize()
    }

    /// Transform an object-local point back into landblock-local space.
    pub fn point_to_landblock_space(&self, object_point: Vector3) -> Vector3 {
        let scaled = self.scale.apply(object_point);
        let rotated = self.placement.orientation.rotate_vector(scaled);
        Vector3::new(
            rotated.x + self.placement.origin.x,
            rotated.y + self.placement.origin.y,
            rotated.z + self.placement.origin.z,
        )
    }
}

/// One interior cell's convex containment volume, in its own authored space.
///
/// Retail decides which cell a point occupies with `CCellStruct::point_in_cell`
/// (`acclient.c:340848`), which walks the **cell** BSP — not the physics BSP — down its `pos_node`
/// spine and rejects the point as soon as it falls strictly behind a splitting plane. That makes a
/// cell a convex region, so the whole test reduces to the list of planes along that spine and no
/// tree needs to be retained.
#[derive(Debug, Clone)]
pub struct CellVolume {
    /// Landblock-local cell selector: the low word of the position's landblock id.
    pub cell_selector: u16,
    /// Placement of the cell's authored space within the landblock.
    pub placement: LandblockPlacement,
    /// Splitting planes along the cell BSP's positive spine, in the cell's authored space.
    pub planes: Vec<Plane>,
    /// Authored collision portals in source order.
    pub portals: Vec<CellCollisionPortal>,
}

/// One cell portal enriched with the source-cell plane needed by collision traversal.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CellCollisionPortal {
    /// Authored portal plane in the source CellStruct's local frame.
    pub plane: Plane,
    /// Side selected by retail's static part-bound traversal.
    pub positive_side: bool,
    /// Cell domain reached through the portal.
    pub target: CellCollisionPortalTarget,
    /// Building registration that lets an outdoor static enter through this portal.
    ///
    /// Present only for outside portals claimed by one `LandblockInfo` building portal. Retail
    /// first requires a static's part box to shadow the outdoor land cell containing this origin.
    pub outdoor_building: Option<OutdoorBuildingTransit>,
}

/// Source building facts needed by retail's outdoor-to-interior static shadow traversal.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OutdoorBuildingTransit {
    /// Stable ordinal in `LandblockInfo.buildings`.
    pub building_index: usize,
    /// Authored building origin in its owning landblock's local frame.
    pub building_origin: Vector3,
}

/// Collision-domain endpoint of an authored EnvCell portal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CellCollisionPortalTarget {
    /// Outdoor land cells surrounding the interior system.
    Outdoor,
    /// Another EnvCell in the same landblock, stored by its local selector.
    EnvCell(u16),
}

/// Collect the splitting planes along a cell BSP's positive spine.
fn cell_spine_planes(root: &BspNode) -> Vec<Plane> {
    let mut planes = Vec::new();
    let mut node = root;
    loop {
        let (plane, positive) = match node {
            BspNode::Port(portal) => (portal.plane, Some(portal.pos.as_ref())),
            BspNode::Internal(internal) => (internal.plane, internal.pos.as_deref()),
            // A leaf ends the spine and contributes no plane.
            BspNode::Leaf(_) => break,
        };
        planes.push(plane);
        match positive {
            Some(next) => node = next,
            None => break,
        }
    }
    planes
}

/// Every static solid authored or generated for one landblock.
#[derive(Debug, Clone, Default)]
pub struct LandblockColliders {
    /// Placements in assembly order.
    pub colliders: Vec<PlacedCollider>,
    /// Interior cell volumes, empty for a landblock assembled without interiors.
    ///
    /// Kept beside the colliders because they are resolved from the same authored records in the
    /// same pass, and a consumer that has one always wants the other.
    pub cell_volumes: Vec<CellVolume>,
}

/// One atomically assembled static collision product for an outdoor landblock and its interiors.
#[derive(Debug, Clone)]
pub struct LandblockCollisionAsset {
    /// Normalized owning CellLandblock DID.
    pub landblock_id: u32,
    /// Terrain triangles built from the same topology facts sent to the renderer.
    pub terrain: TerrainCollisionSurface,
    /// Every placed static shape and interior containment volume.
    pub static_geometry: LandblockColliders,
}

impl LandblockColliders {
    /// Absorb another assembly's colliders and cell volumes.
    ///
    /// Exists because merging by hand went wrong exactly once and silently: a caller extended
    /// `colliders` and forgot `cell_volumes`, leaving a scene with interior geometry but no cells.
    /// Nothing failed — an empty vector is a valid landblock with no interiors — and the effect was
    /// that building shells never conceded at doorways and no body ever reported an interior cell.
    /// Every field of this type has to travel together, so the merge belongs to the type.
    fn absorb(&mut self, other: LandblockColliders) {
        self.colliders.extend(other.colliders);
        self.cell_volumes.extend(other.cell_volumes);
    }
}

/// Assembles placed collision shapes over an already assembled shallow landblock.
#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockColliderAssembler;

impl LandblockColliderAssembler {
    /// Resolves every outdoor and interior collision participant as one atomic artifact.
    pub fn assemble(
        self,
        content: &crate::ContentRepository,
        decode_cache: &crate::ContentDecodeCache,
        landblock: &LandblockAsset,
        generated_placements: &[(u32, LandblockObjectSourceFamily, LandblockPlacement, f32)],
        interior: &crate::LandblockInteriorSystemAsset,
    ) -> Result<LandblockColliders> {
        let mut complete =
            self.assemble_outdoor(content, decode_cache, landblock, generated_placements)?;
        complete.absorb(self.assemble_interior(content, decode_cache, landblock, interior)?);
        Ok(complete)
    }

    /// Resolves every outdoor collision participant placed in one landblock.
    ///
    /// `generated_placements` carries generated scenery, which participates in collision exactly
    /// as authored statics do; the caller supplies it because scenery generation is its own
    /// assembly step with its own inputs.
    fn assemble_outdoor(
        self,
        content: &crate::ContentRepository,
        decode_cache: &crate::ContentDecodeCache,
        landblock: &LandblockAsset,
        generated_placements: &[(u32, LandblockObjectSourceFamily, LandblockPlacement, f32)],
    ) -> Result<LandblockColliders> {
        let mut reader = ContentSourceReader::with_decode_cache(content, decode_cache);
        let mut shapes = ShapeCache::default();
        let mut colliders = Vec::new();

        for object in &landblock.explicit_objects {
            append_placement(
                &mut reader,
                &mut shapes,
                &mut colliders,
                StaticPlacementInput {
                    source_did: object.source_did,
                    family: object.source_family,
                    placement: object.placement,
                    whole_object_scale: 1.0,
                    identity: StaticColliderPlacement::OutdoorExplicit {
                        source_index: object.source_index,
                    },
                },
            )?;
        }
        for (source_index, (source_did, family, placement, scale)) in
            generated_placements.iter().enumerate()
        {
            append_placement(
                &mut reader,
                &mut shapes,
                &mut colliders,
                StaticPlacementInput {
                    source_did: *source_did,
                    family: *family,
                    placement: *placement,
                    whole_object_scale: *scale,
                    identity: StaticColliderPlacement::OutdoorGenerated { source_index },
                },
            )?;
        }
        // Buildings are placed models like any other, and their shells are what stops a body at an
        // exterior wall. They are authored in their own `LandblockInfo` vector rather than among
        // the explicit objects, which is the only reason they were missed: a landblock's interior
        // cells were collidable while the building around them was not, so a body could walk in
        // through a wall and then stand on the floor inside.
        for building in &landblock.buildings {
            append_placement(
                &mut reader,
                &mut shapes,
                &mut colliders,
                StaticPlacementInput {
                    source_did: building.source_did,
                    family: building.source_family,
                    placement: building.placement,
                    whole_object_scale: 1.0,
                    identity: StaticColliderPlacement::BuildingShell {
                        source_index: building.source_index,
                    },
                },
            )?;
        }

        Ok(LandblockColliders {
            colliders,
            cell_volumes: Vec::new(),
        })
    }

    /// Resolve the collision shapes of one landblock's interior cells.
    ///
    /// Interior geometry is the same thing as object geometry to a solver: a physics BSP placed by
    /// a frame. Cells therefore register as ordinary colliders rather than through a parallel
    /// indoor collision model, which is what lets a body walk from terrain onto an interior floor
    /// without the solver knowing the difference.
    fn assemble_interior(
        self,
        content: &crate::ContentRepository,
        decode_cache: &crate::ContentDecodeCache,
        landblock: &LandblockAsset,
        interior: &crate::LandblockInteriorSystemAsset,
    ) -> Result<LandblockColliders> {
        let mut shapes: HashMap<(u32, u32), Option<Arc<CollisionShape>>> = HashMap::new();
        let mut colliders = Vec::new();
        // Indoor objects are ordinary placed models, so they resolve through the same reader and
        // shape cache the outdoor path uses. Cell shells are keyed by Environment + selector and
        // cached separately above; the two never share an identity.
        let mut reader = ContentSourceReader::with_decode_cache(content, decode_cache);
        let mut object_shapes = ShapeCache::default();

        let mut cell_volumes = Vec::new();

        for cell in &interior.cells {
            let environment = decode_cache
                .environment(content, cell.structure.environment_id)
                .with_context(|| {
                    format!(
                        "Could not read Environment 0x{:08X} for interior collision",
                        cell.structure.environment_id
                    )
                })?;
            let structure = environment
                .cells
                .get(&cell.structure.local_selector)
                .with_context(|| {
                    format!(
                        "Environment 0x{:08X} has no CellStruct selector 0x{:08X}",
                        cell.structure.environment_id, cell.structure.local_selector
                    )
                })?;
            let key = (cell.structure.environment_id, cell.structure.local_selector);
            let shape = match shapes.get(&key) {
                Some(cached) => cached.clone(),
                None => {
                    let resolved =
                        bsp_root_sphere(&Some(structure.physics_bsp.clone())).map(|bounds| -> Result<Arc<CollisionShape>> {
                            let box_bounds = CollisionBox::from_points(
                                structure
                                    .vertex_array
                                    .vertices
                                    .values()
                                    .map(|vertex| vertex.origin),
                            )
                            .with_context(|| {
                                format!(
                                    "Environment 0x{:08X} CellStruct 0x{:08X} has a physics BSP but no vertices",
                                    cell.structure.environment_id, cell.structure.local_selector
                                )
                            })?;
                            Ok(Arc::new(CollisionShape {
                                bsp: structure.physics_bsp.clone(),
                                bounds,
                                box_bounds,
                                polygons: resolve_polygons(
                                    &structure.physics_polygons,
                                    &structure.vertex_array,
                                ),
                            }))
                        }).transpose()?;
                    shapes.insert(key, resolved.clone());
                    resolved
                }
            };
            if let Some(shape) = shape {
                colliders.push(place(
                    shape,
                    cell.placement,
                    ColliderScale::uniform(1.0)?,
                    StaticColliderPlacement::EnvCellShell {
                        cell_id: cell.env_cell_id,
                    },
                ));
            }

            // Furniture, fixtures, and props inside the cell. These were never assembled, so every
            // indoor object in the game was walk-through while the room around it was solid.
            // An EnvCell supplies residency rather than a parent transform, so the authored
            // placement is already landblock-local and composes with nothing.
            for object in &cell.static_objects {
                append_placement(
                    &mut reader,
                    &mut object_shapes,
                    &mut colliders,
                    StaticPlacementInput {
                        source_did: object.source_did,
                        family: LandblockObjectSourceFamily::from_did(object.source_did),
                        placement: object.placement,
                        whole_object_scale: 1.0,
                        identity: StaticColliderPlacement::IndoorStatic {
                            source_cell_id: cell.env_cell_id,
                            source_index: object.source_index,
                        },
                    },
                )?;
            }

            // The containment volume comes from the cell BSP, which is a different tree from the
            // physics BSP the collider shares. A cell with no physics geometry still occupies
            // space, so this is resolved independently of the shape above rather than beside it.
            let portals = interior
                .topology
                .portals
                .iter()
                .filter(|portal| portal.source.env_cell_id == cell.env_cell_id)
                .map(|portal| {
                    let polygon = structure.polygons.get(&portal.polygon_id).with_context(|| {
                        format!(
                            "EnvCell 0x{:08X} portal {} references missing CellStruct polygon {}",
                            cell.env_cell_id, portal.source.portal_index, portal.polygon_id
                        )
                    })?;
                    let resolved = CollisionPolygon::resolve(polygon, &structure.vertex_array)
                        .with_context(|| {
                            format!(
                                "EnvCell 0x{:08X} portal {} has a degenerate polygon {}",
                                cell.env_cell_id, portal.source.portal_index, portal.polygon_id
                            )
                        })?;
                    let (target, outdoor_building) = match &portal.endpoint {
                        crate::interior::LandblockPortalEndpoint::Internal {
                            target_env_cell_id,
                            ..
                        } => (
                            CellCollisionPortalTarget::EnvCell(
                                (target_env_cell_id & 0xffff) as u16,
                            ),
                            None,
                        ),
                        crate::interior::LandblockPortalEndpoint::Outside {
                            building_portal,
                            ..
                        } => {
                            let outdoor_building = building_portal
                                .map(|source| -> Result<OutdoorBuildingTransit> {
                                    let building = landblock
                                        .buildings
                                        .get(source.building_index)
                                        .with_context(|| {
                                            format!(
                                                "EnvCell 0x{:08X} portal {} references missing building {}",
                                                cell.env_cell_id,
                                                portal.source.portal_index,
                                                source.building_index
                                            )
                                        })?;
                                    Ok(OutdoorBuildingTransit {
                                        building_index: source.building_index,
                                        building_origin: building.placement.origin,
                                    })
                                })
                                .transpose()?;
                            (CellCollisionPortalTarget::Outdoor, outdoor_building)
                        }
                    };
                    Ok(CellCollisionPortal {
                        plane: Plane {
                            normal: resolved.normal,
                            d: resolved.d,
                        },
                        // `CellPortal::PortalSide` is the inverse of authored flag bit 1.
                        positive_side: (portal.flags & 0x02) == 0,
                        target,
                        outdoor_building,
                    })
                })
                .collect::<Result<Vec<_>>>()?;

            cell_volumes.push(CellVolume {
                cell_selector: (cell.env_cell_id & 0xffff) as u16,
                placement: cell.placement,
                planes: cell_spine_planes(&structure.cell_bsp),
                portals,
            });
        }

        Ok(LandblockColliders {
            colliders,
            cell_volumes,
        })
    }
}

/// Shapes resolved so far in one assembly, keyed by `GfxObj` DID.
#[derive(Debug, Default)]
struct ShapeCache {
    shapes: HashMap<u32, Option<Arc<CollisionShape>>>,
}

impl ShapeCache {
    /// Resolve one `GfxObj`'s shape, or `None` when it has no physics BSP.
    fn shape(
        &mut self,
        reader: &mut ContentSourceReader<'_>,
        gfx_obj_id: u32,
    ) -> Result<Option<Arc<CollisionShape>>> {
        if let Some(cached) = self.shapes.get(&gfx_obj_id) {
            return Ok(cached.clone());
        }
        let gfx_obj = reader.gfx_obj(gfx_obj_id)?;
        let shape = match (&gfx_obj.physics_bsp, bsp_root_sphere(&gfx_obj.physics_bsp)) {
            (Some(bsp), Some(bounds)) => {
                let box_bounds = CollisionBox::from_points(
                    gfx_obj
                        .vertex_array
                        .vertices
                        .values()
                        .map(|vertex| vertex.origin),
                )
                .with_context(|| {
                    format!("GfxObj 0x{gfx_obj_id:08X} has a physics BSP but no vertices")
                })?;
                Some(Arc::new(CollisionShape {
                    bsp: bsp.clone(),
                    bounds,
                    box_bounds,
                    polygons: resolve_polygons(&gfx_obj.physics_polygons, &gfx_obj.vertex_array),
                }))
            }
            // A physics BSP whose root carries no sorting sphere cannot be broad-phase culled;
            // fail loudly rather than silently dropping a solid out of the collision world.
            (Some(_), None) => {
                anyhow::bail!("GfxObj 0x{gfx_obj_id:08X} physics BSP root has no bounding sphere")
            }
            (None, _) => None,
        };
        self.shapes.insert(gfx_obj_id, shape.clone());
        Ok(shape)
    }
}

/// Interdependent source facts needed to expand one authored static into collidable parts.
#[derive(Debug, Clone, Copy)]
struct StaticPlacementInput {
    /// GfxObj or SetupModel DID that owns the part list.
    source_did: u32,
    /// Source family selecting direct-shape or multipart expansion.
    family: LandblockObjectSourceFamily,
    /// Authored landblock-local whole-object frame.
    placement: LandblockPlacement,
    /// Authored whole-object scale applied before any per-part scale.
    whole_object_scale: f32,
    /// Stable placement identity shared by every emitted collidable part.
    identity: StaticColliderPlacement,
}

fn append_placement(
    reader: &mut ContentSourceReader<'_>,
    shapes: &mut ShapeCache,
    colliders: &mut Vec<PlacedCollider>,
    input: StaticPlacementInput,
) -> Result<()> {
    let whole_object_scale =
        ColliderScale::uniform(input.whole_object_scale).with_context(|| {
            format!(
                "Invalid scale for collision source 0x{:08X}",
                input.source_did
            )
        })?;
    match input.family {
        LandblockObjectSourceFamily::GfxObj => {
            if let Some(shape) = shapes.shape(reader, input.source_did)? {
                colliders.push(place(
                    shape,
                    input.placement,
                    whole_object_scale,
                    input.identity,
                ));
            }
        }
        LandblockObjectSourceFamily::SetupModel => {
            let setup = reader.setup_model(input.source_did).with_context(|| {
                format!(
                    "Could not read SetupModel 0x{:08X} for collision",
                    input.source_did
                )
            })?;
            ensure!(
                setup.default_scale.is_empty() || setup.default_scale.len() == setup.parts.len(),
                "SetupModel 0x{:08X} has {} default scales for {} parts",
                input.source_did,
                setup.default_scale.len(),
                setup.parts.len()
            );
            let part_frames = setup
                .placement_frames
                .get(&Placement::Resting)
                .or_else(|| setup.placement_frames.get(&Placement::Default))
                .map(|placement| placement.anim_frame.frames.as_slice());
            if let Some(part_frames) = part_frames {
                ensure!(
                    part_frames.len() == setup.parts.len(),
                    "SetupModel 0x{:08X} selected placement has {} frames for {} parts",
                    input.source_did,
                    part_frames.len(),
                    setup.parts.len()
                );
            }
            for (part_index, part_id) in setup.parts.iter().enumerate() {
                let Some(shape) = shapes.shape(reader, *part_id)? else {
                    continue;
                };
                // Whole-object scale affects both part offsets and geometry. Per-part default scale
                // affects that part's geometry only (`CPartArray::UpdateParts`, acclient.c:314128).
                let part_placement = match part_frames {
                    Some(frames) => compose(
                        &input.placement,
                        frames[part_index].origin,
                        frames[part_index].orientation,
                        whole_object_scale,
                    ),
                    None => input.placement,
                };
                let part_default_scale = setup
                    .default_scale
                    .get(part_index)
                    .copied()
                    .unwrap_or(Vector3::new(1.0, 1.0, 1.0));
                let part_scale = whole_object_scale
                    .compose(part_default_scale)
                    .with_context(|| {
                        format!(
                            "SetupModel 0x{:08X} part {part_index} has invalid default scale",
                            input.source_did
                        )
                    })?;
                colliders.push(place(shape, part_placement, part_scale, input.identity));
            }
        }
        LandblockObjectSourceFamily::Other(_) => {}
    }
    Ok(())
}

/// Compose a landblock placement with a part-local frame.
fn compose(
    base: &LandblockPlacement,
    local_origin: Vector3,
    local_orientation: Quaternion,
    whole_object_scale: ColliderScale,
) -> LandblockPlacement {
    let scaled = whole_object_scale.apply(local_origin);
    let rotated = base.orientation.rotate_vector(scaled);
    LandblockPlacement {
        origin: Vector3::new(
            base.origin.x + rotated.x,
            base.origin.y + rotated.y,
            base.origin.z + rotated.z,
        ),
        orientation: base.orientation.multiply(&local_orientation),
    }
}

fn place(
    shape: Arc<CollisionShape>,
    placement: LandblockPlacement,
    scale: ColliderScale,
    source_placement: StaticColliderPlacement,
) -> PlacedCollider {
    let scaled_center = scale.apply(shape.bounds.center);
    let rotated_center = placement.orientation.rotate_vector(scaled_center);
    PlacedCollider {
        bounds_center: Vector3::new(
            placement.origin.x + rotated_center.x,
            placement.origin.y + rotated_center.y,
            placement.origin.z + rotated_center.z,
        ),
        bounds_radius: shape.bounds.radius * scale.maximum_component(),
        shape,
        placement,
        scale,
        source_placement,
    }
}

fn bsp_root_sphere(node: &Option<BspNode>) -> Option<Sphere> {
    match node.as_ref()? {
        BspNode::Port(portal) => portal.sphere,
        BspNode::Leaf(leaf) => leaf.sphere,
        BspNode::Internal(internal) => internal.sphere,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::physics::{BspLeaf, InternalNode};

    /// A cell BSP whose positive spine is the given planes, ending in a leaf.
    fn spine(planes: &[Plane]) -> BspNode {
        let mut node = BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 1,
            sphere: None,
            poly_ids: Vec::new(),
        });
        for plane in planes.iter().rev() {
            node = BspNode::Internal(InternalNode {
                tag: *b"BPnn",
                plane: *plane,
                pos: Some(Box::new(node)),
                neg: None,
                sphere: None,
                poly_ids: Vec::new(),
            });
        }
        node
    }

    fn plane(normal: Vector3, d: f32) -> Plane {
        Plane { normal, d }
    }

    fn shape_with_bounds(center: Vector3, radius: f32) -> Arc<CollisionShape> {
        Arc::new(CollisionShape {
            bsp: BspNode::Leaf(BspLeaf {
                index: 0,
                solid: 1,
                sphere: Some(Sphere { center, radius }),
                poly_ids: Vec::new(),
            }),
            bounds: Sphere { center, radius },
            box_bounds: CollisionBox {
                minimum: center - Vector3::new(radius, radius, radius),
                maximum: center + Vector3::new(radius, radius, radius),
            },
            polygons: HashMap::new(),
        })
    }

    fn synthetic_cell_volume() -> CellVolume {
        CellVolume {
            cell_selector: 0x0100,
            placement: LandblockPlacement {
                origin: Vector3::new(0.0, 0.0, 0.0),
                orientation: Quaternion::identity(),
            },
            planes: vec![plane(Vector3::new(1.0, 0.0, 0.0), 0.0)],
            portals: Vec::new(),
        }
    }

    /// Only the positive spine contributes, matching retail's walk down `pos_node` alone.
    #[test]
    fn spine_extraction_follows_the_positive_side_only() {
        let planes = [
            plane(Vector3::new(1.0, 0.0, 0.0), 0.0),
            plane(Vector3::new(0.0, 1.0, 0.0), -2.0),
        ];
        let mut root = spine(&planes);
        // Hang an extra plane off the negative side; it must not be collected.
        if let BspNode::Internal(internal) = &mut root {
            internal.neg = Some(Box::new(spine(&[plane(
                Vector3::new(0.0, 0.0, 1.0),
                -99.0,
            )])));
        }

        let collected = cell_spine_planes(&root);
        assert_eq!(collected.len(), 2);
        assert_eq!(collected[1].d, -2.0);
    }

    #[test]
    fn absorbing_an_assembly_carries_cells_as_well_as_colliders() {
        let mut outdoor = LandblockColliders::default();
        let interior = LandblockColliders {
            colliders: Vec::new(),
            cell_volumes: vec![synthetic_cell_volume()],
        };

        outdoor.absorb(interior);

        assert_eq!(
            outdoor.cell_volumes.len(),
            1,
            "cell volumes must travel with the colliders; dropping them leaves a scene with \
             interior geometry and no cells, which reads as a landblock with no interiors"
        );
    }

    #[test]
    fn non_uniform_scale_transforms_points() {
        let collider = place(
            shape_with_bounds(Vector3::zero(), 1.0),
            LandblockPlacement {
                origin: Vector3::new(10.0, 20.0, 30.0),
                orientation: Quaternion::identity(),
            },
            ColliderScale::from_components(Vector3::new(2.0, 3.0, 4.0)).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        );
        let object_point = Vector3::new(1.0, 2.0, 3.0);
        let landblock_point = collider.point_to_landblock_space(object_point);
        assert_eq!(landblock_point, Vector3::new(12.0, 26.0, 42.0));
    }

    #[test]
    fn non_uniform_scale_uses_inverse_transpose_for_normals_and_conservative_bounds() {
        let collider = place(
            shape_with_bounds(Vector3::new(1.0, 1.0, 1.0), 2.0),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::from_components(Vector3::new(2.0, 3.0, 4.0)).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        );
        assert_eq!(collider.bounds_center, Vector3::new(2.0, 3.0, 4.0));
        assert_eq!(collider.bounds_radius, 8.0);

        let transformed = collider.normal_to_landblock_space(Vector3::new(1.0, 1.0, 0.0));
        let expected = Vector3::new(0.5, 1.0 / 3.0, 0.0).normalize();
        assert!((transformed - expected).length() < 1e-6);
    }

    #[test]
    fn invalid_collider_scales_fail_loudly() {
        assert!(ColliderScale::uniform(0.0).is_err());
        assert!(ColliderScale::from_components(Vector3::new(1.0, f32::NAN, 1.0)).is_err());
    }
}
