//! Resident static collision geometry and explicit query families.

mod static_sphere_sweep;

pub use static_sphere_sweep::{StaticSphereSweepHit, StaticSphereSweepRequest};

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use holtburger_common::position::{
    MAX_OUTDOOR_LANDBLOCK_AXIS, METERS_PER_LANDBLOCK, WorldPosition, outdoor_landblock_owner_at,
};
use holtburger_common::{Guid, Vector3};
use holtburger_content::{
    CellCollisionPortal, CellCollisionPortalTarget, CellVolume, CollisionShape,
    LandblockCollisionAsset, PlacedCollider, StaticColliderPlacement, TerrainCollisionTriangle,
};
use thiserror::Error;

use super::bsp_query::{
    ShapeSupportFeature, placed_polygon_contacts, placed_polygon_obstructions,
    placed_solid_contacts, placed_supports, support_on_polygon,
};
use super::cell_index::{GlobalCellRange, OUTDOOR_CELL_METERS};
use super::volume_query::{
    placed_ball_contact, placed_ball_support, placed_cylinder_contact, placed_cylinder_support,
};
use super::{PhysicalCollisionExclusions, PhysicalCollisionFilter};

const CELL_PLANE_TOLERANCE: f32 = 0.000_2;

/// Invalid collision-query geometry rejected before traversal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum CollisionQueryError {
    /// A center contains NaN or infinity.
    #[error("collision query center must be finite")]
    NonFiniteCenter,
    /// A radius is non-finite or not positive.
    #[error("collision query radius must be finite and positive")]
    InvalidRadius,
    /// A bounded probe distance is non-finite or negative.
    #[error("collision query distance must be finite and non-negative")]
    InvalidDistance,
    /// The collision backend does not support one authored static shape pairing.
    #[error("static sphere sweep reached an unsupported collision shape pairing")]
    UnsupportedSphereSweep,
    /// A placed-motion request supplied no accepted geometric leg.
    #[error("placed-motion path must contain at least one waypoint")]
    EmptyMotionPath,
    /// A waypoint fraction contains NaN or infinity.
    #[error("placed-motion waypoint fraction must be finite")]
    NonFiniteMotionFraction,
    /// A waypoint fraction does not lie inside the normalized fixed-tick interval.
    #[error("placed-motion waypoint fraction must be greater than zero and at most one")]
    MotionFractionOutOfRange,
    /// Waypoint fractions do not advance strictly through the fixed tick.
    #[error("placed-motion waypoint fractions must be strictly increasing")]
    NonIncreasingMotionFraction,
    /// The final accepted waypoint does not close the fixed tick.
    #[error("placed-motion path must end at normalized tick fraction one")]
    IncompleteMotionPath,
    /// Directed portal traversal cycled instead of advancing through distinct boundaries.
    #[error("placed-motion path exceeded the resident portal-transition bound")]
    MotionTransitionLimitExceeded,
    /// A supplied prior cell is not present in the authoritative collision scene.
    #[error("placed-motion EnvCell 0x{cell:08X} is absent from the collision scene")]
    UnknownMotionCell {
        /// Full missing EnvCell DID.
        cell: u32,
    },
}

/// Invalid collision facts or residency changes rejected before scene state commits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum CollisionSceneUpdateError {
    /// An indoor static placement names a source EnvCell absent from the same atomic artifact.
    #[error(
        "collision owner 0x{owner:08X} static placement references missing source EnvCell 0x{cell:08X}"
    )]
    MissingSourceCell {
        /// Normalized owning landblock DID.
        owner: u32,
        /// Full missing source EnvCell DID.
        cell: u32,
    },
    /// An authored internal portal names a target EnvCell absent from the same atomic artifact.
    #[error("collision owner 0x{owner:08X} portal references missing target EnvCell 0x{cell:08X}")]
    MissingTargetCell {
        /// Normalized owning landblock DID.
        owner: u32,
        /// Full missing target EnvCell DID.
        cell: u32,
    },
    /// One batch supplied the same insertion owner more than once.
    #[error("collision residency update contains duplicate insertion owner 0x{owner:08X}")]
    DuplicateInsertion {
        /// Duplicated normalized owner DID.
        owner: u32,
    },
    /// One batch tried to insert and remove the same owner without defining an ordering.
    #[error("collision residency update both inserts and removes owner 0x{owner:08X}")]
    ConflictingChange {
        /// Conflicting normalized owner DID.
        owner: u32,
    },
}

/// One sphere-separating contact in absolute world coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaticContact {
    /// Outward-facing unit normal.
    pub normal: Vector3,
    /// Positive world-meter displacement required along `normal`.
    pub depth: f32,
}

/// Grounded movement obstruction with two-sided authored polygon response.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedObstruction {
    /// Radial unit normal used only to separate overlapping geometry.
    pub separation_normal: Vector3,
    /// Authored surface normal facing the body, used for grounded response decisions.
    pub response_normal: Vector3,
    /// Positive world-meter displacement required along `separation_normal`.
    pub depth: f32,
}

/// One source surface reachable by lowering a sphere vertically.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SupportContact {
    /// Authored outward-facing unit normal.
    pub normal: Vector3,
    /// Signed vertical correction from the requested center to tangency; positive rises.
    pub height_delta: f32,
    /// Authored feature reached by the bounded vertical probe.
    pub feature: SupportFeature,
}

/// Authored surface feature reached by a support query.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SupportFeature {
    /// The finite polygon accepts an ordinary adjustment to its authored plane.
    Surface,
    /// The sphere reaches a finite edge but cannot adjust to the polygon plane.
    Edge {
        /// Horizontal normal pointing back across the reached edge.
        inward_normal: Vector3,
    },
}

impl From<ShapeSupportFeature> for SupportFeature {
    fn from(feature: ShapeSupportFeature) -> Self {
        match feature {
            ShapeSupportFeature::Surface => Self::Surface,
            ShapeSupportFeature::Edge { inward_normal } => Self::Edge { inward_normal },
        }
    }
}

/// Validated swept-sphere geometry expressed in one outdoor anchor frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SphereSweep {
    /// Normalized landblock whose local frame contains both centers.
    pub anchor: Guid,
    /// Anchor-local start center; it may lie outside the anchor's 0..192 extent.
    pub start: Vector3,
    /// Anchor-local candidate center; it may lie outside the anchor's 0..192 extent.
    pub end: Vector3,
    /// Positive body radius in meters.
    pub radius: f32,
}

/// One candidate body's authoritative resident cell and every spatial domain reached by its spheres.
///
/// Retail commits the cell containing sphere zero's center separately from the `CELLARRAY` used to
/// query collision (`CObjCell::find_cell_list`, `acclient.c:332969`). Keeping both facts together
/// prevents query families from inventing different terrain/interior selection rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpatialMembership {
    committed_cell: Option<Guid>,
    reaches_outdoors: bool,
    reached_env_cells: Vec<Guid>,
}

impl SpatialMembership {
    /// Membership for a body wholly in outdoor land cells.
    pub fn outdoor() -> Self {
        Self {
            committed_cell: None,
            reaches_outdoors: true,
            reached_env_cells: Vec::new(),
        }
    }

    /// Membership for a body wholly in one EnvCell.
    pub fn interior(cell: Guid) -> Self {
        Self {
            committed_cell: Some(cell),
            reaches_outdoors: false,
            reached_env_cells: vec![cell],
        }
    }

    /// Cell containing the authoritative sphere center, or `None` while outdoors.
    pub fn committed_cell(&self) -> Option<Guid> {
        self.committed_cell
    }

    /// Whether any body sphere reaches outdoor land cells.
    pub fn reaches_outdoors(&self) -> bool {
        self.reaches_outdoors
    }

    /// Deduplicated EnvCells reached by any body sphere.
    pub fn reached_env_cells(&self) -> &[Guid] {
        &self.reached_env_cells
    }

    pub(super) fn merge_reached(mut self, other: Self) -> Self {
        self.reaches_outdoors |= other.reaches_outdoors;
        for cell in other.reached_env_cells {
            if !self.reached_env_cells.contains(&cell) {
                self.reached_env_cells.push(cell);
            }
        }
        self
    }

    fn reaches_interior_in(&self, owner: Guid) -> bool {
        self.reached_env_cells
            .iter()
            .any(|cell| landblock_key(*cell) == owner)
    }
}

/// Directional movement-obstruction query.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MovementObstructionRequest<'a> {
    /// Swept sphere being tested.
    pub sweep: SphereSweep,
    /// Candidate placement selecting the collision domains visible to this query.
    pub placement: &'a SpatialMembership,
}

/// Grounded movement query that preserves two-sided polygon identity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedObstructionRequest<'a> {
    /// Swept sphere being tested.
    pub sweep: SphereSweep,
    /// Candidate placement selecting the collision domains visible to this query.
    pub placement: &'a SpatialMembership,
}

/// Directionless placement-confirmation query.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlacementRequest<'a> {
    /// Normalized landblock whose local frame contains `center`.
    pub anchor: Guid,
    /// Anchor-local sphere center.
    pub center: Vector3,
    /// Positive body radius in meters.
    pub radius: f32,
    /// Candidate placement selecting the collision domains visible to this query.
    pub placement: &'a SpatialMembership,
}

/// Directional support probe for the grounded lower sphere.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SupportRequest<'a> {
    /// Normalized landblock whose local frame contains `center`.
    pub anchor: Guid,
    /// Anchor-local sphere center before settling.
    pub center: Vector3,
    /// Positive lower-sphere radius in meters.
    pub radius: f32,
    /// Maximum vertical distance the sphere may settle.
    pub maximum_drop: f32,
    /// Maximum vertical distance a penetrated walkable plane may lift the sphere.
    pub maximum_rise: f32,
    /// Candidate placement selecting the collision domains visible to this query.
    pub placement: &'a SpatialMembership,
}

/// Body-primary directional query for optional filtered movement restrictions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MovementRestrictionRequest<'a> {
    /// Swept primary sphere whose center selects retail land restrictions.
    pub sweep: SphereSweep,
    /// Candidate placement selecting whether outdoor restrictions participate.
    pub placement: &'a SpatialMembership,
    /// Body-owned optional collision-domain exclusions.
    pub filter: PhysicalCollisionFilter,
}

/// Body-primary directionless query for optional filtered placement restrictions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlacementRestrictionRequest<'a> {
    /// Normalized landblock whose local frame contains `center`.
    pub anchor: Guid,
    /// Primary sphere center selecting retail land restrictions.
    pub center: Vector3,
    /// Positive primary-sphere radius used to select installed restrictions.
    pub radius: f32,
    /// Candidate placement selecting whether outdoor restrictions participate.
    pub placement: &'a SpatialMembership,
    /// Body-owned optional collision-domain exclusions.
    pub filter: PhysicalCollisionFilter,
}

/// Complete internal input for directionless or directional static contacts.
#[derive(Debug, Clone, Copy)]
struct StaticContactRequest<'a> {
    touched: &'a [Guid],
    anchor: Guid,
    center: Vector3,
    radius: f32,
    movement: Option<Vector3>,
    placement: &'a SpatialMembership,
}

/// Prior-cell-aware interior transit query.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CellTransitRequest {
    /// Interior cell committed with the prior pose, or `None` while outdoors.
    pub previous_cell: Option<Guid>,
    /// Normalized landblock whose local frame contains `center`.
    pub anchor: Guid,
    /// Anchor-local candidate body center.
    pub center: Vector3,
    /// Body radius used to admit a doorway candidate before its center crosses the boundary.
    pub radius: f32,
}

/// One accepted geometric endpoint within a normalized fixed-tick motion path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionWaypoint {
    /// Anchor-local sphere center at this accepted endpoint.
    pub center: Vector3,
    /// Strictly increasing completion fraction in `(0, 1]`; the final waypoint must be `1`.
    pub end_fraction: f32,
    /// Whether traversal derives this endpoint's cell or preserves a solver commitment.
    pub placement: MotionWaypointPlacement,
}

/// Placement authority attached to one accepted motion endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionWaypointPlacement {
    /// Derive placement by directed portal traversal, as for a presentation offset.
    Traverse,
    /// Preserve the cell already accepted by collision response, including outdoors.
    Committed(Option<Guid>),
}

/// Camera-agnostic request to attach authoritative placement to accepted motion geometry.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlacedMotionPathRequest<'a> {
    /// Interior cell committed with the initial point, or `None` while outdoors.
    pub previous_cell: Option<Guid>,
    /// Normalized landblock whose local frame contains every waypoint center.
    pub anchor: Guid,
    /// Anchor-local initial sphere center.
    pub start: Vector3,
    /// Positive mover radius used to derive reached collision domains.
    pub radius: f32,
    /// Ordered collision-accepted geometry; portal crossings are inserted between these endpoints.
    pub waypoints: &'a [MotionWaypoint],
}

/// Observable fallback used only when directed traversal leaves an invalid retained EnvCell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlacementRecovery {
    /// Point containment found one unambiguous replacement placement.
    Recovered {
        /// Interior cell retained by directed traversal before validation failed.
        previous_cell: Guid,
        /// Unique containing EnvCell, or `None` when no resident EnvCell contains the point.
        recovered_cell: Option<Guid>,
    },
    /// Several EnvCells contain the point, so portal history remains authoritative.
    Ambiguous {
        /// Interior cell retained by directed traversal before validation failed.
        previous_cell: Guid,
        /// Sorted containing EnvCells intentionally not resolved by iteration order.
        candidates: Vec<Guid>,
        /// Placement selected by topology-seeded transit, or outdoors when none was reached.
        selected_cell: Option<Guid>,
    },
}

/// One position paired with the complete spatial membership valid at that position.
#[derive(Debug, Clone, PartialEq)]
pub struct PlacedMotionPoint {
    center: Vector3,
    placement: SpatialMembership,
    recovery: Option<PlacementRecovery>,
}

impl PlacedMotionPoint {
    /// Anchor-local mover center.
    pub fn center(&self) -> Vector3 {
        self.center
    }

    /// Authoritative cell and collision domains at `center`.
    pub fn placement(&self) -> &SpatialMembership {
        &self.placement
    }

    /// Exceptional placement repair attempted at this exact point, if any.
    pub fn recovery(&self) -> Option<&PlacementRecovery> {
        self.recovery.as_ref()
    }
}

/// One placement-stable path leg ending at an authoritative point.
#[derive(Debug, Clone, PartialEq)]
pub struct PlacedMotionLeg {
    end_fraction: f32,
    end: PlacedMotionPoint,
}

impl PlacedMotionLeg {
    /// Monotonic normalized fixed-tick fraction at this leg boundary.
    pub fn end_fraction(&self) -> f32 {
        self.end_fraction
    }

    /// Position and placement that become authoritative at the exact boundary.
    pub fn end(&self) -> &PlacedMotionPoint {
        &self.end
    }
}

/// Non-empty accepted motion whose position and placement transitions cannot be sampled apart.
#[derive(Debug, Clone, PartialEq)]
pub struct PlacedMotionPath {
    anchor: Guid,
    initial: PlacedMotionPoint,
    legs: Vec<PlacedMotionLeg>,
}

impl PlacedMotionPath {
    /// Normalized landblock frame shared by every retained point.
    pub fn anchor(&self) -> Guid {
        self.anchor
    }

    /// Authoritative point at normalized tick fraction zero.
    pub fn initial(&self) -> &PlacedMotionPoint {
        &self.initial
    }

    /// Non-empty ordered path legs, including accepted bends and placement-only splits.
    pub fn legs(&self) -> &[PlacedMotionLeg] {
        &self.legs
    }

    /// Authoritative point committed for the next fixed tick.
    pub fn final_point(&self) -> &PlacedMotionPoint {
        &self
            .legs
            .last()
            .expect("placed-motion paths are constructed non-empty")
            .end
    }

    /// Samples accepted geometry without separating it from the path's retained boundaries.
    pub fn center_at_fraction(&self, fraction: f32) -> Option<Vector3> {
        if !fraction.is_finite() || !(0.0..=1.0).contains(&fraction) {
            return None;
        }
        let mut start_fraction = 0.0;
        let mut start = self.initial.center;
        for leg in &self.legs {
            if fraction <= leg.end_fraction {
                let span = leg.end_fraction - start_fraction;
                let local = if span <= f32::EPSILON {
                    1.0
                } else {
                    ((fraction - start_fraction) / span).clamp(0.0, 1.0)
                };
                return Some(start + (leg.end.center - start) * local);
            }
            start_fraction = leg.end_fraction;
            start = leg.end.center;
        }
        Some(self.final_point().center)
    }

