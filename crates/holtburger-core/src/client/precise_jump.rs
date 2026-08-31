//! Capability-bounded inverse launch candidates for precise jump prediction.

use holtburger_common::Vector3;
use holtburger_world::PhysicalBodyDefinition;
use holtburger_world::state::SelfJumpCapabilities;
use thiserror::Error;

use super::character_jump::{CharacterJumpReadiness, character_jump_vertical_velocity};
use super::character_kinematics::{
    CharacterJumpKinematics, jump_kinematics_from_movement_capabilities,
};
use super::character_motion::{JumpExtent, JumpExtentError};

const RETAIL_DOUBLE_GRAVITY: f32 = 19.6;
const ENVELOPE_TOLERANCE: f32 = 0.000_1;

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

/// Explicit upper bound on analytic arcs emitted for one target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreciseJumpCandidateBudget(usize);

impl PreciseJumpCandidateBudget {
    pub fn new(maximum_candidates: usize) -> Result<Self, PreciseJumpCandidateBudgetError> {
        if maximum_candidates == 0 {
            return Err(PreciseJumpCandidateBudgetError::ZeroCandidates);
        }
        Ok(Self(maximum_candidates))
    }

    pub const fn maximum_candidates(self) -> usize {
        self.0
    }
}

/// Invalid analytic candidate budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PreciseJumpCandidateBudgetError {
    #[error("precise-jump candidate budget must permit at least one candidate")]
    ZeroCandidates,
}

/// Body-derived landing acceptance scale used by the later collision-backed predictor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpLandingTolerance {
    support_sphere_radius: f32,
}

impl PreciseJumpLandingTolerance {
    /// Planar distance over which the support sphere can contact the selected surface neighborhood.
    pub const fn support_sphere_radius(self) -> f32 {
        self.support_sphere_radius
    }
}

/// Heading-independent planar capability plus body-derived landing acceptance.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpCapabilityEnvelope {
    maximum_planar_speed: f32,
    landing_tolerance: PreciseJumpLandingTolerance,
}

impl PreciseJumpCapabilityEnvelope {
    pub const fn maximum_planar_speed(self) -> f32 {
        self.maximum_planar_speed
    }

    pub const fn landing_tolerance(self) -> PreciseJumpLandingTolerance {
        self.landing_tolerance
    }

    fn contains_planar_velocity(self, planar_velocity: Vector3) -> bool {
        Vector3::new(planar_velocity.x, planar_velocity.y, 0.0).length()
            <= self.maximum_planar_speed + ENVELOPE_TOLERANCE
    }
}

/// One analytically valid arc in deterministic adaptive-search order.
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

/// One capability envelope paired with its deterministic analytic arc sequence.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpCandidateSet {
    envelope: PreciseJumpCapabilityEnvelope,
    candidates: Vec<PreciseJumpLaunchCandidate>,
}

impl PreciseJumpCandidateSet {
    pub const fn envelope(&self) -> PreciseJumpCapabilityEnvelope {
        self.envelope
    }

    pub fn candidates(&self) -> &[PreciseJumpLaunchCandidate] {
        &self.candidates
    }
}

/// Why no legal analytic launch set could be generated from current authority facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PreciseJumpCandidateRejection {
    #[error("an airborne body cannot begin a precise jump")]
    Airborne,
    #[error("precise jump requires current walkable support")]
    Unsupported,
    #[error("an overburdened character cannot jump")]
    Overburdened,
    #[error("precise jump requires a grounded physical body")]
    NonGroundedBody,
    #[error("precise-jump capability facts are invalid")]
    InvalidCapabilities,
    #[error("precise-jump heading must be finite")]
    InvalidHeading,
    #[error("the target lies outside the character's jump envelope")]
    TargetOutsideEnvelope,
}

