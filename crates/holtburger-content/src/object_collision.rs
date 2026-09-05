//! Static solid collision geometry placed in a landblock.
//!
//! Retail selects one collision representation per object (`CPhysicsObj::find_obj_collisions`,
//! `acclient.c:304684-304745`): when any part carries a physics BSP (`PhysicsState::HasPhysicsBSP`,
//! bit 0x10000, cached by ACE `PartArray.CacheHasPhysicsBSP`), the moving sphere collides against
//! each placed part's BSP; otherwise it falls back to the setup's authored cylspheres, then its
//! spheres. A bare `GfxObj` placement without a physics BSP has no setup and therefore no volumes,
//! so it is not a collision participant — draw geometry is never approximated into collision.
//!
//! BSP shapes are shared by `GfxObj` identity: a landblock full of one tree holds one tree's BSP.
//! Volume shapes are shared by owning `SetupModel` identity.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use holtburger_common::attachment::Placement;
use holtburger_common::{Plane, Quaternion, Sphere, Vector3};
use holtburger_dat::file_type::{GfxObj, SetupModel};
use holtburger_dat::graphics::{CVertexArray, Polygon};
use holtburger_dat::physics::BspNode;

use crate::TerrainCollisionSurface;
use crate::landblock::{LandblockAsset, LandblockObjectSourceFamily, LandblockPlacement};
use crate::source_reader::ContentSourceReader;

/// One authored collision shape, shared by every placement that references it.
///
/// The variants mirror retail's three collision representations. Exactly one applies per placed
/// object, decided by the precedence documented on the module.
#[derive(Debug)]
pub enum CollisionShape {
    /// A part's physics BSP with its resolved polygons.
    Bsp(BspSolid),
    /// A setup-level collision cylinder.
    ///
    /// RETAIL QUIRK: the cylinder axis is world +Z regardless of placement orientation. Retail
    /// transforms only the low point into the object's frame and keeps radius/height as scalars
    /// (`CCylSphere::intersects_sphere`, `acclient.c:347305-347338`), so a tipped-over placement
    /// still collides as an upright cylinder. Content was authored against this; tilting the
    /// cylinder with the placement would change collision on every rotated volume static. No
    /// census was run: the behavior is unconditional in the decompile.
    Cylinder(CollisionCylinder),
    /// A setup-level collision ball, used only when the setup has no cylspheres
    /// (`acclient.c:304706`).
    Ball(CollisionBall),
}

impl CollisionShape {
    /// Returns the BSP solid when this shape is one.
    pub fn as_bsp(&self) -> Option<&BspSolid> {
        match self {
            Self::Bsp(solid) => Some(solid),
            Self::Cylinder(_) | Self::Ball(_) => None,
        }
    }
}

/// One authored physics BSP with the geometry its leaves reference.
#[derive(Debug)]
pub struct BspSolid {
    /// Physics BSP in object-local space.
    pub bsp: BspNode,
    /// Object-local bounding sphere from the BSP root, used to cull tree descent.
    pub bounds: Sphere,
    /// Object-local axis-aligned vertex bounds used by retail's static cell-shadow traversal.
    pub box_bounds: CollisionBox,
    /// Physics polygons keyed by the ids the BSP's leaves reference.
    ///
    /// Held beside the tree because the tree alone cannot answer what a body stands on: leaves
    /// carry polygon *ids*, and the geometry lives in the owning record's shared vertex array.
    pub polygons: HashMap<u16, CollisionPolygon>,
}

/// One authored setup collision cylinder in object-local space, axis +Z.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CollisionCylinder {
    /// Object-local center of the cylinder's bottom disc.
    pub low_point: Vector3,
    /// Authored cylinder radius in meters.
    pub radius: f32,
    /// Authored cylinder height in meters, extending from `low_point` along +Z.
    pub height: f32,
}

/// One authored setup collision ball in object-local space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CollisionBall {
    /// Object-local ball center.
    pub center: Vector3,
    /// Authored ball radius in meters.
    pub radius: f32,
}

/// Axis-aligned bounds of one authored collision part in object-local space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CollisionBox {
    minimum: Vector3,
    maximum: Vector3,
}

impl CollisionBox {
    /// Corner of least coordinates.
    pub fn minimum(&self) -> Vector3 {
        self.minimum
    }

