//! Bounded, symmetric contact response between prepared movement-sphere sets.
//!
//! Contact mobility is a gameplay correction weight, not physical mass. This primitive proposes
//! one correction per pair; its caller combines positional requests per body/pass, sweeps the
//! combined displacement against hard geometry, and enforces cumulative travel limits. It never advances time or publishes poses.

//! RETAIL DIVERGENCE: `CPhysicsObj::handle_all_collisions` changes the colliding object's own
//! velocity (`acclient.c:309962-310051`). This client deliberately uses weighted two-body
//! positional separation and tolerates residual overlap so mobile crowds can yield over successive steps.
//! Removing peer separation would remove that approved behavior. Scope: all admitted mobile
//! pairs; the retained synthetic census covers 45-body swarm/pinned/hard-corner workloads, not
//! the complete content population. Template/setup preparation was audited separately; crowded
//! live acceptance remains open.

mod step;
pub use step::{
    ContactBodyPath, ContactBodyUpdate, ContactCollectionUpdate, ContactImpactPoint,
    ContactMotionSegment, ContactStepActuation, FrozenContactTargets,
    MOBILE_CONTACT_ANGULAR_CHORDS, MOBILE_CONTACT_HARD_SLIDE_PASSES,
    advance_body_contact_collection, advance_body_contacts,
};
pub(crate) use step::{
    advance_body_contact_collection_without_reports, checked_recovery_destination,
    has_player_contact,
};

use anyhow::{Result, ensure};
use holtburger_common::{Guid, Sphere, Vector3};
use std::time::Duration;

use crate::{EntityDynamicCollisionPolicy, LocalIntegrationDemand, LocalTargetDemand};

use super::{
    DynamicBodyActivity, PhysicalBodyDefinition, PhysicalSphereSet, SpatialBody, SpatialBodyId,
    SpatialMembership,
};

/// Maximum duration of a compliant physical tick, in seconds.
pub const MOBILE_CONTACT_TICK_SECONDS: f32 = 1.0 / 30.0;
/// Admits one collection's physical time, discarding excess catch-up before input sampling.
/// Authored playback, forces, and movement must all consume this same duration.
pub fn admit_physical_duration(elapsed: Duration) -> Duration {
    elapsed.min(Duration::from_secs_f32(MOBILE_CONTACT_TICK_SECONDS))
}

/// Maximum extra inward walking travel per simulated second, shared across a body's contacts.
/// Separation mobility independently determines who recovers existing overlap.
pub const MOBILE_PUSH_THROUGH_SPEED: f32 = 0.06;

/// Fixed local contact passes per physical tick; residual overlap remains valid state.
pub const MOBILE_CONTACT_PASSES: usize = 4;
/// Fraction of excess penetration requested as positional correction in one pass.
pub const MOBILE_CONTACT_CORRECTION_FRACTION: f32 = 0.5;
/// Absolute upper bound on tolerated mobile overlap, in meters.
pub const MOBILE_CONTACT_TOLERANCE_METERS: f32 = 0.005;
/// Shape-relative overlap tolerance for bodies smaller than the absolute tolerance scale.
pub const MOBILE_CONTACT_TOLERANCE_RADIUS_RATIO: f32 = 0.01;
/// Cumulative separation travel allowance per tick, relative to minimum radius.
/// Ordinary mobile motion is hard-swept but has no collision-derived speed limit;
/// endpoint mobile contacts deliberately do not detect every crossing.
pub const MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO: f32 = 0.25;
/// Non-character and sledding motor acceleration, in meters per second².
pub const PASSIVE_MOTOR_ACCELERATION: f32 = 20.0;
/// Non-character and sledding motor deceleration; stable characters track commands directly.
pub const PASSIVE_MOTOR_BRAKING: f32 = 80.0;

/// Normalized gameplay weight controlling a body's share of positional separation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContactMobility(f32);

