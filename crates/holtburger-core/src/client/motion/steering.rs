//! Core-owned local steering over the shared `MotionOrder` directed-motion reducer.
//!
//! Runs identically under both `Physical` (3D swept collision) and `Navigation` (position-only)
//! movement compositions without bypassing physics or maintaining a frontend-side steering loop.

use std::time::{Duration, Instant};

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{PropertyFloat, WorldObjectPropertyAccessors};
use holtburger_world::WorldState;
use holtburger_world::context::WorldContextExt as _;
use holtburger_world::motion::{
    DirectedMotionSupport, DirectedMotionTravel, MotionCommand, MotionOrder,
    ServerDirectedMotionResolution, ServerDirectedMotionState, ServerDirectedTarget,
    begin_local_move_to_object, begin_local_move_to_position, begin_local_turn_to_heading,
    begin_local_turn_to_object, resolve_server_directed_motion,
};
use serde::{Deserialize, Serialize};

use crate::client::control::ControlSource;
use crate::client::movement_types::{CharacterDrive, Gait, LongitudinalMotion, Turn};

/// Default arrival radius when approaching a point or an entity without an authored use radius.
pub const DEFAULT_STEERING_ARRIVAL_DISTANCE_M: f32 = 1.0;
/// Default follow distance when none is explicitly provided.
pub const DEFAULT_FOLLOW_DISTANCE_M: f32 = 2.0;
/// Extra distance before a settled `Follow` re-arms movement, preventing oscillation.
const FOLLOW_REARM_HYSTERESIS_M: f32 = 0.75;
/// Maximum planar/3D target distance admitted for local steering.
pub const MAX_STEERING_TARGET_DISTANCE_M: f32 = 384.0;
/// Minimum reduction in remaining distance counted as forward progress for stuck detection.
const STUCK_PROGRESS_EPSILON_M: f32 = 0.15;
/// Minimum heading change (radians, ~1.15 deg) counted as angular progress while turning in place.
const STUCK_TURN_PROGRESS_EPSILON_RAD: f32 = 0.02;
/// Default stuck window for `MoveTo` and `Approach` goals.
pub const DEFAULT_STUCK_TIMEOUT_MS: u32 = 2_000;

fn heading_delta_rad(a: f32, b: f32) -> f32 {
    let diff = (a - b).rem_euclid(std::f32::consts::TAU);
    diff.min(std::f32::consts::TAU - diff)
}

fn default_arrival_distance() -> f32 {
    DEFAULT_STEERING_ARRIVAL_DISTANCE_M
}

fn default_follow_distance() -> f32 {
    DEFAULT_FOLLOW_DISTANCE_M
}

fn default_run_gait() -> Gait {
    Gait::Run
}

fn default_stuck_timeout_ms() -> u32 {
    DEFAULT_STUCK_TIMEOUT_MS
}

/// High-level local steering goal executed through `MovementSystem`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LocalSteeringGoal {
    /// Steer toward a fixed world position and stop within `arrival_distance`.
    #[serde(rename_all = "camelCase")]
    MoveTo {
        destination: WorldPosition,
        #[serde(default = "default_arrival_distance")]
        arrival_distance: f32,
        #[serde(default = "default_run_gait")]
        gait: Gait,
        #[serde(default)]
        final_heading: Option<f32>,
    },
    /// Steer toward a live entity and stop within `arrival_distance` (defaults to entity use radius or 1m).
    #[serde(rename_all = "camelCase")]
    Approach {
        target: Guid,
        #[serde(default)]
        arrival_distance: Option<f32>,
        #[serde(default = "default_run_gait")]
        gait: Gait,
    },
    /// Continuously follow a live entity within `follow_distance` until cancelled or lost.
    #[serde(rename_all = "camelCase")]
    Follow {
        target: Guid,
        #[serde(default = "default_follow_distance")]
        follow_distance: f32,
        #[serde(default = "default_run_gait")]
        gait: Gait,
    },
    /// Turn in place to face an absolute AC heading (radians).
    #[serde(rename_all = "camelCase")]
    FaceHeading { heading: f32 },
    /// Turn in place to face a live entity.
    #[serde(rename_all = "camelCase")]
    FaceEntity { target: Guid },
}