    /// Corner of greatest coordinates.
    pub fn maximum(&self) -> Vector3 {
        self.maximum
    }

    /// Places one shared shape and returns its landblock-local axis-aligned bounds.
    ///
    /// Dynamic and static shadow indexes use this same transform so broad-phase membership cannot
    /// drift by object provenance.
    pub fn from_placed_shape(
        shape: &CollisionShape,
        placement: &LandblockPlacement,
        scale: ColliderScale,
    ) -> Result<Self> {
        placed_bounds(shape, placement, scale)
    }

    /// Geometric center.
    pub fn center(&self) -> Vector3 {
        (self.minimum + self.maximum) * 0.5
    }

    /// Radius of the circumscribed sphere around `center`.
    pub fn circumradius(&self) -> f32 {
        ((self.maximum - self.minimum) * 0.5).length()
    }

    /// Whether a sphere reaches this box.
    pub fn intersects_sphere(&self, center: Vector3, radius: f32) -> bool {
        let clamped = Vector3::new(
            center.x.clamp(self.minimum.x, self.maximum.x),
            center.y.clamp(self.minimum.y, self.maximum.y),
            center.z.clamp(self.minimum.z, self.maximum.z),
        );
        (center - clamped).length_squared() <= radius * radius
    }

    /// This box shifted by an offset, in the same frame.
    pub fn translated(&self, offset: Vector3) -> Self {
        Self {
            minimum: self.minimum + offset,
            maximum: self.maximum + offset,
        }
    }

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

/// Resolves one decoded GfxObj's shared physics-BSP shape.
///
/// `None` is the authoritative result when the part has no physics BSP. A BSP with incomplete
/// broad-phase facts is rejected rather than silently disappearing from collision.
pub fn resolve_gfx_obj_collision_shape(
    gfx_obj_id: u32,
    gfx_obj: &GfxObj,
) -> Result<Option<Arc<CollisionShape>>> {
    match (&gfx_obj.physics_bsp, bsp_root_sphere(&gfx_obj.physics_bsp)) {
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
            Ok(Some(Arc::new(CollisionShape::Bsp(BspSolid {
                bsp: bsp.clone(),
                bounds,
                box_bounds,
                polygons: resolve_polygons(&gfx_obj.physics_polygons, &gfx_obj.vertex_array),
            }))))
        }
        (Some(_), None) => {
            anyhow::bail!("GfxObj 0x{gfx_obj_id:08X} physics BSP root has no bounding sphere")
        }
        (None, _) => Ok(None),
    }
}

