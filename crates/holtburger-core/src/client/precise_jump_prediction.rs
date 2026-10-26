//! Collision-backed first-landing prediction for precise jumps.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use holtburger_common::position::METERS_PER_LANDBLOCK;
use holtburger_common::{Guid, Vector3};
use holtburger_world::{
    CollisionQueryError, CollisionScene, CollisionSurfaceRayHit, ContactMotionSegment,
    ContactState, EntityCollisionSnapshot, GroundState, GroundedBodyActuation, MotionWaypoint,
    MotionWaypointPlacement, PhysicalBodyActuation, PhysicalBodyDefinition,
    PhysicalBodyResponseState, PlacedMotionPathRequest, SpatialBody,
};
use thiserror::Error;

use super::precise_jump::PreciseJumpLaunchCandidate;

/// The ordinary client physics quantum used for every speculative tick.
pub const PRECISE_JUMP_FIXED_TICK: Duration = Duration::from_nanos(
    (holtburger_world::MOBILE_CONTACT_TICK_SECONDS as f64 * 1_000_000_000.0) as u64,
);
const TARGET_NORMAL_TOLERANCE: f32 = 0.000_1;

/// Finite picked surface coordinates used by launch math and frontend presentation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpTargetView {
    pub anchor: Guid,
    pub point: Vector3,
    pub normal: Vector3,
    pub committed_cell: Option<Guid>,
}

/// Validated picked surface; selection does not retain a collision-clearance certificate.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpTarget {
    view: PreciseJumpTargetView,
}
impl PreciseJumpTarget {
    pub fn new(anchor: Guid, hit: CollisionSurfaceRayHit) -> Result<Self, PreciseJumpTargetError> {
        if anchor.0 & 0xffff != 0xffff {
            return Err(PreciseJumpTargetError::InvalidAnchor);
        }
        let point = hit.point();
        let normal = hit.normal();
        let length = normal.length_squared();
        if !point.x.is_finite()
            || !point.y.is_finite()
            || !point.z.is_finite()
            || !hit.distance().is_finite()
            || hit.distance() < 0.0
            || !length.is_finite()
            || (length - 1.0).abs() > TARGET_NORMAL_TOLERANCE
        {
            return Err(PreciseJumpTargetError::InvalidHit);
        }
        Ok(Self {
            view: PreciseJumpTargetView {
                anchor,
                point,
                normal,
                committed_cell: hit.placement().committed_cell(),
            },
        })
    }
    pub const fn anchor(&self) -> Guid {
        self.view.anchor
    }
    pub const fn view(&self) -> &PreciseJumpTargetView {
        &self.view
    }
}

/// Invalid collision target rejected before speculative physics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PreciseJumpTargetError {
    #[error("precise-jump target anchor must be a normalized outdoor collision owner")]
    InvalidAnchor,
    #[error("precise-jump target hit must contain finite geometry and a unit normal")]
    InvalidHit,
}

/// One placement interval over the trajectory's normalized `[0, 1]` time domain.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpTrajectoryPlacement {
    start_fraction: f32,
    end_fraction: f32,
    committed_cell: Option<Guid>,
}

impl PreciseJumpTrajectoryPlacement {
    /// Inclusive start of this render-domain interval.
    pub const fn start_fraction(self) -> f32 {
        self.start_fraction
    }

    /// Exclusive interval end, except that the final interval includes one.
    pub const fn end_fraction(self) -> f32 {
        self.end_fraction
    }

    /// EnvCell containing this interval, or `None` for the outdoor domain.
    pub const fn committed_cell(self) -> Option<Guid> {
        self.committed_cell
    }
}

/// Compact analytic launch curve plus the collision traversal's semantic placement partition.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpTrajectory {
    anchor: Guid,
    origin: Vector3,
    velocity: Vector3,
    acceleration: Vector3,
    duration_seconds: f32,
    placements: Vec<PreciseJumpTrajectoryPlacement>,
}

impl PreciseJumpTrajectory {
    /// Normalized outdoor frame containing the curve coefficients.
    pub const fn anchor(&self) -> Guid {
        self.anchor
    }

    pub const fn origin(&self) -> Vector3 {
        self.origin
    }

    /// Linear curve coefficient; the launch candidate retains the actual release velocity.
    pub const fn velocity(&self) -> Vector3 {
        self.velocity
    }

    pub const fn acceleration(&self) -> Vector3 {
        self.acceleration
    }

    pub const fn duration_seconds(&self) -> f32 {
        self.duration_seconds
    }

    pub fn placements(&self) -> &[PreciseJumpTrajectoryPlacement] {
        &self.placements
    }

