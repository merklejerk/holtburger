//! Validated entity-specific physical facts retained by the canonical spatial scene.

use std::sync::Arc;

use holtburger_common::{Quaternion, Vector3};
use holtburger_content::{ColliderScale, CollisionShape};

use crate::{EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, LocalPhysicalDemand};

use super::{PhysicalBodyDefinition, PhysicalBodyResponsePolicy, PhysicalElasticity};

/// One immutable BSP part prepared in root-local coordinates.
#[derive(Debug, Clone)]
pub struct PreparedEntityBspPart {
    /// Zero-based setup part whose authored transform places this shape.
    pub part_index: usize,
    /// Immutable GfxObj content identity that owns the physics BSP.
    pub gfx_obj_did: u32,
    /// Initial part origin relative to the entity root, before instance scaling.
    pub local_origin: Vector3,
    /// Initial part orientation relative to the entity root.
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

/// Validated instance poses in the definition's BSP-part order, plus the last applied sample.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CollisionPartPoses {
    pub(crate) poses: Arc<[holtburger_common::RigidTransform]>,
    pub(crate) sample: Option<crate::motion::AuthoredCollisionPose>,
}

impl CollisionPartPoses {
    fn new(geometry: &PreparedEntityTargetGeometry) -> Self {
        Self {
            poses: geometry
                .physics_bsp_parts
                .iter()
                .map(|part| holtburger_common::RigidTransform {
                    translation: part.local_origin,
                    rotation: part.local_orientation,
                })
                .collect(),
            sample: None,
        }
    }

    pub(crate) fn apply(
        &mut self,
        geometry: &PreparedEntityTargetGeometry,
        sample: crate::motion::AuthoredCollisionPose,
    ) -> anyhow::Result<bool> {
        if self.sample == Some(sample) || geometry.physics_bsp_parts.is_empty() {
            return Ok(false);
        }
        let mut poses = self.poses.to_vec();
        match sample {
            crate::motion::AuthoredCollisionPose::Placement => {
                poses = Self::new(geometry).poses.to_vec();
            }
            crate::motion::AuthoredCollisionPose::Animation {
                animation_id,
                frame,
            } => {
                for (part_index, pose) in geometry
                    .collision_animations
                    .animation(animation_id)?
                    .sample(frame)?
                {
                    let slot = geometry
                        .physics_bsp_parts
                        .iter()
                        .position(|part| part.part_index == part_index)
                        .ok_or_else(|| {
                            anyhow::anyhow!(
                                "prepared collision track has no matching BSP part {part_index}"
                            )
                        })?;
                    poses[slot] = pose;
                }
            }
        }
        let changed = poses.as_slice() != &*self.poses;
        if changed {
            self.poses = poses.into();
        }
        self.sample = Some(sample);
        Ok(changed)
    }
}

/// Both retail target branches retained so a complete live state replacement is reversible.
#[derive(Debug, Clone)]
pub struct PreparedEntityTargetGeometry {
    /// Authored setup radius at scale one, used for target-directed melee clearance.
    pub setup_radius: f32,
    /// Shared collision-part tracks prepared for the entity's effective motion sources.
    pub collision_animations: holtburger_content::collision_pose::CollisionPoseLibrary,
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
        self.collision_animations == other.collision_animations
            && self.setup_radius == other.setup_radius
            && self.physics_bsp_parts == other.physics_bsp_parts
            && self.fallback_scale == other.fallback_scale
            && self.fallback_setup_did == other.fallback_setup_did
            && self.fallback_shapes.len() == other.fallback_shapes.len()
        // The setup identity and ordered shape count are the compatibility key. The decoded shape
        // Arcs are payload, not identity, and may come from independent preparations.
    }
}

/// Gameplay identity joined to its current physical movement permission, independently of sleep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityContactResponse {
    /// Doors, scenery, and items retain authored hard target geometry even while animated.
    Obstacle,
    /// Character identity survives freezing so a later state replacement can restore yielding.
    Character(crate::EntityIntegrationEligibility),
}