/// Generates a minimum-first, fixed-budget dyadic arc search for collision-backed prediction.
pub fn generate_precise_jump_candidates(
    capabilities: &SelfJumpCapabilities,
    definition: PhysicalBodyDefinition,
    heading: f32,
    readiness: CharacterJumpReadiness,
    displacement: PreciseJumpWorldDisplacement,
    budget: PreciseJumpCandidateBudget,
) -> Result<PreciseJumpCandidateSet, PreciseJumpCandidateRejection> {
    require_supported(readiness)?;
    if capabilities.is_overburdened() {
        return Err(PreciseJumpCandidateRejection::Overburdened);
    }
    if !heading.is_finite() {
        return Err(PreciseJumpCandidateRejection::InvalidHeading);
    }
    let kinematics = jump_kinematics_from_movement_capabilities(
        &capabilities.movement,
        capabilities.full_extent_jump_height,
    )
    .map_err(|_| PreciseJumpCandidateRejection::InvalidCapabilities)?;
    let PhysicalBodyDefinition::Grounded { spheres, config } = definition else {
        return Err(PreciseJumpCandidateRejection::NonGroundedBody);
    };
    let gravity = -config.gravity;
    if !gravity.is_finite() || gravity <= 0.0 {
        return Err(PreciseJumpCandidateRejection::InvalidCapabilities);
    }
    let envelope = capability_envelope(kinematics, spheres.support.radius);
    let world_displacement = displacement.get();
    let minimum_planar_time = minimum_planar_time(world_displacement, envelope);
    let minimum_extent = minimum_extent(
        kinematics,
        gravity,
        world_displacement.z,
        minimum_planar_time,
    )?;
    let extents = adaptive_extents(minimum_extent, budget)?;
    let mut candidates = Vec::with_capacity(extents.len());
    for extent in extents {
        let vertical_velocity = character_jump_vertical_velocity(kinematics, extent);
        let discriminant =
            vertical_velocity * vertical_velocity - 2.0 * gravity * world_displacement.z;
        if discriminant < 0.0 {
            continue;
        }
        let flight_duration_seconds = (vertical_velocity + discriminant.max(0.0).sqrt()) / gravity;
        let world_planar_velocity = Vector3::new(
            world_displacement.x / flight_duration_seconds,
            world_displacement.y / flight_duration_seconds,
            0.0,
        );
        if !envelope.contains_planar_velocity(world_planar_velocity) {
            continue;
        }
        let local_planar_velocity = local_planar_vector(world_planar_velocity, heading);
        candidates.push(PreciseJumpLaunchCandidate {
            extent,
            local_velocity: Vector3::new(
                local_planar_velocity.x,
                local_planar_velocity.y,
                vertical_velocity,
            ),
            world_velocity: world_planar_velocity + Vector3::new(0.0, 0.0, vertical_velocity),
            flight_duration_seconds,
        });
    }
    if candidates.is_empty() {
        return Err(PreciseJumpCandidateRejection::TargetOutsideEnvelope);
    }
    Ok(PreciseJumpCandidateSet {
        envelope,
        candidates,
    })
}

fn require_supported(
    readiness: CharacterJumpReadiness,
) -> Result<(), PreciseJumpCandidateRejection> {
    match readiness {
        CharacterJumpReadiness::Supported => Ok(()),
        CharacterJumpReadiness::Airborne => Err(PreciseJumpCandidateRejection::Airborne),
        CharacterJumpReadiness::Unsupported => Err(PreciseJumpCandidateRejection::Unsupported),
    }
}

fn capability_envelope(
    kinematics: CharacterJumpKinematics,
    support_sphere_radius: f32,
) -> PreciseJumpCapabilityEnvelope {
    let movement = kinematics.movement();
    let run_rate = movement.run_rate_scalar();
    PreciseJumpCapabilityEnvelope {
        maximum_planar_speed: movement.base_run_forward_speed() * run_rate,
        landing_tolerance: PreciseJumpLandingTolerance {
            support_sphere_radius,
        },
    }
}

fn local_planar_vector(world: Vector3, heading: f32) -> Vector3 {
    let forward = Vector3::new(-heading.cos(), heading.sin(), 0.0);
    let right = Vector3::new(heading.sin(), heading.cos(), 0.0);
    Vector3::new(world.dot(&right), world.dot(&forward), 0.0)
}

fn minimum_planar_time(
    world_displacement: Vector3,
    envelope: PreciseJumpCapabilityEnvelope,
) -> f32 {
    Vector3::new(world_displacement.x, world_displacement.y, 0.0).length()
        / envelope.maximum_planar_speed
}

