//! Tick-start broad-phase membership for dynamic entity targets.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, OnceLock};

use anyhow::{Context, Result};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_content::{ColliderScale, LandblockPlacement, PlacedCollisionShape};

use super::cell_index::GlobalCellRange;
use super::physical_body::DynamicBodyRuntimeState;
use super::volume_query::placed_shape_contacts;
use super::{
    DynamicBodyActivity, PhysicalBodyDefinition, PhysicalBodyState, SpatialBody, SpatialBodyId,
    SpatialMembership,
};
use crate::{
    EntityCollisionParticipation, EntityIntegrationEligibility, LocalIntegrationDemand,
    LocalTargetDemand, PreparedEntityTargetGeometry,
};

/// Immutable posed entity targets and broad-phase membership shared by camera and prediction queries.
#[derive(Debug, Clone)]
pub struct EntityCollisionSnapshot {
    pub(crate) targets: BTreeMap<SpatialBodyId, EntityCollisionTarget>,
    pub(crate) index: DynamicShadowIndex,
    reporting_enabled_count: usize,
    accepts_peer_reports_count: usize,
    /// Query-driven frozen geometry shared by predictions using this publication's first frame.
    frozen_queries: OnceLock<super::FrozenContactTargets>,
}

/// Collision-only immutable entity record, without integration, animation cursors, or reports.
#[derive(Debug, Clone)]
pub(crate) struct EntityCollisionTarget {
    /// Normalized frame containing the prepared shapes.
    pub(crate) anchor: Guid,
    /// Monotonic geometry identity for O(1) stationary-support and target cache validation.
    pub(crate) geometry_stamp: u64,
    /// Common directional collision and membership facts.
    pub(super) contact: super::mobile_contact::ContactParticipant,
    /// Current posed geometry shared across all queries on this publication.
    pub(crate) shapes: Arc<[PlacedCollisionShape]>,
    /// Landing-target identity exists only when the producer admits a settled solid target.
    proof: Option<EntityCollisionProof>,
    /// Camera obstacles include solid non-creatures even while their authored poses change.
    /// Retail viewer transitions skip creatures.
    pub(crate) camera_solid: bool,
    /// Whether this body emits collision reports when touching indexed peers.
    pub(crate) reporting_enabled: bool,
    /// Whether dynamic collision reports classify this body as `Environment`.
    pub(crate) report_as_environment: bool,
    /// Whether ordinary sweeps treat this body as a one-way hard target.
    pub(crate) is_hard_target: bool,
}

impl EntityCollisionTarget {
    /// Builds one indexed collision target from a body and optional cached placed shapes.
    pub(crate) fn from_body_cached(
        geometry_stamp: u64,
        body: &SpatialBody,
        cached_shapes: Option<(Guid, Arc<[PlacedCollisionShape]>)>,
    ) -> Result<Option<Self>> {
        if !matches!(body.id, SpatialBodyId::Entity(_)) {
            return Ok(None);
        }
        let Some(dynamic) = indexed_dynamic_body(body) else {
            return Ok(None);
        };
        let physical = body
            .physical
            .as_ref()
            .context("indexed entity lost physics")?;
        let anchor = landblock_owner(body.pose);
        let shapes = match cached_shapes {
            Some((cached_anchor, shapes)) if cached_anchor == anchor => shapes,
            Some((cached_anchor, shapes)) => {
                reanchor_placed_shapes_arc(cached_anchor, &shapes, anchor)?
            }
            None => placed_target_shapes(dynamic, body.pose, anchor)?.into(),
        };
        let contact = super::mobile_contact::ContactParticipant::from_dynamic(
            body,
            dynamic,
            physical.collision_filter,
        );
        Ok(Some(Self {
            anchor,
            geometry_stamp,
            contact,
            shapes,
            proof: selectable_target_proof(body),
            camera_solid: dynamic.collision.dynamic_collision.target
                == EntityCollisionParticipation::Solid
                && matches!(
                    dynamic.collision.contact_response,
                    super::EntityContactResponse::Obstacle
                ),
            reporting_enabled: dynamic.collision.reporting.enabled,
            report_as_environment: dynamic.collision.reporting.as_environment,
            is_hard_target: is_hard_target_dynamic(physical, dynamic),
        }))
    }