impl LocalSteeringGoal {
    /// Validates finite numeric inputs and non-null entity targets before admission.
    pub fn validate(&self) -> Result<(), &'static str> {
        match *self {
            Self::MoveTo {
                destination,
                arrival_distance,
                final_heading,
                ..
            } => {
                if !destination.coords.x.is_finite()
                    || !destination.coords.y.is_finite()
                    || !destination.coords.z.is_finite()
                {
                    return Err("MoveTo destination coordinates must be finite");
                }
                if !arrival_distance.is_finite() || arrival_distance < 0.0 {
                    return Err("MoveTo arrivalDistance must be finite and non-negative");
                }
                if final_heading.is_some_and(|heading| !heading.is_finite()) {
                    return Err("MoveTo finalHeading must be finite");
                }
            }
            Self::Approach {
                target,
                arrival_distance,
                ..
            } => {
                if target.is_null() {
                    return Err("Approach target GUID must be non-null");
                }
                if arrival_distance.is_some_and(|d| !d.is_finite() || d < 0.0) {
                    return Err("Approach arrivalDistance must be finite and non-negative");
                }
            }
            Self::Follow {
                target,
                follow_distance,
                ..
            } => {
                if target.is_null() {
                    return Err("Follow target GUID must be non-null");
                }
                if !follow_distance.is_finite() || follow_distance < 0.0 {
                    return Err("Follow followDistance must be finite and non-negative");
                }
            }
            Self::FaceHeading { heading } => {
                if !heading.is_finite() {
                    return Err("FaceHeading heading must be finite");
                }
            }
            Self::FaceEntity { target } => {
                if target.is_null() {
                    return Err("FaceEntity target GUID must be non-null");
                }
            }
        }
        Ok(())
    }

    pub const fn target_guid(&self) -> Option<Guid> {
        match *self {
            Self::Approach { target, .. }
            | Self::Follow { target, .. }
            | Self::FaceEntity { target } => Some(target),
            Self::MoveTo { .. } | Self::FaceHeading { .. } => None,
        }
    }
}

/// Steering submission with stuck-detection and optional overall duration bounds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct LocalSteeringRequest {
    pub goal: LocalSteeringGoal,
    /// Fail with `Stuck` if distance fails to decrease by >= 0.15m within this window.
    #[serde(default = "default_stuck_timeout_ms")]
    pub stuck_timeout_ms: u32,
    /// Optional overall safety timeout in milliseconds.
    #[serde(default)]
    pub max_duration_ms: Option<u32>,
}

/// Terminal outcome emitted once when a local steering operation ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum LocalNavigationOutcome {
    Arrived,
    Stuck,
    TargetLost,
    TimedOut,
    Cancelled,
    Superseded,
    InterruptedByUser,
    InterruptedByServer,
    Teleported,
}

/// Event payload published when local steering concludes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct LocalNavigationFinished {
    pub correlation_id: u64,
    pub outcome: LocalNavigationOutcome,
}

/// Read-only snapshot of the currently active local steering operation.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct LocalSteeringStatus {
    pub correlation_id: u64,
    pub origin: ControlSource,
    pub goal: LocalSteeringGoal,
    /// True when `Follow` is currently settled within range and awaiting target movement.
    pub settled: bool,
    /// Current distance to the goal when measurable.
    pub remaining_distance: Option<f32>,
}

/// Outcome of advancing one tick of `LocalSteeringRuntime`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::client) enum LocalSteeringTick {
    /// Steering remains active; apply `order` locally and publish `wire_drive` to ACE.
    Active {
        order: MotionOrder,
        wire_drive: Option<CharacterDrive>,
        travel: Option<DirectedMotionTravel>,
    },
    /// `Follow` is settled in range; remain stationary without terminating the goal.
    Settled { order: MotionOrder },
    /// Goal terminated cleanly or failed.
    Finished(LocalNavigationOutcome),
}

/// Active local steering state stored inside `MovementSystem`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::client) struct LocalSteeringRuntime {
    pub correlation_id: u64,
    pub origin: ControlSource,
    pub goal: LocalSteeringGoal,
    /// Active directed reducer state; `None` while `Follow` is settled in range.
    directed: Option<ServerDirectedMotionState>,
    /// Current travel vector for `Navigation`-policy authored-offset integration.
    pub travel: Option<DirectedMotionTravel>,
    started_at: Instant,
    stuck_timeout: Duration,
    max_duration: Option<Duration>,
    best_distance: Option<f32>,
    last_heading: Option<f32>,
    last_progress_at: Instant,
    last_distance: Option<f32>,
}

