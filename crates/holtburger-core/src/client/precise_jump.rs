//! Selected-power launch conversion for precise jump prediction.

use holtburger_common::Vector3;
use holtburger_world::PhysicalBodyDefinition;
use holtburger_world::state::SelfJumpCapabilities;
use std::time::Duration;
use thiserror::Error;

use super::character_jump::{character_jump_vertical_velocity, local_planar_vector};
use super::character_kinematics::jump_kinematics_from_movement_capabilities;
use super::character_motion::JumpExtent;

/// Finite world-axis displacement between launch and desired landing body-reference positions.
///
/// The collision-backed predictor owns conversion from a selected surface point and normal into
/// this body-aware position; inverse launch math never treats a surface point as the body's origin.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpWorldDisplacement(Vector3);

impl PreciseJumpWorldDisplacement {
    pub fn new(value: Vector3) -> Result<Self, PreciseJumpWorldDisplacementError> {
        if !value.x.is_finite() || !value.y.is_finite() || !value.z.is_finite() {
            return Err(PreciseJumpWorldDisplacementError::NonFinite);
        }
        Ok(Self(value))
    }

    pub const fn get(self) -> Vector3 {
        self.0
    }
}

/// Invalid target displacement rejected before inverse launch math.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PreciseJumpWorldDisplacementError {
    #[error("precise-jump target displacement must be finite")]
    NonFinite,
}

/// One resolved launch at the explicitly selected power.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpLaunchCandidate {
    extent: JumpExtent,
    local_velocity: Vector3,
    world_velocity: Vector3,
    flight_duration_seconds: f32,
}

impl PreciseJumpLaunchCandidate {
    pub const fn extent(self) -> JumpExtent {
        self.extent
    }

    pub const fn local_velocity(self) -> Vector3 {
        self.local_velocity
    }

    pub const fn world_velocity(self) -> Vector3 {
        self.world_velocity
    }

    /// Open-air descending arrival time used only to seed collision-backed prediction.
    pub const fn flight_duration_seconds(self) -> f32 {
        self.flight_duration_seconds
    }
}

/// One user-selected power resolved into a speed-capped launch and optional ideal intent.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SelectedPreciseJumpLaunch {
    /// Actual launch used by prediction and release; never exceeds current planar capability.
    candidate: PreciseJumpLaunchCandidate,
    /// Ideal connecting velocity, absent when the chosen power cannot reach target height.
    desired_velocity: Option<Vector3>,
}

impl SelectedPreciseJumpLaunch {
    pub const fn candidate(self) -> PreciseJumpLaunchCandidate {
        self.candidate
    }
    pub const fn desired_velocity(self) -> Option<Vector3> {
        self.desired_velocity
    }
}