    /// Evaluates the inverse solver's continuous candidate, independent of renderer tessellation.
    pub fn position_at_fraction(&self, fraction: f32) -> Option<Vector3> {
        if !fraction.is_finite() || !(0.0..=1.0).contains(&fraction) {
            return None;
        }
        let seconds = self.duration_seconds * fraction;
        Some(self.origin + self.velocity * seconds + self.acceleration * (0.5 * seconds * seconds))
    }
}
/// Missing facts or exhausted work that cannot claim a landing endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreciseJumpPredictionIncompleteReason {
    Cancelled,
    SessionChanged,
    BodyUnavailable,
    BodyDefinitionChanged,
    CollisionUnavailable { owner: Guid },
    EnvCellUnavailable { cell: Guid },
    FlightHorizonExhausted,
}
/// Unexpected solver failure outside the prediction's explicit semantic outcomes.
#[derive(Debug, Error)]
pub enum PreciseJumpPredictionError {
    #[error("precise-jump collision solver failed")]
    Solver(#[source] anyhow::Error),
}

/// Builds an ideal free-flight curve with its own directed interior placement partition.
/// This query assigns visibility scopes only; it deliberately does not stop on obstacles.
pub(super) fn selected_jump_curve(
    body: &SpatialBody,
    collision: &CollisionScene,
    anchor: Guid,
    launch_velocity: Vector3,
    duration_seconds: f32,
) -> Result<PreciseJumpTrajectory, PreciseJumpPredictionError> {
    let physical = body.physical.as_ref().ok_or_else(|| {
        PreciseJumpPredictionError::Solver(anyhow::anyhow!("selected curve requires body physics"))
    })?;
    let PhysicalBodyDefinition::Grounded { spheres, config } = physical.definition else {
        return Err(PreciseJumpPredictionError::Solver(anyhow::anyhow!(
            "selected curve requires grounded body geometry"
        )));
    };
    let origin = point_between_anchors(
        body.pose.coords,
        owner_for_position(body.pose.landblock_id),
        anchor,
    );
    let velocity = launch_velocity
        + Vector3::new(
            0.0,
            0.0,
            config.gravity * PRECISE_JUMP_FIXED_TICK.as_secs_f32() * 0.5,
        );
    let acceleration = Vector3::new(0.0, 0.0, config.gravity);
    let offset = body.pose.rotation.rotate_vector(spheres.support.center);
    let samples =
        ((duration_seconds / PRECISE_JUMP_FIXED_TICK.as_secs_f32()).ceil() as usize).clamp(1, 160);
    let waypoints = (1..=samples)
        .map(|sample| {
            let fraction = sample as f32 / samples as f32;
            let time = fraction * duration_seconds;
            MotionWaypoint {
                center: origin + offset + velocity * time + acceleration * (0.5 * time * time),
                end_fraction: fraction,
                placement: MotionWaypointPlacement::Traverse,
            }
        })
        .collect::<Vec<_>>();
    let path = collision
        .transit_motion_path(PlacedMotionPathRequest {
            previous_cell: physical.response.cell(),
            anchor,
            start: origin + offset,
            radius: spheres.support.radius,
            waypoints: &waypoints,
        })
        .map_err(|error| PreciseJumpPredictionError::Solver(error.into()))?;
    let mut placements = Vec::new();
    let mut start_fraction = 0.0;
    let mut committed_cell = path.initial().placement().committed_cell();
    for leg in path.legs() {
        let next_cell = leg.end().placement().committed_cell();
        if next_cell != committed_cell {
            if leg.end_fraction() > start_fraction {
                placements.push(PreciseJumpTrajectoryPlacement {
                    start_fraction,
                    end_fraction: leg.end_fraction(),
                    committed_cell,
                });
            }
            start_fraction = leg.end_fraction();
            committed_cell = next_cell;
        }
    }
    if start_fraction < 1.0 {
        placements.push(PreciseJumpTrajectoryPlacement {
            start_fraction,
            end_fraction: 1.0,
            committed_cell,
        });
    }
    Ok(PreciseJumpTrajectory {
        anchor,
        origin,
        velocity,
        acceleration,
        duration_seconds,
        placements,
    })
}

/// One accepted root-motion leg, including contact adjustments.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpFlightSegment {
    /// Body-reference endpoints in the flight's common anchor frame.
    pub start: Vector3,
    pub end: Vector3,
    /// Interior scope for this leg, or outdoors. Portal changes split legs.
    pub committed_cell: Option<Guid>,
}

/// The first walkable landing, or an explicitly incomplete accepted path prefix.
#[derive(Debug, Clone, PartialEq)]
pub enum PreciseJumpFlightOutcome {
    Landed {
        /// Surface contact, rather than the body-reference endpoint.
        contact_point: Vector3,
        /// Walkable contact normal used to place the landing marker.
        normal: Vector3,
        /// Cell containing the contact, or outdoors.
        committed_cell: Option<Guid>,
        /// Core-owned proximity and walkability classification of the desired target.
        matches_target: bool,
    },
    Incomplete(PreciseJumpPredictionIncompleteReason),
}

