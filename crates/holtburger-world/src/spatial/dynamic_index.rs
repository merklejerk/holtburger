//! Tick-start broad-phase membership for dynamic entity targets.

use std::collections::HashMap;

use anyhow::{Context, Result};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_content::{CollisionBox, LandblockPlacement};

use super::cell_index::GlobalCellRange;
use super::{CollisionPlacement, SpatialBody, SpatialBodyId};

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
            for cell in dynamic.placement.reached_interior_cells() {
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
        mover: SpatialBodyId,
        anchor: Guid,
        minimum: Vector3,
        maximum: Vector3,
        placement: &CollisionPlacement,
    ) -> Vec<SpatialBodyId> {
        let mut selected = Vec::new();
        if placement.reaches_outdoors() {
            for cell in GlobalCellRange::from_local_extent(anchor, minimum, maximum).cells() {
                if let Some(bodies) = self.outdoor_cells.get(&cell) {
                    selected.extend(bodies.iter().copied());
                }
            }
        }
        for cell in placement.reached_interior_cells() {
            if let Some(bodies) = self.interior_cells.get(cell) {
                selected.extend(bodies.iter().copied());
            }
        }
        selected.sort_unstable();
        selected.dedup();
        selected.retain(|body_id| *body_id != mover);
        selected
    }
}

/// Current conservative bounds for the effective target-geometry branch.
pub(crate) fn target_bounds(body: &SpatialBody) -> Result<Vec<CollisionBox>> {
    let dynamic = body
        .physical
        .as_ref()
        .and_then(|physical| physical.dynamic.as_ref())
        .context("body has no dynamic physical state")?;
    let geometry = &dynamic.collision.target_geometry;
    let root = root_placement(body.pose);
    if dynamic.collision.uses_physics_bsp {
        geometry
            .physics_bsp_parts
            .iter()
            .map(|part| {
                let placement = compose_part(&root, part.local_origin, part.local_orientation);
                CollisionBox::from_placed_shape(&part.shape, &placement, part.scale)
            })
            .collect()
    } else {
        geometry
            .fallback_shapes
            .iter()
            .map(|shape| CollisionBox::from_placed_shape(shape, &root, geometry.fallback_scale))
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