/// Resolves one setup's complete retail fallback target branch.
///
/// Retail uses every cylsphere when any exists, otherwise every ordinary sphere. It never unions
/// the two lists, including the five authored setups that carry both.
pub fn resolve_setup_volume_collision_shapes(
    setup_did: u32,
    setup: &SetupModel,
) -> Result<Vec<Arc<CollisionShape>>> {
    if !setup.cyl_spheres.is_empty() {
        setup
            .cyl_spheres
            .iter()
            .map(|cylinder| {
                ensure!(
                    vector_is_finite(cylinder.origin)
                        && cylinder.radius.is_finite()
                        && cylinder.radius >= 0.0
                        && cylinder.height.is_finite()
                        && cylinder.height >= 0.0,
                    "SetupModel 0x{setup_did:08X} authors a degenerate cylsphere: {cylinder:?}"
                );
                Ok(Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                    low_point: cylinder.origin,
                    radius: cylinder.radius,
                    height: cylinder.height,
                })))
            })
            .collect()
    } else {
        setup
            .spheres
            .iter()
            .map(|sphere| {
                ensure!(
                    vector_is_finite(sphere.center)
                        && sphere.radius.is_finite()
                        && sphere.radius >= 0.0,
                    "SetupModel 0x{setup_did:08X} authors a degenerate collision sphere: {sphere:?}"
                );
                Ok(Arc::new(CollisionShape::Ball(CollisionBall {
                    center: sphere.center,
                    radius: sphere.radius,
                })))
            })
            .collect()
    }
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
            vector_is_finite(components)
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

    /// Returns the single component of a uniform scale, or `None` when the components differ.
    pub fn as_uniform(self) -> Option<f32> {
        (self.components.x == self.components.y && self.components.y == self.components.z)
            .then_some(self.components.x)
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

/// Source-neutral placed collision geometry in landblock-local space.
#[derive(Debug, Clone)]
pub struct PlacedCollisionShape {
    /// Shared authored shape.
    pub shape: Arc<CollisionShape>,
    /// Landblock-local placement of the shape's origin.
    pub placement: LandblockPlacement,
    /// Component-wise scale applied to the shape.
    pub scale: ColliderScale,
    /// Landblock-local axis-aligned bounds including scale, used for broad-phase rejection and
    /// outdoor cell-shadow registration.
    pub bounds: CollisionBox,
}

impl PlacedCollisionShape {
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

    /// The placed part box's eight corners in landblock space, before axis-aligned collapse.
    ///
    /// Retail's cell-shadow traversal tests the transformed part box corners against portal and
    /// cell planes, so the rotated (non-axis-aligned) corners are the primitive; the stored
    /// `bounds` field is their axis-aligned collapse. Volume shapes are already axis-aligned in
    /// landblock space (the cylinder axis never tilts), so their corners and bounds coincide.
    pub fn placed_box_corners(&self) -> [Vector3; 8] {
        match &*self.shape {
            CollisionShape::Bsp(solid) => solid
                .box_bounds
                .corners()
                .map(|corner| self.point_to_landblock_space(corner)),
            CollisionShape::Cylinder(_) | CollisionShape::Ball(_) => self.bounds.corners(),
        }
    }

    /// Places a shared shape, deriving its landblock-space bounds.
    ///
    /// The sole construction door: bounds and the volume uniform-scale invariant are resolved
    /// here once, so every collider — production or fixture — carries consistent derived facts.
    /// Fails on a non-uniform volume scale: setup volumes are whole-object geometry, and retail
    /// scales them by the object's scalar scale only (`acclient.c:347305`).
    pub fn new(
        shape: Arc<CollisionShape>,
        placement: LandblockPlacement,
        scale: ColliderScale,
    ) -> Result<Self> {
        let bounds = placed_bounds(&shape, &placement, scale)?;
        Ok(Self {
            shape,
            placement,
            scale,
            bounds,
        })
    }
}

/// One static placed collider plus its authored residency identity.
#[derive(Debug, Clone)]
pub struct PlacedCollider {
    /// Source-neutral placed geometry consumed by broad and narrow phases.
    pub geometry: PlacedCollisionShape,
    /// Authored placement identity used to compile runtime cell residency for every part together.
    pub source_placement: StaticColliderPlacement,
}

impl std::ops::Deref for PlacedCollider {
    type Target = PlacedCollisionShape;

    fn deref(&self) -> &Self::Target {
        &self.geometry
    }
}

impl std::ops::DerefMut for PlacedCollider {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.geometry
    }
}

impl PlacedCollider {
    /// Places static collision geometry and retains only its static residency identity separately.
    pub fn new(
        shape: Arc<CollisionShape>,
        placement: LandblockPlacement,
        scale: ColliderScale,
        source_placement: StaticColliderPlacement,
    ) -> Result<Self> {
        Ok(Self {
            geometry: PlacedCollisionShape::new(shape, placement, scale)?,
            source_placement,
        })
    }
}

/// Landblock-space axis-aligned bounds of one placed shape.
fn placed_bounds(
    shape: &CollisionShape,
    placement: &LandblockPlacement,
    scale: ColliderScale,
) -> Result<CollisionBox> {
    Ok(match shape {
        CollisionShape::Bsp(solid) => {
            let corners = solid.box_bounds.corners().map(|corner| {
                let rotated = placement.orientation.rotate_vector(scale.apply(corner));
                rotated + placement.origin
            });
            CollisionBox::from_points(corners).expect("a part box always has eight corners")
        }
        CollisionShape::Cylinder(cylinder) => {
            let (uniform, transform) = uniform_placement(placement, scale)?;
            let low = transform(cylinder.low_point);
            let radius = cylinder.radius * uniform;
            let height = cylinder.height * uniform;
            CollisionBox {
                minimum: Vector3::new(low.x - radius, low.y - radius, low.z),
                maximum: Vector3::new(low.x + radius, low.y + radius, low.z + height),
            }
        }
        CollisionShape::Ball(ball) => {
            let (uniform, transform) = uniform_placement(placement, scale)?;
            let center = transform(ball.center);
            let radius = ball.radius * uniform;
            CollisionBox {
                minimum: center - Vector3::new(radius, radius, radius),
                maximum: center + Vector3::new(radius, radius, radius),
            }
        }
    })
}