/// Collision-predicted path for exactly one user-selected launch.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpFlight {
    /// Common normalized outdoor frame for path and endpoint positions.
    pub anchor: Guid,
    /// Accepted geometry; no fitted post-impact ballistic curve.
    pub segments: Vec<PreciseJumpFlightSegment>,
    /// Landing or reason no endpoint can yet be claimed.
    pub outcome: PreciseJumpFlightOutcome,
    /// Work performed, consumed by diagnostics independently of endpoint classification.
    pub solver_ticks: u32,
}

/// Immutable inputs for one chosen launch, with no proposal/search budget.
#[derive(Clone, Copy)]
pub struct PreciseJumpFlightRequest<'a> {
    pub body: &'a SpatialBody,
    pub collision_scene: &'a CollisionScene,
    pub entity_collision: &'a EntityCollisionSnapshot,
    pub target: &'a PreciseJumpTarget,
    pub candidate: PreciseJumpLaunchCandidate,
    /// Maximum fixed physical ticks admitted before an incomplete endpoint is published.
    pub maximum_ticks: std::num::NonZeroU32,
    pub start_time: Instant,
}

/// Simulates one hypothetical release through contacts to its first walkable landing.
/// Current support is deliberately not a prerequisite; actual release checks eligibility.
pub fn predict_selected_precise_jump(
    request: PreciseJumpFlightRequest<'_>,
    control: PreciseJumpPredictionControl<'_>,
) -> Result<PreciseJumpFlight, PreciseJumpPredictionError> {
    let mut flight = PreciseJumpFlight {
        anchor: request.target.anchor(),
        segments: Vec::new(),
        outcome: PreciseJumpFlightOutcome::Incomplete(
            PreciseJumpPredictionIncompleteReason::FlightHorizonExhausted,
        ),
        solver_ticks: 0,
    };
    let mut mover = request.body.clone();
    let Some(physical) = mover.physical.as_mut() else {
        flight.outcome = PreciseJumpFlightOutcome::Incomplete(
            PreciseJumpPredictionIncompleteReason::BodyUnavailable,
        );
        return Ok(flight);
    };
    let PhysicalBodyDefinition::Grounded { spheres, config } = physical.definition else {
        flight.outcome = PreciseJumpFlightOutcome::Incomplete(
            PreciseJumpPredictionIncompleteReason::BodyUnavailable,
        );
        return Ok(flight);
    };
    // This private clone starts with the selected impulse, not a supported launch edge.
    // Frozen ticks wake dynamic runtime state and ordinary response supplies later contacts.
    physical.response = PhysicalBodyResponseState::Grounded {
        cell: physical.response.cell(),
        ground: GroundState::Airborne,
        stationary_fall_frames: 0,
    };
    mover.contact = ContactState::Airborne;
    mover.retained.velocity = request.candidate.world_velocity();
    let frozen = request
        .entity_collision
        .prepare_frozen_contacts(owner_for_position(mover.pose.landblock_id))
        .map_err(PreciseJumpPredictionError::Solver)?;
    let mut orientation = mover.pose.rotation;
    for tick in 1..=request.maximum_ticks.get() {
        if let Some(reason) = control.interruption() {
            flight.outcome = PreciseJumpFlightOutcome::Incomplete(reason);
            return Ok(flight);
        }
        let result = match frozen.tick(
            &mut mover,
            request.collision_scene,
            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
            PRECISE_JUMP_FIXED_TICK.as_secs_f32(),
            request.start_time + PRECISE_JUMP_FIXED_TICK * tick,
        ) {
            Ok(result) => result,
            Err(error) => {
                let reason = match error.downcast_ref::<CollisionQueryError>() {
                    Some(CollisionQueryError::UnavailableOwner { owner }) => {
                        PreciseJumpPredictionIncompleteReason::CollisionUnavailable {
                            owner: Guid(*owner),
                        }
                    }
                    Some(CollisionQueryError::UnknownMotionCell { cell }) => {
                        PreciseJumpPredictionIncompleteReason::EnvCellUnavailable {
                            cell: Guid(*cell),
                        }
                    }
                    _ => return Err(PreciseJumpPredictionError::Solver(error)),
                };
                flight.outcome = PreciseJumpFlightOutcome::Incomplete(reason);
                return Ok(flight);
            }
        };
        flight.solver_ticks = tick;
        for segment in &result.motion {
            if let ContactMotionSegment::Rotation { rotation, .. } = segment {
                // Angular clearance paths move sphere centers, not the root.
                orientation = *rotation;
                continue;
            }
            if let Some(path) = segment.path() {
                let path = path.primary();
                let offset = orientation.rotate_vector(spheres.support.center);
                let mut start = point_between_anchors(
                    path.initial().center() - offset,
                    path.anchor(),
                    flight.anchor,
                );
                let mut cell = path.initial().placement().committed_cell();
                for leg in path.legs() {
                    let end = point_between_anchors(
                        leg.end().center() - offset,
                        path.anchor(),
                        flight.anchor,
                    );
                    flight.segments.push(PreciseJumpFlightSegment {
                        start,
                        end,
                        committed_cell: cell,
                    });
                    start = end;
                    cell = leg.end().placement().committed_cell();
                }
            }
            if let ContactMotionSegment::Impact { hit, point, .. } = segment {
                let normal = hit.contact().normal;
                if normal.z >= config.walkable_normal_z {
                    let contact = point_between_anchors(
                        point.center - normal * spheres.support.radius,
                        point.anchor,
                        flight.anchor,
                    );
                    flight.outcome = selected_landing(
                        request.target,
                        contact,
                        normal,
                        point.committed_cell,
                        spheres.support.radius,
                        config.walkable_normal_z,
                    );
                    return Ok(flight);
                }
            }
        }
        if let Some(owner) = result.unavailable_owner {
            flight.outcome = PreciseJumpFlightOutcome::Incomplete(
                PreciseJumpPredictionIncompleteReason::CollisionUnavailable { owner },
            );
            return Ok(flight);
        }
        if mover.contact == ContactState::Grounded {
            if let Some((normal, point, cell)) =
                grounded_support_contact(&mover, spheres.support, flight.anchor)
            {
                flight.outcome = selected_landing(
                    request.target,
                    point,
                    normal,
                    cell,
                    spheres.support.radius,
                    config.walkable_normal_z,
                );
                return Ok(flight);
            }
            flight.outcome = PreciseJumpFlightOutcome::Incomplete(
                PreciseJumpPredictionIncompleteReason::BodyDefinitionChanged,
            );
            return Ok(flight);
        }
    }
    Ok(flight)
}