    pub(crate) fn has_proof(&self) -> bool {
        self.proof.is_some()
    }

    /// Synthetic collision-only record for deferred/exhaustive geometry equivalence tests.
    #[cfg(test)]
    pub(super) fn for_test(
        anchor: Guid,
        contact: super::mobile_contact::ContactParticipant,
        shapes: Vec<PlacedCollisionShape>,
    ) -> Self {
        Self {
            anchor,
            geometry_stamp: 0,
            contact,
            shapes: shapes.into(),
            proof: None,
            camera_solid: true,
            reporting_enabled: false,
            report_as_environment: false,
            is_hard_target: true,
        }
    }
}

/// Shared classification for bodies that act as one-way obstacles in ordinary sweeps.
pub(crate) fn is_hard_target_dynamic(
    physical: &PhysicalBodyState,
    dynamic: &DynamicBodyRuntimeState,
) -> bool {
    matches!(
        physical.definition,
        PhysicalBodyDefinition::FixedPosition { .. }
    ) || dynamic.demand.integration == LocalIntegrationDemand::Excluded
        || matches!(
            dynamic.collision.contact_response,
            super::EntityContactResponse::Character(
                EntityIntegrationEligibility::Frozen | EntityIntegrationEligibility::Static
            )
        )
        || (!dynamic.collision.dynamic_collision.missile
            && !dynamic.collision.contact_response.yields())
}

/// Reframes captured geometry without resampling its authored shape or animation.
pub(super) fn reanchor_placed_shapes_arc(
    source_anchor: Guid,
    shapes: &Arc<[PlacedCollisionShape]>,
    anchor: Guid,
) -> Result<Arc<[PlacedCollisionShape]>> {
    if anchor == source_anchor {
        return Ok(Arc::clone(shapes));
    }
    Ok(reanchor_placed_shapes(source_anchor, shapes, anchor)?.into())
}

/// Reframes captured geometry into caller-owned scratch without resampling authored shapes.
pub(super) fn reanchor_placed_shapes_into(
    source_anchor: Guid,
    shapes: &[PlacedCollisionShape],
    anchor: Guid,
    out: &mut Vec<PlacedCollisionShape>,
) -> Result<()> {
    out.clear();
    out.reserve(shapes.len());
    for shape in shapes {
        if anchor == source_anchor {
            out.push(shape.clone());
            continue;
        }
        let mut placement = shape.placement;
        placement.origin = WorldPosition {
            landblock_id: source_anchor,
            coords: placement.origin,
            rotation: placement.orientation,
        }
        .reanchor_to_landblock_owner(anchor)?
        .coords;
        out.push(PlacedCollisionShape::new(
            shape.shape.clone(),
            placement,
            shape.scale,
        )?);
    }
    Ok(())
}

/// Reframes captured geometry without resampling its authored shape or animation.
pub(super) fn reanchor_placed_shapes(
    source_anchor: Guid,
    shapes: &[PlacedCollisionShape],
    anchor: Guid,
) -> Result<Vec<PlacedCollisionShape>> {
    let mut out = Vec::new();
    reanchor_placed_shapes_into(source_anchor, shapes, anchor, &mut out)?;
    Ok(out)
}

/// Exact collision-relevant identity of one selectable entity surface.
#[derive(Debug, Clone, PartialEq)]
pub struct EntityCollisionProof {
    body_id: SpatialBodyId,
    pose: WorldPosition,
    target_geometry: Arc<PreparedEntityTargetGeometry>,
    /// Immutable instance part poses that identify the queried surface at capture time.
    collision_poses: Arc<[holtburger_common::RigidTransform]>,
    uses_physics_bsp: bool,
    placement: SpatialMembership,
}

impl EntityCollisionProof {
    /// Entity body whose selected geometry supplied the surface.
    pub const fn body_id(&self) -> SpatialBodyId {
        self.body_id
    }

    pub(crate) fn matches(&self, body: &SpatialBody) -> bool {
        selectable_target_proof(body).is_some_and(|current| current == *self)
    }
}

