//! Resident static collision geometry and explicit query families.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Vector3};
use holtburger_content::{
    CellCollisionPortal, CellCollisionPortalTarget, CellVolume, LandblockCollisionAsset,
    PlacedCollider, StaticColliderPlacement, TerrainCollisionTriangle,
};
use thiserror::Error;

use super::bsp_query::{
    BspSupportFeature, placed_polygon_contacts, placed_polygon_obstructions, placed_solid_contacts,
    placed_supports, support_on_polygon,
};

const CELL_PLANE_TOLERANCE: f32 = 0.000_2;

/// Why a collision query cannot safely answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingCoverage {
    /// Resident landblocks required by the swept sphere but absent from the scene.
    pub landblocks: Vec<Guid>,
    /// Whether the swept sphere leaves AC's representable outdoor coordinate space.
    pub outside_world: bool,
}

/// A collision query whose coverage is explicit rather than conflated with a miss.
#[derive(Debug, Clone, PartialEq)]
pub enum CollisionQuery<T> {
    /// Every touched landblock was resident and the query completed.
    Complete(T),
    /// At least one touched landblock was absent or outside the world.
    MissingCoverage(MissingCoverage),
}

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

impl From<BspSupportFeature> for SupportFeature {
    fn from(feature: BspSupportFeature) -> Self {
        match feature {
            BspSupportFeature::Surface => Self::Surface,
            BspSupportFeature::Edge { inward_normal } => Self::Edge { inward_normal },
        }
    }
}

/// Swept-sphere facts required to prove collision coverage.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoverageRequest {
    /// Normalized landblock whose local frame contains both centers.
    pub anchor: Guid,
    /// Anchor-local start center; it may lie outside the anchor's 0..192 extent.
    pub start: Vector3,
    /// Anchor-local candidate center; it may lie outside the anchor's 0..192 extent.
    pub end: Vector3,
    /// Positive body radius in meters.
    pub radius: f32,
}

/// One candidate body's authoritative placement and every collision cell reached by its spheres.
///
/// Retail commits the cell containing sphere zero's center separately from the `CELLARRAY` used to
/// query collision (`CObjCell::find_cell_list`, `acclient.c:332969`). Keeping both facts together
/// prevents query families from inventing different terrain/interior selection rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollisionPlacement {
    committed_cell: Option<Guid>,
    reaches_outdoors: bool,
    reached_interior_cells: Vec<Guid>,
}

impl CollisionPlacement {
    /// Placement for a body wholly in outdoor land cells.
    pub fn outdoor() -> Self {
        Self {
            committed_cell: None,
            reaches_outdoors: true,
            reached_interior_cells: Vec::new(),
        }
    }

    /// Placement for a body wholly in one EnvCell.
    pub fn interior(cell: Guid) -> Self {
        Self {
            committed_cell: Some(cell),
            reaches_outdoors: false,
            reached_interior_cells: vec![cell],
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
    pub fn reached_interior_cells(&self) -> &[Guid] {
        &self.reached_interior_cells
    }

    pub(super) fn merge_reached(mut self, other: Self) -> Self {
        self.reaches_outdoors |= other.reaches_outdoors;
        for cell in other.reached_interior_cells {
            if !self.reached_interior_cells.contains(&cell) {
                self.reached_interior_cells.push(cell);
            }
        }
        self
    }

    fn reaches_interior_in(&self, owner: Guid) -> bool {
        self.reached_interior_cells
            .iter()
            .any(|cell| landblock_key(*cell) == owner)
    }
}

/// Directional movement-obstruction query.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MovementObstructionRequest<'a> {
    /// Swept sphere being tested.
    pub sweep: CoverageRequest,
    /// Candidate placement selecting the collision domains visible to this query.
    pub placement: &'a CollisionPlacement,
}

/// Grounded movement query that preserves two-sided polygon identity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedObstructionRequest<'a> {
    /// Swept sphere being tested.
    pub sweep: CoverageRequest,
    /// Candidate placement selecting the collision domains visible to this query.
    pub placement: &'a CollisionPlacement,
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
    pub placement: &'a CollisionPlacement,
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
    pub placement: &'a CollisionPlacement,
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
    /// Positive mover radius used for coverage and reached collision domains.
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

/// One position paired with the complete collision placement valid at that position.
#[derive(Debug, Clone, PartialEq)]
pub struct PlacedMotionPoint {
    center: Vector3,
    placement: CollisionPlacement,
    recovery: Option<PlacementRecovery>,
}

impl PlacedMotionPoint {
    /// Anchor-local mover center.
    pub fn center(&self) -> Vector3 {
        self.center
    }

