//! Tick-start broad-phase membership for dynamic entity targets.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_content::{ColliderScale, CollisionBox, LandblockPlacement, PlacedCollisionShape};

use super::cell_index::GlobalCellRange;
use super::{DynamicBodyActivity, SpatialBody, SpatialBodyId, SpatialMembership};
use crate::{EntityCollisionParticipation, LocalTargetDemand, PreparedEntityTargetGeometry};

/// Immutable entity targets and broad-phase membership sealed for one speculative evaluation.
#[derive(Debug, Clone)]
pub struct EntityCollisionSnapshot {
    pub(crate) targets: BTreeMap<SpatialBodyId, SpatialBody>,
    pub(crate) index: DynamicShadowIndex,
}

/// Exact collision-relevant identity of one selectable entity surface.
#[derive(Debug, Clone, PartialEq)]
pub struct EntityCollisionProof {
    body_id: SpatialBodyId,
    pose: WorldPosition,
    target_geometry: Arc<PreparedEntityTargetGeometry>,
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
    pub(crate) fn compile<'a>(bodies: impl IntoIterator<Item = &'a SpatialBody>) -> Result<Self> {
        let targets = bodies
            .into_iter()
            .filter(|body| matches!(body.id, SpatialBodyId::Entity(_)))
            .filter(|body| {
                body.physical
                    .as_ref()
                    .and_then(|physical| physical.dynamic.as_ref())
                    .is_some()
            })
            .map(|body| (body.id, body.clone()))
            .collect::<BTreeMap<_, _>>();
        let index = DynamicShadowIndex::compile(targets.values())?;
        Ok(Self { targets, index })
    }

    pub(crate) fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.targets.get(&body_id)
    }

    pub(crate) fn proof(&self, body_id: SpatialBodyId) -> Option<EntityCollisionProof> {
        self.body(body_id).and_then(selectable_target_proof)
    }

    /// Verifies one retained entity surface against this sealed target population.
    pub fn proves(&self, proof: &EntityCollisionProof) -> bool {
        self.body(proof.body_id())
            .is_some_and(|body| proof.matches(body))
    }
}

/// Scene-owned dynamic equivalent of retail's outdoor and EnvCell shadow lists.
#[derive(Debug, Clone, Default)]
pub(crate) struct DynamicShadowIndex {
    outdoor_cells: HashMap<(i32, i32), Vec<SpatialBodyId>>,
    interior_cells: HashMap<Guid, Vec<SpatialBodyId>>,
}

impl DynamicShadowIndex {
    /// Rebuilds one immutable tick-start index from the canonical body population.
    pub(crate) fn compile<'a>(bodies: impl IntoIterator<Item = &'a SpatialBody>) -> Result<Self> {
        let mut index = Self::default();
        let mut bodies = bodies.into_iter().collect::<Vec<_>>();
        bodies.sort_unstable_by_key(|body| body.id);
        for body in bodies {
            if !matches!(body.id, SpatialBodyId::Entity(_)) {
                continue;
            }
            let Some(dynamic) = body
                .physical
                .as_ref()
                .and_then(|physical| physical.dynamic.as_ref())
            else {
                continue;
            };
            if dynamic.activity == DynamicBodyActivity::Suspended {
                continue;
            }
            if dynamic.demand.target != LocalTargetDemand::Retained {
                continue;
            }
            if dynamic.collision.dynamic_collision.target
                == EntityCollisionParticipation::Suppressed
                || dynamic.collision.dynamic_collision.missile
            {
                continue;
            }
            let bounds = target_bounds(body).with_context(|| {
                format!("could not place dynamic target geometry for {:?}", body.id)
            })?;
            if bounds.is_empty() {
                continue;
            }
            if dynamic.placement.reaches_outdoors() {
                let anchor = owner(body.pose);
                for bounds in &bounds {
                    for cell in GlobalCellRange::from_local_extent(
                        anchor,
                        bounds.minimum(),
                        bounds.maximum(),
                    )
                    .cells()
                    {
                        index.outdoor_cells.entry(cell).or_default().push(body.id);
                    }
                }
            }
            for cell in dynamic.placement.reached_env_cells() {
                index.interior_cells.entry(*cell).or_default().push(body.id);
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
        Ok(index)
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
        uses_physics_bsp: dynamic.collision.uses_physics_bsp,
        placement: dynamic.placement.clone(),
    })
}

/// Current conservative bounds for the effective target-geometry branch.
pub(crate) fn target_bounds(body: &SpatialBody) -> Result<Vec<CollisionBox>> {
    Ok(placed_target_shapes(body, body.pose, owner(body.pose))?
        .into_iter()
        .map(|shape| shape.bounds)
        .collect())
}

/// Places the effective target branch in one caller-selected landblock frame.
pub(crate) fn placed_target_shapes(
    body: &SpatialBody,
    pose: WorldPosition,
    anchor: Guid,
) -> Result<Vec<PlacedCollisionShape>> {
    let dynamic = body
        .physical
        .as_ref()
        .and_then(|physical| physical.dynamic.as_ref())
        .context("body has no dynamic physical state")?;
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
            .map(|part| {
                let placement = compose_part(
                    &root,
                    part.local_origin * object_scale,
                    part.local_orientation,
                );
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
