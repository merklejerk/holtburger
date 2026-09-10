//! Tick-start broad-phase membership for dynamic entity targets.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_content::{ColliderScale, LandblockPlacement, PlacedCollisionShape};

use super::cell_index::GlobalCellRange;
use super::physical_body::DynamicBodyRuntimeState;
use super::volume_query::placed_shape_contacts;
use super::{DynamicBodyActivity, SpatialBody, SpatialBodyId, SpatialMembership};
use crate::{EntityCollisionParticipation, LocalTargetDemand, PreparedEntityTargetGeometry};

/// Immutable posed entity targets and broad-phase membership shared by camera and prediction queries.
#[derive(Debug, Clone)]
pub struct EntityCollisionSnapshot {
    pub(crate) targets: BTreeMap<SpatialBodyId, EntityCollisionTarget>,
    pub(crate) index: DynamicShadowIndex,
}

/// Collision-only immutable entity record, without integration, animation cursors, or reports.
#[derive(Debug, Clone)]
pub(crate) struct EntityCollisionTarget {
    /// Normalized frame containing the prepared shapes.
    pub(crate) anchor: Guid,
    /// Common directional collision and membership facts.
    pub(super) contact: super::mobile_contact::ContactParticipant,
    /// Current posed geometry shared across all queries on this publication.
    pub(crate) shapes: Arc<[PlacedCollisionShape]>,
    /// Landing-target identity exists only when the producer admits a settled solid target.
    proof: Option<EntityCollisionProof>,
    /// Camera obstacles include solid non-creatures even while their authored poses change.
    /// Retail viewer transitions skip creatures in acclient.c:304639–304650.
    pub(crate) camera_solid: bool,
}

impl EntityCollisionTarget {
    /// Places the already-prepared geometry in one solver frame without resampling animation.
    pub(crate) fn shapes_in(&self, anchor: Guid) -> Result<Vec<PlacedCollisionShape>> {
        self.shapes
            .iter()
            .map(|shape| {
                if anchor == self.anchor {
                    return Ok(shape.clone());
                }
                let mut placement = shape.placement;
                placement.origin = WorldPosition {
                    landblock_id: self.anchor,
                    coords: placement.origin,
                    rotation: placement.orientation,
                }
                .reanchor_to_landblock_owner(anchor)?
                .coords;
                PlacedCollisionShape::new(shape.shape.clone(), placement, shape.scale)
            })
            .collect()
    }
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
        super::FrozenContactTargets::compile(anchor, self.targets.values())
    }

    pub(crate) fn compile<'a>(bodies: impl IntoIterator<Item = &'a SpatialBody>) -> Result<Self> {
        let mut targets = BTreeMap::new();
        for body in bodies {
            if !matches!(body.id, SpatialBodyId::Entity(_)) {
                continue;
            }
            let Some(dynamic) = indexed_dynamic_body(body) else {
                continue;
            };
            let physical = body
                .physical
                .as_ref()
                .context("indexed entity lost physics")?;
            let anchor = owner(body.pose);
            let target = EntityCollisionTarget {
                anchor,
                contact: super::mobile_contact::ContactParticipant::from_dynamic(
                    body,
                    dynamic,
                    physical.collision_filter,
                ),
                shapes: placed_target_shapes(dynamic, body.pose, anchor)?.into(),
                proof: selectable_target_proof(body),
                camera_solid: dynamic.collision.dynamic_collision.target
                    == EntityCollisionParticipation::Solid
                    && matches!(
                        dynamic.collision.contact_response,
                        super::EntityContactResponse::Obstacle
                    ),
            };
            targets.insert(body.id, target);
        }
        let index = DynamicShadowIndex::compile_prepared(targets.iter().map(|(id, target)| {
            (
                *id,
                &target.contact.membership,
                target.anchor,
                target.shapes.as_ref(),
            )
        }));
        Ok(Self { targets, index })
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
    /// Indexes already-admitted targets from their current membership and placed geometry.
    /// The preparation owner resolves participation; indexing never recovers body physics.
    pub(crate) fn compile_prepared<'a>(
        bodies: impl IntoIterator<
            Item = (
                SpatialBodyId,
                &'a SpatialMembership,
                Guid,
                &'a [PlacedCollisionShape],
            ),
        >,
    ) -> Self {
        let mut index = Self::default();
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
                        index.outdoor_cells.entry(cell).or_default().push(id);
                    }
                }
            }
            for cell in placement.reached_env_cells() {
                index.interior_cells.entry(*cell).or_default().push(id);
            }
        }
        for bodies in index
            .outdoor_cells
            .values_mut()
            .chain(index.interior_cells.values_mut())
        {
            bodies.sort_unstable();
            bodies.dedup();
        }
        index
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
        if placement.reaches_outdoors() {
            for cell in GlobalCellRange::from_local_extent(anchor, minimum, maximum).cells() {
                if let Some(bodies) = self.outdoor_cells.get(&cell) {
                    selected.extend(bodies.iter().copied());
                }
            }
        }
        for cell in placement.reached_env_cells() {
            if let Some(bodies) = self.interior_cells.get(cell) {
                selected.extend(bodies.iter().copied());
            }
        }
        selected.sort_unstable();
        selected.dedup();
        if let Some(excluded) = excluded {
            selected.retain(|body_id| *body_id != excluded);
        }
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

fn owner(pose: WorldPosition) -> Guid {
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

/// Retail calls `check_collision(peer, object)` for each other unparented object in the object's
/// shadow cells (`acclient.c:308394-308444,333172-333189`). The peer therefore supplies movement
/// spheres and `object` supplies target geometry; no static scene query or sweep participates.
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
    let anchor = Guid((object.pose.landblock_id.0 & 0xffff_0000) | 0xffff);
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