/// Resolves the uniform scale a volume shape requires, with its point transform.
fn uniform_placement<'a>(
    placement: &'a LandblockPlacement,
    scale: ColliderScale,
) -> Result<(f32, impl Fn(Vector3) -> Vector3 + 'a)> {
    let uniform = scale
        .as_uniform()
        .with_context(|| format!("setup volume shapes require uniform scale; got {scale:?}"))?;
    Ok((uniform, move |point: Vector3| {
        placement.orientation.rotate_vector(point * uniform) + placement.origin
    }))
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
    cell_volumes: Vec<CellVolume>,
    /// First assembly-order volume for each selector, owned with the immutable cell collection.
    cell_volume_indices: HashMap<u16, usize>,
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
    /// Builds static geometry and its selector lookup without changing assembly order.
    pub fn new(colliders: Vec<PlacedCollider>, cell_volumes: Vec<CellVolume>) -> Self {
        let mut cell_volume_indices = HashMap::with_capacity(cell_volumes.len());
        for (index, volume) in cell_volumes.iter().enumerate() {
            // Preserve the first-match semantics of authored-cell queries, including duplicates.
            cell_volume_indices
                .entry(volume.cell_selector)
                .or_insert(index);
        }
        Self {
            colliders,
            cell_volumes,
            cell_volume_indices,
        }
    }

    /// Interior volumes in assembly order, for geometric searches rather than identity lookup.
    pub fn cell_volumes(&self) -> &[CellVolume] {
        &self.cell_volumes
    }

    /// Resolves an authored cell selector without scanning unrelated interior volumes.
    pub fn cell_volume(&self, selector: u16) -> Option<&CellVolume> {
        self.cell_volume_indices
            .get(&selector)
            .map(|&index| &self.cell_volumes[index])
    }

    /// Absorb another assembly's colliders and cell volumes.
    ///
    /// Exists because merging by hand went wrong exactly once and silently: a caller extended
    /// `colliders` and forgot `cell_volumes`, leaving a scene with interior geometry but no cells.
    /// Nothing failed — an empty vector is a valid landblock with no interiors — and the effect was
    /// that building shells never conceded at doorways and no body ever reported an interior cell.
    /// Every field of this type has to travel together, so the merge belongs to the type.
    fn absorb(&mut self, other: LandblockColliders) {
        self.colliders.extend(other.colliders);
        let offset = self.cell_volumes.len();
        for (selector, index) in other.cell_volume_indices {
            self.cell_volume_indices
                .entry(selector)
                .or_insert(offset + index);
        }
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

        Ok(LandblockColliders::new(colliders, Vec::new()))
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
                            Ok(Arc::new(CollisionShape::Bsp(BspSolid {
                                bsp: structure.physics_bsp.clone(),
                                bounds,
                                box_bounds,
                                polygons: resolve_polygons(
                                    &structure.physics_polygons,
                                    &structure.vertex_array,
                                ),
                            })))
                        }).transpose()?;
                    shapes.insert(key, resolved.clone());
                    resolved
                }
            };
            if let Some(shape) = shape {
                colliders.push(PlacedCollider::new(
                    shape,
                    cell.placement,
                    ColliderScale::uniform(1.0)?,
                    StaticColliderPlacement::EnvCellShell {
                        cell_id: cell.env_cell_id,
                    },
                )?);
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

        Ok(LandblockColliders::new(colliders, cell_volumes))
    }
}

