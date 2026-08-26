//! Parent-driven spatial bodies whose placement is reconciled without collision response.

use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use thiserror::Error;

use super::{
    CollisionQueryError, CollisionScene, MotionWaypoint, MotionWaypointPlacement, PlacedMotionPath,
    PlacedMotionPathRequest,
};

/// Geometry of one child body rigidly driven by a parent body's accepted pose path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChildSpatialBodyDefinition {
    /// Child center in the parent body's local frame.
    local_center: Vector3,
    /// Positive sphere radius used only for portal reach and placement membership.
    radius: f32,
}

/// Invalid child-body geometry rejected before it can retain placement state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ChildSpatialBodyDefinitionError {
    #[error("child spatial body center must be finite")]
    NonFiniteCenter,
    #[error("child spatial body radius must be finite and positive")]
    InvalidRadius,
}

impl ChildSpatialBodyDefinition {
    /// Validates geometry independently from any parent or collision snapshot.
    pub fn new(
        local_center: Vector3,
        radius: f32,
    ) -> Result<Self, ChildSpatialBodyDefinitionError> {
        if !local_center.x.is_finite() || !local_center.y.is_finite() || !local_center.z.is_finite()
        {
            return Err(ChildSpatialBodyDefinitionError::NonFiniteCenter);
        }
        if !radius.is_finite() || radius <= 0.0 {
            return Err(ChildSpatialBodyDefinitionError::InvalidRadius);
        }
        Ok(Self {
            local_center,
            radius,
        })
    }
}

/// One accepted parent-pose boundary that drives a child body's derived motion.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChildSpatialBodyWaypoint {
    /// Parent pose accepted at this boundary.
    pub parent_pose: WorldPosition,
    /// Strictly increasing normalized completion fraction in `(0, 1]`.
    pub end_fraction: f32,
}

/// Solver-owned placement history for one non-responsive body attached to a spatial parent.
///
/// The child has no independent pose authority, integration, contacts, or scene-interest demand.
/// Its only retained state is the portal-committed cell needed to reconcile the next parent path.
#[derive(Debug, Clone, PartialEq)]
pub struct ChildSpatialBody {
    definition: ChildSpatialBodyDefinition,
    committed_cell: Option<Guid>,
}

impl ChildSpatialBody {
    /// Creates a child whose initial topology is seeded by the parent's authoritative residency.
    pub fn new(definition: ChildSpatialBodyDefinition, parent_pose: WorldPosition) -> Self {
        Self {
            definition,
            committed_cell: parent_pose.is_indoors().then_some(parent_pose.landblock_id),
        }
    }

    /// Returns the child cell committed by the most recent successful reconciliation.
    pub const fn committed_cell(&self) -> Option<Guid> {
        self.committed_cell
    }

    /// Returns the immutable parent-local geometry reconciled by this child.
    pub const fn definition(&self) -> ChildSpatialBodyDefinition {
        self.definition
    }

    /// Reconciles the child over one accepted parent path and commits placement atomically.
    pub fn reconcile_parent_path(
        &mut self,
        scene: &CollisionScene,
        initial_parent_pose: WorldPosition,
        parent_waypoints: &[ChildSpatialBodyWaypoint],
    ) -> Result<PlacedMotionPath, CollisionQueryError> {
        let anchor = landblock_owner(initial_parent_pose.landblock_id);
        let start =
            child_center_in_anchor(initial_parent_pose, anchor, self.definition.local_center);
        let waypoints = parent_waypoints
            .iter()
            .map(|waypoint| MotionWaypoint {
                center: child_center_in_anchor(
                    waypoint.parent_pose,
                    anchor,
                    self.definition.local_center,
                ),
                end_fraction: waypoint.end_fraction,
                placement: MotionWaypointPlacement::Traverse,
            })
            .collect::<Vec<_>>();
        let path = scene.transit_motion_path(PlacedMotionPathRequest {
            previous_cell: self.committed_cell,
            anchor,
            start,
            radius: self.definition.radius,
            waypoints: &waypoints,
        })?;
        self.committed_cell = path.final_point().placement().committed_cell();
        Ok(path)
    }
}

fn landblock_owner(cell: Guid) -> Guid {
    Guid((cell.0 & 0xffff_0000) | 0xffff)
}

fn child_center_in_anchor(
    parent_pose: WorldPosition,
    anchor: Guid,
    local_center: Vector3,
) -> Vector3 {
    let parent_owner = landblock_owner(parent_pose.landblock_id);
    let offset = parent_pose.rotation.rotate_vector(local_center);
    let parent_x = ((parent_owner.0 >> 24) & 0xff) as i32;
    let parent_y = ((parent_owner.0 >> 16) & 0xff) as i32;
    let anchor_x = ((anchor.0 >> 24) & 0xff) as i32;
    let anchor_y = ((anchor.0 >> 16) & 0xff) as i32;
    Vector3::new(
        parent_pose.coords.x
            + offset.x
            + (parent_x - anchor_x) as f32 * holtburger_common::position::METERS_PER_LANDBLOCK,
        parent_pose.coords.y
            + offset.y
            + (parent_y - anchor_y) as f32 * holtburger_common::position::METERS_PER_LANDBLOCK,
        parent_pose.coords.z + offset.z,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};

    fn pose(cell: u32, coords: Vector3) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(cell),
            coords,
            rotation: Quaternion::identity(),
        }
    }

    #[test]
    fn rejects_invalid_geometry_before_it_can_retain_state() {
        assert_eq!(
            ChildSpatialBodyDefinition::new(Vector3::new(f32::NAN, 0.0, 0.0), 0.3),
            Err(ChildSpatialBodyDefinitionError::NonFiniteCenter)
        );
        assert_eq!(
            ChildSpatialBodyDefinition::new(Vector3::zero(), 0.0),
            Err(ChildSpatialBodyDefinitionError::InvalidRadius)
        );
    }

    #[test]
    fn outdoor_child_follows_parent_across_landblock_frames_without_owning_interest() {
        let initial = pose(0xda55_0020, Vector3::new(191.0, 96.0, 4.0));
        let definition = ChildSpatialBodyDefinition::new(Vector3::new(0.0, 0.0, 1.5), 0.3)
            .expect("test child should be valid");
        let mut child = ChildSpatialBody::new(definition, initial);
        let path = child
            .reconcile_parent_path(
                &CollisionScene::new(),
                initial,
                &[ChildSpatialBodyWaypoint {
                    parent_pose: pose(0xdb55_0001, Vector3::new(1.0, 96.0, 4.0)),
                    end_fraction: 1.0,
                }],
            )
            .expect("outdoor placement should be topology-free");

        assert_eq!(path.anchor(), Guid(0xda55_ffff));
        assert_eq!(path.initial().center(), Vector3::new(191.0, 96.0, 5.5));
        assert_eq!(path.final_point().center(), Vector3::new(193.0, 96.0, 5.5));
        assert_eq!(child.committed_cell(), None);
    }
}