    /// Whether any point required exceptional placement repair.
    pub fn has_recovery(&self) -> bool {
        self.initial.recovery.is_some() || self.legs.iter().any(|leg| leg.end.recovery.is_some())
    }

    /// Translates every geometric center while preserving authoritative placement transitions.
    pub fn translated(mut self, offset: Vector3) -> Self {
        self.initial.center = self.initial.center + offset;
        for leg in &mut self.legs {
            leg.end.center = leg.end.center + offset;
        }
        self
    }
}

/// Stable reference to a collider that remains owned by its source landblock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct ColliderReference {
    owner: Guid,
    collider_index: usize,
}

/// One selected static collider and the retail BSP leaf policy for this spatial membership.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SelectedCollider {
    /// Stable reference to source-owned collider geometry.
    reference: ColliderReference,
    /// Whether a center-containing solid BSP leaf obstructs this query.
    center_solid: bool,
}

/// One exact directed portal crossing along a single accepted geometric leg.
#[derive(Debug, Clone, Copy, PartialEq)]
struct PlacementTransition {
    fraction: f32,
    target_cell: Option<Guid>,
}

/// One geometric segment evaluated against currently installed placement topology.
#[derive(Debug, Clone, Copy)]
struct PlacementMotionSegment<'a> {
    /// Normalized landblock whose local frame contains both endpoints.
    anchor: Guid,
    /// Anchor-local accepted segment start.
    start: Vector3,
    /// Anchor-local accepted segment end.
    end: Vector3,
    /// Sphere radius used for portal reach and far-side placement.
    radius: f32,
    /// Installed outdoor owners touched by this segment.
    touched: &'a [Guid],
}

/// Scene-derived equivalent of retail's outdoor and EnvCell static shadow lists.
#[derive(Debug, Clone, Default)]
struct StaticShadowIndex {
    /// Outdoor colliders and building shells bucketed by the global 24m cells their placed
    /// bounds shadow. One map serves both: they were always selected together under the same
    /// outdoors gate, and building identity lives on `source_placement`.
    outdoor_cells: HashMap<(i32, i32), Vec<ColliderReference>>,
    interior_colliders: HashMap<Guid, Vec<ColliderReference>>,
}

impl StaticShadowIndex {
    fn compile(
        landblocks: &HashMap<Guid, Arc<LandblockCollisionAsset>>,
    ) -> Result<Self, CollisionSceneUpdateError> {
        let mut index = Self::default();
        let mut outdoor_placements = Vec::new();
        let mut building_entries = Vec::new();
        let mut owners = landblocks.keys().copied().collect::<Vec<_>>();
        owners.sort_unstable();

        for owner in owners {
            let asset = &landblocks[&owner];
            let mut indoor_placements = BTreeMap::<(u32, usize), Vec<usize>>::new();
            let mut outdoor_groups = BTreeMap::<StaticColliderPlacement, Vec<usize>>::new();
            for (collider_index, collider) in asset.static_geometry.colliders.iter().enumerate() {
                let reference = ColliderReference {
                    owner,
                    collider_index,
                };
                match collider.source_placement {
                    source @ (StaticColliderPlacement::OutdoorExplicit { .. }
                    | StaticColliderPlacement::OutdoorGenerated { .. }) => {
                        index.stamp_outdoor(owner, collider, reference);
                        outdoor_groups
                            .entry(source)
                            .or_default()
                            .push(collider_index);
                    }
                    StaticColliderPlacement::BuildingShell { .. } => {
                        index.stamp_outdoor(owner, collider, reference);
                    }
                    StaticColliderPlacement::EnvCellShell { cell_id } => {
                        index
                            .interior_colliders
                            .entry(Guid(cell_id))
                            .or_default()
                            .push(reference);
                    }
                    StaticColliderPlacement::IndoorStatic {
                        source_cell_id,
                        source_index,
                    } => {
                        indoor_placements
                            .entry((source_cell_id, source_index))
                            .or_default()
                            .push(collider_index);
                    }
                }
            }

            for ((source_cell, _), collider_indices) in indoor_placements {
                let references = collider_indices
                    .iter()
                    .copied()
                    .map(|collider_index| ColliderReference {
                        owner,
                        collider_index,
                    })
                    .collect::<Vec<_>>();
                for reached_cell in static_reached_cells(
                    owner.0,
                    source_cell,
                    owner.0,
                    &collider_indices,
                    &asset.static_geometry.colliders,
                    &asset.static_geometry.cell_volumes,
                )? {
                    index
                        .interior_colliders
                        .entry(Guid((owner.0 & 0xffff_0000) | u32::from(reached_cell)))
                        .or_default()
                        .extend(references.iter().copied());
                }
            }

            for (_, collider_indices) in outdoor_groups {
                outdoor_placements.push((owner, collider_indices));
            }
            for volume in &asset.static_geometry.cell_volumes {
                for portal in &volume.portals {
                    if portal.target == CellCollisionPortalTarget::Outdoor
                        && let Some(building) = portal.outdoor_building
                    {
                        building_entries.push((
                            owner,
                            Guid((owner.0 & 0xffff_0000) | u32::from(volume.cell_selector)),
                            volume,
                            portal,
                            building,
                        ));
                    }
                }
            }
        }

        for (source_owner, collider_indices) in outdoor_placements {
            let source_asset = &landblocks[&source_owner];
            let cell_bounds = outdoor_cell_bounds(
                source_owner,
                &collider_indices,
                &source_asset.static_geometry.colliders,
            );
            let references = collider_indices
                .iter()
                .copied()
                .map(|collider_index| ColliderReference {
                    owner: source_owner,
                    collider_index,
                })
                .collect::<Vec<_>>();
            for (target_owner, target_cell, volume, portal, building) in &building_entries {
                if !cell_bounds.contains(outdoor_cell_coordinates(
                    *target_owner,
                    building.building_origin,
                )) {
                    continue;
                }
                if !collider_indices.iter().copied().any(|collider_index| {
                    let collider = &source_asset.static_geometry.colliders[collider_index];
                    part_reaches_building_portal(
                        collider,
                        source_owner.0,
                        volume,
                        target_owner.0,
                        portal,
                    ) && part_box_intersects_volume(
                        collider,
                        source_owner.0,
                        volume,
                        target_owner.0,
                    )
                }) {
                    continue;
                }
                let target_asset = &landblocks[target_owner];
                for reached_cell in static_reached_cells(
                    target_owner.0,
                    target_cell.0,
                    source_owner.0,
                    &collider_indices,
                    &source_asset.static_geometry.colliders,
                    &target_asset.static_geometry.cell_volumes,
                )? {
                    index
                        .interior_colliders
                        .entry(Guid(
                            (target_owner.0 & 0xffff_0000) | u32::from(reached_cell),
                        ))
                        .or_default()
                        .extend(references.iter().copied());
                }
            }
        }

        for colliders in index
            .outdoor_cells
            .values_mut()
            .chain(index.interior_colliders.values_mut())
        {
            colliders.sort_unstable();
            colliders.dedup();
        }
        Ok(index)
    }

    /// Registers one placed collider into every global cell its bounds shadow.
    fn stamp_outdoor(
        &mut self,
        owner: Guid,
        collider: &PlacedCollider,
        reference: ColliderReference,
    ) {
        let range = GlobalCellRange::from_local_extent(
            owner,
            collider.bounds.minimum(),
            collider.bounds.maximum(),
        );
        for cell in range.cells() {
            self.outdoor_cells.entry(cell).or_default().push(reference);
        }
    }

    fn selected_colliders(
        &self,
        query_cells: GlobalCellRange,
        placement: &SpatialMembership,
    ) -> Vec<ColliderReference> {
        let mut selected = Vec::new();
        if placement.reaches_outdoors {
            for cell in query_cells.cells() {
                if let Some(colliders) = self.outdoor_cells.get(&cell) {
                    selected.extend(colliders.iter().copied());
                }
            }
        }
        for cell in &placement.reached_env_cells {
            if let Some(colliders) = self.interior_colliders.get(cell) {
                selected.extend(colliders.iter().copied());
            }
        }
        selected.sort_unstable();
        selected.dedup();
        selected
    }
}

/// Static collision geometry resident by atomic landblock owner.
#[derive(Debug, Default)]
pub struct CollisionScene {
    landblocks: HashMap<Guid, Arc<LandblockCollisionAsset>>,
    shadows: StaticShadowIndex,
}

impl CollisionScene {
    /// Creates an empty scene.
    pub fn new() -> Self {
        Self::default()
    }

    /// Atomically inserts or replaces all collision facts owned by an artifact.
    pub fn insert(
        &mut self,
        asset: LandblockCollisionAsset,
    ) -> Result<(), CollisionSceneUpdateError> {
        self.apply_residency_change(vec![asset], &[])
    }

    /// Atomically applies a resident-set delta and rebuilds static shadows exactly once.
    pub fn apply_residency_change(
        &mut self,
        insertions: Vec<LandblockCollisionAsset>,
        removals: &[Guid],
    ) -> Result<(), CollisionSceneUpdateError> {
        let next = self.staged_residency_change(insertions, removals)?;
        *self = next;
        Ok(())
    }

    /// Builds an independent resident scene while the current snapshot remains queryable.
    ///
    /// Landblock products are immutable and shared between snapshots. Only the small owner map and
    /// its derived shadow index are rebuilt, allowing a runtime to prepare residency off its
    /// simulation lock and commit the complete scene with one pointer swap.
    pub fn staged_residency_change(
        &self,
        insertions: Vec<LandblockCollisionAsset>,
        removals: &[Guid],
    ) -> Result<Self, CollisionSceneUpdateError> {
        if insertions.is_empty() && removals.is_empty() {
            return Ok(Self {
                landblocks: self.landblocks.clone(),
                shadows: self.shadows.clone(),
            });
        }

        let mut insertions_by_owner = BTreeMap::new();
        for asset in insertions {
            let owner = landblock_key(Guid(asset.landblock_id));
            if insertions_by_owner.insert(owner, asset).is_some() {
                return Err(CollisionSceneUpdateError::DuplicateInsertion { owner: owner.0 });
            }
        }
        let mut removal_owners = removals
            .iter()
            .copied()
            .map(landblock_key)
            .collect::<Vec<_>>();
        removal_owners.sort_unstable();
        removal_owners.dedup();
        if let Some(owner) = removal_owners
            .iter()
            .copied()
            .find(|owner| insertions_by_owner.contains_key(owner))
        {
            return Err(CollisionSceneUpdateError::ConflictingChange { owner: owner.0 });
        }

        let mut landblocks = self.landblocks.clone();
        for owner in removal_owners {
            landblocks.remove(&owner);
        }
        for (owner, asset) in insertions_by_owner {
            landblocks.insert(owner, Arc::new(asset));
        }
        let shadows = StaticShadowIndex::compile(&landblocks)?;
        Ok(Self {
            landblocks,
            shadows,
        })
    }

    /// Atomically evicts one landblock's terrain, shapes, and cell volumes.
    pub fn remove(&mut self, landblock_id: Guid) -> bool {
        let owner = landblock_key(landblock_id);
        let removed = self.landblocks.contains_key(&owner);
        if removed {
            self.apply_residency_change(Vec::new(), &[owner])
                .expect("eviction cannot invalidate independently validated collision assets");
        }
        removed
    }

    /// Whether the current immutable snapshot contains one exact authored EnvCell.
    pub fn contains_env_cell(&self, cell: Guid) -> bool {
        if cell.0 & 0xffff < 0x0100 {
            return false;
        }
        self.landblocks
            .get(&landblock_key(cell))
            .is_some_and(|asset| {
                asset
                    .static_geometry
                    .cell_volumes
                    .iter()
                    .any(|volume| u32::from(volume.cell_selector) == cell.0 & 0xffff)
            })
    }

    /// Whether the immutable snapshot contains one canonical outdoor collision owner.
    pub fn contains_landblock(&self, owner: Guid) -> bool {
        self.landblocks.contains_key(&landblock_key(owner))
    }

    /// Whether one authoritative body center occupies a region forbidden by its active domains.
    pub fn body_center_is_forbidden(
        &self,
        anchor: Guid,
        center: Vector3,
        placement: &SpatialMembership,
        filter: PhysicalCollisionFilter,
    ) -> bool {
        if !entirely_water_restriction_participates(placement, filter) {
            return false;
        }
        outdoor_landblock_owner_at(anchor, center)
            .and_then(|owner| self.landblocks.get(&owner))
            .is_some_and(|asset| asset.terrain.entirely_water)
    }

    /// Returns every directional obstruction at the candidate sphere position.
    pub fn movement_obstructions(
        &self,
        request: MovementObstructionRequest,
    ) -> Result<Vec<StaticContact>, CollisionQueryError> {
        validate_sweep(request.sweep)?;
        let touched = touched_landblocks(request.sweep);
        let movement = request.sweep.end - request.sweep.start;
        Ok(self.contacts(StaticContactRequest {
            touched: &touched,
            anchor: request.sweep.anchor,
            center: request.sweep.end,
            radius: request.sweep.radius,
            movement: Some(movement),
            placement: request.placement,
        }))
    }

    /// Returns optional body-primary restrictions crossed by directional movement.
    pub fn movement_restrictions(
        &self,
        request: MovementRestrictionRequest,
    ) -> Result<Vec<StaticContact>, CollisionQueryError> {
        validate_sweep(request.sweep)?;
        let touched = touched_landblocks(request.sweep);
        if !entirely_water_restriction_participates(request.placement, request.filter) {
            return Ok(Vec::new());
        }
        Ok(self.entirely_water_contacts(
            &touched,
            request.sweep.anchor,
            request.sweep.end,
            Some(request.sweep.end - request.sweep.start),
        ))
    }

    /// Returns directional grounded obstructions without collapsing polygon back faces.
    pub fn grounded_obstructions(
        &self,
        request: GroundedObstructionRequest,
    ) -> Result<Vec<GroundedObstruction>, CollisionQueryError> {
        validate_sweep(request.sweep)?;
        let touched = touched_landblocks(request.sweep);
        let movement = request.sweep.end - request.sweep.start;
        let mut contacts = Vec::new();
        for owner in &touched {
            let Some(asset) = self.landblocks.get(owner) else {
                continue;
            };
            let local_center = anchor_to_landblock(request.sweep.end, request.sweep.anchor, *owner);
            if request.placement.reaches_outdoors {
                for cell in
                    overlapped_terrain_cells(&asset.terrain, local_center, request.sweep.radius)
                {
                    for triangle in &cell.triangles {
                        if let Some(contact) =
                            terrain_contact(triangle, local_center, request.sweep.radius)
                            && movement.dot(&contact.normal) <= 0.0
                        {
                            contacts.push(GroundedObstruction {
                                separation_normal: contact.normal,
                                response_normal: contact.normal,
                                depth: contact.depth,
                            });
                        }
                    }
                }
            }
        }
        let query_cells = GlobalCellRange::from_sphere(
            request.sweep.anchor,
            request.sweep.end,
            request.sweep.radius,
        );
        for selected in self.selected_colliders(query_cells, request.placement) {
            let reference = selected.reference;
            let collider = &self.landblocks[&reference.owner].static_geometry.colliders
                [reference.collider_index];
            let local_center =
                anchor_to_landblock(request.sweep.end, request.sweep.anchor, reference.owner);
            if !collider
                .bounds
                .intersects_sphere(local_center, request.sweep.radius)
            {
                continue;
            }
            let undirected_start = contacts.len();
            match &*collider.shape {
                CollisionShape::Bsp(solid) => {
                    contacts.extend(
                        placed_solid_contacts(
                            collider,
                            solid,
                            local_center,
                            request.sweep.radius,
                            selected.center_solid,
                        )
                        .into_iter()
                        .map(|contact| GroundedObstruction {
                            separation_normal: contact.normal,
                            response_normal: contact.normal,
                            depth: contact.depth,
                        }),
                    );
                    contacts.extend(
                        placed_polygon_obstructions(
                            collider,
                            solid,
                            local_center,
                            request.sweep.radius,
                        )
                        .into_iter()
                        .map(|contact| {
                            // Orient the authored polygon normal toward the body; the shared
                            // facing filter below applies to the oriented response.
                            let response_normal =
                                if contact.polygon_normal.dot(&contact.separation.normal) >= 0.0 {
                                    contact.polygon_normal
                                } else {
                                    contact.polygon_normal * -1.0
                                };
                            GroundedObstruction {
                                separation_normal: contact.separation.normal,
                                response_normal,
                                depth: contact.separation.depth,
                            }
                        }),
                    );
                }
                CollisionShape::Cylinder(cylinder) => contacts.extend(
                    placed_cylinder_contact(collider, cylinder, local_center, request.sweep.radius)
                        .map(volume_obstruction),
                ),
                CollisionShape::Ball(ball) => contacts.extend(
                    placed_ball_contact(collider, ball, local_center, request.sweep.radius)
                        .map(volume_obstruction),
                ),
            }
            // One facing rule for every shape: keep only obstructions the movement runs into.
            retain_from(&mut contacts, undirected_start, |obstruction| {
                movement.dot(&obstruction.response_normal) <= 0.0
            });
        }
        Ok(contacts)
    }