impl EntityCollisionSnapshot {
    /// Places and indexes frozen peers once in the trajectory's common coordinate frame.
    pub fn prepare_frozen_contacts(&self, anchor: Guid) -> Result<super::FrozenContactTargets> {
        if let Some(prepared) = self.frozen_queries.get() {
            return if prepared.anchor() == anchor {
                Ok(prepared.clone())
            } else {
                super::FrozenContactTargets::compile(anchor, self.targets.values())
            };
        }
        let prepared = super::FrozenContactTargets::compile(anchor, self.targets.values())?;
        let shared = self.frozen_queries.get_or_init(|| prepared);
        if shared.anchor() == anchor {
            Ok(shared.clone())
        } else {
            // Concurrent queries can request different frames; geometry never inherits
            // another request's frame merely because it won first-publication ownership.
            super::FrozenContactTargets::compile(anchor, self.targets.values())
        }
    }

    #[cfg(test)]
    pub(crate) fn compile<'a>(bodies: impl IntoIterator<Item = &'a SpatialBody>) -> Result<Self> {
        Self::compile_with_cached(bodies.into_iter().map(|body| (0, body, None)))
    }

    pub(crate) fn compile_with_cached<'a>(
        entries: impl IntoIterator<
            Item = (
                u64,
                &'a SpatialBody,
                Option<(Guid, Arc<[PlacedCollisionShape]>)>,
            ),
        >,
    ) -> Result<Self> {
        let mut targets = BTreeMap::new();
        let mut reporting_enabled_count = 0usize;
        let mut accepts_peer_reports_count = 0usize;
        for (geometry_stamp, body, cached_shapes) in entries {
            let Some(target) =
                EntityCollisionTarget::from_body_cached(geometry_stamp, body, cached_shapes)?
            else {
                continue;
            };
            reporting_enabled_count += usize::from(target.reporting_enabled);
            accepts_peer_reports_count += usize::from(target.contact.policy.accepts_peer_reports);
            targets.insert(body.id, target);
        }
        let mut index = DynamicShadowIndex::default();
        index.rebuild_prepared(targets.iter().map(|(id, target)| {
            (
                *id,
                &target.contact.membership,
                target.anchor,
                target.shapes.as_ref(),
            )
        }));
        Ok(Self {
            targets,
            index,
            reporting_enabled_count,
            accepts_peer_reports_count,
            frozen_queries: OnceLock::new(),
        })
    }

    pub(crate) const fn any_reporting_enabled(&self) -> bool {
        self.reporting_enabled_count > 0
    }

    pub(crate) const fn any_accepts_peer_reports(&self) -> bool {
        self.accepts_peer_reports_count > 0
    }

    /// Incrementally replaces or removes one entity target in place.
    pub(crate) fn update_target(
        &mut self,
        body_id: SpatialBodyId,
        next: Option<EntityCollisionTarget>,
    ) {
        if let Some(target) = next {
            if let Some(previous) = self.targets.get_mut(&body_id) {
                self.reporting_enabled_count = self.reporting_enabled_count
                    - usize::from(previous.reporting_enabled)
                    + usize::from(target.reporting_enabled);
                self.accepts_peer_reports_count = self.accepts_peer_reports_count
                    - usize::from(previous.contact.policy.accepts_peer_reports)
                    + usize::from(target.contact.policy.accepts_peer_reports);
                let index_unchanged = previous.geometry_stamp == target.geometry_stamp
                    && previous.anchor == target.anchor
                    && previous.contact.membership == target.contact.membership
                    && Arc::ptr_eq(&previous.shapes, &target.shapes);
                if !index_unchanged {
                    self.index.remove_target(
                        body_id,
                        &previous.contact.membership,
                        previous.anchor,
                        &previous.shapes,
                    );
                    self.index.insert_target(
                        body_id,
                        &target.contact.membership,
                        target.anchor,
                        &target.shapes,
                    );
                }
                *previous = target;
                self.frozen_queries = OnceLock::new();
            } else {
                self.reporting_enabled_count += usize::from(target.reporting_enabled);
                self.accepts_peer_reports_count +=
                    usize::from(target.contact.policy.accepts_peer_reports);
                self.index.insert_target(
                    body_id,
                    &target.contact.membership,
                    target.anchor,
                    &target.shapes,
                );
                self.targets.insert(body_id, target);
                self.frozen_queries = OnceLock::new();
            }
        } else if let Some(previous) = self.targets.remove(&body_id) {
            self.reporting_enabled_count -= usize::from(previous.reporting_enabled);
            self.accepts_peer_reports_count -=
                usize::from(previous.contact.policy.accepts_peer_reports);
            self.index.remove_target(
                body_id,
                &previous.contact.membership,
                previous.anchor,
                &previous.shapes,
            );
            self.frozen_queries = OnceLock::new();
        }
    }

    /// Clears only `proof` when a body transitions out of settled status without changing geometry.
    pub(crate) fn clear_target_proof(&mut self, body_id: SpatialBodyId) {
        if let Some(target) = self.targets.get_mut(&body_id) {
            target.proof = None;
        }
    }

    pub(crate) fn target(&self, body_id: SpatialBodyId) -> Option<&EntityCollisionTarget> {
        self.targets.get(&body_id)
    }

    pub(crate) fn proof(&self, body_id: SpatialBodyId) -> Option<EntityCollisionProof> {
        self.target(body_id).and_then(|target| target.proof.clone())
    }

    /// Verifies one retained entity surface against this sealed target population.
    pub fn proves(&self, proof: &EntityCollisionProof) -> bool {
        self.target(proof.body_id())
            .is_some_and(|target| target.proof.as_ref() == Some(proof))
    }
}