fn minimum_extent(
    kinematics: CharacterJumpKinematics,
    gravity: f32,
    vertical_displacement: f32,
    minimum_planar_time: f32,
) -> Result<JumpExtent, PreciseJumpCandidateRejection> {
    let vertical_reach_speed = (2.0 * gravity * vertical_displacement).max(0.0).sqrt();
    let planar_time_speed = if minimum_planar_time > f32::EPSILON {
        (vertical_displacement / minimum_planar_time + 0.5 * gravity * minimum_planar_time).max(0.0)
    } else {
        0.0
    };
    let floor_speed = character_jump_vertical_velocity(kinematics, JumpExtent::MINIMUM);
    let required_speed = floor_speed.max(vertical_reach_speed).max(planar_time_speed);
    let required_extent = if required_speed <= floor_speed + ENVELOPE_TOLERANCE {
        JumpExtent::MINIMUM.get()
    } else {
        (required_speed * required_speed
            / (RETAIL_DOUBLE_GRAVITY * kinematics.full_extent_jump_height()))
        .max(JumpExtent::MINIMUM.get())
    };
    if required_extent > JumpExtent::MAXIMUM.get() + ENVELOPE_TOLERANCE {
        return Err(PreciseJumpCandidateRejection::TargetOutsideEnvelope);
    }
    JumpExtent::new(required_extent.min(JumpExtent::MAXIMUM.get()))
        .map_err(|_| PreciseJumpCandidateRejection::TargetOutsideEnvelope)
}