    /// Returns every overlap at a candidate placement without directional filtering.
    pub fn placement_contacts(
        &self,
        request: PlacementRequest,
    ) -> Result<Vec<StaticContact>, CollisionQueryError> {
        let sweep = SphereSweep {
            anchor: request.anchor,
            start: request.center,
            end: request.center,
            radius: request.radius,
        };
        validate_sweep(sweep)?;
        let touched = touched_landblocks(sweep);
        Ok(self.contacts(StaticContactRequest {
            touched: &touched,
            anchor: request.anchor,
            center: request.center,
            radius: request.radius,
            movement: None,
            placement: request.placement,
        }))
    }

    /// Returns optional body-primary restrictions at a stationary placement.
    pub fn placement_restrictions(
        &self,
        request: PlacementRestrictionRequest,
    ) -> Result<Vec<StaticContact>, CollisionQueryError> {
        let sweep = SphereSweep {
            anchor: request.anchor,
            start: request.center,
            end: request.center,
            radius: request.radius,
        };
        validate_sweep(sweep)?;
        let touched = touched_landblocks(sweep);
        if !entirely_water_restriction_participates(request.placement, request.filter) {
            return Ok(Vec::new());
        }
        Ok(self.entirely_water_contacts(&touched, request.anchor, request.center, None))
    }

    /// Returns authored surfaces reachable by lowering the sphere within a finite distance.
    ///
    /// This query reports geometry only. Grounded response policy owns the walkable-normal test.
    pub fn support_contacts(
        &self,
        request: SupportRequest,
    ) -> Result<Vec<SupportContact>, CollisionQueryError> {
        validate_probe(request)?;
        let sweep = SphereSweep {
            anchor: request.anchor,
            start: request.center,
            end: request.center - Vector3::new(0.0, 0.0, request.maximum_drop),
            radius: request.radius,
        };
        let touched = touched_landblocks(sweep);

        let mut supports = Vec::new();
        for owner in &touched {
            let Some(asset) = self.landblocks.get(owner) else {
                continue;
            };
            let local_center = anchor_to_landblock(request.center, request.anchor, *owner);
            if request.placement.reaches_outdoors {
                // A settle probe is vertical, so its planar reach is only the sphere radius; the
                // drop and rise change which triangles can be reached in Z, not in XY.
                for cell in overlapped_terrain_cells(&asset.terrain, local_center, request.radius) {
                    for triangle in &cell.triangles {
                        let plane_d = -triangle.normal.dot(&triangle.vertices[0]);
                        if let Some(support) = support_on_polygon(
                            &triangle.vertices,
                            triangle.normal,
                            plane_d,
                            local_center,
                            request.radius,
                            request.maximum_drop,
                            request.maximum_rise,
                        ) {
                            supports.push(SupportContact {
                                normal: support.normal,
                                height_delta: support.height_delta,
                                feature: support.feature.into(),
                            });
                        }
                    }
                }
            }
        }
        let query_cells =
            GlobalCellRange::from_sphere(request.anchor, request.center, request.radius);
        let vertical_reach = request.radius + request.maximum_drop.max(request.maximum_rise);
        for selected in self.selected_colliders(query_cells, request.placement) {
            let reference = selected.reference;
            let collider = &self.landblocks[&reference.owner].static_geometry.colliders
                [reference.collider_index];
            let local_center = anchor_to_landblock(request.center, request.anchor, reference.owner);
            if !collider
                .bounds
                .intersects_sphere(local_center, vertical_reach)
            {
                continue;
            }
            // One contract mapping for every shape's supports.
            let mut push = |support: super::bsp_query::ShapeSupport| {
                supports.push(SupportContact {
                    normal: support.normal,
                    height_delta: support.height_delta,
                    feature: support.feature.into(),
                });
            };
            match &*collider.shape {
                CollisionShape::Bsp(solid) => placed_supports(
                    collider,
                    solid,
                    local_center,
                    request.radius,
                    request.maximum_drop,
                    request.maximum_rise,
                )
                .into_iter()
                .for_each(&mut push),
                CollisionShape::Cylinder(cylinder) => {
                    if let Some(support) = placed_cylinder_support(
                        collider,
                        cylinder,
                        local_center,
                        request.radius,
                        request.maximum_drop,
                        request.maximum_rise,
                    ) {
                        push(support);
                    }
                }
                CollisionShape::Ball(ball) => {
                    if let Some(support) = placed_ball_support(
                        collider,
                        ball,
                        local_center,
                        request.radius,
                        request.maximum_drop,
                        request.maximum_rise,
                    ) {
                        push(support);
                    }
                }
            }
        }
        Ok(supports)
    }

    /// Resolves both the center-containing cell and every collision cell reached by one sphere.
    ///
    /// Retail seeds the prior EnvCell (or outdoor land cells), expands the touched-cell array
    /// through portals, then separately selects the cell containing sphere zero's center
    /// (`CObjCell::find_cell_list`, `acclient.c:332969-333069`).
    pub fn transit_cell(
        &self,
        request: CellTransitRequest,
    ) -> Result<SpatialMembership, CollisionQueryError> {
        if let Some(previous_cell) = request.previous_cell
            && !self.contains_env_cell(previous_cell)
        {
            return Err(CollisionQueryError::UnknownMotionCell {
                cell: previous_cell.0,
            });
        }
        let sweep = SphereSweep {
            anchor: request.anchor,
            start: request.center,
            end: request.center,
            radius: request.radius,
        };
        validate_sweep(sweep)?;
        let touched = touched_landblocks(sweep);
        Ok(self.transit_cell_installed(request, &touched))
    }

    /// Resolves placement using only currently installed owners touched by `request.center`.
    fn transit_cell_installed(
        &self,
        request: CellTransitRequest,
        touched: &[Guid],
    ) -> SpatialMembership {
        let mut placement = if request.previous_cell.is_some() {
            SpatialMembership {
                committed_cell: None,
                reaches_outdoors: false,
                reached_env_cells: Vec::new(),
            }
        } else {
            SpatialMembership::outdoor()
        };

        if let Some(previous_cell) = request.previous_cell {
            let owner = landblock_key(previous_cell);
            if let Some(asset) = self.landblocks.get(&owner)
                && asset
                    .static_geometry
                    .cell_volumes
                    .iter()
                    .any(|volume| volume.cell_selector == (previous_cell.0 & 0xffff) as u16)
            {
                let local = anchor_to_landblock(request.center, request.anchor, owner);
                placement.reached_env_cells.push(previous_cell);
                expand_reached_cells(asset, owner, local, request.radius, &mut placement);
                placement.committed_cell = containing_reached_cell(asset, local, &placement);
                if !placement.reaches_outdoors {
                    return placement;
                }
            }
        }

        for owner in touched.iter().copied() {
            let local = anchor_to_landblock(request.center, request.anchor, owner);
            let Some(asset) = self.landblocks.get(&owner) else {
                continue;
            };
            for volume in &asset.static_geometry.cell_volumes {
                let is_outdoor_entry = volume
                    .portals
                    .iter()
                    .any(|portal| portal.target == CellCollisionPortalTarget::Outdoor);
                let cell = Guid((owner.0 & 0xffff_0000) | u32::from(volume.cell_selector));
                if is_outdoor_entry
                    && volume_reaches(volume, local, request.radius)
                    && !placement.reached_env_cells.contains(&cell)
                {
                    placement.reached_env_cells.push(cell);
                }
            }
            expand_reached_cells(asset, owner, local, request.radius, &mut placement);
            if placement.committed_cell.is_none() {
                placement.committed_cell = containing_reached_cell(asset, local, &placement);
            }
        }
        placement
    }

    /// Attaches exact, prior-cell-seeded placement transitions to accepted geometric motion.
    ///
    /// This operation does not solve collision or predict future motion. Callers provide every
    /// accepted bend. The scene only inserts directed portal boundaries and derives the complete
    /// spatial membership valid at each retained point.
    pub fn transit_motion_path(
        &self,
        request: PlacedMotionPathRequest<'_>,
    ) -> Result<PlacedMotionPath, CollisionQueryError> {
        validate_motion_waypoints(request.waypoints)?;
        let (initial_placement, initial_recovery) = self.placement_for_committed_cell(
            request.anchor,
            request.start,
            request.radius,
            request.previous_cell,
        )?;
        let mut path = PlacedMotionPath {
            anchor: landblock_key(request.anchor),
            initial: PlacedMotionPoint {
                center: request.start,
                placement: initial_placement,
                recovery: initial_recovery,
            },
            legs: Vec::new(),
        };
        let mut geometric_start = request.start;
        let mut geometric_start_fraction = 0.0;
        let mut current_cell = path.initial.placement.committed_cell;

        for waypoint in request.waypoints {
            let segment_leg_start = path.legs.len();
            let sweep = SphereSweep {
                anchor: request.anchor,
                start: geometric_start,
                end: waypoint.center,
                radius: request.radius,
            };
            validate_sweep(sweep)?;
            let touched = touched_landblocks(sweep);
            let transition_limit = self
                .landblocks
                .values()
                .map(|asset| {
                    asset
                        .static_geometry
                        .cell_volumes
                        .iter()
                        .map(|volume| volume.portals.len())
                        .sum::<usize>()
                })
                .sum::<usize>()
                .max(1);
            let mut transition_count = 0;
            let mut cursor = 0.0;
            let segment = PlacementMotionSegment {
                anchor: request.anchor,
                start: geometric_start,
                end: waypoint.center,
                radius: request.radius,
                touched: &touched,
            };
            while let Some(transition) =
                self.next_placement_transition(segment, cursor, current_cell)?
            {
                transition_count += 1;
                if transition_count > transition_limit {
                    return Err(CollisionQueryError::MotionTransitionLimitExceeded);
                }
                let center =
                    interpolate_point(geometric_start, waypoint.center, transition.fraction);
                let (placement, recovery) = self.placement_for_committed_cell(
                    request.anchor,
                    center,
                    request.radius,
                    transition.target_cell,
                )?;
                let end_fraction = geometric_start_fraction
                    + (waypoint.end_fraction - geometric_start_fraction) * transition.fraction;
                append_motion_leg(
                    &mut path,
                    end_fraction,
                    PlacedMotionPoint {
                        center,
                        placement,
                        recovery,
                    },
                );
                current_cell = path.final_point().placement.committed_cell;
                cursor = transition.fraction;
            }

            let inferred = self.placement_for_committed_cell(
                request.anchor,
                waypoint.center,
                request.radius,
                current_cell,
            )?;
            let (placement, recovery) = match waypoint.placement {
                MotionWaypointPlacement::Traverse => inferred,
                MotionWaypointPlacement::Committed(cell) if inferred.0.committed_cell() == cell => {
                    // Preserve explicit containment recovery when it agrees with collision
                    // response; this is the graceful escape path for an invalid retained cell.
                    inferred
                }
                MotionWaypointPlacement::Committed(cell) => {
                    // Collision response already validated this endpoint and its placement. A
                    // contradictory ordinary traversal is a numerical portal graze, so none of
                    // that segment's inferred transitions may leak into the authoritative path.
                    path.legs.truncate(segment_leg_start);
                    self.placement_for_committed_cell(
                        request.anchor,
                        waypoint.center,
                        request.radius,
                        cell,
                    )?
                }
            };
            append_motion_leg(
                &mut path,
                waypoint.end_fraction,
                PlacedMotionPoint {
                    center: waypoint.center,
                    placement,
                    recovery,
                },
            );
            current_cell = path.final_point().placement.committed_cell;
            geometric_start = waypoint.center;
            geometric_start_fraction = waypoint.end_fraction;
        }

        Ok(path)
    }

    fn placement_for_committed_cell(
        &self,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        committed_cell: Option<Guid>,
    ) -> Result<(SpatialMembership, Option<PlacementRecovery>), CollisionQueryError> {
        let mut placement = self.transit_cell(CellTransitRequest {
            previous_cell: committed_cell,
            anchor,
            center,
            radius,
        })?;
        let recovery = if let Some(previous_cell) =
            committed_cell.filter(|cell| placement.committed_cell != Some(*cell))
        {
            Some(self.recover_placement(
                anchor,
                center,
                radius,
                previous_cell,
                placement.committed_cell,
            )?)
        } else {
            None
        };
        if let Some(PlacementRecovery::Recovered { recovered_cell, .. }) = &recovery {
            placement = self.transit_cell(CellTransitRequest {
                previous_cell: *recovered_cell,
                anchor,
                center,
                radius,
            })?;
            return Ok((placement, recovery));
        }
        if recovery.is_some() {
            return Ok((placement, recovery));
        }
        placement.committed_cell = committed_cell;
        match committed_cell {
            Some(cell) => {
                if !placement.reached_env_cells.contains(&cell) {
                    placement.reached_env_cells.push(cell);
                }
            }
            None => placement.reaches_outdoors = true,
        }
        Ok((placement, recovery))
    }

    fn recover_placement(
        &self,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        previous_cell: Guid,
        transit_cell: Option<Guid>,
    ) -> Result<PlacementRecovery, CollisionQueryError> {
        let sweep = SphereSweep {
            anchor,
            start: center,
            end: center,
            radius,
        };
        validate_sweep(sweep)?;
        let touched = touched_landblocks(sweep);
        let mut candidates = touched
            .into_iter()
            .flat_map(|owner| {
                let local = anchor_to_landblock(center, anchor, owner);
                self.landblocks
                    .get(&owner)
                    .into_iter()
                    .flat_map(move |asset| {
                        asset
                            .static_geometry
                            .cell_volumes
                            .iter()
                            .filter(move |volume| volume_reaches(volume, local, 0.0))
                            .map(move |volume| {
                                Guid((owner.0 & 0xffff_0000) | u32::from(volume.cell_selector))
                            })
                    })
            })
            .collect::<Vec<_>>();
        candidates.sort_unstable();
        candidates.dedup();
        Ok(match candidates.as_slice() {
            [] => PlacementRecovery::Recovered {
                previous_cell,
                recovered_cell: None,
            },
            [cell] => PlacementRecovery::Recovered {
                previous_cell,
                recovered_cell: Some(*cell),
            },
            _ => PlacementRecovery::Ambiguous {
                previous_cell,
                candidates,
                selected_cell: transit_cell,
            },
        })
    }