/// Resolves exactly the supplied power, independently of current support or landing success.
/// A below-height target uses capped movement toward it and a same-height flight horizon.
pub fn resolve_selected_precise_jump(
    integration_step: Duration,
    capabilities: &SelfJumpCapabilities,
    definition: PhysicalBodyDefinition,
    heading: f32,
    displacement: PreciseJumpWorldDisplacement,
    extent: JumpExtent,
) -> Result<SelectedPreciseJumpLaunch, PreciseJumpCandidateRejection> {
    if integration_step.is_zero()
        || integration_step.as_secs_f32() > holtburger_world::MOBILE_CONTACT_TICK_SECONDS
    {
        return Err(PreciseJumpCandidateRejection::InvalidIntegrationStep);
    }
    if !heading.is_finite() {
        return Err(PreciseJumpCandidateRejection::InvalidHeading);
    }
    let PhysicalBodyDefinition::Grounded { config, .. } = definition else {
        return Err(PreciseJumpCandidateRejection::NonGroundedBody);
    };
    let gravity = -config.gravity;
    if !gravity.is_finite() || gravity <= 0.0 {
        return Err(PreciseJumpCandidateRejection::InvalidCapabilities);
    }
    let kinematics = jump_kinematics_from_movement_capabilities(
        &capabilities.movement,
        capabilities.full_extent_jump_height,
    )
    .map_err(|_| PreciseJumpCandidateRejection::InvalidCapabilities)?;
    let maximum_speed =
        kinematics.movement().base_run_forward_speed() * kinematics.movement().run_rate_scalar();
    if !maximum_speed.is_finite() {
        return Err(PreciseJumpCandidateRejection::InvalidCapabilities);
    }
    let vertical = character_jump_vertical_velocity(kinematics, extent);
    let curve_vertical = vertical - 0.5 * gravity * integration_step.as_secs_f32();
    let delta = displacement.get();
    let discriminant = curve_vertical * curve_vertical - 2.0 * gravity * delta.z;
    // Permit only f32 height-rounding error at an exact apex.
    let apex_roundoff =
        f32::EPSILON * (curve_vertical * curve_vertical + (2.0 * gravity * delta.z).abs()) * 2.0;
    let desired_time = (discriminant >= -apex_roundoff)
        .then(|| (curve_vertical + discriminant.max(0.0).sqrt()) / gravity);
    let desired_velocity =
        desired_time.map(|seconds| Vector3::new(delta.x / seconds, delta.y / seconds, vertical));
    let flight_duration_seconds = desired_time.unwrap_or(2.0 * curve_vertical / gravity);
    let planar = match desired_velocity {
        Some(velocity) => {
            let planar = Vector3::new(velocity.x, velocity.y, 0.0);
            let speed = planar.length();
            if speed > maximum_speed {
                planar * (maximum_speed / speed)
            } else {
                planar
            }
        }
        None => {
            let planar = Vector3::new(delta.x, delta.y, 0.0);
            let distance = planar.length();
            if distance > 0.0 {
                planar * (maximum_speed / distance)
            } else {
                Vector3::zero()
            }
        }
    };
    if !flight_duration_seconds.is_finite()
        || flight_duration_seconds <= 0.0
        || !planar.x.is_finite()
        || !planar.y.is_finite()
        || !vertical.is_finite()
        || desired_velocity
            .is_some_and(|velocity| !velocity.x.is_finite() || !velocity.y.is_finite())
    {
        return Err(PreciseJumpCandidateRejection::InvalidCapabilities);
    }
    let local = local_planar_vector(planar, heading);
    Ok(SelectedPreciseJumpLaunch {
        candidate: PreciseJumpLaunchCandidate {
            extent,
            local_velocity: Vector3::new(local.x, local.y, vertical),
            world_velocity: Vector3::new(planar.x, planar.y, vertical),
            flight_duration_seconds,
        },
        desired_velocity,
    })
}

/// Invalid numeric or body-geometry inputs for selected launch conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PreciseJumpCandidateRejection {
    #[error("jump integration quantum is invalid")]
    InvalidIntegrationStep,
    #[error("character heading must be finite")]
    InvalidHeading,
    #[error("jump capabilities must contain usable finite kinematics")]
    InvalidCapabilities,
    #[error("jump prediction requires grounded body geometry")]
    NonGroundedBody,
}
#[cfg(test)]
mod tests {
    use holtburger_common::Sphere;
    use holtburger_protocol::messages::movement::MotionStance;
    use holtburger_world::state::{
        PlayerMotionTableSource, SelfMovementCapabilities, SelfMovementKinematics,
    };
    use holtburger_world::{
        EdgeProtection, GroundedConfig, PhysicalSphereSet, RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
        RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z,
    };

    use super::*;