/// Scene-owned dynamic equivalent of retail's outdoor and EnvCell shadow lists.
#[derive(Debug, Clone, Default)]
pub(crate) struct DynamicShadowIndex {
    outdoor_cells: HashMap<(i32, i32), Vec<SpatialBodyId>>,
    interior_cells: HashMap<Guid, Vec<SpatialBodyId>>,
}

impl DynamicShadowIndex {
    /// Clears all cell entries while retaining map capacity when modest in size.
    pub(crate) fn clear_retaining(&mut self) {
        if self.outdoor_cells.len() > 512 {
            self.outdoor_cells.clear();
        } else {
            for bodies in self.outdoor_cells.values_mut() {
                bodies.clear();
            }
        }
        if self.interior_cells.len() > 256 {
            self.interior_cells.clear();
        } else {
            for bodies in self.interior_cells.values_mut() {
                bodies.clear();
            }
        }
    }

    /// Rebuilds index contents in place, preserving existing cell `Vec` capacities.
    pub(crate) fn rebuild_prepared<'a>(
        &mut self,
        bodies: impl IntoIterator<
            Item = (
                SpatialBodyId,
                &'a SpatialMembership,
                Guid,
                &'a [PlacedCollisionShape],
            ),
        >,
    ) {
        self.clear_retaining();
        for (id, placement, anchor, shapes) in bodies {
            if shapes.is_empty() {
                continue;
            }
            if placement.reaches_outdoors() {
                for shape in shapes {
                    for cell in GlobalCellRange::from_local_extent(
                        anchor,
                        shape.bounds.minimum(),
                        shape.bounds.maximum(),
                    )
                    .cells()
                    {
                        self.outdoor_cells.entry(cell).or_default().push(id);
                    }
                }
            }
            for cell in placement.reached_env_cells() {
                self.interior_cells.entry(*cell).or_default().push(id);
            }
        }
        for bodies in self
            .outdoor_cells
            .values_mut()
            .chain(self.interior_cells.values_mut())
        {
            if bodies.len() > 1 {
                bodies.sort_unstable();
                bodies.dedup();
            }
        }
    }

    /// Inserts one target into its touched outdoor and interior cells, keeping lists sorted.
    pub(crate) fn insert_target(
        &mut self,
        id: SpatialBodyId,
        placement: &SpatialMembership,
        anchor: Guid,
        shapes: &[PlacedCollisionShape],
    ) {
        if shapes.is_empty() {
            return;
        }
        if placement.reaches_outdoors() {
            for shape in shapes {
                for cell in GlobalCellRange::from_local_extent(
                    anchor,
                    shape.bounds.minimum(),
                    shape.bounds.maximum(),
                )
                .cells()
                {
                    let bucket = self.outdoor_cells.entry(cell).or_default();
                    if let Err(pos) = bucket.binary_search(&id) {
                        bucket.insert(pos, id);
                    }
                }
            }
        }
        for cell in placement.reached_env_cells() {
            let bucket = self.interior_cells.entry(*cell).or_default();
            if let Err(pos) = bucket.binary_search(&id) {
                bucket.insert(pos, id);
            }
        }
    }

    /// Removes one target from its touched outdoor and interior cells.
    pub(crate) fn remove_target(
        &mut self,
        id: SpatialBodyId,
        placement: &SpatialMembership,
        anchor: Guid,
        shapes: &[PlacedCollisionShape],
    ) {
        if shapes.is_empty() {
            return;
        }
        if placement.reaches_outdoors() {
            for shape in shapes {
                for cell in GlobalCellRange::from_local_extent(
                    anchor,
                    shape.bounds.minimum(),
                    shape.bounds.maximum(),
                )
                .cells()
                {
                    if let Some(bucket) = self.outdoor_cells.get_mut(&cell)
                        && let Ok(pos) = bucket.binary_search(&id)
                    {
                        bucket.remove(pos);
                        if bucket.is_empty() {
                            self.outdoor_cells.remove(&cell);
                        }
                    }
                }
            }
        }
        for cell in placement.reached_env_cells() {
            if let Some(bucket) = self.interior_cells.get_mut(cell)
                && let Ok(pos) = bucket.binary_search(&id)
            {
                bucket.remove(pos);
                if bucket.is_empty() {
                    self.interior_cells.remove(cell);
                }
            }
        }
    }

    /// Collects stable, deduplicated candidates into caller-owned `out` scratch.
    pub(crate) fn candidates_into(
        &self,
        excluded: Option<SpatialBodyId>,
        anchor: Guid,
        minimum: Vector3,
        maximum: Vector3,
        placement: &SpatialMembership,
        out: &mut Vec<SpatialBodyId>,
    ) {
        out.clear();
        if placement.reaches_outdoors() {
            for cell in GlobalCellRange::from_local_extent(anchor, minimum, maximum).cells() {
                if let Some(bodies) = self.outdoor_cells.get(&cell) {
                    out.extend(bodies.iter().copied());
                }
            }
        }
        for cell in placement.reached_env_cells() {
            if let Some(bodies) = self.interior_cells.get(cell) {
                out.extend(bodies.iter().copied());
            }
        }
        if out.len() > 1 {
            out.sort_unstable();
            out.dedup();
        }
        if let Some(excluded) = excluded {
            out.retain(|body_id| *body_id != excluded);
        }
    }

    /// Returns stable, deduplicated candidates from swept outdoor cells and provisional EnvCells.
    pub(crate) fn candidates(
        &self,
        excluded: Option<SpatialBodyId>,
        anchor: Guid,
        minimum: Vector3,
        maximum: Vector3,
        placement: &SpatialMembership,
    ) -> Vec<SpatialBodyId> {
        let mut selected = Vec::new();
        self.candidates_into(excluded, anchor, minimum, maximum, placement, &mut selected);
        selected
    }
}