    /// Authoritative cell and collision domains at `center`.
    pub fn placement(&self) -> &CollisionPlacement {
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

/// One selected static collider and the retail BSP leaf policy for this collision placement.
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

/// Scene-derived equivalent of retail's outdoor and EnvCell static shadow lists.
#[derive(Debug, Clone, Default)]
struct StaticShadowIndex {
    outdoor_colliders: HashMap<Guid, Vec<ColliderReference>>,
    building_shells: HashMap<Guid, Vec<ColliderReference>>,
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
                        index
                            .outdoor_colliders
                            .entry(owner)
                            .or_default()
                            .push(reference);
                        outdoor_groups
                            .entry(source)
                            .or_default()
                            .push(collider_index);
                    }
                    StaticColliderPlacement::BuildingShell { .. } => {
                        index
                            .building_shells
                            .entry(owner)
                            .or_default()
                            .push(reference);
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
            .outdoor_colliders
            .values_mut()
            .chain(index.building_shells.values_mut())
            .chain(index.interior_colliders.values_mut())
        {
            colliders.sort_unstable();
            colliders.dedup();
        }
        Ok(index)
    }

    fn selected_colliders(
        &self,
        touched: &[Guid],
        placement: &CollisionPlacement,
    ) -> Vec<ColliderReference> {
        let mut selected = Vec::new();
        if placement.reaches_outdoors {
            for owner in collision_source_landblocks(touched) {
                if let Some(colliders) = self.outdoor_colliders.get(&owner) {
                    selected.extend(colliders.iter().copied());
                }
                if let Some(colliders) = self.building_shells.get(&owner) {
                    selected.extend(colliders.iter().copied());
                }
            }
        }
        for cell in &placement.reached_interior_cells {
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

    /// Proves that every touched landblock and static-collider source neighbor is resident.
    pub fn coverage(
        &self,
        request: CoverageRequest,
    ) -> Result<CollisionQuery<Vec<Guid>>, CollisionQueryError> {
        validate_coverage(request)?;
        let (touched, outside_world) = touched_landblocks(request);
        let missing = collision_source_landblocks(&touched)
            .into_iter()
            .filter(|landblock| !self.landblocks.contains_key(landblock))
            .collect::<Vec<_>>();
        if outside_world || !missing.is_empty() {
            Ok(CollisionQuery::MissingCoverage(MissingCoverage {
                landblocks: missing,
                outside_world,
            }))
        } else {
            Ok(CollisionQuery::Complete(touched))
        }
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

    /// Returns every directional obstruction at the candidate sphere position.
    pub fn movement_obstructions(
        &self,
        request: MovementObstructionRequest,
    ) -> Result<CollisionQuery<Vec<StaticContact>>, CollisionQueryError> {
        let touched = match self.coverage(request.sweep)? {
            CollisionQuery::Complete(touched) => touched,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(CollisionQuery::MissingCoverage(missing));
            }
        };
        let movement = request.sweep.end - request.sweep.start;
        Ok(CollisionQuery::Complete(self.contacts(
            &touched,
            request.sweep.anchor,
            request.sweep.end,
            request.sweep.radius,
            Some(movement),
            request.placement,
        )))
    }

    /// Returns directional grounded obstructions without collapsing polygon back faces.
    pub fn grounded_obstructions(
        &self,
        request: GroundedObstructionRequest,
    ) -> Result<CollisionQuery<Vec<GroundedObstruction>>, CollisionQueryError> {
        let touched = match self.coverage(request.sweep)? {
            CollisionQuery::Complete(touched) => touched,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(CollisionQuery::MissingCoverage(missing));
            }
        };
        let movement = request.sweep.end - request.sweep.start;
        let mut contacts = Vec::new();
        for owner in &touched {
            let Some(asset) = self.landblocks.get(owner) else {
                continue;
            };
            let local_center = anchor_to_landblock(request.sweep.end, request.sweep.anchor, *owner);
            if request.placement.reaches_outdoors {
                for cell in &asset.terrain.cells {
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
        for selected in self.selected_colliders(&touched, request.placement) {
            let reference = selected.reference;
            let collider = &self.landblocks[&reference.owner].static_geometry.colliders
                [reference.collider_index];
            let local_center =
                anchor_to_landblock(request.sweep.end, request.sweep.anchor, reference.owner);
            let separation = local_center - collider.bounds_center;
            let reach = request.sweep.radius + collider.bounds_radius;
            if separation.length_squared() > reach * reach {
                continue;
            }
            contacts.extend(
                placed_solid_contacts(
                    collider,
                    local_center,
                    request.sweep.radius,
                    selected.center_solid,
                )
                .into_iter()
                .filter(|contact| movement.dot(&contact.normal) <= 0.0)
                .map(|contact| GroundedObstruction {
                    separation_normal: contact.normal,
                    response_normal: contact.normal,
                    depth: contact.depth,
                }),
            );
            contacts.extend(
                placed_polygon_obstructions(collider, local_center, request.sweep.radius)
                    .into_iter()
                    .filter_map(|contact| {
                        let response_normal =
                            if contact.polygon_normal.dot(&contact.separation.normal) >= 0.0 {
                                contact.polygon_normal
                            } else {
                                contact.polygon_normal * -1.0
                            };
                        (movement.dot(&response_normal) <= 0.0).then_some(GroundedObstruction {
                            separation_normal: contact.separation.normal,
                            response_normal,
                            depth: contact.separation.depth,
                        })
                    }),
            );
        }
        Ok(CollisionQuery::Complete(contacts))
    }

    /// Returns every overlap at a candidate placement without directional filtering.
    pub fn placement_contacts(
        &self,
        request: PlacementRequest,
    ) -> Result<CollisionQuery<Vec<StaticContact>>, CollisionQueryError> {
        let coverage = CoverageRequest {
            anchor: request.anchor,
            start: request.center,
            end: request.center,
            radius: request.radius,
        };
        let touched = match self.coverage(coverage)? {
            CollisionQuery::Complete(touched) => touched,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(CollisionQuery::MissingCoverage(missing));
            }
        };
        Ok(CollisionQuery::Complete(self.contacts(
            &touched,
            request.anchor,
            request.center,
            request.radius,
            None,
            request.placement,
        )))
    }

    /// Returns authored surfaces reachable by lowering the sphere within a finite distance.
    ///
    /// This query reports geometry only. Grounded response policy owns the walkable-normal test.
    pub fn support_contacts(
        &self,
        request: SupportRequest,
    ) -> Result<CollisionQuery<Vec<SupportContact>>, CollisionQueryError> {
        validate_probe(request)?;
        let coverage = CoverageRequest {
            anchor: request.anchor,
            start: request.center,
            end: request.center - Vector3::new(0.0, 0.0, request.maximum_drop),
            radius: request.radius,
        };
        let touched = match self.coverage(coverage)? {
            CollisionQuery::Complete(touched) => touched,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(CollisionQuery::MissingCoverage(missing));
            }
        };

        let mut supports = Vec::new();
        for owner in &touched {
            let Some(asset) = self.landblocks.get(owner) else {
                continue;
            };
            let local_center = anchor_to_landblock(request.center, request.anchor, *owner);
            if request.placement.reaches_outdoors {
                for cell in &asset.terrain.cells {
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
        for selected in self.selected_colliders(&touched, request.placement) {
            let reference = selected.reference;
            let collider = &self.landblocks[&reference.owner].static_geometry.colliders
                [reference.collider_index];
            let local_center = anchor_to_landblock(request.center, request.anchor, reference.owner);
            let vertical_reach = request.radius + request.maximum_drop.max(request.maximum_rise);
            let separation = local_center - collider.bounds_center;
            let reach = vertical_reach + collider.bounds_radius;
            if separation.length_squared() > reach * reach {
                continue;
            }
            supports.extend(
                placed_supports(
                    collider,
                    local_center,
                    request.radius,
                    request.maximum_drop,
                    request.maximum_rise,
                )
                .into_iter()
                .map(|support| SupportContact {
                    normal: support.normal,
                    height_delta: support.height_delta,
                    feature: support.feature.into(),
                }),
            );
        }
        Ok(CollisionQuery::Complete(supports))
    }

    /// Resolves both the center-containing cell and every collision cell reached by one sphere.
    ///
    /// Retail seeds the prior EnvCell (or outdoor land cells), expands the touched-cell array
    /// through portals, then separately selects the cell containing sphere zero's center
    /// (`CObjCell::find_cell_list`, `acclient.c:332969-333069`).
    pub fn transit_cell(
        &self,
        request: CellTransitRequest,
    ) -> Result<CollisionQuery<CollisionPlacement>, CollisionQueryError> {
        let coverage = CoverageRequest {
            anchor: request.anchor,
            start: request.center,
            end: request.center,
            radius: request.radius,
        };
        let touched = match self.coverage(coverage)? {
            CollisionQuery::Complete(touched) => touched,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(CollisionQuery::MissingCoverage(missing));
            }
        };

        let mut placement = if request.previous_cell.is_some() {
            CollisionPlacement {
                committed_cell: None,
                reaches_outdoors: false,
                reached_interior_cells: Vec::new(),
            }
        } else {
            CollisionPlacement::outdoor()
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
                placement.reached_interior_cells.push(previous_cell);
                expand_reached_cells(asset, owner, local, request.radius, &mut placement);
                placement.committed_cell = containing_reached_cell(asset, local, &placement);
                return Ok(CollisionQuery::Complete(placement));
            }
        }

        for owner in touched {
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
                    && !placement.reached_interior_cells.contains(&cell)
                {
                    placement.reached_interior_cells.push(cell);
                }
            }
            expand_reached_cells(asset, owner, local, request.radius, &mut placement);
            if placement.committed_cell.is_none() {
                placement.committed_cell = containing_reached_cell(asset, local, &placement);
            }
        }
        Ok(CollisionQuery::Complete(placement))
    }

    /// Attaches exact, prior-cell-seeded placement transitions to accepted geometric motion.
    ///
    /// This operation does not solve collision or predict future motion. Callers provide every
    /// accepted bend. The scene only inserts directed portal boundaries and derives the complete
    /// collision placement valid at each retained point.
    pub fn transit_motion_path(
        &self,
        request: PlacedMotionPathRequest<'_>,
    ) -> Result<CollisionQuery<PlacedMotionPath>, CollisionQueryError> {
        validate_motion_waypoints(request.waypoints)?;
        let (initial_placement, initial_recovery) = match self.placement_for_committed_cell(
            request.anchor,
            request.start,
            request.radius,
            request.previous_cell,
        )? {
            CollisionQuery::Complete(placement) => placement,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(CollisionQuery::MissingCoverage(missing));
            }
        };
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
            let sweep = CoverageRequest {
                anchor: request.anchor,
                start: geometric_start,
                end: waypoint.center,
                radius: request.radius,
            };
            let touched = match self.coverage(sweep)? {
                CollisionQuery::Complete(touched) => touched,
                CollisionQuery::MissingCoverage(missing) => {
                    return Ok(CollisionQuery::MissingCoverage(missing));
                }
            };
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
            while let Some(transition) = self.next_placement_transition(
                request.anchor,
                geometric_start,
                waypoint.center,
                cursor,
                current_cell,
                &touched,
            )? {
                transition_count += 1;
                if transition_count > transition_limit {
                    return Err(CollisionQueryError::MotionTransitionLimitExceeded);
                }
                let center =
                    interpolate_point(geometric_start, waypoint.center, transition.fraction);
                let (placement, recovery) = match self.placement_for_committed_cell(
                    request.anchor,
                    center,
                    request.radius,
                    transition.target_cell,
                )? {
                    CollisionQuery::Complete(placement) => placement,
                    CollisionQuery::MissingCoverage(missing) => {
                        return Ok(CollisionQuery::MissingCoverage(missing));
                    }
                };
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

            let (placement, recovery) = match self.placement_for_committed_cell(
                request.anchor,
                waypoint.center,
                request.radius,
                current_cell,
            )? {
                CollisionQuery::Complete(placement) => placement,
                CollisionQuery::MissingCoverage(missing) => {
                    return Ok(CollisionQuery::MissingCoverage(missing));
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

        Ok(CollisionQuery::Complete(path))
    }

    fn placement_for_committed_cell(
        &self,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        committed_cell: Option<Guid>,
    ) -> Result<CollisionQuery<(CollisionPlacement, Option<PlacementRecovery>)>, CollisionQueryError>
    {
        if let Some(cell) = committed_cell {
            let owner = landblock_key(cell);
            let has_cell = self.landblocks.get(&owner).is_some_and(|asset| {
                asset
                    .static_geometry
                    .cell_volumes
                    .iter()
                    .any(|volume| volume.cell_selector == (cell.0 & 0xffff) as u16)
            });
            if !has_cell {
                return Err(CollisionQueryError::UnknownMotionCell { cell: cell.0 });
            }
        }
        let mut placement = match self.transit_cell(CellTransitRequest {
            previous_cell: committed_cell,
            anchor,
            center,
            radius,
        })? {
            CollisionQuery::Complete(placement) => placement,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(CollisionQuery::MissingCoverage(missing));
            }
        };
        let recovery = if let Some(previous_cell) =
            committed_cell.filter(|cell| placement.committed_cell != Some(*cell))
        {
            match self.recover_placement(
                anchor,
                center,
                radius,
                previous_cell,
                placement.committed_cell,
            )? {
                CollisionQuery::Complete(recovery) => Some(recovery),
                CollisionQuery::MissingCoverage(missing) => {
                    return Ok(CollisionQuery::MissingCoverage(missing));
                }
            }
        } else {
            None
        };
        if let Some(PlacementRecovery::Recovered { recovered_cell, .. }) = &recovery {
            placement = match self.transit_cell(CellTransitRequest {
                previous_cell: *recovered_cell,
                anchor,
                center,
                radius,
            })? {
                CollisionQuery::Complete(placement) => placement,
                CollisionQuery::MissingCoverage(missing) => {
                    return Ok(CollisionQuery::MissingCoverage(missing));
                }
            };
            return Ok(CollisionQuery::Complete((placement, recovery)));
        }
        if recovery.is_some() {
            return Ok(CollisionQuery::Complete((placement, recovery)));
        }
        placement.committed_cell = committed_cell;
        match committed_cell {
            Some(cell) => {
                if !placement.reached_interior_cells.contains(&cell) {
                    placement.reached_interior_cells.push(cell);
                }
            }
            None => placement.reaches_outdoors = true,
        }
        Ok(CollisionQuery::Complete((placement, recovery)))
    }

    fn recover_placement(
        &self,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        previous_cell: Guid,
        transit_cell: Option<Guid>,
    ) -> Result<CollisionQuery<PlacementRecovery>, CollisionQueryError> {
        let touched = match self.coverage(CoverageRequest {
            anchor,
            start: center,
            end: center,
            radius,
        })? {
            CollisionQuery::Complete(touched) => touched,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(CollisionQuery::MissingCoverage(missing));
            }
        };
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
        Ok(CollisionQuery::Complete(match candidates.as_slice() {
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
        }))
    }

    fn next_placement_transition(
        &self,
        anchor: Guid,
        start: Vector3,
        end: Vector3,
        cursor: f32,
        current_cell: Option<Guid>,
        touched: &[Guid],
    ) -> Result<Option<PlacementTransition>, CollisionQueryError> {
        let segment_length = start.distance(&end);
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
            let local_start = source
                .placement
                .to_local_space(anchor_to_landblock(start, anchor, owner));
            let local_end = source
                .placement
                .to_local_space(anchor_to_landblock(end, anchor, owner));
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
                    CellCollisionPortalTarget::Outdoor => None,
                    CellCollisionPortalTarget::EnvCell(selector) => {
                        let target = Guid((owner.0 & 0xffff_0000) | u32::from(selector));
                        if !self.target_contains_after_crossing(
                            anchor,
                            start,
                            end,
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
            for owner in touched {
                let Some(asset) = self.landblocks.get(owner) else {
                    continue;
                };
                let landblock_start = anchor_to_landblock(start, anchor, *owner);
                let landblock_end = anchor_to_landblock(end, anchor, *owner);
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
                            anchor,
                            start,
                            end,
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

    fn contacts(
        &self,
        touched: &[Guid],
        anchor: Guid,
        center: Vector3,
        radius: f32,
        movement: Option<Vector3>,
        placement: &CollisionPlacement,
    ) -> Vec<StaticContact> {
        let mut contacts = Vec::new();
        for owner in touched {
            let Some(asset) = self.landblocks.get(owner) else {
                continue;
            };
            let local_center = anchor_to_landblock(center, anchor, *owner);
            if placement.reaches_outdoors {
                for cell in &asset.terrain.cells {
                    for triangle in &cell.triangles {
                        if let Some(contact) = terrain_contact(triangle, local_center, radius)
                            && movement.is_none_or(|delta| delta.dot(&contact.normal) < 0.0)
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
        for selected in self.selected_colliders(touched, placement) {
            let reference = selected.reference;
            let collider = &self.landblocks[&reference.owner].static_geometry.colliders
                [reference.collider_index];
            let local_center = anchor_to_landblock(center, anchor, reference.owner);
            let separation = local_center - collider.bounds_center;
            let reach = radius + collider.bounds_radius;
            if separation.length_squared() > reach * reach {
                continue;
            }
            for contact in
                placed_solid_contacts(collider, local_center, radius, selected.center_solid)
                    .into_iter()
                    .chain(placed_polygon_contacts(collider, local_center, radius))
            {
                if movement.is_some_and(|delta| delta.dot(&contact.normal) >= 0.0) {
                    continue;
                }
                contacts.push(StaticContact {
                    normal: contact.normal,
                    depth: contact.depth,
                });
            }
        }
        contacts
    }

    fn selected_colliders(
        &self,
        touched: &[Guid],
        placement: &CollisionPlacement,
    ) -> Vec<SelectedCollider> {
        self.shadows
            .selected_colliders(touched, placement)
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

#[derive(Debug, Clone, Copy)]
struct OutdoorCellBounds {
    minimum: (i32, i32),
    maximum: (i32, i32),
}

impl OutdoorCellBounds {
    fn contains(self, cell: (i32, i32)) -> bool {
        cell.0 >= self.minimum.0
            && cell.0 <= self.maximum.0
            && cell.1 >= self.minimum.1
            && cell.1 <= self.maximum.1
    }
}

/// Returns every 24-meter outdoor land cell shadowed by one multipart static as one rectangle.
fn outdoor_cell_bounds(
    owner: Guid,
    collider_indices: &[usize],
    colliders: &[PlacedCollider],
) -> OutdoorCellBounds {
    let mut points = collider_indices.iter().copied().flat_map(|collider_index| {
        let collider = &colliders[collider_index];
        collider
            .shape
            .box_bounds
            .corners()
            .map(|corner| collider.point_to_landblock_space(corner))
    });
    let first = points
        .next()
        .expect("a collidable static placement has at least one part box");
    let mut minimum = first;
    let mut maximum = first;
    for point in points {
        minimum.x = minimum.x.min(point.x);
        minimum.y = minimum.y.min(point.y);
        maximum.x = maximum.x.max(point.x);
        maximum.y = maximum.y.max(point.y);
    }
    let owner_x = ((owner.0 >> 24) & 0xff) as i32 * 8;
    let owner_y = ((owner.0 >> 16) & 0xff) as i32 * 8;
    OutdoorCellBounds {
        minimum: (
            owner_x + (minimum.x / 24.0).floor() as i32,
            owner_y + (minimum.y / 24.0).floor() as i32,
        ),
        maximum: (
            owner_x + (maximum.x / 24.0).floor() as i32,
            owner_y + (maximum.y / 24.0).floor() as i32,
        ),
    }
}

fn outdoor_cell_coordinates(owner: Guid, point: Vector3) -> (i32, i32) {
    (
        ((owner.0 >> 24) & 0xff) as i32 * 8 + (point.x / 24.0).floor() as i32,
        ((owner.0 >> 16) & 0xff) as i32 * 8 + (point.y / 24.0).floor() as i32,
    )
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
    let sphere_center = target.placement.to_local_space(point_between_landblocks(
        collider.bounds_center,
        collider_owner,
        target_owner,
    ));
    let sphere_distance = portal.plane.distance_to_point(&sphere_center);
    if portal.positive_side {
        if sphere_distance > collider.bounds_radius + CELL_PLANE_TOLERANCE {
            return false;
        }
    } else if sphere_distance < -collider.bounds_radius - CELL_PLANE_TOLERANCE {
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
    let sphere_center = source.placement.to_local_space(point_between_landblocks(
        collider.bounds_center,
        collider_owner,
        cell_owner,
    ));
    let sphere_distance = portal.plane.distance_to_point(&sphere_center);
    if portal.positive_side {
        if sphere_distance < -collider.bounds_radius - CELL_PLANE_TOLERANCE {
            return false;
        }
    } else if sphere_distance > collider.bounds_radius + CELL_PLANE_TOLERANCE {
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
    let transformed = collider.shape.box_bounds.corners().map(|corner| {
        let source_point = collider.point_to_landblock_space(corner);
        volume.placement.to_local_space(point_between_landblocks(
            source_point,
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
    placement: &mut CollisionPlacement,
) {
    let mut index = 0;
    while index < placement.reached_interior_cells.len() {
        let source_cell = placement.reached_interior_cells[index];
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
                        && !placement.reached_interior_cells.contains(&target_cell)
                    {
                        placement.reached_interior_cells.push(target_cell);
                    }
                }
            }
        }
    }
}

fn containing_reached_cell(
    asset: &LandblockCollisionAsset,
    landblock_point: Vector3,
    placement: &CollisionPlacement,
) -> Option<Guid> {
    placement
        .reached_interior_cells
        .iter()
        .copied()
        .find(|cell| {
            asset
                .static_geometry
                .cell_volumes
                .iter()
                .find(|volume| volume.cell_selector == (cell.0 & 0xffff) as u16)
                .is_some_and(|volume| volume_reaches(volume, landblock_point, 0.0))
        })
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

fn validate_coverage(request: CoverageRequest) -> Result<(), CollisionQueryError> {
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
    validate_coverage(CoverageRequest {
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

fn touched_landblocks(request: CoverageRequest) -> (Vec<Guid>, bool) {
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
    let anchor_x = ((anchor.0 >> 24) & 0xff) as i32;
    let anchor_y = ((anchor.0 >> 16) & 0xff) as i32;
    let min_x = anchor_x + (minimum.x / METERS_PER_LANDBLOCK).floor() as i32;
    let min_y = anchor_y + (minimum.y / METERS_PER_LANDBLOCK).floor() as i32;
    let max_x = anchor_x + (maximum.x / METERS_PER_LANDBLOCK).floor() as i32;
    let max_y = anchor_y + (maximum.y / METERS_PER_LANDBLOCK).floor() as i32;
    let outside_world = min_x < 0 || min_y < 0 || max_x > 255 || max_y > 255;
    let mut touched = Vec::new();
    for x in min_x.clamp(0, 255)..=max_x.clamp(0, 255) {
        for y in min_y.clamp(0, 255)..=max_y.clamp(0, 255) {
            touched.push(Guid(((x as u32) << 24) | ((y as u32) << 16) | 0xffff));
        }
    }
    (touched, outside_world)
}

/// Expands touched collision owners by the one-landblock source halo static shadows may cross.
fn collision_source_landblocks(touched: &[Guid]) -> Vec<Guid> {
    let mut sources = Vec::new();
    for owner in touched {
        let x = ((owner.0 >> 24) & 0xff) as i32;
        let y = ((owner.0 >> 16) & 0xff) as i32;
        for offset_x in -1..=1 {
            for offset_y in -1..=1 {
                let source_x = x + offset_x;
                let source_y = y + offset_y;
                if !(0..=255).contains(&source_x) || !(0..=255).contains(&source_y) {
                    continue;
                }
                sources.push(Guid(
                    ((source_x as u32) << 24) | ((source_y as u32) << 16) | 0xffff,
                ));
            }
        }
    }
    sources.sort_unstable();
    sources.dedup();
    sources
}

pub(super) fn landblock_key(landblock_id: Guid) -> Guid {
    Guid((landblock_id.0 & 0xffff_0000) | 0xffff)
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

/// Converts an anchor-local point into an outdoor pose without large absolute f32 coordinates.
pub(super) fn anchor_point_to_outdoor_position(
    anchor: Guid,
    point: Vector3,
    rotation: holtburger_common::Quaternion,
) -> WorldPosition {
    let anchor = landblock_key(anchor);
    let x = (((anchor.0 >> 24) & 0xff) as i32 + (point.x / METERS_PER_LANDBLOCK).floor() as i32)
        .clamp(0, 255) as u32;
    let y = (((anchor.0 >> 16) & 0xff) as i32 + (point.y / METERS_PER_LANDBLOCK).floor() as i32)
        .clamp(0, 255) as u32;
    let owner = Guid((x << 24) | (y << 16) | 0xffff);
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
        ColliderScale, CollisionBox, CollisionShape, LandblockColliders, LandblockPlacement,
        OutdoorBuildingTransit, StaticColliderPlacement, TerrainCollisionSurface,
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
            shape: Arc::new(CollisionShape {
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
            }),
            placement: LandblockPlacement {
                origin: center,
                orientation: Quaternion::identity(),
            },
            scale: ColliderScale::uniform(1.0).unwrap(),
            bounds_center: center,
            bounds_radius: 1.0,
            source_placement,
        }
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
                terrain: TerrainCollisionSurface { cells: Vec::new() },
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
                        terrain: TerrainCollisionSurface { cells: Vec::new() },
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
    fn direct_queries_reject_invalid_geometry() {
        let scene = CollisionScene::new();
        let request = CoverageRequest {
            anchor: Guid(0xda55_ffff),
            start: Vector3::zero(),
            end: Vector3::zero(),
            radius: 0.0,
        };
        assert_eq!(
            scene.coverage(request),
            Err(CollisionQueryError::InvalidRadius)
        );
        assert_eq!(
            scene.coverage(CoverageRequest {
                start: Vector3::new(f32::NAN, 0.0, 0.0),
                radius: 1.0,
                ..request
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
                placement: &CollisionPlacement::outdoor(),
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
                placement: &CollisionPlacement::outdoor(),
            }),
            Err(CollisionQueryError::InvalidDistance)
        );
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
            }])),
            Err(CollisionQueryError::NonFiniteMotionFraction)
        );
        assert_eq!(
            scene.transit_motion_path(request(&[MotionWaypoint {
                center: Vector3::zero(),
                end_fraction: 1.1,
            }])),
            Err(CollisionQueryError::MotionFractionOutOfRange)
        );
        assert_eq!(
            scene.transit_motion_path(request(&[
                MotionWaypoint {
                    center: Vector3::zero(),
                    end_fraction: 0.5,
                },
                MotionWaypoint {
                    center: Vector3::zero(),
                    end_fraction: 0.5,
                },
            ])),
            Err(CollisionQueryError::NonIncreasingMotionFraction)
        );
        assert_eq!(
            scene.transit_motion_path(request(&[MotionWaypoint {
                center: Vector3::zero(),
                end_fraction: 0.5,
            }])),
            Err(CollisionQueryError::IncompleteMotionPath)
        );
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

        let CollisionQuery::Complete(path) = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.4, 10.0, 20.0),
                    end_fraction: 1.0,
                }],
            })
            .unwrap()
        else {
            panic!("resident synthetic path unexpectedly lacked coverage");
        };

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

        let CollisionQuery::Complete(path) = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                }],
            })
            .unwrap()
        else {
            panic!("synthetic recovery path unexpectedly lacked coverage");
        };

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

        let CollisionQuery::Complete(path) = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                }],
            })
            .unwrap()
        else {
            panic!("synthetic recovery path unexpectedly lacked coverage");
        };

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

        let CollisionQuery::Complete(path) = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                }],
            })
            .unwrap()
        else {
            panic!("synthetic recovery path unexpectedly lacked coverage");
        };

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
        let first = match scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(78.26, 46.23, 21.25),
                radius: 0.25,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(78.26, 46.33, 21.25),
                    end_fraction: 1.0,
                }],
            })
            .unwrap()
        {
            CollisionQuery::Complete(path) => path,
            CollisionQuery::MissingCoverage(_) => panic!("synthetic scene unexpectedly missing"),
        };
        let split_waypoints = first
            .legs()
            .iter()
            .map(|leg| MotionWaypoint {
                center: leg.end().center(),
                end_fraction: leg.end_fraction(),
            })
            .collect::<Vec<_>>();

        let second = match scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: first.initial().center(),
                radius: 0.3,
                waypoints: &split_waypoints,
            })
            .unwrap()
        {
            CollisionQuery::Complete(path) => path,
            CollisionQuery::MissingCoverage(_) => panic!("synthetic scene unexpectedly missing"),
        };
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
    fn placed_motion_path_preserves_accepted_bends_before_adding_portal_splits() {
        let scene = placement_scene(Vec::new());
        let CollisionQuery::Complete(path) = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(96.0, 96.0, 20.0),
                radius: 0.3,
                waypoints: &[
                    MotionWaypoint {
                        center: Vector3::new(97.0, 96.0, 20.0),
                        end_fraction: 0.25,
                    },
                    MotionWaypoint {
                        center: Vector3::new(97.0, 98.0, 20.0),
                        end_fraction: 1.0,
                    },
                ],
            })
            .unwrap()
        else {
            panic!("resident synthetic path unexpectedly lacked coverage");
        };

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

        let CollisionQuery::Complete(path) = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: Some(source_cell),
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(99.8, 10.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(100.2, 10.0, 20.0),
                    end_fraction: 1.0,
                }],
            })
            .unwrap()
        else {
            panic!("resident synthetic path unexpectedly lacked coverage");
        };

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
        let CollisionQuery::Complete(path) = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(191.8, 96.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(192.2, 96.0, 20.0),
                    end_fraction: 1.0,
                }],
            })
            .unwrap()
        else {
            panic!("resident synthetic path unexpectedly lacked coverage");
        };

        assert_eq!(path.anchor(), Guid(0xda55_ffff));
        assert_eq!(path.legs().len(), 1);
        assert_eq!(path.final_point().center().x, 192.2);
        assert_eq!(path.final_point().placement().committed_cell(), None);
    }

    #[test]
    fn placed_motion_path_returns_missing_coverage_without_a_partial_result() {
        let scene = CollisionScene::new();
        let result = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor: Guid(0xda55_ffff),
                start: Vector3::new(96.0, 96.0, 20.0),
                radius: 0.3,
                waypoints: &[MotionWaypoint {
                    center: Vector3::new(97.0, 96.0, 20.0),
                    end_fraction: 1.0,
                }],
            })
            .unwrap();

        assert!(matches!(result, CollisionQuery::MissingCoverage(_)));
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

        let outdoors = CollisionPlacement::outdoor();
        assert_eq!(
            scene.shadows.selected_colliders(&[owner], &outdoors),
            references([0, 1])
        );

        let interior = CollisionPlacement::interior(cell);
        assert_eq!(
            scene.shadows.selected_colliders(&[owner], &interior),
            references([2, 3])
        );

        let straddling = CollisionPlacement::outdoor().merge_reached(interior);
        assert_eq!(
            scene.shadows.selected_colliders(&[owner], &straddling),
            references([0, 1, 2, 3])
        );
        assert_eq!(
            scene.selected_colliders(&[owner], &straddling),
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
                .selected_colliders(&[owner], &CollisionPlacement::interior(source)),
            references([0, 1])
        );
        assert_eq!(
            scene
                .shadows
                .selected_colliders(&[owner], &CollisionPlacement::interior(target)),
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
                terrain: TerrainCollisionSurface { cells: Vec::new() },
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
                terrain: TerrainCollisionSurface { cells: Vec::new() },
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
            scene
                .shadows
                .selected_colliders(&[target_owner], &CollisionPlacement::interior(target_cell)),
            [ColliderReference {
                owner: source_owner,
                collider_index: 0,
            }]
        );

        scene.remove(source_owner);
        assert!(
            scene
                .shadows
                .selected_colliders(&[target_owner], &CollisionPlacement::interior(target_cell))
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
                    terrain: TerrainCollisionSurface { cells: Vec::new() },
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
                .selected_colliders(&[original_owner], &CollisionPlacement::outdoor()),
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
                    terrain: TerrainCollisionSurface { cells: Vec::new() },
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