impl ContactMobility {
    /// No positional separation share; mobile contact still brakes inward velocity.
    pub const ZERO: Self = Self(0.0);
    /// Local-player response weight: peers take one hundred times its unconstrained separation share.
    pub const PLAYER: Self = Self(0.01);
    /// Initial ordinary mobile-body mobility.
    pub const MOBILE: Self = Self(1.0);

    /// Accepts a finite weight in [0, 1]; pair response depends only on the relative weights.
    pub fn new(weight: f32) -> Result<Self> {
        ensure!(
            weight.is_finite() && (0.0..=1.0).contains(&weight),
            "contact mobility must be finite and between zero and one"
        );
        Ok(Self(weight))
    }
}

/// One immutable participant, prepared in the same coordinate frame as its peer.
#[derive(Debug, Clone, Copy)]
pub struct MobileContactBody {
    /// Validated movement spheres with their centers already transformed into the query frame.
    spheres: PhysicalSphereSet,
    /// Actual integration velocity after motor/gravity, excluding positional correction.
    velocity: Vector3,
    /// Explicit mobile response permission with its independent separation weight.
    /// None receives no pair response; Some(ZERO) still participates in inward braking.
    response_mobility: Option<ContactMobility>,
}

impl MobileContactBody {
    /// Prepares contact geometry and velocity without consuming movement or applying an impulse.
    pub fn new(
        spheres: PhysicalSphereSet,
        velocity: Vector3,
        response_mobility: Option<ContactMobility>,
    ) -> Result<Self> {
        ensure!(
            velocity.x.is_finite() && velocity.y.is_finite() && velocity.z.is_finite(),
            "mobile contact velocity must be finite"
        );
        Ok(Self {
            spheres,
            velocity,
            response_mobility,
        })
    }
}

/// One participant's proposed response; geometry admission remains the caller's responsibility.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MobileContactChange {
    /// Positional separation to sweep against hard obstacles, never added to retained velocity.
    pub displacement: Vector3,
    /// Change to integration velocity, removing only this participant's inward normal motion.
    pub velocity_change: Vector3,
}

/// Deepest effective sphere contact and the two independent participant responses.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MobileContactResponse {
    /// Unit direction from the second participant toward the first.
    pub normal: Vector3,
    /// Penetration beyond the selected sphere pair's allowed overlap, in meters.
    pub excess_penetration: f32,
    /// Response for the first participant.
    pub first: MobileContactChange,
    /// Response for the second participant.
    pub second: MobileContactChange,
}

/// Resolves at most one contact for an unordered body pair in stable caller-owned identity order.
///
/// Sphere-order ties retain the first contact. Coincident centers use opposing relative velocity,
/// or +X when stationary, so no reciprocal query is needed to manufacture a normal. Other sphere
/// contacts can be selected on a later bounded pass; this does not require complete separation.
pub fn resolve_mobile_contact(
    first: &MobileContactBody,
    second: &MobileContactBody,
) -> Option<MobileContactResponse> {
    if first.response_mobility.is_none() && second.response_mobility.is_none() {
        return None;
    }
    let first_weight = first.response_mobility.map_or(0.0, |weight| weight.0);
    let second_weight = second.response_mobility.map_or(0.0, |weight| weight.0);
    let total_weight = first_weight + second_weight;
    let relative_velocity = first.velocity - second.velocity;
    let mut selected: Option<(Vector3, f32)> = None;
    for first_sphere in first.spheres.iter() {
        for second_sphere in second.spheres.iter() {
            let delta = first_sphere.center - second_sphere.center;
            let radius_sum = first_sphere.radius + second_sphere.radius;
            let tolerance = MOBILE_CONTACT_TOLERANCE_METERS
                .min(radius_sum * MOBILE_CONTACT_TOLERANCE_RADIUS_RATIO);
            let distance = delta.length();
            let excess = radius_sum - distance - tolerance;
            if excess <= 0.0 || selected.is_some_and(|(_, depth)| depth >= excess) {
                continue;
            }
            let normal = if distance > f32::EPSILON {
                delta / distance
            } else {
                let speed = relative_velocity.length();
                if speed > f32::EPSILON {
                    relative_velocity * (-1.0 / speed)
                } else {
                    Vector3::new(1.0, 0.0, 0.0)
                }
            };
            selected = Some((normal, excess));
        }
    }
    let (normal, excess_penetration) = selected?;
    let separation = normal * (MOBILE_CONTACT_CORRECTION_FRACTION * excess_penetration);
    let closing_speed = (-relative_velocity.dot(&normal)).max(0.0);
    // Two zero-weight bodies can brake each other while accepting their residual overlap.
    let (first_share, second_share) = if total_weight > 0.0 {
        (first_weight / total_weight, second_weight / total_weight)
    } else {
        (0.0, 0.0)
    };
    // Contact removes only each body's own inward motion. Peer speed never becomes a
    // desired velocity, so repeated pair responses cannot accelerate a resting neighbor.
    let velocity_change = |body: &MobileContactBody, outward: Vector3| {
        if closing_speed > 0.0 && body.response_mobility.is_some() {
            outward * -body.velocity.dot(&outward).min(0.0)
        } else {
            Vector3::zero()
        }
    };
    Some(MobileContactResponse {
        normal,
        excess_penetration,
        first: MobileContactChange {
            displacement: separation * first_share,
            velocity_change: velocity_change(first, normal),
        },
        second: MobileContactChange {
            displacement: separation * -second_share,
            velocity_change: velocity_change(second, normal * -1.0),
        },
    })
}