fn selected_landing(
    target: &PreciseJumpTarget,
    contact_point: Vector3,
    normal: Vector3,
    committed_cell: Option<Guid>,
    tolerance: f32,
    walkable_normal_z: f32,
) -> PreciseJumpFlightOutcome {
    PreciseJumpFlightOutcome::Landed {
        contact_point,
        normal,
        committed_cell,
        matches_target: target.view.normal.z >= walkable_normal_z
            && committed_cell == target.view.committed_cell
            && contact_point.distance(&target.view.point) <= tolerance,
    }
}

/// Cooperative cancellation for one horizon-bounded chosen flight.
#[derive(Clone, Copy)]
pub struct PreciseJumpPredictionControl<'a> {
    /// Cooperative retirement checked between indivisible solver queries.
    pub cancelled: &'a AtomicBool,
}

impl PreciseJumpPredictionControl<'_> {
    fn interruption(self) -> Option<PreciseJumpPredictionIncompleteReason> {
        self.cancelled
            .load(Ordering::Relaxed)
            .then_some(PreciseJumpPredictionIncompleteReason::Cancelled)
    }
}

pub(super) fn desired_landing_body_point(
    body: &SpatialBody,
    target: &PreciseJumpTargetView,
    support_sphere: holtburger_world::GroundedSphere,
) -> Vector3 {
    let body_anchor = owner_for_position(body.pose.landblock_id);
    let target_in_body_frame = point_between_anchors(target.point, target.anchor, body_anchor);
    target_in_body_frame + target.normal * support_sphere.radius
        - body.pose.rotation.rotate_vector(support_sphere.center)
}
fn grounded_support_contact(
    body: &SpatialBody,
    support_sphere: holtburger_world::GroundedSphere,
    target_anchor: Guid,
) -> Option<(Vector3, Vector3, Option<Guid>)> {
    let PhysicalBodyResponseState::Grounded {
        ground: GroundState::Supported(support),
        ..
    } = body.physical.as_ref()?.response
    else {
        return None;
    };
    let (contact, committed_cell) =
        support_contact(body, support_sphere, support.normal, target_anchor)?;
    Some((support.normal, contact, committed_cell))
}
fn support_contact(
    body: &SpatialBody,
    support_sphere: holtburger_world::GroundedSphere,
    normal: Vector3,
    target_anchor: Guid,
) -> Option<(Vector3, Option<Guid>)> {
    let physical = body.physical.as_ref()?;
    let body_anchor = owner_for_position(body.pose.landblock_id);
    let center = body.pose.coords + body.pose.rotation.rotate_vector(support_sphere.center);
    let contact = center - normal * support_sphere.radius;
    Some((
        point_between_anchors(contact, body_anchor, target_anchor),
        physical.response.cell(),
    ))
}
fn owner_for_position(position: Guid) -> Guid {
    Guid((position.0 & 0xffff_0000) | 0xffff)
}
fn point_between_anchors(point: Vector3, source: Guid, target: Guid) -> Vector3 {
    Vector3::new(
        point.x
            + ((((source.0 >> 24) & 0xff) as i32 - ((target.0 >> 24) & 0xff) as i32) as f32
                * METERS_PER_LANDBLOCK),
        point.y
            + ((((source.0 >> 16) & 0xff) as i32 - ((target.0 >> 16) & 0xff) as i32) as f32
                * METERS_PER_LANDBLOCK),
        point.z,
    )
}
#[cfg(test)]
pub(in crate::client) mod tests {
    use holtburger_world::{SpatialBodyId, SpatialScene};
    use std::collections::HashMap;
    use std::sync::Arc;