    fn next_placement_transition(
        &self,
        segment: PlacementMotionSegment<'_>,
        cursor: f32,
        current_cell: Option<Guid>,
    ) -> Result<Option<PlacementTransition>, CollisionQueryError> {
        let segment_length = segment.start.distance(&segment.end);
        if segment_length <= f32::EPSILON {
            return Ok(None);
        }
        let minimum_advance = CELL_PLANE_TOLERANCE / segment_length;
        let mut selected: Option<PlacementTransition> = None;

        if let Some(cell) = current_cell {
            let owner = landblock_key(cell);
            let asset = self
                .landblocks
                .get(&owner)
                .ok_or(CollisionQueryError::UnknownMotionCell { cell: cell.0 })?;
            let source = asset
                .static_geometry
                .cell_volumes
                .iter()
                .find(|volume| volume.cell_selector == (cell.0 & 0xffff) as u16)
                .ok_or(CollisionQueryError::UnknownMotionCell { cell: cell.0 })?;
            let local_start = source.placement.to_local_space(anchor_to_landblock(
                segment.start,
                segment.anchor,
                owner,
            ));
            let local_end = source.placement.to_local_space(anchor_to_landblock(
                segment.end,
                segment.anchor,
                owner,
            ));
            for portal in &source.portals {
                let Some(fraction) = directed_plane_crossing_fraction(
                    portal.plane.distance_to_point(&local_start),
                    portal.plane.distance_to_point(&local_end),
                    portal.positive_side,
                    cursor,
                    minimum_advance,
                ) else {
                    continue;
                };
                let target_cell = match portal.target {
                    CellCollisionPortalTarget::Outdoor => self
                        .coincident_outdoor_target_after_crossing(
                            segment,
                            fraction,
                            minimum_advance,
                            cell,
                        ),
                    CellCollisionPortalTarget::EnvCell(selector) => {
                        let target = Guid((owner.0 & 0xffff_0000) | u32::from(selector));
                        if !self.target_contains_after_crossing(
                            segment.anchor,
                            segment.start,
                            segment.end,
                            fraction,
                            minimum_advance,
                            target,
                        )? {
                            continue;
                        }
                        Some(target)
                    }
                };
                select_earlier_transition(
                    &mut selected,
                    PlacementTransition {
                        fraction,
                        target_cell,
                    },
                );
            }
        } else {
            for owner in segment.touched {
                let Some(asset) = self.landblocks.get(owner) else {
                    continue;
                };
                let landblock_start = anchor_to_landblock(segment.start, segment.anchor, *owner);
                let landblock_end = anchor_to_landblock(segment.end, segment.anchor, *owner);
                for source in &asset.static_geometry.cell_volumes {
                    let local_start = source.placement.to_local_space(landblock_start);
                    let local_end = source.placement.to_local_space(landblock_end);
                    for portal in &source.portals {
                        if portal.target != CellCollisionPortalTarget::Outdoor {
                            continue;
                        }
                        let Some(fraction) = directed_plane_crossing_fraction(
                            portal.plane.distance_to_point(&local_start),
                            portal.plane.distance_to_point(&local_end),
                            !portal.positive_side,
                            cursor,
                            minimum_advance,
                        ) else {
                            continue;
                        };
                        let target_cell =
                            Guid((owner.0 & 0xffff_0000) | u32::from(source.cell_selector));
                        if !self.target_contains_after_crossing(
                            segment.anchor,
                            segment.start,
                            segment.end,
                            fraction,
                            minimum_advance,
                            target_cell,
                        )? {
                            continue;
                        }
                        select_earlier_transition(
                            &mut selected,
                            PlacementTransition {
                                fraction,
                                target_cell: Some(target_cell),
                            },
                        );
                    }
                }
            }
        }
        Ok(selected)
    }

    /// Resolves an EnvCell reached through a zero-thickness outdoor transit, when unique.
    ///
    /// Retail adds outdoor land cells to the same `CELLARRAY` and continues expanding them into
    /// building entries (`CEnvCell::find_transit_cells`, `acclient.c:334180-334430`). Our outdoor
    /// domain is implicit, so a just-beyond placement query performs that same expansion and this
    /// method collapses the two coincident boundaries into one authoritative placement change.
    fn coincident_outdoor_target_after_crossing(
        &self,
        segment: PlacementMotionSegment<'_>,
        fraction: f32,
        minimum_advance: f32,
        source_cell: Guid,
    ) -> Option<Guid> {
        let probe_fraction = (fraction + minimum_advance).min(1.0);
        let probe = interpolate_point(segment.start, segment.end, probe_fraction);
        let placement = self.transit_cell_installed(
            CellTransitRequest {
                previous_cell: Some(source_cell),
                anchor: segment.anchor,
                center: probe,
                radius: segment.radius,
            },
            segment.touched,
        );
        let mut candidates =
            placement
                .reached_env_cells()
                .iter()
                .copied()
                .filter(|cell| *cell != source_cell)
                .filter(|cell| {
                    let owner = landblock_key(*cell);
                    let local = anchor_to_landblock(probe, segment.anchor, owner);
                    let landblock_start = anchor_to_landblock(segment.start, segment.anchor, owner);
                    let landblock_end = anchor_to_landblock(segment.end, segment.anchor, owner);
                    self.landblocks.get(&owner).is_some_and(|asset| {
                        asset
                            .static_geometry
                            .cell_volumes
                            .iter()
                            .find(|volume| volume.cell_selector == (cell.0 & 0xffff) as u16)
                            .is_some_and(|volume| {
                                let local_start = volume.placement.to_local_space(landblock_start);
                                let local_end = volume.placement.to_local_space(landblock_end);
                                volume_reaches(volume, local, 0.0)
                                    && volume.portals.iter().any(|portal| {
                                        portal.target == CellCollisionPortalTarget::Outdoor
                                            && directed_plane_crossing_fraction(
                                                portal.plane.distance_to_point(&local_start),
                                                portal.plane.distance_to_point(&local_end),
                                                !portal.positive_side,
                                                0.0,
                                                0.0,
                                            )
                                            .is_some_and(|target_fraction| {
                                                (target_fraction - fraction).abs()
                                                    <= minimum_advance
                                            })
                                    })
                            })
                    })
                })
                .collect::<Vec<_>>();
        candidates.sort_unstable();
        candidates.dedup();
        match candidates.as_slice() {
            [target] => Some(*target),
            _ => None,
        }
    }

    fn target_contains_after_crossing(
        &self,
        anchor: Guid,
        start: Vector3,
        end: Vector3,
        fraction: f32,
        minimum_advance: f32,
        target_cell: Guid,
    ) -> Result<bool, CollisionQueryError> {
        let owner = landblock_key(target_cell);
        let target = self
            .landblocks
            .get(&owner)
            .and_then(|asset| {
                asset
                    .static_geometry
                    .cell_volumes
                    .iter()
                    .find(|volume| volume.cell_selector == (target_cell.0 & 0xffff) as u16)
            })
            .ok_or(CollisionQueryError::UnknownMotionCell {
                cell: target_cell.0,
            })?;
        let probe_fraction = (fraction + minimum_advance).min(1.0);
        let probe =
            anchor_to_landblock(interpolate_point(start, end, probe_fraction), anchor, owner);
        Ok(volume_reaches(target, probe, 0.0))
    }

    fn contacts(&self, request: StaticContactRequest<'_>) -> Vec<StaticContact> {
        let mut contacts = Vec::new();
        for owner in request.touched {
            let Some(asset) = self.landblocks.get(owner) else {
                continue;
            };
            let local_center = anchor_to_landblock(request.center, request.anchor, *owner);
            if request.placement.reaches_outdoors {
                for cell in overlapped_terrain_cells(&asset.terrain, local_center, request.radius) {
                    for triangle in &cell.triangles {
                        if let Some(contact) =
                            terrain_contact(triangle, local_center, request.radius)
                            && request
                                .movement
                                .is_none_or(|delta| delta.dot(&contact.normal) < 0.0)
                        {
                            contacts.push(StaticContact {
                                normal: contact.normal,
                                depth: contact.depth,
                            });
                        }
                    }
                }
            }
        }
        let query_cells =
            GlobalCellRange::from_sphere(request.anchor, request.center, request.radius);
        for selected in self.selected_colliders(query_cells, request.placement) {
            let reference = selected.reference;
            let collider = &self.landblocks[&reference.owner].static_geometry.colliders
                [reference.collider_index];
            let local_center = anchor_to_landblock(request.center, request.anchor, reference.owner);
            if !collider
                .bounds
                .intersects_sphere(local_center, request.radius)
            {
                continue;
            }
            // One movement gate and contract mapping for every shape's contacts.
            let mut push = |contact: super::bsp_query::ShapeContact| {
                if request
                    .movement
                    .is_some_and(|delta| delta.dot(&contact.normal) >= 0.0)
                {
                    return;
                }
                contacts.push(StaticContact {
                    normal: contact.normal,
                    depth: contact.depth,
                });
            };
            match &*collider.shape {
                CollisionShape::Bsp(solid) => placed_solid_contacts(
                    collider,
                    solid,
                    local_center,
                    request.radius,
                    selected.center_solid,
                )
                .into_iter()
                .chain(placed_polygon_contacts(
                    collider,
                    solid,
                    local_center,
                    request.radius,
                ))
                .for_each(&mut push),
                CollisionShape::Cylinder(cylinder) => {
                    if let Some(contact) =
                        placed_cylinder_contact(collider, cylinder, local_center, request.radius)
                    {
                        push(contact);
                    }
                }
                CollisionShape::Ball(ball) => {
                    if let Some(contact) =
                        placed_ball_contact(collider, ball, local_center, request.radius)
                    {
                        push(contact);
                    }
                }
            }
        }
        contacts
    }

    /// Synthesizes retail's whole-landblock water restriction as center-based boundary contacts.
    ///
    /// `CLandCell::find_env_collisions` rejects an `ENTIRELY_WATER` landblock before ordinary
    /// terrain response for bodies without the viewer or missile exemptions
    /// (`acclient.c:340351-340399`). The sphere radius intentionally does not move this boundary.
    fn entirely_water_contacts(
        &self,
        touched: &[Guid],
        anchor: Guid,
        center: Vector3,
        movement: Option<Vector3>,
    ) -> Vec<StaticContact> {
        let mut contacts = Vec::new();
        for owner in touched {
            let Some(asset) = self.landblocks.get(owner) else {
                continue;
            };
            if !asset.terrain.entirely_water {
                continue;
            }
            let end = anchor_to_landblock(center, anchor, *owner);
            if !inside_landblock_xy(end) {
                continue;
            }
            let start = movement.map_or(end, |delta| end - delta);
            let mut entered = false;
            if start.x < 0.0 {
                contacts.push(StaticContact {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    depth: end.x.max(0.0),
                });
                entered = true;
            } else if start.x >= METERS_PER_LANDBLOCK {
                contacts.push(StaticContact {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    depth: (METERS_PER_LANDBLOCK - end.x).max(0.0),
                });
                entered = true;
            }
            if start.y < 0.0 {
                contacts.push(StaticContact {
                    normal: Vector3::new(0.0, -1.0, 0.0),
                    depth: end.y.max(0.0),
                });
                entered = true;
            } else if start.y >= METERS_PER_LANDBLOCK {
                contacts.push(StaticContact {
                    normal: Vector3::new(0.0, 1.0, 0.0),
                    depth: (METERS_PER_LANDBLOCK - end.y).max(0.0),
                });
                entered = true;
            }
            if !entered {
                contacts.push(nearest_landblock_exit(end));
            }
        }
        contacts
    }

    fn selected_colliders(
        &self,
        query_cells: GlobalCellRange,
        placement: &SpatialMembership,
    ) -> Vec<SelectedCollider> {
        self.shadows
            .selected_colliders(query_cells, placement)
            .into_iter()
            .map(|reference| {
                let collider = &self.landblocks[&reference.owner].static_geometry.colliders
                    [reference.collider_index];
                // Retail keeps a reached building in the cell array but disables its BSP
                // center-solid test after any retained sphere reaches an EnvCell. Authored
                // polygons remain eligible for walls and walkable support (`bldg_check` and
                // `hits_interior_cell`, acclient.c:345874, 346397).
                let center_solid = !matches!(
                    collider.source_placement,
                    StaticColliderPlacement::BuildingShell { .. }
                ) || !placement.reaches_interior_in(reference.owner);
                SelectedCollider {
                    reference,
                    center_solid,
                }
            })
            .collect()
    }
}

/// Returns every 24-meter outdoor land cell shadowed by one multipart static as one rectangle.
fn outdoor_cell_bounds(
    owner: Guid,
    collider_indices: &[usize],
    colliders: &[PlacedCollider],
) -> GlobalCellRange {
    let mut boxes = collider_indices
        .iter()
        .copied()
        .map(|collider_index| colliders[collider_index].bounds);
    let first = boxes
        .next()
        .expect("a collidable static placement has at least one part box");
    let mut minimum = first.minimum();
    let mut maximum = first.maximum();
    for bounds in boxes {
        minimum.x = minimum.x.min(bounds.minimum().x);
        minimum.y = minimum.y.min(bounds.minimum().y);
        maximum.x = maximum.x.max(bounds.maximum().x);
        maximum.y = maximum.y.max(bounds.maximum().y);
    }
    GlobalCellRange::from_local_extent(owner, minimum, maximum)
}

fn outdoor_cell_coordinates(owner: Guid, point: Vector3) -> (i32, i32) {
    let range = GlobalCellRange::from_local_extent(owner, point, point);
    range.minimum
}

fn point_between_landblocks(point: Vector3, source_owner: u32, target_owner: u32) -> Vector3 {
    Vector3::new(
        point.x
            + ((((source_owner >> 24) & 0xff) as i32 - ((target_owner >> 24) & 0xff) as i32)
                as f32
                * METERS_PER_LANDBLOCK),
        point.y
            + ((((source_owner >> 16) & 0xff) as i32 - ((target_owner >> 16) & 0xff) as i32)
                as f32
                * METERS_PER_LANDBLOCK),
        point.z,
    )
}

/// Applies retail's reverse portal-side test when a building admits an outdoor static.
fn part_reaches_building_portal(
    collider: &PlacedCollider,
    collider_owner: u32,
    target: &CellVolume,
    target_owner: u32,
    portal: &CellCollisionPortal,
) -> bool {
    let bounds_radius = collider.bounds.circumradius();
    let sphere_center = target.placement.to_local_space(point_between_landblocks(
        collider.bounds.center(),
        collider_owner,
        target_owner,
    ));
    let sphere_distance = portal.plane.distance_to_point(&sphere_center);
    if portal.positive_side {
        if sphere_distance > bounds_radius + CELL_PLANE_TOLERANCE {
            return false;
        }
    } else if sphere_distance < -bounds_radius - CELL_PLANE_TOLERANCE {
        return false;
    }
    let distances = part_box_in_cell(collider, collider_owner, target, target_owner)
        .map(|corner| portal.plane.distance_to_point(&corner));
    if portal.positive_side {
        distances
            .into_iter()
            .any(|distance| distance >= -CELL_PLANE_TOLERANCE)
    } else {
        distances
            .into_iter()
            .any(|distance| distance <= CELL_PLANE_TOLERANCE)
    }
}

/// Derives retail-style per-cell shadow membership for every part of one indoor static placement.
fn static_reached_cells(
    cell_owner: u32,
    source_cell: u32,
    collider_owner: u32,
    collider_indices: &[usize],
    colliders: &[PlacedCollider],
    volumes: &[CellVolume],
) -> Result<Vec<u16>, CollisionSceneUpdateError> {
    let source_selector = source_cell as u16;
    if !volumes
        .iter()
        .any(|volume| volume.cell_selector == source_selector)
    {
        return Err(CollisionSceneUpdateError::MissingSourceCell {
            owner: cell_owner,
            cell: source_cell,
        });
    }

    let mut reached = vec![source_selector];
    let mut index = 0;
    while index < reached.len() {
        let current_selector = reached[index];
        index += 1;
        let source = volumes
            .iter()
            .find(|volume| volume.cell_selector == current_selector)
            .expect("reached cells are validated before insertion");
        for portal in &source.portals {
            let CellCollisionPortalTarget::EnvCell(target_selector) = portal.target else {
                continue;
            };
            if reached.contains(&target_selector) {
                continue;
            }
            let target = volumes
                .iter()
                .find(|volume| volume.cell_selector == target_selector)
                .ok_or(CollisionSceneUpdateError::MissingTargetCell {
                    owner: cell_owner,
                    cell: (cell_owner & 0xffff_0000) | u32::from(target_selector),
                })?;
            if collider_indices.iter().copied().any(|collider_index| {
                let collider = &colliders[collider_index];
                part_reaches_portal(collider, collider_owner, source, cell_owner, portal)
                    && part_box_intersects_volume(collider, collider_owner, target, cell_owner)
            }) {
                reached.push(target_selector);
            }
        }
    }
    Ok(reached)
}