/// Shapes resolved so far in one assembly.
#[derive(Debug, Default)]
struct ShapeCache {
    /// Per-part BSP shapes keyed by `GfxObj` DID.
    shapes: HashMap<u32, Option<Arc<CollisionShape>>>,
    /// Setup-level volume shapes keyed by `SetupModel` DID.
    volumes: HashMap<u32, Arc<Vec<Arc<CollisionShape>>>>,
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
        let shape = resolve_gfx_obj_collision_shape(gfx_obj_id, &gfx_obj)?;
        self.shapes.insert(gfx_obj_id, shape.clone());
        Ok(shape)
    }

    /// Resolve one setup's fallback volume shapes, empty when it authors none.
    ///
    /// Retail's precedence within the fallback is either/or: cylspheres when any exist, else
    /// spheres (`CPhysicsObj::find_obj_collisions`, `acclient.c:304688-304745`). Five authored
    /// setups carry both kinds, so collapsing this to a union would add collision content never
    /// had.
    fn setup_volumes(
        &mut self,
        setup_did: u32,
        setup: &SetupModel,
    ) -> Result<Arc<Vec<Arc<CollisionShape>>>> {
        if let Some(cached) = self.volumes.get(&setup_did) {
            return Ok(Arc::clone(cached));
        }
        let authored = resolve_setup_volume_collision_shapes(setup_did, setup)?;
        let shared = Arc::new(authored);
        self.volumes.insert(setup_did, Arc::clone(&shared));
        Ok(shared)
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
                colliders.push(PlacedCollider::new(
                    shape,
                    input.placement,
                    whole_object_scale,
                    input.identity,
                )?);
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
            let mut any_part_bsp = false;
            for (part_index, part_id) in setup.parts.iter().enumerate() {
                let Some(shape) = shapes.shape(reader, *part_id)? else {
                    continue;
                };
                any_part_bsp = true;
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
                colliders.push(PlacedCollider::new(
                    shape,
                    part_placement,
                    part_scale,
                    input.identity,
                )?);
            }
            // Retail collides against per-part physics BSPs only when the object has
            // `PhysicsState::HasPhysicsBSP` (any part carries one); otherwise it falls back to the
            // setup's authored volumes (`CPhysicsObj::find_obj_collisions`, acclient.c:304684).
            // 172 authored setups carry both representations, so emitting volumes alongside BSP
            // parts would double-collide them.
            if !any_part_bsp {
                for shape in shapes.setup_volumes(input.source_did, &setup)?.iter() {
                    colliders.push(PlacedCollider::new(
                        Arc::clone(shape),
                        input.placement,
                        whole_object_scale,
                        input.identity,
                    )?);
                }
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

/// Whether every component of a vector is finite.
fn vector_is_finite(vector: Vector3) -> bool {
    vector.x.is_finite() && vector.y.is_finite() && vector.z.is_finite()
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
        Arc::new(CollisionShape::Bsp(BspSolid {
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
        }))
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
    fn cell_lookup_preserves_assembly_order_and_first_selector_match() {
        let cells = [0x0200, 0xffff, 0x0100, 0x0200]
            .into_iter()
            .map(|cell_selector| CellVolume {
                cell_selector,
                ..synthetic_cell_volume()
            })
            .collect();
        let geometry = LandblockColliders::new(Vec::new(), cells);
        assert_eq!(
            geometry
                .cell_volumes()
                .iter()
                .map(|cell| cell.cell_selector)
                .collect::<Vec<_>>(),
            [0x0200, 0xffff, 0x0100, 0x0200]
        );
        for (selector, index) in [(0x0200, 0), (0xffff, 1), (0x0100, 2)] {
            assert!(std::ptr::eq(
                geometry.cell_volume(selector).unwrap(),
                &geometry.cell_volumes()[index]
            ));
        }
        assert!(geometry.cell_volume(0x0101).is_none());
        assert!(LandblockColliders::default().cell_volume(0x0100).is_none());
    }

    #[test]
    fn absorbing_cells_offsets_new_indices_and_preserves_existing_matches() {
        let mut geometry = LandblockColliders::new(Vec::new(), vec![synthetic_cell_volume()]);
        geometry.absorb(LandblockColliders::new(
            Vec::new(),
            vec![
                CellVolume {
                    cell_selector: 0x0200,
                    ..synthetic_cell_volume()
                },
                synthetic_cell_volume(),
            ],
        ));
        assert!(std::ptr::eq(
            geometry.cell_volume(0x0100).unwrap(),
            &geometry.cell_volumes()[0]
        ));
        assert!(std::ptr::eq(
            geometry.cell_volume(0x0200).unwrap(),
            &geometry.cell_volumes()[1]
        ));
        assert_eq!(geometry.cell_volumes().len(), 3);
    }

    #[test]
    fn absorbing_an_assembly_carries_cells_as_well_as_colliders() {
        let mut outdoor = LandblockColliders::default();
        let interior = LandblockColliders::new(Vec::new(), vec![synthetic_cell_volume()]);

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
        let collider = PlacedCollider::new(
            shape_with_bounds(Vector3::zero(), 1.0),
            LandblockPlacement {
                origin: Vector3::new(10.0, 20.0, 30.0),
                orientation: Quaternion::identity(),
            },
            ColliderScale::from_components(Vector3::new(2.0, 3.0, 4.0)).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap();
        let object_point = Vector3::new(1.0, 2.0, 3.0);
        let landblock_point = collider.point_to_landblock_space(object_point);
        assert_eq!(landblock_point, Vector3::new(12.0, 26.0, 42.0));
    }

    #[test]
    fn non_uniform_scale_uses_inverse_transpose_for_normals_and_scaled_bounds() {
        let collider = PlacedCollider::new(
            shape_with_bounds(Vector3::new(1.0, 1.0, 1.0), 2.0),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::from_components(Vector3::new(2.0, 3.0, 4.0)).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap();
        // Box bounds are the unit cube around (1, 1, 1) scaled to radius 2, then component-scaled.
        assert_eq!(collider.bounds.minimum(), Vector3::new(-2.0, -3.0, -4.0));
        assert_eq!(collider.bounds.maximum(), Vector3::new(6.0, 9.0, 12.0));
        assert_eq!(collider.bounds.center(), Vector3::new(2.0, 3.0, 4.0));

        let transformed = collider.normal_to_landblock_space(Vector3::new(1.0, 1.0, 0.0));
        let expected = Vector3::new(0.5, 1.0 / 3.0, 0.0).normalize();
        assert!((transformed - expected).length() < 1e-6);
    }

    #[test]
    fn rotated_bsp_bounds_cover_the_placed_corners() {
        // A quarter turn around Z maps the box's +X reach onto +Y; the AABB must follow the
        // rotated corners rather than rotating its min/max naively.
        let half_angle = std::f32::consts::FRAC_PI_4;
        let quarter_turn = Quaternion {
            w: half_angle.cos(),
            x: 0.0,
            y: 0.0,
            z: half_angle.sin(),
        };
        let collider = PlacedCollider::new(
            shape_with_bounds(Vector3::new(1.0, 0.0, 0.0), 1.0),
            LandblockPlacement {
                origin: Vector3::new(100.0, 100.0, 0.0),
                orientation: quarter_turn,
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap();
        assert!((collider.bounds.center() - Vector3::new(100.0, 101.0, 0.0)).length() < 1e-5);
        assert!((collider.bounds.minimum().x - 99.0).abs() < 1e-5);
        assert!((collider.bounds.maximum().y - 102.0).abs() < 1e-5);
    }

    /// RETAIL QUIRK coverage: the placed cylinder never tilts with its placement
    /// (`acclient.c:347305` transforms only the low point), so a rotated placement moves the low
    /// point but keeps the box axis-aligned with world Z.
    #[test]
    fn placed_cylinder_bounds_stay_world_z_aligned_under_rotation() {
        let half_angle = std::f32::consts::FRAC_PI_4;
        let quarter_turn_about_y = Quaternion {
            w: half_angle.cos(),
            x: 0.0,
            y: half_angle.sin(),
            z: 0.0,
        };
        let collider = PlacedCollider::new(
            Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                low_point: Vector3::new(1.0, 0.0, 0.0),
                radius: 0.5,
                height: 4.0,
            })),
            LandblockPlacement {
                origin: Vector3::new(10.0, 10.0, 5.0),
                orientation: quarter_turn_about_y,
            },
            ColliderScale::uniform(2.0).unwrap(),
            StaticColliderPlacement::OutdoorGenerated { source_index: 0 },
        )
        .unwrap();
        // Scaled low point (2, 0, 0) rotates about Y onto -Z: placed low = (10, 10, 3).
        let bounds = collider.bounds;
        assert!((bounds.minimum() - Vector3::new(9.0, 9.0, 3.0)).length() < 1e-5);
        // Height 4 × scale 2 extends straight up regardless of the rotation.
        assert!((bounds.maximum() - Vector3::new(11.0, 11.0, 11.0)).length() < 1e-5);
    }

    #[test]
    fn placed_ball_bounds_scale_and_translate() {
        let collider = PlacedCollider::new(
            Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::new(0.0, 0.0, 1.0),
                radius: 1.5,
            })),
            LandblockPlacement {
                origin: Vector3::new(50.0, 60.0, 0.0),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(2.0).unwrap(),
            StaticColliderPlacement::OutdoorGenerated { source_index: 0 },
        )
        .unwrap();
        assert_eq!(collider.bounds.center(), Vector3::new(50.0, 60.0, 2.0));
        assert_eq!(collider.bounds.minimum(), Vector3::new(47.0, 57.0, -1.0));
        assert_eq!(collider.bounds.maximum(), Vector3::new(53.0, 63.0, 5.0));
    }

    #[test]
    fn volume_shapes_reject_non_uniform_scale_loudly() {
        let error = PlacedCollider::new(
            Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                low_point: Vector3::zero(),
                radius: 1.0,
                height: 1.0,
            })),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::from_components(Vector3::new(1.0, 2.0, 1.0)).unwrap(),
            StaticColliderPlacement::OutdoorGenerated { source_index: 0 },
        );
        assert!(error.is_err(), "non-uniform volume scale must fail loudly");
    }

    #[test]
    fn invalid_collider_scales_fail_loudly() {
        assert!(ColliderScale::uniform(0.0).is_err());
        assert!(ColliderScale::from_components(Vector3::new(1.0, f32::NAN, 1.0)).is_err());
    }

    /// Retail's fallback is either/or: any authored cylsphere suppresses every authored sphere
    /// (`CPhysicsObj::find_obj_collisions`, `acclient.c:304688`). Five authored setups carry both
    /// (e.g. 0x02000F7B), so a union here would add collision content never had.
    #[test]
    fn cylspheres_suppress_spheres_in_the_volume_fallback() {
        let mut setup = holtburger_dat::file_type::SetupModel {
            id: 0x0200_0001,
            flags: 0,
            parts: Vec::new(),
            parent_index: Vec::new(),
            default_scale: Vec::new(),
            holding_locations: Default::default(),
            connection_points: Default::default(),
            placement_frames: Default::default(),
            cyl_spheres: vec![holtburger_dat::file_type::setup_model::CylSphere {
                origin: Vector3::zero(),
                radius: 1.0,
                height: 2.0,
            }],
            spheres: vec![
                Sphere {
                    center: Vector3::zero(),
                    radius: 1.0,
                },
                Sphere {
                    center: Vector3::new(1.0, 0.0, 0.0),
                    radius: 1.0,
                },
            ],
            height: 0.0,
            radius: 0.0,
            step_up: 0.0,
            step_down: 0.0,
            sorting_sphere: Sphere {
                center: Vector3::zero(),
                radius: 0.0,
            },
            selection_sphere: Sphere {
                center: Vector3::zero(),
                radius: 0.0,
            },
            lights: Default::default(),
            default_animation: None,
            default_script_did: None,
            default_motion_table: None,
            default_sound_table: None,
            default_script_table: None,
        };

        let mut cache = ShapeCache::default();
        let volumes = cache.setup_volumes(setup.id, &setup).unwrap();
        assert_eq!(volumes.len(), 1, "cylspheres must suppress spheres");
        assert!(matches!(&*volumes[0], CollisionShape::Cylinder(_)));

        setup.cyl_spheres.clear();
        let mut cache = ShapeCache::default();
        let volumes = cache.setup_volumes(setup.id, &setup).unwrap();
        assert_eq!(volumes.len(), 2, "without cylspheres, spheres participate");
        assert!(matches!(&*volumes[0], CollisionShape::Ball(_)));
    }

    #[test]
    fn collision_box_sphere_intersection_clamps_to_faces() {
        let bounds =
            CollisionBox::from_points([Vector3::new(0.0, 0.0, 0.0), Vector3::new(2.0, 2.0, 2.0)])
                .unwrap();
        assert!(bounds.intersects_sphere(Vector3::new(3.0, 1.0, 1.0), 1.5));
        assert!(!bounds.intersects_sphere(Vector3::new(3.0, 1.0, 1.0), 0.5));
        // Corner reach uses true euclidean distance, not per-axis slack.
        assert!(!bounds.intersects_sphere(Vector3::new(3.0, 3.0, 1.0), 1.2));
        assert!(bounds.intersects_sphere(Vector3::new(3.0, 3.0, 1.0), 1.5));
    }
}
