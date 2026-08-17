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
    pub part_index: usize,
    pub gfx_obj_did: u32,
    pub local_origin: Vector3,
    pub local_orientation: Quaternion,
    pub scale: ColliderScale,
    pub shape: Arc<CollisionShape>,
}

impl PartialEq for PreparedEntityBspPart {
    fn eq(&self, other: &Self) -> bool {
        self.part_index == other.part_index
            && self.gfx_obj_did == other.gfx_obj_did
            && self.local_origin == other.local_origin
            && self.local_orientation == other.local_orientation
            && self.scale == other.scale
            && Arc::ptr_eq(&self.shape, &other.shape)
    }
}

/// Both retail target branches retained so a complete live state replacement is reversible.
#[derive(Debug, Clone)]
pub struct PreparedEntityTargetGeometry {
    /// Actual appearance-substituted BSP parts used when `HasPhysicsBSP` is set.
    pub physics_bsp_parts: Vec<PreparedEntityBspPart>,
    /// Setup cylspheres, otherwise setup spheres, used when `HasPhysicsBSP` is clear.
    pub fallback_shapes: Vec<Arc<CollisionShape>>,
    /// Uniform root scale used by every fallback shape.
    pub fallback_scale: ColliderScale,
}

impl PartialEq for PreparedEntityTargetGeometry {
    fn eq(&self, other: &Self) -> bool {
        self.physics_bsp_parts == other.physics_bsp_parts
            && self.fallback_scale == other.fallback_scale
            && self.fallback_shapes.len() == other.fallback_shapes.len()
            && self
                .fallback_shapes
                .iter()
                .zip(&other.fallback_shapes)
                .all(|(left, right)| Arc::ptr_eq(left, right))
    }
}

/// Entity-specific collision and scheduling facts retained beside generic response memory.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicBodyCollisionDefinition {
    pub target_geometry: PreparedEntityTargetGeometry,
    pub scheduling: EntityPhysicsScheduling,
    pub dynamic_collision: EntityDynamicCollisionPolicy,
    pub reporting: EntityCollisionReportPolicy,
    pub uses_physics_bsp: bool,
    pub weenie_type: WeenieType,
    /// Authored bounded elasticity retained across reversible `Inelastic` state changes.
    pub elasticity: PhysicalElasticity,
    pub default_animation_available: bool,
    pub default_script_available: bool,
}

/// Complete immutable physical definition prepared before a dynamic entity body is installed.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicPhysicalBodyDefinition {
    pub movement: PhysicalBodyDefinition,
    pub response_policy: PhysicalBodyResponsePolicy,
    pub entity_collision: DynamicBodyCollisionDefinition,
}