/// Mirrors retail's sphere broad phase followed by its authored part-box portal-side test.
fn part_reaches_portal(
    collider: &PlacedCollider,
    collider_owner: u32,
    source: &CellVolume,
    cell_owner: u32,
    portal: &CellCollisionPortal,
) -> bool {
    let bounds_radius = collider.bounds.circumradius();
    let sphere_center = source.placement.to_local_space(point_between_landblocks(
        collider.bounds.center(),
        collider_owner,
        cell_owner,
    ));
    let sphere_distance = portal.plane.distance_to_point(&sphere_center);
    if portal.positive_side {
        if sphere_distance < -bounds_radius - CELL_PLANE_TOLERANCE {
            return false;
        }
    } else if sphere_distance > bounds_radius + CELL_PLANE_TOLERANCE {
        return false;
    }

    let distances = part_box_in_cell(collider, collider_owner, source, cell_owner)
        .map(|corner| portal.plane.distance_to_point(&corner));
    if portal.positive_side {
        distances
            .into_iter()
            .any(|distance| distance >= -CELL_PLANE_TOLERANCE)
    } else {
        distances
            .into_iter()
            .any(|distance| distance <= CELL_PLANE_TOLERANCE)
    }
}

fn part_box_intersects_volume(
    collider: &PlacedCollider,
    collider_owner: u32,
    volume: &CellVolume,
    cell_owner: u32,
) -> bool {
    let bounds = part_box_in_cell(collider, collider_owner, volume, cell_owner);
    volume.planes.iter().all(|plane| {
        bounds
            .iter()
            .any(|corner| plane.distance_to_point(corner) >= -CELL_PLANE_TOLERANCE)
    })
}

/// Returns the cell-local axis-aligned bounds of one transformed part.
fn part_box_in_cell(
    collider: &PlacedCollider,
    collider_owner: u32,
    volume: &CellVolume,
    cell_owner: u32,
) -> [Vector3; 8] {
    let transformed = collider.placed_box_corners().map(|corner| {
        volume.placement.to_local_space(point_between_landblocks(
            corner,
            collider_owner,
            cell_owner,
        ))
    });
    axis_box_corners(transformed)
}

fn axis_box_corners(points: [Vector3; 8]) -> [Vector3; 8] {
    let mut minimum = points[0];
    let mut maximum = points[0];
    for point in points.into_iter().skip(1) {
        minimum.x = minimum.x.min(point.x);
        minimum.y = minimum.y.min(point.y);
        minimum.z = minimum.z.min(point.z);
        maximum.x = maximum.x.max(point.x);
        maximum.y = maximum.y.max(point.y);
        maximum.z = maximum.z.max(point.z);
    }
    [
        Vector3::new(minimum.x, minimum.y, minimum.z),
        Vector3::new(minimum.x, minimum.y, maximum.z),
        Vector3::new(minimum.x, maximum.y, minimum.z),
        Vector3::new(minimum.x, maximum.y, maximum.z),
        Vector3::new(maximum.x, minimum.y, minimum.z),
        Vector3::new(maximum.x, minimum.y, maximum.z),
        Vector3::new(maximum.x, maximum.y, minimum.z),
        Vector3::new(maximum.x, maximum.y, maximum.z),
    ]
}

fn expand_reached_cells(
    asset: &LandblockCollisionAsset,
    owner: Guid,
    landblock_point: Vector3,
    radius: f32,
    placement: &mut SpatialMembership,
) {
    let mut index = 0;
    while index < placement.reached_env_cells.len() {
        let source_cell = placement.reached_env_cells[index];
        index += 1;
        if landblock_key(source_cell) != owner {
            continue;
        }
        let Some(source) = asset
            .static_geometry
            .cell_volumes
            .iter()
            .find(|volume| volume.cell_selector == (source_cell.0 & 0xffff) as u16)
        else {
            continue;
        };
        let source_local = source.placement.to_local_space(landblock_point);
        for portal in &source.portals {
            match portal.target {
                CellCollisionPortalTarget::Outdoor => {
                    let distance = portal.plane.distance_to_point(&source_local);
                    if distance.abs() < radius + CELL_PLANE_TOLERANCE {
                        placement.reaches_outdoors = true;
                    }
                }
                CellCollisionPortalTarget::EnvCell(selector) => {
                    let Some(target) = asset
                        .static_geometry
                        .cell_volumes
                        .iter()
                        .find(|volume| volume.cell_selector == selector)
                    else {
                        continue;
                    };
                    let target_cell =
                        Guid((owner.0 & 0xffff_0000) | u32::from(target.cell_selector));
                    if volume_reaches(target, landblock_point, radius)
                        && !placement.reached_env_cells.contains(&target_cell)
                    {
                        placement.reached_env_cells.push(target_cell);
                    }
                }
            }
        }
    }
}

fn containing_reached_cell(
    asset: &LandblockCollisionAsset,
    landblock_point: Vector3,
    placement: &SpatialMembership,
) -> Option<Guid> {
    placement.reached_env_cells.iter().copied().find(|cell| {
        asset
            .static_geometry
            .cell_volumes
            .iter()
            .find(|volume| volume.cell_selector == (cell.0 & 0xffff) as u16)
            .is_some_and(|volume| volume_reaches(volume, landblock_point, 0.0))
    })
}

/// Retains, in order, the tail elements from `start` that satisfy the predicate.
fn retain_from<T: Copy>(items: &mut Vec<T>, start: usize, mut keep: impl FnMut(&T) -> bool) {
    let mut kept = start;
    for index in start..items.len() {
        if keep(&items[index]) {
            items.swap(kept, index);
            kept += 1;
        }
    }
    items.truncate(kept);
}

/// Maps a volume separation contact onto the grounded obstruction contract; a volume's authored
/// surface is the solid its separation came from, so the normals coincide.
fn volume_obstruction(contact: super::bsp_query::ShapeContact) -> GroundedObstruction {
    GroundedObstruction {
        separation_normal: contact.normal,
        response_normal: contact.normal,
        depth: contact.depth,
    }
}

/// Terrain cells whose 24m footprint overlaps a sphere's contact-reachable extent, in storage
/// order.
///
/// `TerrainCollisionSurface.cells` is row-major over the authored 8x8 grid (row = Y cell,
/// column = X cell), so overlap resolves to direct index arithmetic instead of a scan.
///
/// `terrain_contact` projects a center below a triangle's plane back along the normal, so a
/// buried body reaches triangles horizontally offset by up to its vertical burial times the
/// surface's steepest planar-shift ratio. The planar reach grows by that provable bound, keeping
/// buried-body recovery contacts identical to an exhaustive scan.
fn overlapped_terrain_cells(
    terrain: &holtburger_content::TerrainCollisionSurface,
    center: Vector3,
    reach: f32,
) -> impl Iterator<Item = &holtburger_content::TerrainCollisionCell> {
    let burial = (terrain.maximum_height - (center.z - reach)).max(0.0);
    let reach = reach + (burial + reach) * terrain.maximum_planar_shift_ratio;
    let side = holtburger_content::TERRAIN_GRID_CELLS as i32;
    let clamped_range = move |minimum: f32, maximum: f32| {
        let low = (minimum / OUTDOOR_CELL_METERS).floor().max(0.0) as i32;
        let high = (maximum / OUTDOOR_CELL_METERS)
            .floor()
            .min((side - 1) as f32) as i32;
        low..=high
    };
    // Authored surfaces always carry the full row-major grid, which direct indexing requires.
    // Synthetic surfaces may carry any subset with no coordinate meaning, so they keep the
    // exhaustive scan.
    let indexed = terrain.cells.len() == (side * side) as usize;
    let columns = clamped_range(center.x - reach, center.x + reach);
    let indexed_cells = indexed.then(move || {
        clamped_range(center.y - reach, center.y + reach).flat_map(move |row| {
            columns
                .clone()
                .map(move |column| &terrain.cells[(row * side + column) as usize])
        })
    });
    let scan = if indexed {
        0..0
    } else {
        0..terrain.cells.len()
    };
    scan.map(|index| &terrain.cells[index])
        .chain(indexed_cells.into_iter().flatten())
}

fn terrain_contact(
    triangle: &TerrainCollisionTriangle,
    center: Vector3,
    radius: f32,
) -> Option<StaticContact> {
    let plane_d = -triangle.normal.dot(&triangle.vertices[0]);
    let distance = triangle.normal.dot(&center) + plane_d;
    // Use the same authored-contact tolerance as polygon queries. A support probe followed by
    // placement confirmation can differ by a few float ULPs at exact tangency; reporting that as
    // penetration prevents an otherwise valid grounded pose from committing.
    if distance >= radius - CELL_PLANE_TOLERANCE {
        return None;
    }
    let projected = center - triangle.normal * distance;
    if !point_in_triangle(projected, triangle.vertices, triangle.normal) {
        return None;
    }
    Some(StaticContact {
        normal: triangle.normal,
        depth: radius - distance,
    })
}

fn point_in_triangle(point: Vector3, vertices: [Vector3; 3], normal: Vector3) -> bool {
    (0..3).all(|index| {
        let start = vertices[index];
        let end = vertices[(index + 1) % 3];
        (point - start).dot(&normal.cross(&(end - start))) >= -CELL_PLANE_TOLERANCE
    })
}

fn volume_reaches(
    volume: &holtburger_content::CellVolume,
    landblock_point: Vector3,
    radius: f32,
) -> bool {
    let local = volume.placement.to_local_space(landblock_point);
    volume
        .planes
        .iter()
        .all(|plane| plane.distance_to_point(&local) >= -(CELL_PLANE_TOLERANCE + radius.max(0.0)))
}

fn validate_motion_waypoints(waypoints: &[MotionWaypoint]) -> Result<(), CollisionQueryError> {
    if waypoints.is_empty() {
        return Err(CollisionQueryError::EmptyMotionPath);
    }
    let mut previous = 0.0;
    for waypoint in waypoints {
        if !waypoint.end_fraction.is_finite() {
            return Err(CollisionQueryError::NonFiniteMotionFraction);
        }
        if waypoint.end_fraction <= 0.0 || waypoint.end_fraction > 1.0 {
            return Err(CollisionQueryError::MotionFractionOutOfRange);
        }
        if waypoint.end_fraction <= previous {
            return Err(CollisionQueryError::NonIncreasingMotionFraction);
        }
        previous = waypoint.end_fraction;
    }
    if previous != 1.0 {
        return Err(CollisionQueryError::IncompleteMotionPath);
    }
    Ok(())
}

fn directed_plane_crossing_fraction(
    start_distance: f32,
    end_distance: f32,
    target_is_positive: bool,
    cursor: f32,
    minimum_advance: f32,
) -> Option<f32> {
    let oriented_start = if target_is_positive {
        start_distance
    } else {
        -start_distance
    };
    let oriented_end = if target_is_positive {
        end_distance
    } else {
        -end_distance
    };
    let delta = oriented_end - oriented_start;
    if delta <= f32::EPSILON {
        return None;
    }
    let mut fraction = -oriented_start / delta;
    if fraction > 1.0 {
        // A prior placement pass may emit this exact portal boundary as a waypoint. Transforming
        // that world point back into authored local space can leave it a few float ULPs short of
        // the plane. Commit the endpoint crossing inside the same tolerance used by cell reach.
        if oriented_end < -CELL_PLANE_TOLERANCE {
            return None;
        }
        fraction = 1.0;
    }
    if fraction <= cursor + minimum_advance {
        return None;
    }
    Some(fraction.clamp(0.0, 1.0))
}

fn interpolate_point(start: Vector3, end: Vector3, fraction: f32) -> Vector3 {
    start + (end - start) * fraction
}

fn select_earlier_transition(
    selected: &mut Option<PlacementTransition>,
    candidate: PlacementTransition,
) {
    if selected
        .as_ref()
        .is_none_or(|current| candidate.fraction < current.fraction - f32::EPSILON)
    {
        *selected = Some(candidate);
    }
}

fn append_motion_leg(path: &mut PlacedMotionPath, end_fraction: f32, mut end: PlacedMotionPoint) {
    if let Some(last) = path.legs.last_mut()
        && (last.end_fraction - end_fraction).abs() <= f32::EPSILON
    {
        // Multiple zero-duration topology boundaries collapse to the final authoritative placement
        // at that instant. A non-zero-width intermediate cell still receives its own leg.
        if end.recovery.is_none() {
            end.recovery = last.end.recovery.take();
        }
        last.end = end;
        return;
    }
    debug_assert!(
        path.legs
            .last()
            .is_none_or(|last| end_fraction > last.end_fraction)
    );
    path.legs.push(PlacedMotionLeg { end_fraction, end });
}

fn validate_sweep(request: SphereSweep) -> Result<(), CollisionQueryError> {
    if !request.start.x.is_finite()
        || !request.start.y.is_finite()
        || !request.start.z.is_finite()
        || !request.end.x.is_finite()
        || !request.end.y.is_finite()
        || !request.end.z.is_finite()
    {
        return Err(CollisionQueryError::NonFiniteCenter);
    }
    if !request.radius.is_finite() || request.radius <= 0.0 {
        return Err(CollisionQueryError::InvalidRadius);
    }
    Ok(())
}

fn validate_probe(request: SupportRequest) -> Result<(), CollisionQueryError> {
    validate_sweep(SphereSweep {
        anchor: request.anchor,
        start: request.center,
        end: request.center,
        radius: request.radius,
    })?;
    if !request.maximum_drop.is_finite()
        || request.maximum_drop < 0.0
        || !request.maximum_rise.is_finite()
        || request.maximum_rise < 0.0
    {
        return Err(CollisionQueryError::InvalidDistance);
    }
    Ok(())
}

fn touched_landblocks(request: SphereSweep) -> Vec<Guid> {
    let minimum = Vector3::new(
        request.start.x.min(request.end.x) - request.radius,
        request.start.y.min(request.end.y) - request.radius,
        0.0,
    );
    let maximum = Vector3::new(
        request.start.x.max(request.end.x) + request.radius,
        request.start.y.max(request.end.y) + request.radius,
        0.0,
    );
    let anchor = landblock_key(request.anchor);
    let anchor_x = i64::from((anchor.0 >> 24) & 0xff);
    let anchor_y = i64::from((anchor.0 >> 16) & 0xff);
    let min_x = anchor_x.saturating_add((minimum.x / METERS_PER_LANDBLOCK).floor() as i64);
    let min_y = anchor_y.saturating_add((minimum.y / METERS_PER_LANDBLOCK).floor() as i64);
    let max_x = anchor_x.saturating_add((maximum.x / METERS_PER_LANDBLOCK).floor() as i64);
    let max_y = anchor_y.saturating_add((maximum.y / METERS_PER_LANDBLOCK).floor() as i64);
    let maximum_axis = i64::from(MAX_OUTDOOR_LANDBLOCK_AXIS);
    let first_x = min_x.max(0);
    let first_y = min_y.max(0);
    let last_x = max_x.min(maximum_axis);
    let last_y = max_y.min(maximum_axis);
    if first_x > last_x || first_y > last_y {
        return Vec::new();
    }
    let mut touched = Vec::new();
    for x in first_x..=last_x {
        for y in first_y..=last_y {
            touched.push(Guid(((x as u32) << 24) | ((y as u32) << 16) | 0xffff));
        }
    }
    touched
}

pub(super) fn landblock_key(landblock_id: Guid) -> Guid {
    Guid((landblock_id.0 & 0xffff_0000) | 0xffff)
}

fn inside_landblock_xy(point: Vector3) -> bool {
    (0.0..METERS_PER_LANDBLOCK).contains(&point.x) && (0.0..METERS_PER_LANDBLOCK).contains(&point.y)
}

fn entirely_water_restriction_participates(
    placement: &SpatialMembership,
    filter: PhysicalCollisionFilter,
) -> bool {
    placement.reaches_outdoors
        && !filter.excludes(PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER)
}

fn nearest_landblock_exit(point: Vector3) -> StaticContact {
    let candidates = [
        (point.x, Vector3::new(-1.0, 0.0, 0.0)),
        (METERS_PER_LANDBLOCK - point.x, Vector3::new(1.0, 0.0, 0.0)),
        (point.y, Vector3::new(0.0, -1.0, 0.0)),
        (METERS_PER_LANDBLOCK - point.y, Vector3::new(0.0, 1.0, 0.0)),
    ];
    let (depth, normal) = candidates
        .into_iter()
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .expect("a landblock always has four boundary faces");
    StaticContact { normal, depth }
}