impl EntityContactResponse {
    /// Replaces physical restrictions without losing the body's gameplay identity.
    pub fn with_physics(self, state: crate::EffectiveEntityPhysicsState) -> Self {
        match self {
            Self::Obstacle => Self::Obstacle,
            Self::Character(_) => Self::Character(state.integration_eligibility),
        }
    }

    /// Scheduling and current velocity do not grant or revoke character yielding.
    pub fn yields(self) -> bool {
        matches!(
            self,
            Self::Character(crate::EntityIntegrationEligibility::Eligible)
        )
    }
}

/// Entity-specific prepared collision facts retained beside generic response memory.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicBodyCollisionDefinition {
    /// Public player-pair status; absent for non-player and Explorer-authored bodies.
    /// Content preparation leaves identity unbound; client installation joins current world status,
    /// and subsequent physics-state reconfiguration preserves it.
    pub player_collision: Option<crate::PlayerCollisionStatus>,
    /// Type/state-owned contact response, independent from ordinary integration demand.
    pub contact_response: EntityContactResponse,
    /// Shared stable target branches prepared once from immutable content.
    pub target_geometry: Arc<PreparedEntityTargetGeometry>,
    /// State-derived directional peer collision policy.
    pub dynamic_collision: EntityDynamicCollisionPolicy,
    /// State-derived directional contact reporting policy.
    pub reporting: EntityCollisionReportPolicy,
    /// Currently selected target branch within `target_geometry`.
    pub uses_physics_bsp: bool,
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
    /// Entity-specific peer-target, response, and reporting facts.
    pub entity_collision: DynamicBodyCollisionDefinition,
}

/// A prepared physical definition joined to the producer demand that gives it a local role.
///
/// Construction rejects a body with neither target nor integration demand so physical allocation
/// cannot become a third, contradictory source of admission policy.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicPhysicalBodyConfiguration {
    definition: DynamicPhysicalBodyDefinition,
    demand: LocalPhysicalDemand,
    /// Current absolute whole-object scale applied when the runtime body is installed.
    object_scale: f32,
    /// Initial instance poses validated before this configuration becomes queryable.
    collision_poses: CollisionPartPoses,
}

/// Failure to join prepared body facts to producer-owned local demand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DynamicPhysicalBodyConfigurationError {
    /// A pose-only entity must not retain an otherwise unused physical allocation.
    #[error("dynamic physical body configuration requires target or integration demand")]
    NoLocalPhysicalDemand,
    #[error("dynamic physical body object scale must be finite and positive")]
    InvalidObjectScale,
}

impl DynamicPhysicalBodyConfiguration {
    /// Joins prepared facts to a non-empty local demand.
    pub fn new(
        definition: DynamicPhysicalBodyDefinition,
        demand: LocalPhysicalDemand,
    ) -> Result<Self, DynamicPhysicalBodyConfigurationError> {
        if !demand.requires_physical_body() {
            return Err(DynamicPhysicalBodyConfigurationError::NoLocalPhysicalDemand);
        }
        Ok(Self {
            collision_poses: CollisionPartPoses::new(&definition.entity_collision.target_geometry),
            definition,
            demand,
            object_scale: 1.0,
        })
    }

    /// Joins unit geometry to its current absolute whole-object scale.
    pub fn with_object_scale(
        definition: DynamicPhysicalBodyDefinition,
        demand: LocalPhysicalDemand,
        object_scale: f32,
    ) -> Result<Self, DynamicPhysicalBodyConfigurationError> {
        let mut configuration = Self::new(definition, demand)?;
        if !object_scale.is_finite() || object_scale <= 0.0 {
            return Err(DynamicPhysicalBodyConfigurationError::InvalidObjectScale);
        }
        configuration.object_scale = object_scale;
        Ok(configuration)
    }