    fn capabilities(
        run_rate: f32,
        full_extent_jump_height: f32,
        burden: f32,
    ) -> SelfJumpCapabilities {
        SelfJumpCapabilities {
            movement: SelfMovementCapabilities {
                kinematics: SelfMovementKinematics {
                    source: PlayerMotionTableSource::DirectProperty {
                        motion_table_id: 0x0900_0020,
                    },
                    motion_table_id: 0x0900_0020,
                    stance: MotionStance::NonCombat as u32,
                    base_walk_forward_velocity: Vector3::new(3.12, 0.0, 0.0),
                    base_run_forward_velocity: Vector3::new(4.0, 0.0, 0.0),
                    base_turn_left_omega: Vector3::new(0.0, 0.0, -1.0),
                    base_turn_right_omega: Vector3::new(0.0, 0.0, 1.0),
                },
                run_rate_scalar: run_rate,
            },
            full_extent_jump_height,
            burden,
        }
    }
    fn body() -> PhysicalBodyDefinition {
        PhysicalBodyDefinition::grounded(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.475),
                    radius: 0.48,
                },
                Some(Sphere {
                    center: Vector3::new(0.0, 0.0, 1.275),
                    radius: 0.48,
                }),
            )
            .unwrap(),
            GroundedConfig {
                gravity: -9.8,
                walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
                landing_normal_z: RETAIL_LANDING_NORMAL_Z,
                airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
                step_up_height: 0.9,
                step_down_height: 0.9,
                edge_protection: EdgeProtection::Creature,
                maximum_substep_distance: 0.2,
                maximum_substeps: 64,
                maximum_contact_passes: 8,
                separation_epsilon: 0.000_1,
            },
        )
        .unwrap()
    }
    #[test]
    fn selected_power_derives_ideal_velocity_and_caps_actual_shortfall() {
        let tick = Duration::from_secs_f32(holtburger_world::MOBILE_CONTACT_TICK_SECONDS);
        let actor = capabilities(1.0, 4.2125, 0.0);
        let power = JumpExtent::new(0.4).unwrap();
        for distance in [1.0, 20.0] {
            let delta = Vector3::new(distance, 0.0, 0.0);
            let selected = resolve_selected_precise_jump(
                tick,
                &actor,
                body(),
                0.0,
                PreciseJumpWorldDisplacement::new(delta).unwrap(),
                power,
            )
            .unwrap();
            let candidate = selected.candidate();
            assert_eq!(candidate.extent(), power);
            let time = candidate.flight_duration_seconds();
            let desired = selected.desired_velocity().unwrap();
            assert!((desired.x * time - distance).abs() < 0.00001);
            assert!(candidate.world_velocity().x <= 4.0);
            if distance == 1.0 {
                assert_eq!(candidate.world_velocity(), desired);
            } else {
                assert!(candidate.world_velocity().x * time < distance);
            }
            let curve_vertical = desired.z - 0.5 * 9.8 * tick.as_secs_f32();
            assert!((curve_vertical * time - 0.5 * 9.8 * time * time).abs() < 0.00001);
        }
    }
    #[test]
    fn below_height_power_keeps_a_valid_capped_launch_without_an_ideal_connection() {
        let tick = Duration::from_secs_f32(holtburger_world::MOBILE_CONTACT_TICK_SECONDS);
        let actor = capabilities(1.0, 4.2125, 2.5);
        for distance in [0.0, 1.0] {
            let selected = resolve_selected_precise_jump(
                tick,
                &actor,
                body(),
                std::f32::consts::PI,
                PreciseJumpWorldDisplacement::new(Vector3::new(distance, 0.0, 10.0)).unwrap(),
                JumpExtent::MINIMUM,
            )
            .unwrap();
            assert!(selected.desired_velocity().is_none());
            assert_eq!(selected.candidate().extent(), JumpExtent::MINIMUM);
            assert_eq!(
                selected.candidate().world_velocity().x,
                if distance == 0.0 { 0.0 } else { 4.0 }
            );
            assert!(selected.candidate().flight_duration_seconds() > 0.0);
        }
    }
    #[test]
    fn exact_apex_is_connectable_but_a_higher_target_is_not() {
        let tick = Duration::from_secs_f32(holtburger_world::MOBILE_CONTACT_TICK_SECONDS);
        let actor = capabilities(1.0, 4.2125, 0.0);
        let resolve = |height| {
            resolve_selected_precise_jump(
                tick,
                &actor,
                body(),
                0.0,
                PreciseJumpWorldDisplacement::new(Vector3::new(0.0, 0.0, height)).unwrap(),
                JumpExtent::MAXIMUM,
            )
            .unwrap()
        };
        let vertical = resolve(0.0).candidate().world_velocity().z;
        let gravity = 9.8;
        let curve_vertical = vertical - 0.5 * gravity * tick.as_secs_f32();
        let apex = curve_vertical * curve_vertical / (2.0 * gravity);
        let at_apex = resolve(apex);
        assert!(at_apex.desired_velocity().is_some());
        assert!(
            (at_apex.candidate().flight_duration_seconds() - curve_vertical / gravity).abs()
                < 0.001
        );
        assert!(resolve(apex + 0.01).desired_velocity().is_none());
    }

    #[test]
    fn nonfinite_displacement_and_heading_are_rejected_before_launch() {
        for invalid in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            for delta in [
                Vector3::new(invalid, 0.0, 0.0),
                Vector3::new(0.0, invalid, 0.0),
                Vector3::new(0.0, 0.0, invalid),
            ] {
                assert_eq!(
                    PreciseJumpWorldDisplacement::new(delta),
                    Err(PreciseJumpWorldDisplacementError::NonFinite)
                );
            }
            assert_eq!(
                resolve_selected_precise_jump(
                    Duration::from_secs_f32(holtburger_world::MOBILE_CONTACT_TICK_SECONDS),
                    &capabilities(1.0, 4.2125, 0.0),
                    body(),
                    invalid,
                    PreciseJumpWorldDisplacement::new(Vector3::zero()).unwrap(),
                    JumpExtent::MINIMUM,
                ),
                Err(PreciseJumpCandidateRejection::InvalidHeading)
            );
        }
    }
}