/// Local-player and remote targets share the live collision index; ephemeral probes do not.
pub(crate) fn indexed_dynamic_body(
    body: &SpatialBody,
) -> Option<&super::physical_body::DynamicBodyRuntimeState> {
    let dynamic = body.physical.as_ref()?.dynamic.as_ref()?;
    dynamic_target_is_indexed(body.id, dynamic).then_some(dynamic)
}

/// Shared admission for canonical bodies and prepared substep report views.
pub(crate) fn dynamic_target_is_indexed(
    id: SpatialBodyId,
    dynamic: &DynamicBodyRuntimeState,
) -> bool {
    !matches!(id, SpatialBodyId::Ephemeral(_))
        && dynamic.activity != DynamicBodyActivity::Suspended
        && dynamic.demand.target == LocalTargetDemand::Retained
        && dynamic.collision.dynamic_collision.target != EntityCollisionParticipation::Suppressed
        && !dynamic.collision.dynamic_collision.missile
}

fn selectable_target_proof(body: &SpatialBody) -> Option<EntityCollisionProof> {
    let dynamic = body.physical.as_ref()?.dynamic.as_ref()?;
    if !matches!(body.id, SpatialBodyId::Entity(_))
        || dynamic.activity != DynamicBodyActivity::Settled
        || dynamic.demand.target != LocalTargetDemand::Retained
        || dynamic.collision.dynamic_collision.target != EntityCollisionParticipation::Solid
        || dynamic.collision.dynamic_collision.missile
    {
        return None;
    }
    Some(EntityCollisionProof {
        body_id: body.id,
        pose: body.pose,
        target_geometry: dynamic.collision.target_geometry.clone(),
        collision_poses: dynamic.collision_poses.poses.clone(),
        uses_physics_bsp: dynamic.collision.uses_physics_bsp,
        placement: dynamic.placement.clone(),
    })
}