fn adaptive_extents(
    minimum: JumpExtent,
    budget: PreciseJumpCandidateBudget,
) -> Result<Vec<JumpExtent>, PreciseJumpCandidateRejection> {
    let count = budget.maximum_candidates();
    if count == 1 || minimum == JumpExtent::MAXIMUM {
        return Ok(vec![minimum]);
    }
    let mut fractions = vec![0.0_f32, 1.0];
    let mut intervals = vec![(0.0_f32, 1.0_f32)];
    while fractions.len() < count && !intervals.is_empty() {
        let widest = (1..intervals.len()).fold(0, |selected, candidate| {
            let selected_interval = intervals[selected];
            let candidate_interval = intervals[candidate];
            let selected_width = selected_interval.1 - selected_interval.0;
            let candidate_width = candidate_interval.1 - candidate_interval.0;
            if candidate_width > selected_width
                || (candidate_width == selected_width && candidate_interval.0 < selected_interval.0)
            {
                candidate
            } else {
                selected
            }
        });
        let (lower, upper) = intervals.swap_remove(widest);
        let midpoint = lower + (upper - lower) * 0.5;
        if midpoint <= lower || midpoint >= upper {
            continue;
        }
        fractions.push(midpoint);
        intervals.push((lower, midpoint));
        intervals.push((midpoint, upper));
    }
    let span = JumpExtent::MAXIMUM.get() - minimum.get();
    fractions
        .into_iter()
        .map(|fraction| {
            let value = minimum.get() + span * fraction;
            JumpExtent::new(value).map_err(|error| match error {
                JumpExtentError::NonFinite | JumpExtentError::OutsideRetailRange => {
                    PreciseJumpCandidateRejection::InvalidCapabilities
                }
            })
        })
        .collect()
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

    fn candidates(
        displacement: Vector3,
        count: usize,
    ) -> Result<PreciseJumpCandidateSet, PreciseJumpCandidateRejection> {
        generate_precise_jump_candidates(
            &capabilities(1.0, 4.2125, 0.0),
            body(),
            0.0,
            CharacterJumpReadiness::Supported,
            PreciseJumpWorldDisplacement::new(displacement).unwrap(),
            PreciseJumpCandidateBudget::new(count).unwrap(),
        )
    }

    #[test]
    fn budget_and_displacement_reject_invalid_inputs_at_construction() {
        assert_eq!(
            PreciseJumpCandidateBudget::new(0),
            Err(PreciseJumpCandidateBudgetError::ZeroCandidates)
        );
        assert_eq!(
            PreciseJumpWorldDisplacement::new(Vector3::new(f32::NAN, 0.0, 0.0)),
            Err(PreciseJumpWorldDisplacementError::NonFinite)
        );
    }

    #[test]
    fn capability_envelope_uses_actor_run_speed_and_body_tolerance() {
        let set = candidates(Vector3::zero(), 1).unwrap();
        let envelope = set.envelope();
        assert_eq!(envelope.maximum_planar_speed(), 4.0);
        assert_eq!(envelope.landing_tolerance().support_sphere_radius(), 0.48);

        let fast = generate_precise_jump_candidates(
            &capabilities(3.0, 4.2125, 0.0),
            body(),
            0.0,
            CharacterJumpReadiness::Supported,
            PreciseJumpWorldDisplacement::new(Vector3::zero()).unwrap(),
            PreciseJumpCandidateBudget::new(1).unwrap(),
        )
        .unwrap();
        let fast_envelope = fast.envelope();
        assert_eq!(fast_envelope.maximum_planar_speed(), 12.0);
    }

    #[test]
    fn isotropic_planar_cap_admits_equal_distance_in_every_direction() {
        let diagonal = 6.0 / 2.0_f32.sqrt();
        let cases = [
            (0.0, Vector3::new(-6.0, 0.0, 0.0)),
            (0.0, Vector3::new(6.0, 0.0, 0.0)),
            (0.0, Vector3::new(0.0, 6.0, 0.0)),
            (0.0, Vector3::new(diagonal, diagonal, 0.0)),
            (std::f32::consts::FRAC_PI_2, Vector3::new(0.0, 6.0, 0.0)),
        ];
        let mut expected_extents: Option<Vec<f32>> = None;
        for (heading, displacement) in cases {
            let set = generate_precise_jump_candidates(
                &capabilities(1.0, 4.2125, 0.0),
                body(),
                heading,
                CharacterJumpReadiness::Supported,
                PreciseJumpWorldDisplacement::new(displacement).unwrap(),
                PreciseJumpCandidateBudget::new(5).unwrap(),
            )
            .unwrap();
            let envelope = set.envelope();
            let candidates = set.candidates();
            assert_eq!(candidates.len(), 5);
            assert!(
                candidates
                    .iter()
                    .all(|candidate| envelope.contains_planar_velocity(candidate.world_velocity()))
            );
            let extents = candidates
                .iter()
                .map(|candidate| candidate.extent().get())
                .collect::<Vec<_>>();
            if let Some(expected) = &expected_extents {
                assert!(
                    extents
                        .iter()
                        .zip(expected)
                        .all(|(actual, expected)| (actual - expected).abs() < ENVELOPE_TOLERANCE),
                    "{extents:?} != {expected:?}"
                );
            } else {
                expected_extents = Some(extents);
            }
            assert_eq!(candidates[1].extent(), JumpExtent::MAXIMUM);
            assert!(candidates.iter().enumerate().all(|(index, candidate)| {
                candidates[..index]
                    .iter()
                    .all(|earlier| earlier.extent() != candidate.extent())
            }));
        }
    }

    #[test]
    fn planar_magnitude_cap_rejects_only_distance_beyond_full_extent_reach() {
        assert!(candidates(Vector3::new(0.0, 6.0, 0.0), 6).is_ok());
        assert_eq!(
            candidates(Vector3::new(0.0, 8.0, 0.0), 6),
            Err(PreciseJumpCandidateRejection::TargetOutsideEnvelope)
        );
    }

    #[test]
    fn minimum_height_floor_emits_the_true_minimum_extent_first() {
        let set = candidates(Vector3::zero(), 4).unwrap();
        let candidates = set.candidates();
        assert_eq!(candidates[0].extent(), JumpExtent::MINIMUM);
        assert_eq!(candidates.len(), 4);
        assert_eq!(candidates[1].extent(), JumpExtent::MAXIMUM);
        assert!(
            (candidates[0].local_velocity().z - (0.35_f32 * RETAIL_DOUBLE_GRAVITY).sqrt()).abs()
                < 0.000_01
        );
    }

    #[test]
    fn higher_arcs_subdivide_the_widest_remaining_extent_interval() {
        let set = candidates(Vector3::zero(), 6).unwrap();
        let minimum = set.candidates()[0].extent().get();
        let span = JumpExtent::MAXIMUM.get() - minimum;
        let fractions = set
            .candidates()
            .iter()
            .map(|candidate| (candidate.extent().get() - minimum) / span)
            .collect::<Vec<_>>();

        for (actual, expected) in fractions.iter().zip([0.0, 1.0, 0.5, 0.25, 0.75, 0.125]) {
            assert!((actual - expected).abs() < 0.000_1, "{fractions:?}");
        }
    }

    #[test]
    fn elevated_and_lower_targets_use_descending_open_air_arrivals() {
        for displacement in [Vector3::new(-3.0, 0.0, 2.0), Vector3::new(-3.0, 0.0, -2.0)] {
            let set = candidates(displacement, 3).unwrap();
            for candidate in set.candidates() {
                let time = candidate.flight_duration_seconds();
                let z = candidate.world_velocity().z * time - 0.5 * 9.8 * time * time;
                assert!((z - displacement.z).abs() < 0.000_1, "{candidate:?}");
                assert!(candidate.world_velocity().z - 9.8 * time <= ENVELOPE_TOLERANCE);
            }
        }
    }

    #[test]
    fn impossible_height_overburden_and_readiness_fail_before_prediction() {
        assert_eq!(
            candidates(Vector3::new(0.0, 0.0, 4.3), 4),
            Err(PreciseJumpCandidateRejection::TargetOutsideEnvelope)
        );
        let solve = |capabilities: SelfJumpCapabilities, readiness| {
            generate_precise_jump_candidates(
                &capabilities,
                body(),
                0.0,
                readiness,
                PreciseJumpWorldDisplacement::new(Vector3::zero()).unwrap(),
                PreciseJumpCandidateBudget::new(1).unwrap(),
            )
        };
        assert_eq!(
            solve(
                capabilities(1.0, 4.2125, 2.0),
                CharacterJumpReadiness::Supported
            ),
            Err(PreciseJumpCandidateRejection::Overburdened)
        );
        assert_eq!(
            solve(
                capabilities(1.0, 4.2125, 0.0),
                CharacterJumpReadiness::Airborne
            ),
            Err(PreciseJumpCandidateRejection::Airborne)
        );
        assert_eq!(
            solve(
                capabilities(1.0, 4.2125, 0.0),
                CharacterJumpReadiness::Unsupported
            ),
            Err(PreciseJumpCandidateRejection::Unsupported)
        );
        assert_eq!(
            solve(
                capabilities(1.0, 0.35, 0.0),
                CharacterJumpReadiness::Supported
            )
            .unwrap()
            .candidates()[0]
                .extent(),
            JumpExtent::MINIMUM,
            "zero-effective-skill capability still obeys retail's minimum jump floor"
        );
        let mut invalid_planar_capability = capabilities(1.0, 4.2125, 0.0);
        invalid_planar_capability
            .movement
            .kinematics
            .base_run_forward_velocity = Vector3::zero();
        assert_eq!(
            solve(invalid_planar_capability, CharacterJumpReadiness::Supported),
            Err(PreciseJumpCandidateRejection::InvalidCapabilities)
        );
    }

    #[test]
    fn heading_only_converts_world_trajectory_to_body_local_wire_velocity() {
        let heading = std::f32::consts::FRAC_PI_4;
        let set = generate_precise_jump_candidates(
            &capabilities(1.0, 4.2125, 0.0),
            body(),
            heading,
            CharacterJumpReadiness::Supported,
            PreciseJumpWorldDisplacement::new(Vector3::new(0.0, 4.0, 0.0)).unwrap(),
            PreciseJumpCandidateBudget::new(1).unwrap(),
        )
        .unwrap();
        let candidate = set.candidates()[0];
        let local = candidate.local_velocity();
        let forward = Vector3::new(-heading.cos(), heading.sin(), 0.0);
        let right = Vector3::new(heading.sin(), heading.cos(), 0.0);
        let reconstructed_world = right * local.x + forward * local.y;
        let world = candidate.world_velocity();
        assert!((reconstructed_world.x - world.x).abs() < ENVELOPE_TOLERANCE);
        assert!((reconstructed_world.y - world.y).abs() < ENVELOPE_TOLERANCE);
        assert!((local.x.hypot(local.y) - world.x.hypot(world.y)).abs() < ENVELOPE_TOLERANCE);
    }

    #[test]
    fn ordinary_jump_vertical_output_remains_the_shared_extent_rule() {
        let kinematics = jump_kinematics_from_movement_capabilities(
            &capabilities(1.0, 4.2125, 0.0).movement,
            4.2125,
        )
        .unwrap();
        for extent in [
            JumpExtent::MINIMUM,
            JumpExtent::new(0.5).unwrap(),
            JumpExtent::MAXIMUM,
        ] {
            let precise = character_jump_vertical_velocity(kinematics, extent);
            let expected_height = (4.2125 * extent.get()).max(0.35);
            assert!((precise - (expected_height * RETAIL_DOUBLE_GRAVITY).sqrt()).abs() < 0.000_01);
        }
    }
}