/// Grounded definition policy and the response-owned support at the accepted pose.
#[derive(Debug, Clone, Copy)]
pub struct GroundedContactState {
    /// Existing stair, slope, gravity, and edge policy.
    pub config: super::GroundedConfig,
    /// Accepted support; the step validates world ownership or re-queries its hard entity.
    pub ground: super::GroundState,
}

/// Prepared geometric role, independent of whether ordinary integration is sleeping.
#[derive(Debug, Clone, Copy)]
enum PreparedContactRole {
    /// Contact cannot translate this body; the scene supplies its authored target geometry.
    Hard,
    /// Ordinary sphere-based advancement, with independent compliant or hard contact response.
    Mover {
        /// Movement spheres and integration velocity for local response.
        body: MobileContactBody,
        /// Grounded policy supplied by the definition owner; absent for free-flight bodies.
        grounded: Option<GroundedContactState>,
        /// Authored friction, restitution, and facing policy, independent of movement geometry.
        policy: super::PhysicalBodyResponsePolicy,
    },
    /// One-way swept projectile motion, excluded from compliant crowd response.
    Projectile {
        /// Prepared movement spheres and incoming velocity.
        body: MobileContactBody,
        /// Authored impact and facing response, independent of character contact mobility.
        policy: super::PhysicalBodyResponsePolicy,
    },
}

/// Contact facts sampled once from an installed body for a collection's working state.
#[derive(Debug, Clone)]
struct PreparedBodyContact<'a> {
    /// Borrowed source facts validated together before any contact consumer runs.
    source: PreparedContactSource<'a>,
    /// Source identity, filtering, and current placement shared by prepared geometric roles.
    participant: ContactParticipant,
    /// Hard-target, compliant-mobile, or one-way projectile geometry role.
    role: PreparedContactRole,
}

/// Source facts retained while a mobile working shape changes during contact passes.
#[derive(Debug, Clone)]
pub(super) struct ContactParticipant {
    /// Normalized public identity, independent from state-derived physics policy.
    pub(super) player_collision: Option<crate::PlayerCollisionStatus>,
    /// Canonical identity used for stable pair order, hard queries, and publication.
    pub(super) body_id: SpatialBodyId,
    /// Whether the producer retains this body as a target for other movers.
    pub(super) target_demand: LocalTargetDemand,
    /// Existing directional collision semantics; reporting remains independently owned.
    pub(super) policy: EntityDynamicCollisionPolicy,
    /// Proven collision domains; overlapping coordinates in disconnected EnvCells do not collide.
    pub(super) membership: SpatialMembership,
    /// Body-owned exclusions used by hard-obstacle correction sweeps.
    pub(super) filter: super::PhysicalCollisionFilter,
}