    /// Initializes collision at the current authored pose before publishing the body.
    pub fn with_collision_pose(
        mut self,
        sample: crate::motion::AuthoredCollisionPose,
        previous_body: Option<&super::SpatialBody>,
    ) -> anyhow::Result<Self> {
        // A new table may omit trailing parts. Seed compatible part slots from the live body
        // before applying its selected clip, even when the prepared animation library changed.
        if let Some(previous) = previous_body
            .and_then(|body| body.physical.as_ref())
            .and_then(|physical| physical.dynamic.as_ref())
            .filter(|dynamic| {
                dynamic.collision.target_geometry.physics_bsp_parts
                    == self
                        .definition
                        .entity_collision
                        .target_geometry
                        .physics_bsp_parts
            })
        {
            self.collision_poses.poses = previous.collision_poses.poses.clone();
            self.collision_poses.sample = None;
        }
        self.collision_poses
            .apply(&self.definition.entity_collision.target_geometry, sample)?;
        Ok(self)
    }

    /// Prepared geometry and response facts, independent from producer policy.
    pub const fn definition(&self) -> &DynamicPhysicalBodyDefinition {
        &self.definition
    }

    /// Final producer-owned target and integration demand.
    pub const fn demand(&self) -> LocalPhysicalDemand {
        self.demand
    }

    /// Separates the joined configuration at the canonical scene ownership boundary.
    pub(crate) fn into_parts(
        self,
    ) -> (
        DynamicPhysicalBodyDefinition,
        LocalPhysicalDemand,
        f32,
        CollisionPartPoses,
    ) {
        (
            self.definition,
            self.demand,
            self.object_scale,
            self.collision_poses,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LocalIntegrationDemand, LocalTargetDemand};
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
            setup_radius: 0.5,
            collision_animations: Default::default(),
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
            setup_radius: 0.5,
            collision_animations: Default::default(),
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

    #[test]
    fn configuration_rejects_a_body_with_no_local_physical_role() {
        let definition = DynamicPhysicalBodyDefinition {
            movement: PhysicalBodyDefinition::free_sphere(
                super::super::PhysicalSphereSet::new(
                    holtburger_common::Sphere {
                        center: Vector3::zero(),
                        radius: 0.5,
                    },
                    None,
                )
                .unwrap(),
                super::super::FreeSphereConfig {
                    maximum_substep_distance: 0.25,
                    maximum_substeps: 8,
                    maximum_contact_passes: 4,
                    separation_epsilon: 0.001,
                },
            )
            .unwrap(),
            response_policy: PhysicalBodyResponsePolicy {
                restitution: super::super::PhysicalRestitution::Inelastic,
                friction: super::super::PhysicalFriction::DEFAULT,
                surface_motion: super::super::PhysicalSurfaceMotion::Stable,
                align_path: false,
            },
            entity_collision: DynamicBodyCollisionDefinition {
                player_collision: None,
                contact_response: crate::spatial::EntityContactResponse::Character(
                    crate::EntityIntegrationEligibility::Eligible,
                ),
                target_geometry: Arc::new(PreparedEntityTargetGeometry {
                    setup_radius: 0.5,
                    collision_animations: Default::default(),
                    physics_bsp_parts: Vec::new(),
                    fallback_setup_did: 0,
                    fallback_shapes: Vec::new(),
                    fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                }),
                dynamic_collision: crate::EntityDynamicCollisionPolicy {
                    is_static: false,
                    target: crate::EntityCollisionParticipation::Suppressed,
                    mover_accepts_response: false,
                    accepts_peer_reports: false,
                    missile: false,
                    path_clipped: false,
                },
                reporting: crate::EntityCollisionReportPolicy {
                    enabled: false,
                    as_environment: false,
                },
                uses_physics_bsp: false,
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        };

        assert_eq!(
            DynamicPhysicalBodyConfiguration::new(
                definition,
                LocalPhysicalDemand {
                    target: LocalTargetDemand::Absent,
                    integration: LocalIntegrationDemand::Excluded,
                },
            ),
            Err(DynamicPhysicalBodyConfigurationError::NoLocalPhysicalDemand)
        );
    }
}