    use holtburger_common::position::WorldPosition;
    use holtburger_common::{Quaternion, Sphere};
    use holtburger_content::{
        BspSolid, CellVolume, ColliderScale, CollisionBox, CollisionPolygon, CollisionShape,
        LandblockColliders, LandblockCollisionAsset, LandblockPlacement, LandblockTerrain,
        PlacedCollider, StaticColliderPlacement, TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode};
    use holtburger_world::state::SelfJumpCapabilities;
    use holtburger_world::{
        DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
        DynamicPhysicalBodyDefinition, EdgeProtection, EntityCollisionParticipation,
        EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, GroundSupport,
        LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, PhysicalBodyResponseState,
        PhysicalBodyState, PhysicalCollisionFilter, PhysicalElasticity,
        PreparedEntityTargetGeometry, StaticSurfaceRayRequest,
    };

    use crate::{JumpExtent, PreciseJumpWorldDisplacement, retail_player_grounded_profile};

    use super::*;

    const OWNER: Guid = Guid(0xda55_ffff);

    /// Asset-free collision fixture shared by prediction and asynchronous runtime tests.
    pub(in crate::client) struct PredictionFixture {
        pub collision: CollisionScene,
        pub scene: SpatialScene,
        pub body_id: SpatialBodyId,
        pub capabilities: SelfJumpCapabilities,
        pub target: PreciseJumpTarget,
        pub now: Instant,
    }