/// Immutable source facts retained through contact preparation and working motion.
#[derive(Debug, Clone, Copy)]
struct PreparedContactSource<'a> {
    /// Original pose and authored vectors; actuation callbacks consume the original body.
    body: &'a SpatialBody,
    /// Installed physics, including direct-query bodies without an entity lifecycle.
    physical: &'a super::PhysicalBodyState,
    /// Resolved target participation, carrying geometry only for queries that consume it.
    target: PreparedContactTarget<'a>,
}

/// Geometry availability and query timing are one prepared decision, separate from movement.
#[derive(Debug, Clone, Copy)]
enum PreparedContactTarget<'a> {
    /// Authored obstacles participate before and after their ordinary movement.
    Hard(&'a super::physical_body::DynamicBodyRuntimeState),
    /// Yielding targets participate only at accepted endpoints for projectile queries.
    Mobile(&'a super::physical_body::DynamicBodyRuntimeState),
    /// Movement-only, unretained yielding, and projectile bodies supply no target geometry.
    Absent,
}

impl<'a> PreparedBodyContact<'a> {
    /// Prepares installed physics in a caller-selected common landblock frame.
    /// The scene must refresh residency before this call; activity alone is not an owner proof.
    /// Absent or suspended physics cannot participate. Settled bodies keep finite mobility;
    /// integration-excluded and fixed-position bodies are hard, irrespective of current speed.
    fn from_body(body: &'a SpatialBody, anchor: Guid) -> Result<Option<Self>> {
        let Some(physical) = body.physical.as_ref() else {
            return Ok(None);
        };
        super::physics_work::record_body_preparation();
        let participant = match &physical.dynamic {
            Some(dynamic) => {
                if dynamic.activity == DynamicBodyActivity::Suspended {
                    return Ok(None);
                }
                ContactParticipant::from_dynamic(body, dynamic, physical.collision_filter)
            }
            // Movement-only bodies have no authored peer geometry or report owner. Their
            // response cell seeds the same checked sphere traversal used by entity movers.
            None => ContactParticipant {
                player_collision: None,
                body_id: body.id,
                target_demand: LocalTargetDemand::Absent,
                policy: EntityDynamicCollisionPolicy {
                    is_static: false,
                    target: crate::EntityCollisionParticipation::Suppressed,
                    mover_accepts_response: true,
                    accepts_peer_reports: false,
                    missile: false,
                    path_clipped: false,
                },
                membership: match physical.response.cell() {
                    Some(cell) => SpatialMembership::interior(cell),
                    None => SpatialMembership::outdoor(),
                },
                filter: physical.collision_filter,
            },
        };
        let yields = physical
            .dynamic
            .as_ref()
            .is_none_or(|dynamic| dynamic.collision.contact_response.yields());
        let role = if matches!(
            physical.definition,
            PhysicalBodyDefinition::FixedPosition { .. }
        ) || (physical.dynamic.as_ref().is_some_and(|dynamic| {
            dynamic.demand.integration == LocalIntegrationDemand::Excluded
                || matches!(
                    dynamic.collision.contact_response,
                    super::EntityContactResponse::Character(
                        crate::EntityIntegrationEligibility::Frozen
                            | crate::EntityIntegrationEligibility::Static
                    )
                )
        })) {
            PreparedContactRole::Hard
        } else {
            let pose = body.pose.reanchor_to_landblock_owner(anchor)?;
            let placed = |sphere: super::GroundedSphere| Sphere {
                center: pose.coords + pose.rotation.rotate_vector(sphere.center),
                radius: sphere.radius,
            };
            let spheres = physical.definition.spheres();
            let spheres = PhysicalSphereSet::new(
                placed(spheres.primary()),
                spheres.upper_constraint().map(placed),
            )?;
            let mobile_weight = match body.id {
                SpatialBodyId::LocalPlayer(_) => ContactMobility::PLAYER,
                _ => ContactMobility::MOBILE,
            };
            let mobile = MobileContactBody::new(
                spheres,
                body.retained.velocity,
                yields.then_some(mobile_weight),
            )?;
            if participant.policy.missile {
                PreparedContactRole::Projectile {
                    body: mobile,
                    policy: physical.response_policy,
                }
            } else {
                PreparedContactRole::Mover {
                    body: mobile,
                    policy: physical.response_policy,
                    grounded: match physical.definition {
                        PhysicalBodyDefinition::Grounded { config, .. } => {
                            let super::PhysicalBodyResponseState::Grounded { ground, .. } =
                                physical.response
                            else {
                                anyhow::bail!(
                                    "grounded contact definition requires grounded response state"
                                );
                            };
                            Some(GroundedContactState { config, ground })
                        }
                        PhysicalBodyDefinition::FreeSphere { .. }
                        | PhysicalBodyDefinition::FixedPosition { .. } => None,
                    },
                }
            }
        };
        let hard_target = matches!(role, PreparedContactRole::Hard)
            || matches!(role, PreparedContactRole::Mover { .. }) && !yields;
        let target = match physical.dynamic.as_ref() {
            Some(dynamic) if hard_target => PreparedContactTarget::Hard(dynamic),
            Some(dynamic)
                if matches!(role, PreparedContactRole::Mover { .. })
                    && participant.target_demand == LocalTargetDemand::Retained =>
            {
                PreparedContactTarget::Mobile(dynamic)
            }
            None if hard_target => anyhow::bail!("hard contact target requires authored geometry"),
            _ => PreparedContactTarget::Absent,
        };
        Ok(Some(Self {
            source: PreparedContactSource {
                body,
                physical,
                target,
            },
            participant,
            role,
        }))
    }
}

impl ContactParticipant {
    /// Captures collision-only facts shared by live and frozen query preparation.
    pub(super) fn from_dynamic(
        body: &SpatialBody,
        dynamic: &super::physical_body::DynamicBodyRuntimeState,
        filter: super::PhysicalCollisionFilter,
    ) -> Self {
        Self {
            player_collision: dynamic.collision.player_collision,
            body_id: body.id,
            target_demand: dynamic.demand.target,
            policy: dynamic.collision.dynamic_collision,
            membership: dynamic.placement.clone(),
            filter,
        }
    }

    fn receives_response_from(&self, peer: &Self) -> bool {
        !self
            .filter
            .excludes(super::PhysicalCollisionExclusions::ENTITY_RESPONSE)
            && self.body_id != peer.body_id
            && peer.target_demand == LocalTargetDemand::Retained
            && self
                .policy
                .contact_with(peer.policy, self.player_collision, peer.player_collision)
                == crate::EntityContactInteraction::Blocking
    }
}

fn resolve_participant_pair(
    first_source: &ContactParticipant,
    mut first: MobileContactBody,
    second_source: &ContactParticipant,
    mut second: MobileContactBody,
) -> Option<MobileContactResponse> {
    if !first_source
        .membership
        .intersects_reached(&second_source.membership)
    {
        return None;
    }
    if !first_source.receives_response_from(second_source) {
        first.response_mobility = None;
    }
    if !second_source.receives_response_from(first_source) {
        second.response_mobility = None;
    }
    resolve_mobile_contact(&first, &second)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Sphere;

    #[test]
    fn zero_separation_weight_still_brakes_without_receiving_displacement() {
        for peer_weight in [ContactMobility::ZERO, ContactMobility::MOBILE] {
            let first = body(0.0, Vector3::new(5.0, 2.0, 0.0), ContactMobility::ZERO);
            let second = body(0.9, Vector3::new(-3.0, -1.0, 0.0), peer_weight);
            let response = resolve_mobile_contact(&first, &second).unwrap();
            let reversed = resolve_mobile_contact(&second, &first).unwrap();
            assert_eq!(response.first, reversed.second);
            assert_eq!(response.second, reversed.first);
            assert_eq!(response.first.displacement, Vector3::zero());
            assert_eq!(
                first.velocity + response.first.velocity_change,
                Vector3::new(0.0, 2.0, 0.0)
            );
            assert_eq!(
                second.velocity + response.second.velocity_change,
                Vector3::new(0.0, -1.0, 0.0)
            );
            if peer_weight == ContactMobility::ZERO {
                assert_eq!(response.second.displacement, Vector3::zero());
            } else {
                assert!(response.second.displacement.x > 0.0);
            }
        }
    }

    #[test]
    fn contact_brakes_each_body_without_transferring_momentum_in_either_pair_order() {
        for (player_speed, mob_speed, expected_player, expected_mob) in [
            (0.0, -3.0, 0.0, 0.0),
            (3.0, 0.0, 0.0, 0.0),
            (3.0, -3.0, 0.0, 0.0),
            (-2.0, -3.0, -2.0, 0.0),
            (-3.0, 0.0, -3.0, 0.0),
        ] {
            let player = body(
                0.0,
                Vector3::new(player_speed, 2.0, 0.0),
                ContactMobility::MOBILE,
            );
            let mob = body(
                0.9,
                Vector3::new(mob_speed, 0.0, 0.0),
                ContactMobility::MOBILE,
            );
            let result = resolve_mobile_contact(&player, &mob).unwrap();
            let reversed = resolve_mobile_contact(&mob, &player).unwrap();
            assert_eq!(result.first, reversed.second);
            assert_eq!(result.second, reversed.first);
            assert!(
                (player.velocity.x + result.first.velocity_change.x - expected_player).abs() < 1e-6
            );
            assert!((mob.velocity.x + result.second.velocity_change.x - expected_mob).abs() < 1e-6);
            assert_eq!(result.first.velocity_change.y, 0.0);
            assert!(
                result.first.displacement.x < 0.0,
                "overlap still separates the player"
            );
        }
    }

    #[test]
    fn unresponsive_incoming_peer_cannot_force_player_velocity_response() {
        let player = body(0.0, Vector3::zero(), ContactMobility::PLAYER);
        let mut mob = body(0.9, Vector3::new(-3.0, 0.0, 0.0), ContactMobility::MOBILE);
        mob.response_mobility = None;
        let response = resolve_mobile_contact(&player, &mob).unwrap();
        assert_eq!(response.first.velocity_change, Vector3::zero());
        assert_eq!(response.second.velocity_change, Vector3::zero());
        assert!(response.first.displacement.x < 0.0);
        assert_eq!(response.second.displacement, Vector3::zero());
    }

    #[test]
    fn pair_filter_preserves_directional_response_and_reached_domains() {
        let mut first = ContactParticipant {
            player_collision: None,
            body_id: SpatialBodyId::Entity(Guid(1)),
            target_demand: LocalTargetDemand::Retained,
            policy: EntityDynamicCollisionPolicy {
                is_static: false,
                target: crate::EntityCollisionParticipation::Solid,
                mover_accepts_response: false,
                accepts_peer_reports: true,
                missile: false,
                path_clipped: false,
            },
            membership: SpatialMembership::outdoor(),
            filter: super::super::PhysicalCollisionFilter::ALL,
        };
        let mut second = first.clone();
        second.body_id = SpatialBodyId::Entity(Guid(2));
        second.policy.mover_accepts_response = true;
        let mobile = body(0.0, Vector3::zero(), ContactMobility::MOBILE);
        let response = resolve_participant_pair(&first, mobile, &second, mobile).unwrap();
        assert_eq!(response.first.displacement, Vector3::zero());
        assert_eq!(response.first.velocity_change, Vector3::zero());
        assert!(response.second.displacement.length() > 0.0);
        assert!(resolve_participant_pair(&first, mobile, &first, mobile).is_none());
        first.policy.mover_accepts_response = true;
        first.filter = super::super::PhysicalCollisionFilter::excluding(
            super::super::PhysicalCollisionExclusions::ENTITY_RESPONSE,
        );
        let filtered = resolve_participant_pair(&first, mobile, &second, mobile).unwrap();
        assert_eq!(filtered.first.displacement, Vector3::zero());
        assert_eq!(filtered.first.velocity_change, Vector3::zero());
        assert!(filtered.second.displacement.length() > 0.0);
        first.filter = super::super::PhysicalCollisionFilter::ALL;
        let restored = resolve_participant_pair(&first, mobile, &second, mobile).unwrap();
        assert!(restored.first.displacement.length() > 0.0);
        first.membership = SpatialMembership::interior(Guid(0xda55_0100));
        second.membership = SpatialMembership::interior(Guid(0xda55_0101));
        assert!(resolve_participant_pair(&first, mobile, &second, mobile).is_none());
    }

    fn body(x: f32, velocity: Vector3, mobility: ContactMobility) -> MobileContactBody {
        let spheres = PhysicalSphereSet::new(
            Sphere {
                center: Vector3::new(x, 0.0, 0.0),
                radius: 0.5,
            },
            None,
        )
        .unwrap();
        MobileContactBody::new(spheres, velocity, Some(mobility)).unwrap()
    }

    #[test]
    fn closing_contact_shares_separation_and_removes_relative_normal_velocity() {
        let first = body(0.0, Vector3::new(1.0, 2.0, 0.0), ContactMobility::PLAYER);
        let second = body(0.9, Vector3::zero(), ContactMobility::MOBILE);
        let response = resolve_mobile_contact(&first, &second).unwrap();
        assert!(response.first.displacement.x < 0.0);
        assert!(response.second.displacement.x > 0.0);
        let ratio = ContactMobility::MOBILE.0 / ContactMobility::PLAYER.0;
        assert!(
            (response.first.displacement.x * ratio + response.second.displacement.x).abs() < 1e-6
        );
        let relative = first.velocity + response.first.velocity_change
            - second.velocity
            - response.second.velocity_change;
        assert!(relative.dot(&response.normal).abs() < 1e-6);
        assert_eq!(response.first.velocity_change.y, 0.0);
    }

    #[test]
    fn separating_motion_is_not_cancelled_or_launched_by_position_recovery() {
        let first = body(0.0, Vector3::new(-1.0, 0.0, 0.0), ContactMobility::PLAYER);
        let second = body(0.5, Vector3::zero(), ContactMobility::MOBILE);
        let response = resolve_mobile_contact(&first, &second).unwrap();
        assert!(response.excess_penetration > 0.0);
        assert_eq!(response.first.velocity_change, Vector3::zero());
        assert_eq!(response.second.velocity_change, Vector3::zero());
    }

    #[test]
    fn overlap_inside_tolerance_needs_no_response() {
        let first = body(0.0, Vector3::zero(), ContactMobility::PLAYER);
        let second = body(
            1.0 - MOBILE_CONTACT_TOLERANCE_METERS * 0.5,
            Vector3::zero(),
            ContactMobility::MOBILE,
        );
        assert!(resolve_mobile_contact(&first, &second).is_none());
    }

    #[test]
    fn immovable_participant_receives_neither_displacement_nor_velocity() {
        let first = body(0.0, Vector3::new(1.0, 0.0, 0.0), ContactMobility::MOBILE);
        let mut second = body(0.9, Vector3::zero(), ContactMobility::MOBILE);
        second.response_mobility = None;
        let response = resolve_mobile_contact(&first, &second).unwrap();
        assert_eq!(response.second.displacement, Vector3::zero());
        assert_eq!(response.second.velocity_change, Vector3::zero());
        assert!((first.velocity + response.first.velocity_change).length() < 1e-6);
    }

    #[test]
    fn two_sphere_contact_selection_can_alternate_without_launching_or_diverging() {
        let spheres = |offset: Vector3, upper_offset: Vector3| {
            PhysicalSphereSet::new(
                Sphere {
                    center: offset,
                    radius: 0.5,
                },
                Some(Sphere {
                    center: upper_offset,
                    radius: 0.5,
                }),
            )
            .unwrap()
        };
        let mut first = MobileContactBody::new(
            spheres(Vector3::zero(), Vector3::new(0.0, 0.0, 2.0)),
            Vector3::zero(),
            Some(ContactMobility::PLAYER),
        )
        .unwrap();
        let mut second = MobileContactBody::new(
            spheres(Vector3::new(0.9, 0.0, 0.0), Vector3::new(0.0, 0.6, 2.0)),
            Vector3::zero(),
            Some(ContactMobility::MOBILE),
        )
        .unwrap();
        let response = resolve_mobile_contact(&first, &second).unwrap();
        assert_eq!(response.normal, Vector3::new(0.0, -1.0, 0.0));
        assert_eq!(response.first.displacement.x, 0.0);
        assert!(response.first.displacement.y < 0.0);
        let translate = |body: &mut MobileContactBody, change: MobileContactChange| {
            let moved = |sphere: super::super::GroundedSphere| Sphere {
                center: sphere.center + change.displacement,
                radius: sphere.radius,
            };
            body.spheres = PhysicalSphereSet::new(
                moved(body.spheres.primary()),
                body.spheres.upper_constraint().map(moved),
            )
            .unwrap();
            body.velocity = body.velocity + change.velocity_change;
        };
        let mut previous_normal = response.normal;
        let mut switched = false;
        for _ in 0..16 * MOBILE_CONTACT_PASSES {
            let Some(response) = resolve_mobile_contact(&first, &second) else {
                break;
            };
            switched |= response.normal.dot(&previous_normal) < 0.99;
            previous_normal = response.normal;
            translate(&mut first, response.first);
            translate(&mut second, response.second);
            assert_eq!(first.velocity, Vector3::zero());
            assert_eq!(second.velocity, Vector3::zero());
        }
        assert!(
            switched,
            "fixture never switched between its competing sphere contacts"
        );
        let residual = resolve_mobile_contact(&first, &second)
            .map_or(0.0, |contact| contact.excess_penetration);
        assert!(
            residual < MOBILE_CONTACT_TOLERANCE_METERS,
            "alternating sphere contacts retained excessive compression: {residual}"
        );
    }

    #[test]
    fn contact_never_increases_either_body_speed_even_at_coincident_centers() {
        for separation in [0.0, 0.9] {
            for first_speed in [-20.0, -2.0, 0.0, 2.0, 20.0] {
                for second_speed in [-20.0, -2.0, 0.0, 2.0, 20.0] {
                    let first = body(
                        0.0,
                        Vector3::new(first_speed, 2.0, 0.0),
                        ContactMobility::PLAYER,
                    );
                    let second = body(
                        separation,
                        Vector3::new(second_speed, -1.0, 0.0),
                        ContactMobility::MOBILE,
                    );
                    let response = resolve_mobile_contact(&first, &second).unwrap();
                    for (body, change) in [(first, response.first), (second, response.second)] {
                        assert!(
                            (body.velocity + change.velocity_change).length_squared()
                                <= body.velocity.length_squared() + 0.0001
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn coincident_stationary_centers_have_finite_deterministic_separation() {
        let first = body(0.0, Vector3::zero(), ContactMobility::PLAYER);
        let second = body(0.0, Vector3::zero(), ContactMobility::MOBILE);
        let response = resolve_mobile_contact(&first, &second).unwrap();
        assert_eq!(response.normal, Vector3::new(1.0, 0.0, 0.0));
        assert!(response.first.displacement.x.is_finite());
        assert!(response.first.displacement.x > 0.0);
    }
}
