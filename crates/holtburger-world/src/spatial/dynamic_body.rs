//! Validated entity-specific physical facts retained by the canonical spatial scene.

use std::sync::Arc;

use holtburger_common::properties::WeenieType;
use holtburger_common::{Quaternion, Vector3};
use holtburger_content::{ColliderScale, CollisionShape};

use crate::{EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, EntityPhysicsScheduling};

use super::{PhysicalBodyDefinition, PhysicalBodyResponsePolicy, PhysicalElasticity};

/// One immutable BSP part prepared in root-local coordinates.
#[derive(Debug, Clone)]
pub struct PreparedEntityBspPart {
    /// Zero-based setup part whose authored transform places this shape.
    pub part_index: usize,
    /// Immutable GfxObj content identity that owns the physics BSP.
    pub gfx_obj_did: u32,
    /// Part origin relative to the entity root after root scaling.
    pub local_origin: Vector3,
    /// Part orientation relative to the entity root.
    pub local_orientation: Quaternion,
    /// Complete part and root scale applied to the authored shape.
    pub scale: ColliderScale,
    /// Decoded immutable collision payload for the identified GfxObj.
    pub shape: Arc<CollisionShape>,
}

impl PartialEq for PreparedEntityBspPart {
    fn eq(&self, other: &Self) -> bool {
        self.part_index == other.part_index
            && self.gfx_obj_did == other.gfx_obj_did
            && self.local_origin == other.local_origin
            && self.local_orientation == other.local_orientation
            && self.scale == other.scale
        // Content repositories are immutable. Equal GfxObj identities plus equal placement facts
        // therefore describe compatible geometry even when two preparations decoded separate Arcs.
    }
}

/// Both retail target branches retained so a complete live state replacement is reversible.
#[derive(Debug, Clone)]
pub struct PreparedEntityTargetGeometry {
    /// Actual appearance-substituted BSP parts used when `HasPhysicsBSP` is set.
    pub physics_bsp_parts: Vec<PreparedEntityBspPart>,
    /// Immutable SetupModel identity that owns the ordered fallback volumes.
    pub fallback_setup_did: u32,
    /// Setup cylspheres, otherwise setup spheres, used when `HasPhysicsBSP` is clear.
    pub fallback_shapes: Vec<Arc<CollisionShape>>,
    /// Uniform root scale used by every fallback shape.
    pub fallback_scale: ColliderScale,
}

impl PartialEq for PreparedEntityTargetGeometry {
    fn eq(&self, other: &Self) -> bool {
        self.physics_bsp_parts == other.physics_bsp_parts
            && self.fallback_scale == other.fallback_scale
            && self.fallback_setup_did == other.fallback_setup_did
            && self.fallback_shapes.len() == other.fallback_shapes.len()
        // The setup identity and ordered shape count are the compatibility key. The decoded shape
        // Arcs are payload, not identity, and may come from independent preparations.
    }
}

/// Entity-specific collision and scheduling facts retained beside generic response memory.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicBodyCollisionDefinition {
    /// Both stable target branches prepared from immutable content.
    pub target_geometry: PreparedEntityTargetGeometry,
    /// State-derived fixed-tick eligibility.
    pub scheduling: EntityPhysicsScheduling,
    /// State-derived directional peer collision policy.
    pub dynamic_collision: EntityDynamicCollisionPolicy,
    /// State-derived directional contact reporting policy.
    pub reporting: EntityCollisionReportPolicy,
    /// Currently selected target branch within `target_geometry`.
    pub uses_physics_bsp: bool,
    /// Gameplay category consumed by dynamic pair filtering.
    pub weenie_type: WeenieType,
    /// Authored bounded elasticity retained across reversible `Inelastic` state changes.
    pub elasticity: PhysicalElasticity,
    /// Whether preparation found a setup default animation for reversible state changes.
    pub default_animation_available: bool,
    /// Whether preparation found a setup default physics script for reversible state changes.
    pub default_script_available: bool,
}

/// Complete immutable physical definition prepared before a dynamic entity body is installed.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicPhysicalBodyDefinition {
    /// Movement and environment-response geometry used by the existing physical solver.
    pub movement: PhysicalBodyDefinition,
    /// Authored response coefficients after effective-state overrides.
    pub response_policy: PhysicalBodyResponsePolicy,
    /// Entity-specific peer-target, scheduling, and reporting facts.
    pub entity_collision: DynamicBodyCollisionDefinition,
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::{CollisionBall, CollisionShape};

    fn ball_shape() -> Arc<CollisionShape> {
        Arc::new(CollisionShape::Ball(CollisionBall {
            center: Vector3::zero(),
            radius: 0.5,
        }))
    }

    #[test]
    fn prepared_geometry_equality_uses_immutable_content_identity_not_arc_identity() {
        let left = PreparedEntityTargetGeometry {
            physics_bsp_parts: vec![PreparedEntityBspPart {
                part_index: 0,
                gfx_obj_did: 0x0100_0001,
                local_origin: Vector3::zero(),
                local_orientation: Quaternion::identity(),
                scale: ColliderScale::uniform(1.0).unwrap(),
                shape: ball_shape(),
            }],
            fallback_setup_did: 0x0200_0001,
            fallback_shapes: vec![ball_shape()],
            fallback_scale: ColliderScale::uniform(1.0).unwrap(),
        };
        let right = PreparedEntityTargetGeometry {
            physics_bsp_parts: vec![PreparedEntityBspPart {
                shape: ball_shape(),
                ..left.physics_bsp_parts[0].clone()
            }],
            fallback_shapes: vec![ball_shape()],
            ..left.clone()
        };

        assert!(!Arc::ptr_eq(
            &left.physics_bsp_parts[0].shape,
            &right.physics_bsp_parts[0].shape
        ));
        assert!(!Arc::ptr_eq(
            &left.fallback_shapes[0],
            &right.fallback_shapes[0]
        ));
        assert_eq!(left, right);
    }
}