/// Collapses parallel contacts and returns the finite displacement that clears all of them.
pub(super) fn separating_displacement(contacts: &[StaticContact], epsilon: f32) -> Vector3 {
    let mut constraints: Vec<(Vector3, f32)> = Vec::new();
    for contact in contacts {
        if let Some((_, depth)) = constraints
            .iter_mut()
            .find(|(normal, _)| normal.dot(&contact.normal) > 0.999)
        {
            *depth = depth.max(contact.depth);
        } else {
            constraints.push((contact.normal, contact.depth));
        }
    }
    constraints
        .into_iter()
        .fold(Vector3::zero(), |offset, (normal, depth)| {
            offset + normal * (depth + epsilon)
        })
}

fn anchor_to_landblock(point: Vector3, anchor: Guid, landblock: Guid) -> Vector3 {
    let anchor = landblock_key(anchor);
    Vector3::new(
        point.x
            + ((((anchor.0 >> 24) & 0xff) as i32 - ((landblock.0 >> 24) & 0xff) as i32) as f32
                * METERS_PER_LANDBLOCK),
        point.y
            + ((((anchor.0 >> 16) & 0xff) as i32 - ((landblock.0 >> 16) & 0xff) as i32) as f32
                * METERS_PER_LANDBLOCK),
        point.z,
    )
}

/// Converts an anchor-local point into the authored frame of a committed EnvCell.
pub(super) fn anchor_point_to_cell_position(
    anchor: Guid,
    point: Vector3,
    cell: Guid,
    rotation: holtburger_common::Quaternion,
) -> WorldPosition {
    WorldPosition {
        landblock_id: cell,
        coords: anchor_to_landblock(point, anchor, cell),
        rotation,
    }
}