/// Places the effective target branch in one caller-selected landblock frame.
pub(crate) fn placed_target_shapes(
    dynamic: &DynamicBodyRuntimeState,
    pose: WorldPosition,
    anchor: Guid,
) -> Result<Vec<PlacedCollisionShape>> {
    let geometry = &dynamic.collision.target_geometry;
    let object_scale = dynamic.object_scale;
    let root = root_placement(
        pose.reanchor_to_landblock_owner(anchor)
            .context("could not reanchor dynamic target geometry")?,
    );
    if dynamic.collision.uses_physics_bsp {
        geometry
            .physics_bsp_parts
            .iter()
            .enumerate()
            .map(|(index, part)| {
                let pose = dynamic.collision_poses.poses[index];
                let placement = compose_part(&root, pose.translation * object_scale, pose.rotation);
                let scale = ColliderScale::from_components(part.scale.components() * object_scale)?;
                PlacedCollisionShape::new(part.shape.clone(), placement, scale)
            })
            .collect()
    } else {
        let scale =
            ColliderScale::from_components(geometry.fallback_scale.components() * object_scale)?;
        geometry
            .fallback_shapes
            .iter()
            .map(|shape| PlacedCollisionShape::new(shape.clone(), root, scale))
            .collect()
    }
}

pub(crate) const fn landblock_owner(pose: WorldPosition) -> Guid {
    Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff)
}

fn root_placement(pose: WorldPosition) -> LandblockPlacement {
    LandblockPlacement {
        origin: pose.coords,
        orientation: pose.rotation,
    }
}

fn compose_part(
    root: &LandblockPlacement,
    local_origin: Vector3,
    local_orientation: holtburger_common::Quaternion,
) -> LandblockPlacement {
    LandblockPlacement {
        origin: root.origin + root.orientation.rotate_vector(local_origin),
        orientation: root.orientation.multiply(&local_orientation),
    }
}

/// Retail calls `check_collision(peer, object)` for each other unparented object in the
/// object's shadow cells. The peer therefore supplies movement spheres and `object` supplies
/// target geometry; no static scene query or sweep participates.
pub(crate) fn current_entity_peer_overlap<'a>(
    object: &SpatialBody,
    peers: impl IntoIterator<Item = &'a SpatialBody>,
) -> Result<bool> {
    let object_dynamic = object
        .physical
        .as_ref()
        .and_then(|physical| physical.dynamic.as_ref())
        .context("solidifying object has no dynamic physical state")?;
    // Test the requested solid state; current ethereal participation must not make
    // solidification automatically succeed (retail checks peers before committing it).
    let mut prospective = object_dynamic.collision.dynamic_collision;
    prospective.target = EntityCollisionParticipation::Solid;
    let anchor = landblock_owner(object.pose);
    let object_shapes = placed_target_shapes(object_dynamic, object.pose, anchor)?;
    if object_shapes.is_empty() {
        return Ok(false);
    }

    for peer in peers {
        if peer.id == object.id {
            continue;
        }
        let Some(peer_physical) = peer.physical.as_ref() else {
            continue;
        };
        let Some(peer_dynamic) = peer_physical.dynamic.as_ref() else {
            continue;
        };
        if peer_dynamic.activity == super::DynamicBodyActivity::Suspended
            || !object_dynamic
                .placement
                .intersects_reached(&peer_dynamic.placement)
            || peer_dynamic.collision.dynamic_collision.contact_with(
                prospective,
                peer_dynamic.collision.player_collision,
                object_dynamic.collision.player_collision,
            ) != crate::EntityContactInteraction::Blocking
        {
            continue;
        }
        let peer_pose = peer
            .pose
            .reanchor_to_landblock_owner(anchor)
            .context("could not reanchor solidification peer")?;
        for sphere in peer_physical.definition.spheres().iter() {
            let center = peer_pose.coords + peer_pose.rotation.rotate_vector(sphere.center);
            if object_shapes.iter().any(|shape| {
                shape.bounds.intersects_sphere(center, sphere.radius)
                    && !placed_shape_contacts(shape, center, sphere.radius).is_empty()
            }) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