    pub(in crate::client) fn flat_prediction_fixture() -> PredictionFixture {
        let collision = collision_scene(0.0, Vec::new());
        let now = Instant::now();
        let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(114.0, 96.0, 0.0));
        PredictionFixture {
            collision,
            scene,
            body_id,
            capabilities: capabilities(),
            target,
            now,
        }
    }

    /// Collection-admitted variant for authority-tick launch transaction tests.
    pub(in crate::client) fn flat_dynamic_prediction_fixture() -> PredictionFixture {
        let mut fixture = flat_prediction_fixture();
        let (scene, body_id) = dynamic_body_scene(
            &fixture.collision,
            Vector3::new(120.0, 96.0, 0.005),
            fixture.now,
        );
        fixture.scene = scene;
        fixture.body_id = body_id;
        fixture
    }

    fn selected_flight(
        scene: &SpatialScene,
        collision: &CollisionScene,
        body_id: SpatialBodyId,
        target: &PreciseJumpTarget,
        power: JumpExtent,
        maximum_ticks: u32,
        now: Instant,
    ) -> PreciseJumpFlight {
        let body = scene.body(body_id).unwrap();
        let spheres = body.physical.as_ref().unwrap().definition.spheres();
        let desired = desired_landing_body_point(body, target.view(), spheres.primary());
        let selected = super::super::precise_jump::resolve_selected_precise_jump(
            PRECISE_JUMP_FIXED_TICK,
            &capabilities(),
            body.physical.as_ref().unwrap().definition,
            body.pose.rotation.to_heading(),
            PreciseJumpWorldDisplacement::new(desired - body.pose.coords).unwrap(),
            power,
        )
        .unwrap();
        let entities = scene.entity_collision_snapshot().unwrap();
        predict_selected_precise_jump(
            PreciseJumpFlightRequest {
                body,
                collision_scene: collision,
                entity_collision: &entities,
                target,
                candidate: selected.candidate(),
                maximum_ticks: std::num::NonZeroU32::new(maximum_ticks).unwrap(),
                start_time: now,
            },
            PreciseJumpPredictionControl {
                cancelled: &AtomicBool::new(false),
            },
        )
        .unwrap()
    }

    #[test]
    fn selected_flight_continues_after_ceiling_impact_and_reports_the_missed_landing() {
        let ceiling = polygon_collider(
            vec![
                Vector3::new(80.0, 80.0, 3.0),
                Vector3::new(80.0, 110.0, 3.0),
                Vector3::new(125.0, 110.0, 3.0),
                Vector3::new(125.0, 80.0, 3.0),
            ],
            Vector3::new(0.0, 0.0, -1.0),
            0,
        );
        let collision = collision_scene(0.0, vec![ceiling]);
        let now = Instant::now();
        let (mut scene, id) = body_scene(&collision, Vector3::new(90.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(94.8, 96.0, 0.0));
        let power = JumpExtent::new(0.77).unwrap();
        let supported = selected_flight(&scene, &collision, id, &target, power, 160, now);
        assert!(supported.solver_ticks > 5);
        let PreciseJumpFlightOutcome::Landed {
            contact_point,
            matches_target,
            ..
        } = supported.outcome
        else {
            panic!("ceiling arc must land: {:?}", supported.outcome);
        };
        assert!(!matches_target);
        assert!(contact_point.x < 92.0);
        assert!(contact_point.z.abs() < 0.001);
        assert!(
            supported
                .segments
                .iter()
                .any(|segment| segment.end.z < segment.start.z)
        );
        for pair in supported.segments.windows(2) {
            assert!((pair[0].end - pair[1].start).length() < 0.001);
        }
        let mut body = scene.body(id).unwrap().clone();
        body.contact = ContactState::Airborne;
        if let PhysicalBodyResponseState::Grounded { ground, .. } =
            &mut body.physical.as_mut().unwrap().response
        {
            *ground = GroundState::Airborne;
        }
        scene.update_body(body).unwrap();
        assert_eq!(
            selected_flight(&scene, &collision, id, &target, power, 160, now),
            supported
        );
    }

    #[test]
    fn selected_flight_distinguishes_matching_landing_speed_capped_miss_and_incomplete_prefix() {
        let collision = collision_scene(0.0, Vec::new());
        let now = Instant::now();
        let (scene, id) = body_scene(&collision, Vector3::new(90.0, 96.0, 0.005), now);
        for (distance, expected) in [(1.0, true), (20.0, false)] {
            let target = downward_target(&collision, Vector3::new(90.0 + distance, 96.0, 0.0));
            let flight = selected_flight(
                &scene,
                &collision,
                id,
                &target,
                JumpExtent::MAXIMUM,
                160,
                now,
            );
            let PreciseJumpFlightOutcome::Landed { matches_target, .. } = flight.outcome else {
                panic!("flat arc must land");
            };
            assert_eq!(matches_target, expected);
            let incomplete =
                selected_flight(&scene, &collision, id, &target, JumpExtent::MAXIMUM, 1, now);
            assert_eq!(
                incomplete.outcome,
                PreciseJumpFlightOutcome::Incomplete(
                    PreciseJumpPredictionIncompleteReason::FlightHorizonExhausted
                )
            );
            assert!(!incomplete.segments.is_empty());
        }
    }

    #[test]
    fn selected_flight_continues_after_wall_contact_with_tangential_motion() {
        let wall = polygon_collider(
            vec![
                Vector3::new(92.0, 90.0, 0.0),
                Vector3::new(92.0, 105.0, 0.0),
                Vector3::new(92.0, 105.0, 8.0),
                Vector3::new(92.0, 90.0, 8.0),
            ],
            Vector3::new(-1.0, 0.0, 0.0),
            0,
        );
        let collision = collision_scene(0.0, vec![wall]);
        let now = Instant::now();
        let (scene, id) = body_scene(&collision, Vector3::new(90.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(95.0, 99.0, 0.0));
        let flight = selected_flight(
            &scene,
            &collision,
            id,
            &target,
            JumpExtent::MAXIMUM,
            160,
            now,
        );
        let PreciseJumpFlightOutcome::Landed {
            contact_point,
            matches_target,
            ..
        } = flight.outcome
        else {
            panic!("wall continuation must land");
        };
        assert!(!matches_target);
        assert!(contact_point.x < 92.0);
        assert!(contact_point.y > 96.5);
        assert!(
            flight
                .segments
                .iter()
                .any(|segment| segment.end.x < segment.start.x
                    && segment.end.y > segment.start.y + 0.001)
        );
    }

    #[test]
    fn selected_flight_and_ideal_curve_preserve_interior_placement() {
        let cell = Guid(0xda550100);
        let mut floor = polygon_collider(
            vec![
                Vector3::new(108.0, 92.0, 0.0),
                Vector3::new(124.0, 92.0, 0.0),
                Vector3::new(124.0, 100.0, 0.0),
                Vector3::new(108.0, 100.0, 0.0),
            ],
            Vector3::new(0.0, 0.0, 1.0),
            0,
        );
        floor.source_placement = StaticColliderPlacement::EnvCellShell { cell_id: cell.0 };
        let mut collision = CollisionScene::new();
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: OWNER.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(
                    vec![floor],
                    vec![CellVolume {
                        cell_selector: cell.0 as u16,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: Vec::new(),
                        portals: Vec::new(),
                    }],
                ),
            })
            .unwrap();
        let now = Instant::now();
        let (scene, id) = body_scene_in_cell(
            &collision,
            cell,
            Vector3::new(120.0, 96.0, 0.005),
            Some(cell),
            now,
        );
        let target =
            downward_target_in_cell(&collision, Vector3::new(114.0, 96.0, 0.0), Some(cell));
        let flight = selected_flight(
            &scene,
            &collision,
            id,
            &target,
            JumpExtent::MAXIMUM,
            160,
            now,
        );
        assert!(
            matches!(flight.outcome,PreciseJumpFlightOutcome::Landed {matches_target:true,committed_cell:Some(landed),..} if landed==cell)
        );
        assert!(
            flight
                .segments
                .iter()
                .all(|segment| segment.committed_cell == Some(cell))
        );
        let body = scene.body(id).unwrap();
        let physical = body.physical.as_ref().unwrap();
        let selected = super::super::precise_jump::resolve_selected_precise_jump(
            PRECISE_JUMP_FIXED_TICK,
            &capabilities(),
            physical.definition,
            0.0,
            PreciseJumpWorldDisplacement::new(
                desired_landing_body_point(
                    body,
                    target.view(),
                    physical.definition.spheres().primary(),
                ) - body.pose.coords,
            )
            .unwrap(),
            JumpExtent::MAXIMUM,
        )
        .unwrap();
        let curve = selected_jump_curve(
            body,
            &collision,
            OWNER,
            selected.desired_velocity().unwrap(),
            selected.candidate().flight_duration_seconds(),
        )
        .unwrap();
        assert_eq!(
            curve.placements(),
            &[PreciseJumpTrajectoryPlacement {
                start_fraction: 0.0,
                end_fraction: 1.0,
                committed_cell: Some(cell)
            }]
        );
    }

    #[test]
    fn missing_collision_coverage_keeps_an_explicit_incomplete_endpoint() {
        let collision = collision_scene(0.0, Vec::new());
        let now = Instant::now();
        let (scene, id) = body_scene(&collision, Vector3::new(0.1, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(4.0, 96.0, 0.0));
        let flight = selected_flight(
            &scene,
            &collision,
            id,
            &target,
            JumpExtent::MAXIMUM,
            160,
            now,
        );
        assert!(matches!(
            flight.outcome,
            PreciseJumpFlightOutcome::Incomplete(
                PreciseJumpPredictionIncompleteReason::CollisionUnavailable { .. }
            )
        ));
    }

    fn capabilities() -> SelfJumpCapabilities {
        SelfJumpCapabilities {
            run_rate_scalar: 1.0,
            full_extent_jump_height: 4.2125,
            burden: 0.0,
        }
    }
    fn flat_terrain(owner: Guid, height: f32) -> TerrainCollisionSurface {
        TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![height; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(owner.0),
        })
        .unwrap()
    }
    fn collision_scene(terrain_height: f32, colliders: Vec<PlacedCollider>) -> CollisionScene {
        let mut collision = CollisionScene::new();
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: OWNER.0,
                terrain: flat_terrain(OWNER, terrain_height),
                static_geometry: LandblockColliders::new(colliders, Vec::new()),
            })
            .unwrap();
        collision
    }
    fn polygon_collider(
        vertices: Vec<Vector3>,
        normal: Vector3,
        source_index: usize,
    ) -> PlacedCollider {
        let center = vertices
            .iter()
            .copied()
            .fold(Vector3::zero(), |sum, vertex| sum + vertex)
            / vertices.len() as f32;
        let radius = vertices
            .iter()
            .map(|vertex| vertex.distance(&center))
            .fold(0.0_f32, f32::max);
        let bounds = Sphere { center, radius };
        PlacedCollider::new(
            Arc::new(CollisionShape::Bsp(BspSolid {
                bsp: BspNode::Leaf(BspLeaf {
                    index: 0,
                    solid: 0,
                    sphere: Some(bounds),
                    poly_ids: vec![1],
                }),
                bounds,
                box_bounds: CollisionBox::from_points(vertices.iter().copied()).unwrap(),
                polygons: HashMap::from([(
                    1,
                    CollisionPolygon {
                        d: -normal.dot(&vertices[0]),
                        vertices,
                        normal,
                    },
                )]),
            })),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index },
        )
        .unwrap()
    }
    fn body_scene(
        collision: &CollisionScene,
        coords: Vector3,
        now: Instant,
    ) -> (SpatialScene, SpatialBodyId) {
        body_scene_in_cell(collision, OWNER, coords, None, now)
    }
    fn body_scene_in_cell(
        collision: &CollisionScene,
        pose_landblock_id: Guid,
        coords: Vector3,
        cell: Option<Guid>,
        now: Instant,
    ) -> (SpatialScene, SpatialBodyId) {
        let profile = retail_player_grounded_profile(EdgeProtection::None).unwrap();
        let mut scene = SpatialScene::new();
        let pose = WorldPosition {
            landblock_id: pose_landblock_id,
            coords,
            rotation: Quaternion::from_heading(0.0),
        };
        let body_id = scene.allocate_ephemeral_body_id();
        let mut body = SpatialBody::new_ephemeral(body_id, pose, now);
        body.contact = ContactState::Grounded;
        body.physical = Some(PhysicalBodyState::new(
            profile.definition,
            PhysicalCollisionFilter::ALL,
            profile.response_policy,
            cell,
        ));
        let PhysicalBodyResponseState::Grounded { ground, .. } =
            &mut body.physical.as_mut().unwrap().response
        else {
            panic!("player profile must retain grounded response")
        };
        *ground = GroundState::Supported(GroundSupport {
            feature: holtburger_world::SupportFeature::Surface,
            normal: Vector3::new(0.0, 0.0, 1.0),
            source: holtburger_world::SupportSource::World(collision.owner_proof(OWNER).unwrap()),
        });
        scene.register_body(body);
        (scene, body_id)
    }
    fn dynamic_body_scene(
        collision: &CollisionScene,
        coords: Vector3,
        now: Instant,
    ) -> (SpatialScene, SpatialBodyId) {
        let profile = retail_player_grounded_profile(EdgeProtection::None).unwrap();
        let mut scene = SpatialScene::new();
        let body_id = scene.allocate_ephemeral_body_id();
        scene.register_body(SpatialBody::new_ephemeral(
            body_id,
            WorldPosition {
                landblock_id: OWNER,
                coords,
                rotation: Quaternion::from_heading(0.0),
            },
            now,
        ));
        let configuration = DynamicPhysicalBodyConfiguration::new(
            DynamicPhysicalBodyDefinition {
                movement: profile.definition,
                response_policy: profile.response_policy,
                entity_collision: DynamicBodyCollisionDefinition {
                    player_collision: None,
                    contact_response: holtburger_world::EntityContactResponse::Character(
                        holtburger_world::EntityIntegrationEligibility::Eligible,
                    ),
                    target_geometry: Arc::new(PreparedEntityTargetGeometry {
                        setup_radius: 0.5,
                        setup_height: 1.0,
                        collision_animations: Default::default(),
                        physics_bsp_parts: Vec::new(),
                        fallback_setup_did: 0x0200_0000,
                        fallback_shapes: Vec::new(),
                        fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                    }),
                    dynamic_collision: EntityDynamicCollisionPolicy {
                        is_static: false,
                        target: EntityCollisionParticipation::Suppressed,
                        mover_accepts_response: true,
                        accepts_peer_reports: true,
                        missile: false,
                        path_clipped: false,
                    },
                    reporting: EntityCollisionReportPolicy {
                        enabled: false,
                        as_environment: false,
                    },
                    uses_physics_bsp: false,
                    elasticity: PhysicalElasticity::DEFAULT,
                    default_animation_available: false,
                    default_script_available: false,
                },
            },
            LocalPhysicalDemand {
                target: LocalTargetDemand::Absent,
                integration: LocalIntegrationDemand::Eligible,
            },
        )
        .unwrap();
        scene
            .set_dynamic_physical_body(
                body_id,
                Some(configuration),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        for tick in 1..=3 {
            scene
                .tick_physical_body(
                    body_id,
                    collision,
                    holtburger_world::PhysicalBodyInput::autonomous(
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                    ),
                    PRECISE_JUMP_FIXED_TICK.as_secs_f32(),
                    now + PRECISE_JUMP_FIXED_TICK * tick,
                )
                .unwrap();
            if scene.body(body_id).unwrap().contact == ContactState::Grounded {
                break;
            }
        }
        assert_eq!(scene.body(body_id).unwrap().contact, ContactState::Grounded);
        (scene, body_id)
    }
    fn downward_target(collision: &CollisionScene, point: Vector3) -> PreciseJumpTarget {
        downward_target_in_cell(collision, point, None)
    }
    fn downward_target_in_cell(
        collision: &CollisionScene,
        point: Vector3,
        previous_cell: Option<Guid>,
    ) -> PreciseJumpTarget {
        let hit = collision
            .cast_static_surface_ray(StaticSurfaceRayRequest {
                anchor: OWNER,
                start: Vector3::new(point.x, point.y, point.z + 5.0),
                direction: Vector3::new(0.0, 0.0, -1.0),
                maximum_distance: 10.0,
                previous_cell,
                filter: PhysicalCollisionFilter::ALL,
            })
            .unwrap()
            .unwrap();
        PreciseJumpTarget::new(OWNER, CollisionSurfaceRayHit::Environment(hit)).unwrap()
    }
}