impl LocalSteeringRuntime {
    /// Validates goal bounds and target availability synchronously against the live world.
    pub(in crate::client) fn validate_against_world(
        request: LocalSteeringRequest,
        world: &WorldState,
    ) -> Result<WorldPosition, &'static str> {
        request.goal.validate()?;
        let current_pose = world
            .local_player_runtime_pose()
            .ok_or("local player pose is unavailable")?;
        if let Some(target) = request.goal.target_guid()
            && world
                .server_directed_target(world.player.guid, target)
                .is_none()
        {
            return Err("target entity is unavailable for steering");
        }
        let initial_distance = Self::measure_distance(request.goal, current_pose, world);
        if initial_distance.is_some_and(|d| d > MAX_STEERING_TARGET_DISTANCE_M) {
            return Err("steering target exceeds maximum 384m range");
        }
        Ok(current_pose)
    }

    /// Initializes a validated local steering runtime against the current authoritative world.
    pub(in crate::client) fn start(
        correlation_id: u64,
        origin: ControlSource,
        request: LocalSteeringRequest,
        now: Instant,
        world: &WorldState,
    ) -> Result<Self, &'static str> {
        let current_pose = Self::validate_against_world(request, world)?;
        let run_rate = world.player_run_rate().unwrap_or(1.0).max(0.1);

        let directed = Self::build_directed_state(request.goal, current_pose, run_rate, world)?;
        let initial_distance = Self::measure_distance(request.goal, current_pose, world);
        let stuck_timeout = Duration::from_millis(u64::from(request.stuck_timeout_ms.max(250)));
        let max_duration = request
            .max_duration_ms
            .filter(|&ms| ms > 0)
            .map(|ms| Duration::from_millis(u64::from(ms)));

        Ok(Self {
            correlation_id,
            origin,
            goal: request.goal,
            directed: Some(directed),
            travel: None,
            started_at: now,
            stuck_timeout,
            max_duration,
            best_distance: initial_distance,
            last_heading: Some(current_pose.rotation.to_heading()),
            last_progress_at: now,
            last_distance: initial_distance,
        })
    }

    pub(in crate::client) fn status(&self) -> LocalSteeringStatus {
        LocalSteeringStatus {
            correlation_id: self.correlation_id,
            origin: self.origin,
            goal: self.goal,
            settled: self.directed.is_none(),
            remaining_distance: self.last_distance,
        }
    }

    pub(in crate::client) fn finish_event(&self, outcome: LocalNavigationOutcome) -> LocalNavigationFinished {
        LocalNavigationFinished {
            correlation_id: self.correlation_id,
            outcome,
        }
    }

    fn resolved_arrival_distance(goal: LocalSteeringGoal, world: &WorldState) -> f32 {
        match goal {
            LocalSteeringGoal::MoveTo {
                arrival_distance, ..
            } => arrival_distance,
            LocalSteeringGoal::Approach {
                target,
                arrival_distance,
                ..
            } => arrival_distance.unwrap_or_else(|| {
                world
                    .entities
                    .get(target)
                    .and_then(|entity| entity.get_float_prop(PropertyFloat::UseRadius))
                    .map(|radius| (radius as f32).clamp(0.5, 6.0))
                    .unwrap_or(DEFAULT_STEERING_ARRIVAL_DISTANCE_M)
            }),
            LocalSteeringGoal::Follow {
                follow_distance, ..
            } => follow_distance,
            LocalSteeringGoal::FaceHeading { .. } | LocalSteeringGoal::FaceEntity { .. } => 0.0,
        }
    }

    fn build_directed_state(
        goal: LocalSteeringGoal,
        current_pose: WorldPosition,
        run_rate: f32,
        world: &WorldState,
    ) -> Result<ServerDirectedMotionState, &'static str> {
        let arrival = Self::resolved_arrival_distance(goal, world);
        match goal {
            LocalSteeringGoal::MoveTo {
                destination,
                gait,
                final_heading,
                ..
            } => begin_local_move_to_position(
                current_pose,
                destination,
                arrival,
                run_rate,
                matches!(gait, Gait::Run),
                final_heading,
            )
            .ok_or("invalid MoveTo steering parameters"),
            LocalSteeringGoal::Approach { target, gait, .. }
            | LocalSteeringGoal::Follow { target, gait, .. } => {
                if world.entities.get(target).is_none() {
                    return Err("target entity does not exist");
                }
                begin_local_move_to_object(
                    current_pose,
                    target,
                    arrival,
                    run_rate,
                    matches!(gait, Gait::Run),
                    false,
                )
                .ok_or("invalid object steering parameters")
            }
            LocalSteeringGoal::FaceHeading { heading } => {
                begin_local_turn_to_heading(heading).ok_or("invalid FaceHeading parameters")
            }
            LocalSteeringGoal::FaceEntity { target } => {
                if world.entities.get(target).is_none() {
                    return Err("target entity does not exist");
                }
                begin_local_turn_to_object(target).ok_or("invalid FaceEntity parameters")
            }
        }
    }

    fn measure_distance(
        goal: LocalSteeringGoal,
        current_pose: WorldPosition,
        world: &WorldState,
    ) -> Option<f32> {
        match goal {
            LocalSteeringGoal::MoveTo { destination, .. } => {
                Some(current_pose.distance_to(&destination))
            }
            LocalSteeringGoal::Approach { target, .. }
            | LocalSteeringGoal::Follow { target, .. }
            | LocalSteeringGoal::FaceEntity { target } => world
                .server_directed_target(world.player.guid, target)
                .map(|resolved| current_pose.distance_to(&resolved.pose)),
            LocalSteeringGoal::FaceHeading { .. } => None,
        }
    }

    /// Evaluates one tick against authoritative poses and support state.
    pub(in crate::client) fn advance(
        &mut self,
        now: Instant,
        world: &WorldState,
        steady_order: MotionOrder,
        support: DirectedMotionSupport,
    ) -> LocalSteeringTick {
        if let Some(max_duration) = self.max_duration
            && now.duration_since(self.started_at) >= max_duration
        {
            return LocalSteeringTick::Finished(LocalNavigationOutcome::TimedOut);
        }

        let Some(current_pose) = world.local_player_runtime_pose() else {
            return LocalSteeringTick::Finished(LocalNavigationOutcome::TargetLost);
        };

        // Check entity presence and distance ceiling for entity-targeted goals.
        let object_target: Option<ServerDirectedTarget> = match self.goal.target_guid() {
            Some(target) => {
                let Some(resolved) = world.server_directed_target(world.player.guid, target) else {
                    return LocalSteeringTick::Finished(LocalNavigationOutcome::TargetLost);
                };
                if current_pose.distance_to(&resolved.pose) > MAX_STEERING_TARGET_DISTANCE_M {
                    return LocalSteeringTick::Finished(LocalNavigationOutcome::TargetLost);
                }
                Some(resolved)
            }
            None => None,
        };

        let distance = Self::measure_distance(self.goal, current_pose, world);
        self.last_distance = distance;

        // Handle settled `Follow` re-arming with hysteresis.
        if self.directed.is_none() {
            if let LocalSteeringGoal::Follow {
                follow_distance, ..
            } = self.goal
            {
                if distance.is_some_and(|d| d > follow_distance + FOLLOW_REARM_HYSTERESIS_M) {
                    let run_rate = world.player_run_rate().unwrap_or(1.0).max(0.1);
                    if let Ok(state) =
                        Self::build_directed_state(self.goal, current_pose, run_rate, world)
                    {
                        self.directed = Some(state);
                        self.best_distance = distance;
                        self.last_heading = Some(current_pose.rotation.to_heading());
                        self.last_progress_at = now;
                    } else {
                        return LocalSteeringTick::Finished(LocalNavigationOutcome::TargetLost);
                    }
                } else {
                    self.travel = None;
                    return LocalSteeringTick::Settled {
                        order: idle_order(steady_order, support),
                    };
                }
            } else {
                return LocalSteeringTick::Finished(LocalNavigationOutcome::Arrived);
            }
        }

        let Some(state) = self.directed else {
            return LocalSteeringTick::Finished(LocalNavigationOutcome::Arrived);
        };

        match resolve_server_directed_motion(
            state,
            steady_order,
            current_pose,
            support,
            object_target,
        ) {
            ServerDirectedMotionResolution::Active(step) => {
                // Phase-aware stuck detection: while turning in place (`step.travel == None`),
                // measure angular progress so 180° turnarounds don't trip the linear stuck timer;
                // once translating (`step.travel == Some`), measure remaining-distance progress.
                if matches!(
                    self.goal,
                    LocalSteeringGoal::MoveTo { .. }
                        | LocalSteeringGoal::Approach { .. }
                        | LocalSteeringGoal::Follow { .. }
                ) {
                    let heading = current_pose.rotation.to_heading();
                    if step.travel.is_some() {
                        if self.travel.is_none() {
                            self.best_distance = distance;
                            self.last_progress_at = now;
                        } else if let Some(dist) = distance {
                            let improved = self
                                .best_distance
                                .is_none_or(|best| best - dist >= STUCK_PROGRESS_EPSILON_M);
                            if improved {
                                self.best_distance = Some(dist);
                                self.last_progress_at = now;
                            } else if now.duration_since(self.last_progress_at) >= self.stuck_timeout
                            {
                                self.travel = None;
                                return LocalSteeringTick::Finished(LocalNavigationOutcome::Stuck);
                            }
                        }
                        self.last_heading = Some(heading);
                    } else if self.travel.is_some() {
                        // Entering FinalTurn from Moving gets a fresh angular stuck window.
                        self.last_heading = Some(heading);
                        self.last_progress_at = now;
                    } else {
                        let turned = self.last_heading.is_none_or(|prev| {
                            heading_delta_rad(prev, heading) >= STUCK_TURN_PROGRESS_EPSILON_RAD
                        });
                        if turned {
                            self.last_heading = Some(heading);
                            self.last_progress_at = now;
                        } else if now.duration_since(self.last_progress_at) >= self.stuck_timeout {
                            self.travel = None;
                            return LocalSteeringTick::Finished(LocalNavigationOutcome::Stuck);
                        }
                    }
                }

                self.directed = Some(step.state);
                self.travel = step.travel;
                let wire_drive = motion_order_to_wire_drive(step.order, self.goal_gait());
                LocalSteeringTick::Active {
                    order: step.order,
                    wire_drive,
                    travel: step.travel,
                }
            }
            ServerDirectedMotionResolution::Complete { .. } => {
                self.travel = None;
                if matches!(self.goal, LocalSteeringGoal::Follow { .. }) {
                    self.directed = None;
                    LocalSteeringTick::Settled {
                        order: idle_order(steady_order, support),
                    }
                } else {
                    LocalSteeringTick::Finished(LocalNavigationOutcome::Arrived)
                }
            }
            ServerDirectedMotionResolution::Failed(_) => {
                self.travel = None;
                LocalSteeringTick::Finished(LocalNavigationOutcome::TargetLost)
            }
        }
    }

    const fn goal_gait(&self) -> Gait {
        match self.goal {
            LocalSteeringGoal::MoveTo { gait, .. }
            | LocalSteeringGoal::Approach { gait, .. }
            | LocalSteeringGoal::Follow { gait, .. } => gait,
            LocalSteeringGoal::FaceHeading { .. } | LocalSteeringGoal::FaceEntity { .. } => {
                Gait::Walk
            }
        }
    }
}