/// Converts an anchor-local point into an outdoor pose without large absolute f32 coordinates.
pub(super) fn anchor_point_to_outdoor_position(
    anchor: Guid,
    point: Vector3,
    rotation: holtburger_common::Quaternion,
) -> WorldPosition {
    let Some(owner) = outdoor_landblock_owner_at(anchor, point) else {
        return WorldPosition {
            landblock_id: Guid(anchor.0 & 0xffff_0000),
            coords: point,
            rotation,
        };
    };
    WorldPosition {
        // A pose carries an outdoor cell selector, not the root record's 0xFFFF selector.
        landblock_id: Guid(owner.0 & 0xffff_0000),
        coords: anchor_to_landblock(point, anchor, owner),
        rotation,
    }
    .normalize_outdoor_cell()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use holtburger_common::{Plane, Quaternion, Sphere};
    use holtburger_content::{
        BspSolid, ColliderScale, CollisionBall, CollisionBox, CollisionCylinder, CollisionPolygon,
        CollisionShape, LandblockColliders, LandblockPlacement, OutdoorBuildingTransit,
        StaticColliderPlacement, TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode};

    use super::*;

    fn collider_at(x: f32, source_placement: StaticColliderPlacement) -> PlacedCollider {
        let center = Vector3::new(x, 0.0, 0.0);
        let bounds = Sphere {
            center: Vector3::zero(),
            radius: 1.0,
        };
        PlacedCollider {
            geometry: holtburger_content::PlacedCollisionShape {
                shape: Arc::new(CollisionShape::Bsp(BspSolid {
                    bsp: BspNode::Leaf(BspLeaf {
                        index: 0,
                        solid: 0,
                        sphere: Some(bounds),
                        poly_ids: Vec::new(),
                    }),
                    bounds,
                    box_bounds: CollisionBox::from_points([
                        Vector3::new(-1.0, -1.0, -1.0),
                        Vector3::new(1.0, 1.0, 1.0),
                    ])
                    .unwrap(),
                    polygons: HashMap::new(),
                })),
                placement: LandblockPlacement {
                    origin: center,
                    orientation: Quaternion::identity(),
                },
                scale: ColliderScale::uniform(1.0).unwrap(),
                bounds: CollisionBox::from_points([
                    center - Vector3::new(1.0, 1.0, 1.0),
                    center + Vector3::new(1.0, 1.0, 1.0),
                ])
                .unwrap(),
            },
            source_placement,
        }
    }

    fn owner_cells(owner: Guid) -> GlobalCellRange {
        GlobalCellRange::from_local_extent(
            owner,
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(191.9, 191.9, 0.0),
        )
    }

    fn outdoor_asset(owner: Guid, colliders: Vec<PlacedCollider>) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
            landblock_id: owner.0,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders {
                colliders,
                cell_volumes: Vec::new(),
            },
        }
    }

    fn sweep(
        scene: &CollisionScene,
        owner: Guid,
        start: Vector3,
        end: Vector3,
        radius: f32,
    ) -> StaticSphereSweepHit {
        scene
            .sweep_static_sphere(StaticSphereSweepRequest {
                anchor: owner,
                start,
                end,
                previous_cell: None,
                radius,
                filter: PhysicalCollisionFilter::ALL,
            })
            .unwrap()
            .expect("fixture sweep must hit")
    }

    #[test]
    fn static_sphere_sweep_finds_ball_and_cylinder_time_of_impact() {
        let owner = Guid(0xda55_ffff);
        for shape in [
            Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 1.0,
            })),
            Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                low_point: Vector3::new(0.0, 0.0, -2.0),
                radius: 1.0,
                height: 4.0,
            })),
        ] {
            let collider = PlacedCollider::new(
                shape,
                LandblockPlacement {
                    origin: Vector3::new(5.0, 10.0, 10.0),
                    orientation: Quaternion::identity(),
                },
                ColliderScale::uniform(1.0).unwrap(),
                StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
            )
            .unwrap();
            let mut scene = CollisionScene::new();
            scene.insert(outdoor_asset(owner, vec![collider])).unwrap();

            let hit = sweep(
                &scene,
                owner,
                Vector3::new(0.0, 10.0, 10.0),
                Vector3::new(10.0, 10.0, 10.0),
                0.5,
            );
            assert!((hit.time_of_impact - 0.35).abs() < 0.000_1, "{hit:?}");
        }
    }

    #[test]
    fn static_sphere_sweep_finds_a_thin_bsp_polygon_without_endpoint_overlap() {
        let owner = Guid(0xda55_ffff);
        let vertices = vec![
            Vector3::new(5.0, 8.0, 8.0),
            Vector3::new(5.0, 8.0, 12.0),
            Vector3::new(5.0, 12.0, 12.0),
            Vector3::new(5.0, 12.0, 8.0),
        ];
        let bounds = Sphere {
            center: Vector3::new(5.0, 10.0, 10.0),
            radius: 3.0,
        };
        let collider = PlacedCollider::new(
            Arc::new(CollisionShape::Bsp(BspSolid {
                bsp: BspNode::Leaf(BspLeaf {
                    index: 0,
                    solid: 0,
                    sphere: Some(bounds),
                    poly_ids: vec![1],
                }),
                bounds,
                box_bounds: CollisionBox::from_points(vertices.iter().copied()).unwrap(),
                polygons: HashMap::from([(
                    1,
                    CollisionPolygon {
                        vertices,
                        normal: Vector3::new(-1.0, 0.0, 0.0),
                        d: 5.0,
                    },
                )]),
            })),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap();
        let mut scene = CollisionScene::new();
        scene.insert(outdoor_asset(owner, vec![collider])).unwrap();

        let hit = sweep(
            &scene,
            owner,
            Vector3::new(0.0, 10.0, 10.0),
            Vector3::new(10.0, 10.0, 10.0),
            0.5,
        );
        assert!((hit.time_of_impact - 0.45).abs() < 0.000_1, "{hit:?}");
        assert_eq!(hit.normal, Vector3::new(-1.0, 0.0, 0.0));
    }

    #[test]
    fn static_sphere_sweep_finds_terrain_time_of_impact() {
        let owner = Guid(0xda55_ffff);
        let terrain =
            TerrainCollisionSurface::from_terrain(&holtburger_content::LandblockTerrain {
                grid_size: 9,
                tile_size: 24.0,
                height_indices: vec![0; 81],
                heights: vec![0.0; 81],
                terrain_samples: vec![0; 81],
                cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(owner.0),
            })
            .unwrap();
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: owner.0,
                terrain,
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();

        let hit = sweep(
            &scene,
            owner,
            Vector3::new(96.0, 96.0, 5.0),
            Vector3::new(96.0, 96.0, -5.0),
            0.5,
        );
        assert!((hit.time_of_impact - 0.45).abs() < 0.000_1, "{hit:?}");
        assert_eq!(hit.normal, Vector3::new(0.0, 0.0, 1.0));
    }

    #[test]
    fn static_sphere_sweep_finds_an_entirely_water_boundary() {
        let west = Guid(0xda55_ffff);
        let east = Guid(0xdb55_ffff);
        let mut scene = CollisionScene::new();
        scene.insert(outdoor_asset(west, Vec::new())).unwrap();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: east.0,
                terrain: TerrainCollisionSurface {
                    cells: Vec::new(),
                    entirely_water: true,
                    maximum_height: f32::NEG_INFINITY,
                    maximum_planar_shift_ratio: 0.0,
                },
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();

        let hit = sweep(
            &scene,
            west,
            Vector3::new(190.0, 96.0, 10.0),
            Vector3::new(194.0, 96.0, 10.0),
            0.5,
        );
        assert!((hit.time_of_impact - 0.5).abs() < f32::EPSILON, "{hit:?}");
        assert_eq!(hit.normal, Vector3::new(-1.0, 0.0, 0.0));
    }

    /// Test-only full-scan oracle: every resident collider and terrain triangle, no selection.
    ///
    /// Shares the narrow phase with production on purpose — this differential proves the cell
    /// index selects a superset of everything that can contact, never that the narrow phase is
    /// correct (the retail differentials own that).
    fn full_scan_contacts(
        scene: &CollisionScene,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        placement: &SpatialMembership,
    ) -> Vec<(u32, u32, u32, u32)> {
        let mut contacts = Vec::new();
        for (owner, asset) in &scene.landblocks {
            let local_center = anchor_to_landblock(center, anchor, *owner);
            if placement.reaches_outdoors {
                for cell in &asset.terrain.cells {
                    for triangle in &cell.triangles {
                        if let Some(contact) = terrain_contact(triangle, local_center, radius) {
                            contacts.push(contact_bits(contact.normal, contact.depth));
                        }
                    }
                }
            }
            for collider in &asset.static_geometry.colliders {
                let selectable = match collider.source_placement {
                    StaticColliderPlacement::OutdoorExplicit { .. }
                    | StaticColliderPlacement::OutdoorGenerated { .. }
                    | StaticColliderPlacement::BuildingShell { .. } => placement.reaches_outdoors,
                    StaticColliderPlacement::EnvCellShell { cell_id } => placement
                        .reached_env_cells
                        .contains(&Guid((owner.0 & 0xffff_0000) | (cell_id & 0xffff))),
                    // Indoor statics shadow through reached-cell traversal; the seam cases this
                    // differential covers are outdoor, so restrict the oracle to outdoor kinds.
                    StaticColliderPlacement::IndoorStatic { .. } => false,
                };
                if !selectable {
                    continue;
                }
                let center_solid = !matches!(
                    collider.source_placement,
                    StaticColliderPlacement::BuildingShell { .. }
                ) || !placement.reaches_interior_in(*owner);
                let shape_contacts: Vec<_> = match &*collider.shape {
                    CollisionShape::Bsp(solid) => {
                        placed_solid_contacts(collider, solid, local_center, radius, center_solid)
                            .into_iter()
                            .chain(placed_polygon_contacts(
                                collider,
                                solid,
                                local_center,
                                radius,
                            ))
                            .collect()
                    }
                    CollisionShape::Cylinder(cylinder) => {
                        placed_cylinder_contact(collider, cylinder, local_center, radius)
                            .into_iter()
                            .collect()
                    }
                    CollisionShape::Ball(ball) => {
                        placed_ball_contact(collider, ball, local_center, radius)
                            .into_iter()
                            .collect()
                    }
                };
                for contact in shape_contacts {
                    contacts.push(contact_bits(contact.normal, contact.depth));
                }
            }
        }
        contacts.sort_unstable();
        contacts
    }

    /// Buried centers reach horizontally offset sloped triangles through the projection in
    /// `terrain_contact`; indexed terrain selection must reproduce that recovery surface exactly.
    #[test]
    fn indexed_terrain_selection_reproduces_full_scan_contacts_for_buried_centers() {
        let owner = Guid(0xda55_ffff);
        // A steep west-to-east ramp: heights rise 4m per 24m column.
        let heights: Vec<f32> = (0..81).map(|index| (index / 9) as f32 * 4.0).collect();
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: owner.0,
                terrain: TerrainCollisionSurface::from_terrain(
                    &holtburger_content::LandblockTerrain {
                        grid_size: 9,
                        tile_size: 24.0,
                        height_indices: vec![0; 81],
                        heights,
                        terrain_samples: vec![0; 81],
                        cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(
                            owner.0,
                        ),
                    },
                )
                .unwrap(),
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();

        let placement = SpatialMembership::outdoor();
        let mut total_contacts = 0usize;
        for (x, y, z) in [
            (96.0, 96.0, -20.0),
            (150.0, 40.0, 0.0),
            (60.0, 120.0, 5.0),
            (180.0, 96.0, -5.0),
        ] {
            let center = Vector3::new(x, y, z);
            let mut indexed: Vec<_> = scene
                .placement_contacts(PlacementRequest {
                    anchor: owner,
                    center,
                    radius: 0.5,
                    placement: &placement,
                })
                .unwrap()
                .into_iter()
                .map(|contact| contact_bits(contact.normal, contact.depth))
                .collect();
            indexed.sort_unstable();
            let full = full_scan_contacts(&scene, owner, center, 0.5, &placement);
            assert_eq!(
                indexed, full,
                "buried terrain selection diverged at ({x}, {y}, {z})"
            );
            total_contacts += indexed.len();
        }
        assert!(
            total_contacts >= 4,
            "buried parity ran vacuously: {total_contacts} contacts"
        );
    }

    fn contact_bits(normal: Vector3, depth: f32) -> (u32, u32, u32, u32) {
        (
            normal.x.to_bits(),
            normal.y.to_bits(),
            normal.z.to_bits(),
            depth.to_bits(),
        )
    }

    /// Bit-exact contact parity between the cell-indexed selection and a full scan, sampled over
    /// a two-owner scene whose colliders straddle the shared seam.
    #[test]
    fn indexed_selection_reproduces_full_scan_contacts_across_a_landblock_seam() {
        let west = Guid(0xda55_ffff);
        let east = Guid(0xdb55_ffff);
        let mut scene = CollisionScene::new();
        for (owner, xs) in [(west, [20.0, 190.5]), (east, [1.5, 100.0])] {
            let colliders = xs
                .into_iter()
                .enumerate()
                .map(|(index, x)| {
                    // Cylinders guarantee real contact geometry; the hollow BSP fixture used by
                    // the selection tests never produces contacts.
                    PlacedCollider::new(
                        Arc::new(CollisionShape::Cylinder(
                            holtburger_content::CollisionCylinder {
                                low_point: Vector3::zero(),
                                radius: 1.0,
                                height: 4.0,
                            },
                        )),
                        LandblockPlacement {
                            // Vary y so seam probes cross multiple cells.
                            origin: Vector3::new(x, 12.0 * (index as f32 + 1.0), -2.0),
                            orientation: Quaternion::identity(),
                        },
                        ColliderScale::uniform(1.0).unwrap(),
                        StaticColliderPlacement::OutdoorExplicit {
                            source_index: index,
                        },
                    )
                    .unwrap()
                })
                .collect();
            scene
                .insert(LandblockCollisionAsset {
                    landblock_id: owner.0,
                    terrain: TerrainCollisionSurface::empty(),
                    static_geometry: LandblockColliders {
                        colliders,
                        cell_volumes: Vec::new(),
                    },
                })
                .unwrap();
        }

        let placement = SpatialMembership::outdoor();
        let mut total_contacts = 0usize;
        // Anchor-west probes spanning both owners, including straight over the seam and points
        // near the varied collider rows.
        for (x, y) in [
            (19.5, 12.0),
            (190.4, 24.0),
            (191.9, 12.0),
            (193.4, 24.0),
            (292.0, 24.0),
            (96.0, 96.0),
        ] {
            let center = Vector3::new(x, y, 0.0);
            let mut indexed: Vec<_> = scene
                .placement_contacts(PlacementRequest {
                    anchor: west,
                    center,
                    radius: 1.2,
                    placement: &placement,
                })
                .unwrap()
                .into_iter()
                .map(|contact| contact_bits(contact.normal, contact.depth))
                .collect();
            indexed.sort_unstable();
            let full = full_scan_contacts(&scene, west, center, 1.2, &placement);
            assert_eq!(
                indexed, full,
                "indexed selection diverged from the full scan at ({x}, {y})"
            );
            total_contacts += indexed.len();
        }
        assert!(
            total_contacts >= 3,
            "parity ran vacuously: only {total_contacts} contacts across all probes"
        );
    }

    fn volume(selector: u16, portals: Vec<CellCollisionPortal>) -> CellVolume {
        CellVolume {
            cell_selector: selector,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: Vec::new(),
            portals,
        }
    }

    fn scene(colliders: Vec<PlacedCollider>, cell_volumes: Vec<CellVolume>) -> CollisionScene {
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders {
                    colliders,
                    cell_volumes,
                },
            })
            .unwrap();
        scene
    }

    fn placement_scene(cell_volumes: Vec<CellVolume>) -> CollisionScene {
        let mut center_volumes = Some(cell_volumes);
        let mut scene = CollisionScene::new();
        for x in 0xd8..=0xdc {
            for y in 0x53..=0x57 {
                let center = x == 0xda && y == 0x55;
                scene
                    .insert(LandblockCollisionAsset {
                        landblock_id: (x << 24) | (y << 16) | 0xffff,
                        terrain: TerrainCollisionSurface::empty(),
                        static_geometry: LandblockColliders {
                            colliders: Vec::new(),
                            cell_volumes: if center {
                                center_volumes.take().unwrap()
                            } else {
                                Vec::new()
                            },
                        },
                    })
                    .unwrap();
            }
        }
        scene
    }

    fn entirely_water_boundary_scene() -> CollisionScene {
        let mut scene = placement_scene(Vec::new());
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: 0xdb55_ffff,
                terrain: TerrainCollisionSurface {
                    entirely_water: true,
                    ..TerrainCollisionSurface::empty()
                },
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();
        scene
    }

    fn portal(normal_x: f32, d: f32, target: CellCollisionPortalTarget) -> CellCollisionPortal {
        CellCollisionPortal {
            plane: Plane {
                normal: Vector3::new(normal_x, 0.0, 0.0),
                d,
            },
            positive_side: true,
            target,
            outdoor_building: None,
        }
    }

    fn coincident_outdoor_cells() -> Vec<CellVolume> {
        vec![
            CellVolume {
                cell_selector: 0x010a,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                planes: vec![Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 100.0,
                }],
                portals: vec![portal(1.0, -100.0, CellCollisionPortalTarget::Outdoor)],
            },
            CellVolume {
                cell_selector: 0x010b,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                planes: vec![Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -100.0,
                }],
                portals: vec![portal(-1.0, 100.0, CellCollisionPortalTarget::Outdoor)],
            },
        ]
    }

    fn references(indices: impl IntoIterator<Item = usize>) -> Vec<ColliderReference> {
        indices
            .into_iter()
            .map(|collider_index| ColliderReference {
                owner: Guid(0xda55_ffff),
                collider_index,
            })
            .collect()
    }

    #[test]
    fn terrain_tangency_tolerance_does_not_reject_settled_support() {
        let triangle = TerrainCollisionTriangle {
            vertices: [
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(10.0, 0.0, 0.0),
                Vector3::new(0.0, 10.0, 0.0),
            ],
            normal: Vector3::new(0.0, 0.0, 1.0),
        };
        assert!(
            terrain_contact(&triangle, Vector3::new(1.0, 1.0, 0.999_9), 1.0).is_none(),
            "sub-tolerance float drift became placement penetration"
        );
        assert!(
            terrain_contact(&triangle, Vector3::new(1.0, 1.0, 0.999), 1.0).is_some(),
            "meaningful terrain penetration was hidden by tolerance"
        );
    }

    #[test]
    fn entirely_water_boundary_obstructs_ordinary_bodies_but_honors_explicit_exclusion() {
        let scene = entirely_water_boundary_scene();
        let sweep = SphereSweep {
            anchor: Guid(0xda55_ffff),
            start: Vector3::new(191.9, 96.0, 50.0),
            end: Vector3::new(192.1, 96.0, 50.0),
            radius: 0.25,
        };
        let placement = SpatialMembership::outdoor();
        let contacts = scene
            .movement_restrictions(MovementRestrictionRequest {
                sweep,
                placement: &placement,
                filter: PhysicalCollisionFilter::ALL,
            })
            .unwrap();
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].normal, Vector3::new(-1.0, 0.0, 0.0));
        assert!((contacts[0].depth - (sweep.end.x - METERS_PER_LANDBLOCK)).abs() < f32::EPSILON);

        let barrier_exempt =
            PhysicalCollisionFilter::excluding(PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER);
        let exempt_contacts = scene
            .movement_restrictions(MovementRestrictionRequest {
                sweep,
                placement: &placement,
                filter: barrier_exempt,
            })
            .unwrap();
        assert!(exempt_contacts.is_empty());

        let placement_contacts = scene
            .placement_restrictions(PlacementRestrictionRequest {
                anchor: sweep.anchor,
                center: sweep.end,
                radius: sweep.radius,
                placement: &placement,
                filter: PhysicalCollisionFilter::ALL,
            })
            .unwrap();
        assert_eq!(placement_contacts.len(), 1);
        assert_eq!(placement_contacts[0].normal, Vector3::new(-1.0, 0.0, 0.0));
    }

    #[test]
    fn direct_queries_reject_invalid_geometry() {
        let scene = CollisionScene::new();
        let request = SphereSweep {
            anchor: Guid(0xda55_ffff),
            start: Vector3::zero(),
            end: Vector3::zero(),
            radius: 0.0,
        };
        assert_eq!(
            scene.movement_obstructions(MovementObstructionRequest {
                sweep: request,
                placement: &SpatialMembership::outdoor(),
            }),
            Err(CollisionQueryError::InvalidRadius)
        );
        assert_eq!(
            scene.movement_obstructions(MovementObstructionRequest {
                sweep: SphereSweep {
                    start: Vector3::new(f32::NAN, 0.0, 0.0),
                    radius: 1.0,
                    ..request
                },
                placement: &SpatialMembership::outdoor(),
            }),
            Err(CollisionQueryError::NonFiniteCenter)
        );
        assert_eq!(
            scene.support_contacts(SupportRequest {
                anchor: request.anchor,
                center: request.start,
                radius: 1.0,
                maximum_drop: -1.0,
                maximum_rise: 0.0,
                placement: &SpatialMembership::outdoor(),
            }),
            Err(CollisionQueryError::InvalidDistance)
        );
        assert_eq!(
            scene.support_contacts(SupportRequest {
                anchor: request.anchor,
                center: request.start,
                radius: 1.0,
                maximum_drop: 0.0,
                maximum_rise: f32::NAN,
                placement: &SpatialMembership::outdoor(),
            }),
            Err(CollisionQueryError::InvalidDistance)
        );
    }

    #[test]
    fn extreme_finite_sweep_outside_the_landscape_is_empty_space() {
        let scene = CollisionScene::new();
        let contacts = scene
            .movement_obstructions(MovementObstructionRequest {
                sweep: SphereSweep {
                    anchor: Guid(0xda55_ffff),
                    start: Vector3::new(f32::MAX, f32::MIN, 20.0),
                    end: Vector3::new(f32::MAX, f32::MIN, 20.0),
                    radius: 0.25,
                },
                placement: &SpatialMembership::outdoor(),
            })
            .unwrap();

        assert!(contacts.is_empty());
    }

    #[test]
    fn placed_motion_validation_names_each_invalid_timing_shape() {
        let scene = CollisionScene::new();
        fn request(waypoints: &[MotionWaypoint]) -> PlacedMotionPathRequest<'_> {
            PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::zero(),
                radius: 0.3,
                waypoints,
            }
        }

        assert_eq!(
            scene.transit_motion_path(request(&[])),
            Err(CollisionQueryError::EmptyMotionPath)
        );
        assert_eq!(
            scene.transit_motion_path(request(&[MotionWaypoint {
                center: Vector3::zero(),
                end_fraction: f32::NAN,
                placement: MotionWaypointPlacement::Traverse,
            }])),
            Err(CollisionQueryError::NonFiniteMotionFraction)
        );
        assert_eq!(
            scene.transit_motion_path(request(&[MotionWaypoint {
                center: Vector3::zero(),
                end_fraction: 1.1,
                placement: MotionWaypointPlacement::Traverse,
            }])),
            Err(CollisionQueryError::MotionFractionOutOfRange)
        );
        assert_eq!(
            scene.transit_motion_path(request(&[
                MotionWaypoint {
                    center: Vector3::zero(),
                    end_fraction: 0.5,
                    placement: MotionWaypointPlacement::Traverse,
                },
                MotionWaypoint {
                    center: Vector3::zero(),
                    end_fraction: 0.5,
                    placement: MotionWaypointPlacement::Traverse,
                },
            ])),
            Err(CollisionQueryError::NonIncreasingMotionFraction)
        );
        assert_eq!(
            scene.transit_motion_path(request(&[MotionWaypoint {
                center: Vector3::zero(),
                end_fraction: 0.5,
                placement: MotionWaypointPlacement::Traverse,
            }])),
            Err(CollisionQueryError::IncompleteMotionPath)
        );
    }

    #[test]
    fn stationary_transit_rejects_an_absent_prior_env_cell() {
        let scene = CollisionScene::new();

        assert_eq!(
            scene.transit_cell(CellTransitRequest {
                previous_cell: Some(Guid(0xda55_0100)),
                anchor: Guid(0xda55_ffff),
                center: Vector3::zero(),
                radius: 0.3,
            }),
            Err(CollisionQueryError::UnknownMotionCell { cell: 0xda55_0100 })
        );
    }

    #[test]
    fn committed_cell_pose_reanchors_from_the_comparison_anchor() {
        let pose = anchor_point_to_cell_position(
            Guid(0xda55_ffff),
            Vector3::new(20.0, -40.0, 2.0),
            Guid(0xdb56_0100),
            Quaternion::identity(),
        );

        assert_eq!(pose.landblock_id, Guid(0xdb56_0100));
        assert_eq!(pose.coords, Vector3::new(-172.0, -232.0, 2.0));
    }

    #[test]
    fn child_spatial_body_starts_from_authoritative_deep_env_cell() {
        use crate::spatial::{
            ChildSpatialBody, ChildSpatialBodyDefinition, ChildSpatialBodyWaypoint,
        };

        let cell = Guid(0xda55_0100);
        let scene = placement_scene(vec![volume(0x0100, Vec::new())]);
        let parent = WorldPosition {
            landblock_id: cell,
            coords: Vector3::new(20.0, 30.0, 4.0),
            rotation: Quaternion::identity(),
        };
        let mut child = ChildSpatialBody::new(
            ChildSpatialBodyDefinition::new(Vector3::new(0.0, 0.0, 1.5), 0.3).unwrap(),
            parent,
        );

        let path = child
            .reconcile_parent_path(
                &scene,
                parent,
                &[ChildSpatialBodyWaypoint {
                    parent_pose: parent,
                    end_fraction: 1.0,
                }],
            )
            .unwrap();

        assert_eq!(path.initial().placement().committed_cell(), Some(cell));
        assert_eq!(path.final_point().placement().committed_cell(), Some(cell));
        assert_eq!(child.committed_cell(), Some(cell));
    }

    #[test]
    fn non_camera_sphere_path_keeps_thin_cell_entry_and_exit_with_matching_end_domains() {
        let thin_cell = Guid(0xda55_010b);
        let scene = placement_scene(vec![CellVolume {
            cell_selector: 0x010b,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![
                Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -100.0,
                },
                Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 100.2,
                },
            ],
            portals: vec![
                portal(-1.0, 100.0, CellCollisionPortalTarget::Outdoor),
                portal(1.0, -100.2, CellCollisionPortalTarget::Outdoor),
            ],
        }]);

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.4, 10.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(path.anchor(), Guid(0xda55_ffff));
        assert_eq!(path.initial().placement().committed_cell(), None);
        assert_eq!(path.legs().len(), 3);
        assert!((path.legs()[0].end_fraction() - 1.0 / 3.0).abs() < 0.000_1);
        assert_eq!(
            path.legs()[0].end().placement().committed_cell(),
            Some(thin_cell),
            "the target placement becomes authoritative at the exact entry boundary"
        );
        assert!((path.legs()[1].end_fraction() - 2.0 / 3.0).abs() < 0.000_1);
        assert_eq!(path.legs()[1].end().placement().committed_cell(), None);
        assert_eq!(path.legs()[2].end_fraction(), 1.0);
        assert_eq!(path.final_point().center(), Vector3::new(100.4, 10.0, 20.0));
        assert_eq!(path.final_point().placement().committed_cell(), None);
        assert!(path.legs().iter().all(|leg| leg.end().recovery().is_none()));
    }

    #[test]
    fn prior_cell_reach_continues_through_outdoors_into_a_coincident_cell() {
        let source_cell = Guid(0xda55_010a);
        let target_cell = Guid(0xda55_010b);
        let scene = placement_scene(coincident_outdoor_cells());

        let placement = scene
            .transit_cell(CellTransitRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                center: Vector3::new(100.2, 10.0, 20.0),
                radius: 0.3,
            })
            .unwrap();

        assert_eq!(placement.committed_cell(), Some(target_cell));
        assert!(placement.reaches_outdoors());
        assert_eq!(placement.reached_env_cells(), &[source_cell, target_cell]);
    }

    #[test]
    fn placed_motion_collapses_a_coincident_outdoor_junction() {
        let source_cell = Guid(0xda55_010a);
        let target_cell = Guid(0xda55_010b);
        let scene = placement_scene(coincident_outdoor_cells());

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(
            path.initial().placement().committed_cell(),
            Some(source_cell)
        );
        assert_eq!(path.legs().len(), 2);
        assert_eq!(
            path.legs()[0].end().placement().committed_cell(),
            Some(target_cell)
        );
        assert_eq!(
            path.final_point().placement().committed_cell(),
            Some(target_cell)
        );
        assert!(
            path.legs()
                .iter()
                .all(|leg| leg.end().placement().committed_cell().is_some()),
            "a zero-thickness junction exposed a synthetic outdoor placement"
        );
    }

    #[test]
    fn placed_motion_keeps_an_unpaired_outdoor_exit() {
        let source_cell = Guid(0xda55_010a);
        let mut cells = coincident_outdoor_cells();
        cells.pop();
        let scene = placement_scene(cells);

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(
            path.initial().placement().committed_cell(),
            Some(source_cell)
        );
        assert_eq!(path.legs()[0].end().placement().committed_cell(), None);
        assert_eq!(path.final_point().placement().committed_cell(), None);
    }

    #[test]
    fn placed_motion_does_not_choose_an_ambiguous_coincident_target() {
        let source_cell = Guid(0xda55_010a);
        let mut cells = coincident_outdoor_cells();
        cells.push(CellVolume {
            cell_selector: 0x010c,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -100.0,
            }],
            portals: vec![portal(-1.0, 100.0, CellCollisionPortalTarget::Outdoor)],
        });
        let scene = placement_scene(cells);

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        let boundary = path.legs()[0].end().placement();
        assert_eq!(boundary.committed_cell(), None);
        assert!(
            boundary.reached_env_cells().contains(&Guid(0xda55_010b))
                && boundary.reached_env_cells().contains(&Guid(0xda55_010c))
        );
        assert_eq!(path.final_point().placement().committed_cell(), None);
    }

    #[test]
    fn placed_motion_repairs_an_escaped_cell_to_outdoors() {
        let source_cell = Guid(0xda55_010a);
        let scene = placement_scene(vec![CellVolume {
            cell_selector: 0x010a,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![Plane {
                normal: Vector3::new(-1.0, 0.0, 0.0),
                d: 100.0,
            }],
            portals: Vec::new(),
        }]);

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(path.final_point().placement().committed_cell(), None);
        assert_eq!(
            path.final_point().recovery(),
            Some(&PlacementRecovery::Recovered {
                previous_cell: source_cell,
                recovered_cell: None,
            })
        );
    }

    #[test]
    fn placed_motion_repairs_an_escaped_cell_to_one_unique_cell() {
        let source_cell = Guid(0xda55_010a);
        let target_cell = Guid(0xda55_010b);
        let scene = placement_scene(vec![
            CellVolume {
                cell_selector: 0x010a,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                planes: vec![Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 100.0,
                }],
                portals: Vec::new(),
            },
            CellVolume {
                cell_selector: 0x010b,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                planes: vec![Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -100.0,
                }],
                portals: Vec::new(),
            },
        ]);

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(
            path.final_point().placement().committed_cell(),
            Some(target_cell)
        );
        assert_eq!(
            path.final_point().recovery(),
            Some(&PlacementRecovery::Recovered {
                previous_cell: source_cell,
                recovered_cell: Some(target_cell),
            })
        );
    }

    #[test]
    fn ambiguous_placement_recovery_reports_candidates_without_iteration_order_selection() {
        let source_cell = Guid(0xda55_010a);
        let first_candidate = Guid(0xda55_010b);
        let second_candidate = Guid(0xda55_010c);
        let open_candidate = |cell_selector| CellVolume {
            cell_selector,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: Vec::new(),
            portals: Vec::new(),
        };
        let scene = placement_scene(vec![
            CellVolume {
                cell_selector: 0x010a,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                planes: vec![Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 100.0,
                }],
                portals: Vec::new(),
            },
            open_candidate(0x010c),
            open_candidate(0x010b),
        ]);

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(path.final_point().placement().committed_cell(), None);
        assert_eq!(
            path.final_point().recovery(),
            Some(&PlacementRecovery::Ambiguous {
                previous_cell: source_cell,
                candidates: vec![first_candidate, second_candidate],
                selected_cell: None,
            })
        );
    }

    #[test]
    fn retransiting_transformed_portal_boundary_preserves_the_crossing() {
        let source_cell = Guid(0xda55_010a);
        let target_cell = Guid(0xda55_010b);
        let scene = placement_scene(vec![
            CellVolume {
                cell_selector: 0x010a,
                // CE95-style decimal translations make the world-space boundary a few float ULPs
                // short when transformed back to local space on a second placement pass.
                placement: LandblockPlacement {
                    origin: Vector3::new(78.26, 40.68, 20.0),
                    orientation: Quaternion::identity(),
                },
                planes: vec![Plane {
                    normal: Vector3::new(0.0, -1.0, 0.0),
                    d: 5.6,
                }],
                portals: vec![CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(0.0, 1.0, 0.0),
                        d: -5.6,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::EnvCell(0x010b),
                    outdoor_building: None,
                }],
            },
            CellVolume {
                cell_selector: 0x010b,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                planes: vec![Plane {
                    normal: Vector3::new(0.0, 1.0, 0.0),
                    d: -46.28,
                }],
                portals: Vec::new(),
            },
        ]);
        let first = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(78.26, 46.23, 21.25),
                radius: 0.25,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(78.26, 46.33, 21.25),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();
        let split_waypoints = first
            .legs()
            .iter()
            .map(|leg| MotionWaypoint {
                center: leg.end().center(),
                end_fraction: leg.end_fraction(),
                placement: MotionWaypointPlacement::Traverse,
            })
            .collect::<Vec<_>>();

        let second = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: first.initial().center(),
                radius: 0.3,
                waypoints: &split_waypoints,
            })
            .unwrap();
        let placements = second
            .legs()
            .iter()
            .map(|leg| leg.end().placement().committed_cell())
            .collect::<Vec<_>>();

        assert!(placements.contains(&Some(target_cell)));
        assert_eq!(
            second.final_point().placement().committed_cell(),
            Some(target_cell)
        );
    }

    #[test]
    fn committed_endpoint_rejects_a_rounded_cell_portal_graze() {
        const ROUNDED_DAT_QUARTER_TURN_COMPONENT: f32 = 707_107.0 / 1_000_000.0;
        let source_cell = Guid(0xda55_0126);
        let target_cell = Guid(0xda55_011a);
        let scene = placement_scene(vec![
            CellVolume {
                cell_selector: 0x0126,
                placement: LandblockPlacement {
                    origin: Vector3::new(92.0, 83.0, -43.6),
                    // DAT-authored quarter turns use rounded components. Quaternion magnitude
                    // must not tilt the transformed portal plane into tangential motion.
                    orientation: Quaternion {
                        w: ROUNDED_DAT_QUARTER_TURN_COMPONENT,
                        x: 0.0,
                        y: 0.0,
                        z: -ROUNDED_DAT_QUARTER_TURN_COMPONENT,
                    },
                },
                planes: Vec::new(),
                portals: vec![CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(0.0, 1.0, 0.0),
                        d: 5.0,
                    },
                    positive_side: false,
                    target: CellCollisionPortalTarget::EnvCell(0x011a),
                    outdoor_building: None,
                }],
            },
            CellVolume {
                cell_selector: 0x011a,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                planes: Vec::new(),
                portals: Vec::new(),
            },
        ]);

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(87.000_1, 81.813_83, -43.12),
                radius: 0.48,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(87.000_1, 81.877_45, -43.12),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Committed(Some(source_cell)),
                }],
            })
            .unwrap();

        assert_eq!(
            path.final_point().placement().committed_cell(),
            Some(source_cell)
        );
        assert_eq!(path.legs().len(), 1);
        assert_ne!(
            path.initial().placement().committed_cell(),
            Some(target_cell)
        );
    }

    #[test]
    fn placed_motion_path_preserves_accepted_bends_before_adding_portal_splits() {
        let scene = placement_scene(Vec::new());
        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(96.0, 96.0, 20.0),
                radius: 0.3,
                waypoints: &[
                    MotionWaypoint {
                        center: Vector3::new(97.0, 96.0, 20.0),
                        end_fraction: 0.25,
                        placement: MotionWaypointPlacement::Traverse,
                    },
                    MotionWaypoint {
                        center: Vector3::new(97.0, 98.0, 20.0),
                        end_fraction: 1.0,
                        placement: MotionWaypointPlacement::Traverse,
                    },
                ],
            })
            .unwrap();

        assert_eq!(path.legs().len(), 2);
        assert_eq!(path.legs()[0].end_fraction(), 0.25);
        assert_eq!(
            path.legs()[0].end().center(),
            Vector3::new(97.0, 96.0, 20.0)
        );
        assert_eq!(path.legs()[1].end_fraction(), 1.0);
    }

    #[test]
    fn placed_motion_path_uses_portal_history_when_cell_volumes_overlap() {
        let source_cell = Guid(0xda55_010a);
        let target_cell = Guid(0xda55_010b);
        let scene = placement_scene(vec![
            CellVolume {
                cell_selector: 0x010a,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                // The source deliberately contains the entire path, so endpoint containment alone
                // cannot select the target cell.
                planes: Vec::new(),
                portals: vec![portal(
                    1.0,
                    -100.0,
                    CellCollisionPortalTarget::EnvCell(0x010b),
                )],
            },
            CellVolume {
                cell_selector: 0x010b,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                planes: vec![Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -100.0,
                }],
                portals: vec![portal(
                    -1.0,
                    100.0,
                    CellCollisionPortalTarget::EnvCell(0x010a),
                )],
            },
        ]);

        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(
            path.initial().placement().committed_cell(),
            Some(source_cell)
        );
        assert_eq!(path.legs().len(), 2);
        assert_eq!(
            path.legs()[0].end().placement().committed_cell(),
            Some(target_cell)
        );
        assert_eq!(
            path.final_point().placement().committed_cell(),
            Some(target_cell),
            "overlapping source containment overrode directed portal history"
        );
    }

    #[test]
    fn outdoor_placed_motion_path_keeps_one_anchor_across_a_landblock_boundary() {
        let scene = placement_scene(Vec::new());
        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(191.8, 96.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(192.2, 96.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(path.anchor(), Guid(0xda55_ffff));
        assert_eq!(path.legs().len(), 1);
        assert_eq!(path.final_point().center().x, 192.2);
        assert_eq!(path.final_point().placement().committed_cell(), None);
    }

    #[test]
    fn placed_motion_path_crosses_an_empty_scene_as_open_space() {
        let scene = CollisionScene::new();
        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(96.0, 96.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(97.0, 96.0, 20.0),
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Traverse,
                }],
            })
            .unwrap();

        assert_eq!(path.anchor(), Guid(0xda55_ffff));
        assert_eq!(path.legs().len(), 1);
        assert_eq!(path.final_point().center(), Vector3::new(97.0, 96.0, 20.0));
        assert_eq!(path.final_point().placement().committed_cell(), None);
    }

    #[test]
    fn scene_index_selects_exact_static_collision_domains() {
        let owner = Guid(0xda55_ffff);
        let cell = Guid(0xda55_0100);
        let sibling = Guid(0xda55_0101);
        let scene = scene(
            vec![
                collider_at(
                    0.0,
                    StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
                ),
                collider_at(
                    0.0,
                    StaticColliderPlacement::BuildingShell { source_index: 0 },
                ),
                collider_at(
                    0.0,
                    StaticColliderPlacement::EnvCellShell { cell_id: cell.0 },
                ),
                collider_at(
                    0.0,
                    StaticColliderPlacement::IndoorStatic {
                        source_cell_id: cell.0,
                        source_index: 0,
                    },
                ),
                collider_at(
                    0.0,
                    StaticColliderPlacement::IndoorStatic {
                        source_cell_id: sibling.0,
                        source_index: 0,
                    },
                ),
            ],
            vec![volume(0x0100, Vec::new()), volume(0x0101, Vec::new())],
        );

        let outdoors = SpatialMembership::outdoor();
        assert_eq!(
            scene
                .shadows
                .selected_colliders(owner_cells(owner), &outdoors),
            references([0, 1])
        );

        let interior = SpatialMembership::interior(cell);
        assert_eq!(
            scene
                .shadows
                .selected_colliders(owner_cells(owner), &interior),
            references([2, 3])
        );

        let straddling = SpatialMembership::outdoor().merge_reached(interior);
        assert_eq!(
            scene
                .shadows
                .selected_colliders(owner_cells(owner), &straddling),
            references([0, 1, 2, 3])
        );
        assert_eq!(
            scene.selected_colliders(owner_cells(owner), &straddling),
            vec![
                SelectedCollider {
                    reference: references([0])[0],
                    center_solid: true,
                },
                SelectedCollider {
                    reference: references([1])[0],
                    center_solid: false,
                },
                SelectedCollider {
                    reference: references([2])[0],
                    center_solid: true,
                },
                SelectedCollider {
                    reference: references([3])[0],
                    center_solid: true,
                },
            ]
        );
    }

    #[test]
    fn multipart_indoor_static_is_indexed_into_every_cell_reached_by_any_part() {
        let owner = Guid(0xda55_ffff);
        let source = Guid(0xda55_0100);
        let target = Guid(0xda55_0101);
        let placement = StaticColliderPlacement::IndoorStatic {
            source_cell_id: source.0,
            source_index: 7,
        };
        let scene = scene(
            vec![collider_at(-10.0, placement), collider_at(0.5, placement)],
            vec![
                volume(
                    0x0100,
                    vec![CellCollisionPortal {
                        plane: Plane {
                            normal: Vector3::new(1.0, 0.0, 0.0),
                            d: 0.0,
                        },
                        positive_side: true,
                        target: CellCollisionPortalTarget::EnvCell(0x0101),
                        outdoor_building: None,
                    }],
                ),
                volume(0x0101, Vec::new()),
            ],
        );

        assert_eq!(
            scene
                .shadows
                .selected_colliders(owner_cells(owner), &SpatialMembership::interior(source)),
            references([0, 1])
        );
        assert_eq!(
            scene
                .shadows
                .selected_colliders(owner_cells(owner), &SpatialMembership::interior(target)),
            references([0, 1]),
            "every part follows the authored placement's union membership"
        );
    }

    #[test]
    fn outdoor_static_shadows_into_a_neighbor_owned_env_cell_and_expires_with_its_source() {
        let target_owner = Guid(0xda55_ffff);
        let source_owner = Guid(0xdb55_ffff);
        let target_cell = Guid(0xda55_0100);
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: source_owner.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders {
                    colliders: vec![collider_at(
                        -1.0,
                        StaticColliderPlacement::OutdoorGenerated { source_index: 56 },
                    )],
                    cell_volumes: Vec::new(),
                },
            })
            .unwrap();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: target_owner.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: vec![volume(
                        0x0100,
                        vec![CellCollisionPortal {
                            plane: Plane {
                                normal: Vector3::new(1.0, 0.0, 0.0),
                                d: -192.0,
                            },
                            positive_side: true,
                            target: CellCollisionPortalTarget::Outdoor,
                            outdoor_building: Some(OutdoorBuildingTransit {
                                building_index: 0,
                                building_origin: Vector3::new(180.0, 12.0, 0.0),
                            }),
                        }],
                    )],
                },
            })
            .unwrap();

        assert_eq!(
            scene.shadows.selected_colliders(
                owner_cells(target_owner),
                &SpatialMembership::interior(target_cell)
            ),
            [ColliderReference {
                owner: source_owner,
                collider_index: 0,
            }]
        );

        scene.remove(source_owner);
        assert!(
            scene
                .shadows
                .selected_colliders(
                    owner_cells(target_owner),
                    &SpatialMembership::interior(target_cell)
                )
                .is_empty(),
            "eviction retained a dangling cross-owner static shadow"
        );
    }

    #[test]
    fn failed_residency_batch_restores_assets_and_shadow_index_atomically() {
        let original_owner = Guid(0xda55_ffff);
        let invalid_owner = Guid(0xdb55_ffff);
        let mut scene = scene(
            vec![collider_at(
                0.0,
                StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
            )],
            Vec::new(),
        );
        let error = scene
            .apply_residency_change(
                vec![LandblockCollisionAsset {
                    landblock_id: invalid_owner.0,
                    terrain: TerrainCollisionSurface::empty(),
                    static_geometry: LandblockColliders {
                        colliders: vec![collider_at(
                            0.0,
                            StaticColliderPlacement::IndoorStatic {
                                source_cell_id: 0xdb55_0100,
                                source_index: 0,
                            },
                        )],
                        cell_volumes: Vec::new(),
                    },
                }],
                &[original_owner],
            )
            .unwrap_err();
        assert!(matches!(
            error,
            CollisionSceneUpdateError::MissingSourceCell {
                owner: 0xdb55_ffff,
                cell: 0xdb55_0100,
            }
        ));
        assert!(scene.landblocks.contains_key(&original_owner));
        assert!(!scene.landblocks.contains_key(&invalid_owner));
        assert_eq!(
            scene
                .shadows
                .selected_colliders(owner_cells(original_owner), &SpatialMembership::outdoor()),
            references([0]),
            "failed rebuild replaced the previously committed shadow index"
        );
    }

    #[test]
    fn staged_residency_shares_retained_products_without_mutating_the_live_scene() {
        let retained_owner = Guid(0xda55_ffff);
        let inserted_owner = Guid(0xdb55_ffff);
        let scene = scene(Vec::new(), Vec::new());
        let retained_product = Arc::clone(&scene.landblocks[&retained_owner]);

        let staged = scene
            .staged_residency_change(
                vec![LandblockCollisionAsset {
                    landblock_id: inserted_owner.0,
                    terrain: TerrainCollisionSurface::empty(),
                    static_geometry: LandblockColliders::default(),
                }],
                &[],
            )
            .unwrap();

        assert!(!scene.landblocks.contains_key(&inserted_owner));
        assert!(staged.landblocks.contains_key(&inserted_owner));
        assert!(Arc::ptr_eq(
            &retained_product,
            &staged.landblocks[&retained_owner]
        ));
    }
}