fn idle_order(steady_order: MotionOrder, support: DirectedMotionSupport) -> MotionOrder {
    MotionOrder {
        style: steady_order.style,
        ..MotionOrder::default()
    }
    .with_character_presentation(support.presentation())
}

/// Projects a resolved `MotionOrder` into an equivalent wire `CharacterDrive` for `MoveToState`.
pub(in crate::client) fn motion_order_to_wire_drive(
    order: MotionOrder,
    fallback_gait: Gait,
) -> Option<CharacterDrive> {
    let (gait, longitudinal) = match order.forward {
        Some((MotionCommand::RUN_FORWARD, speed)) if speed >= 0.0 => {
            (Gait::Run, Some(LongitudinalMotion::Forward))
        }
        Some((MotionCommand::WALK_FORWARD, speed)) if speed < 0.0 => {
            (Gait::Walk, Some(LongitudinalMotion::Backward))
        }
        Some((MotionCommand::WALK_BACKWARDS, _)) => {
            (Gait::Walk, Some(LongitudinalMotion::Backward))
        }
        Some((MotionCommand::WALK_FORWARD, _)) => (Gait::Walk, Some(LongitudinalMotion::Forward)),
        _ => (fallback_gait, None),
    };
    let turning = match order.turn {
        Some((MotionCommand::TURN_RIGHT, speed)) => Some(if speed >= 0.0 {
            Turn::Right
        } else {
            Turn::Left
        }),
        Some((MotionCommand::TURN_LEFT, speed)) => Some(if speed >= 0.0 {
            Turn::Left
        } else {
            Turn::Right
        }),
        _ => None,
    };
    if longitudinal.is_none() && turning.is_none() {
        return None;
    }
    Some(CharacterDrive {
        gait,
        longitudinal,
        lateral: None,
        turning,
        turn_rate_scalar: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_world::entity::Entity;
    use holtburger_world::motion::MotionContact;
    use holtburger_world::spatial::ContactState;

    fn world_with_player_and_target(player_x: f32, target_x: f32) -> (WorldState, Guid) {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let target_guid = Guid(0x7000_0002);
        let player = Entity::new(
            player_guid,
            "Player".into(),
            WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(player_x, 0.0, 0.0),
                rotation: Quaternion::from_heading(std::f32::consts::FRAC_PI_2),
            },
        );
        world.player.guid = player_guid;
        world.add_entity(player);

        let target = Entity::new(
            target_guid,
            "Target".into(),
            WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(target_x, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        world.add_entity(target);
        (world, target_guid)
    }

    #[test]
    fn move_to_arrives_and_detects_stuck_under_physical_and_navigation_support() {
        let (mut world, _target) = world_with_player_and_target(0.0, 20.0);
        let now = Instant::now();
        let req = LocalSteeringRequest {
            goal: LocalSteeringGoal::MoveTo {
                destination: WorldPosition {
                    landblock_id: Guid(0x0101_0001),
                    coords: Vector3::new(10.0, 0.0, 0.0),
                    rotation: Quaternion::identity(),
                },
                arrival_distance: 1.0,
                gait: Gait::Run,
                final_heading: None,
            },
            stuck_timeout_ms: 500,
            max_duration_ms: None,
        };

        for support in [
            DirectedMotionSupport::Physical(MotionContact::RequiresSupport(ContactState::Grounded)),
            DirectedMotionSupport::PositionOnly,
        ] {
            let mut runtime =
                LocalSteeringRuntime::start(1, ControlSource::Automation, req, now, &world)
                    .unwrap();
            let step = runtime.advance(now, &world, MotionOrder::default(), support);
            assert!(matches!(step, LocalSteeringTick::Active { .. }));

            // Without pose progress past stuck_timeout_ms, reports Stuck.
            let stuck = runtime.advance(
                now + Duration::from_millis(600),
                &world,
                MotionOrder::default(),
                support,
            );
            assert_eq!(stuck, LocalSteeringTick::Finished(LocalNavigationOutcome::Stuck));

            // Fresh runtime that moves within arrival_distance reports Arrived.
            let mut arriving =
                LocalSteeringRuntime::start(2, ControlSource::Automation, req, now, &world)
                    .unwrap();
            let _ = world.set_local_player_runtime_pose(WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(9.5, 0.0, 0.0),
                rotation: Quaternion::from_heading(std::f32::consts::FRAC_PI_2),
            });
            let done = arriving.advance(
                now + Duration::from_millis(100),
                &world,
                MotionOrder::default(),
                support,
            );
            assert_eq!(done, LocalSteeringTick::Finished(LocalNavigationOutcome::Arrived));
            // Reset player pose for next support loop iteration.
            let _ = world.set_local_player_runtime_pose(WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(0.0, 0.0, 0.0),
                rotation: Quaternion::from_heading(std::f32::consts::FRAC_PI_2),
            });
        }
    }

    #[test]
    fn follow_settles_in_range_rearms_and_fails_on_target_despawn() {
        let (mut world, target) = world_with_player_and_target(0.0, 1.0);
        let now = Instant::now();
        let req = LocalSteeringRequest {
            goal: LocalSteeringGoal::Follow {
                target,
                follow_distance: 2.0,
                gait: Gait::Run,
            },
            stuck_timeout_ms: 1_000,
            max_duration_ms: None,
        };
        let mut runtime =
            LocalSteeringRuntime::start(7, ControlSource::Automation, req, now, &world).unwrap();

        // Already within follow_distance -> settles rather than finishing.
        let settled = runtime.advance(
            now,
            &world,
            MotionOrder::default(),
            DirectedMotionSupport::PositionOnly,
        );
        assert!(matches!(settled, LocalSteeringTick::Settled { .. }));
        assert!(runtime.status().settled);

        // Target moves far away -> re-arms Active steering.
        world.entities.get_mut(target).unwrap().position = WorldPosition {
            landblock_id: Guid(0x0101_0001),
            coords: Vector3::new(15.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let rearmed = runtime.advance(
            now + Duration::from_millis(100),
            &world,
            MotionOrder::default(),
            DirectedMotionSupport::PositionOnly,
        );
        assert!(matches!(rearmed, LocalSteeringTick::Active { .. }));
        assert!(!runtime.status().settled);

        // Despawn target -> TargetLost.
        world.remove_entity(target);
        let lost = runtime.advance(
            now + Duration::from_millis(200),
            &world,
            MotionOrder::default(),
            DirectedMotionSupport::PositionOnly,
        );
        assert_eq!(
            lost,
            LocalSteeringTick::Finished(LocalNavigationOutcome::TargetLost)
        );
    }

    #[test]
    fn turn_in_place_progress_does_not_trip_linear_stuck_timer() {
        let (mut world, _target) = world_with_player_and_target(0.0, 20.0);
        // Face West (0 rad) while moving East (PI rad): forces a full 180-degree InitialTurn.
        let _ = world.set_local_player_runtime_pose(WorldPosition {
            landblock_id: Guid(0x0101_0001),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        });
        let now = Instant::now();
        let req = LocalSteeringRequest {
            goal: LocalSteeringGoal::MoveTo {
                destination: WorldPosition {
                    landblock_id: Guid(0x0101_0001),
                    coords: Vector3::new(10.0, 0.0, 0.0),
                    rotation: Quaternion::identity(),
                },
                arrival_distance: 1.0,
                gait: Gait::Run,
                final_heading: None,
            },
            stuck_timeout_ms: 500,
            max_duration_ms: None,
        };
        let mut runtime =
            LocalSteeringRuntime::start(9, ControlSource::Automation, req, now, &world).unwrap();

        // Advance past stuck_timeout_ms (900ms > 500ms) while turning in place with no translation.
        for step_idx in 1..=6 {
            let heading = (step_idx as f32) * 0.45;
            let _ = world.set_local_player_runtime_pose(WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(0.0, 0.0, 0.0),
                rotation: Quaternion::from_heading(heading),
            });
            let tick = runtime.advance(
                now + Duration::from_millis(step_idx * 150),
                &world,
                MotionOrder::default(),
                DirectedMotionSupport::PositionOnly,
            );
            assert!(
                matches!(tick, LocalSteeringTick::Active { .. }),
                "turn progress at step {step_idx} should stay Active, got {tick:?}"
            );
        }

        // Once facing East (PI rad), translation begins and gets a fresh stuck window.
        let _ = world.set_local_player_runtime_pose(WorldPosition {
            landblock_id: Guid(0x0101_0001),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::from_heading(std::f32::consts::PI),
        });
        let translating = runtime.advance(
            now + Duration::from_millis(1_050),
            &world,
            MotionOrder::default(),
            DirectedMotionSupport::PositionOnly,
        );
        assert!(matches!(
            translating,
            LocalSteeringTick::Active {
                travel: Some(_),
                ..
            }
        ));

        // Staying blocked past stuck_timeout_ms during translation still reports Stuck.
        let stuck = runtime.advance(
            now + Duration::from_millis(1_600),
            &world,
            MotionOrder::default(),
            DirectedMotionSupport::PositionOnly,
        );
        assert_eq!(
            stuck,
            LocalSteeringTick::Finished(LocalNavigationOutcome::Stuck)
        );
    }
}
