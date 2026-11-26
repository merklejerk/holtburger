//! Camera-free targeted jump solver and settlement contracts shared by automation and clients.

use std::num::NonZeroU32;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_world::state::SelfJumpCapabilities;
use holtburger_world::{
    CollisionScene, ContactState, EntityCollisionSnapshot, PhysicalBodyDefinition, SpatialBody,
};
use serde::{Deserialize, Serialize};

use crate::client::character_jump::RETAIL_DOUBLE_GRAVITY;
use crate::client::character_kinematics::retail_jump_kinematics;
use crate::client::character_motion::JumpExtent;
use crate::client::control::ControlSource;
use crate::client::precise_jump::{PreciseJumpWorldDisplacement, resolve_selected_precise_jump};
use crate::client::precise_jump_prediction::{
    PRECISE_JUMP_FIXED_TICK, PreciseJumpFlightOutcome, PreciseJumpFlightRequest,
    PreciseJumpPredictionControl, PreciseJumpPredictionError,
    PreciseJumpPredictionIncompleteReason, PreciseJumpTarget, PreciseJumpTargetView,
    desired_landing_body_point, owner_for_position, point_between_anchors,
    predict_selected_precise_jump,
};
use crate::client::precise_jump_runtime::{
    PreciseJumpActionSequence, PreciseJumpTransactionFeedback, PreciseJumpTransactionOutcome,
    PreciseJumpTransactionRejection, PreparedPreciseJumpCommit,
};

/// Maximum fixed physics ticks evaluated per candidate rollout (matches interactive precise jump).
pub const TARGETED_JUMP_MAXIMUM_TICKS: u32 = 160;

/// Safety horizon for an in-flight targeted jump before emitting `TimedOut`.
const TARGETED_JUMP_AIRBORNE_DEADLINE: Duration = Duration::from_secs(10);

/// Small margin above minimum analytic extent to avoid f32 apex roundoff clipping a ledge lip.
const AUTO_POWER_SAFETY_MARGIN: f32 = 0.02;

/// Minimum extent separation between distinct candidates in the ascending auto-power ladder.
const AUTO_POWER_DEDUP_EPSILON: f32 = 0.005;

/// Camera-free, pre-validated target specification for previewing or executing a targeted jump.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TargetedJumpTarget {
    position: WorldPosition,
    /// Unit surface normal when caller-supplied; defaults to `(0, 0, 1)` when `None`.
    normal: Option<Vector3>,
}

impl TargetedJumpTarget {
    /// Validates target position and optional surface normal once at the owning core boundary.
    pub fn new(position: WorldPosition, normal: Option<Vector3>) -> Result<Self, &'static str> {
        if position.landblock_id.is_null() {
            return Err("jump-to `target` requires a non-zero landblockId");
        }
        if !position.coords.x.is_finite()
            || !position.coords.y.is_finite()
            || !position.coords.z.is_finite()
        {
            return Err("jump-to `target` coordinates must be finite");
        }
        let normal = match normal {
            Some(n) => {
                if !n.x.is_finite() || !n.y.is_finite() || !n.z.is_finite() {
                    return Err("jump-to `normal` components must be finite");
                }
                let length = n.length();
                if !length.is_finite() || length <= 1e-5 {
                    return Err("jump-to `normal` must be non-zero");
                }
                Some(n * (1.0 / length))
            }
            None => None,
        };
        Ok(Self { position, normal })
    }

    pub const fn position(&self) -> WorldPosition {
        self.position
    }

    pub const fn normal(&self) -> Option<Vector3> {
        self.normal
    }

    /// Projects this already-validated target into the normalized collision anchor frame.
    pub(in crate::client) fn into_view(self) -> PreciseJumpTargetView {
        let anchor = owner_for_position(self.position.landblock_id);
        let committed_cell = ((self.position.landblock_id.0 & 0xffff) >= 0x0100)
            .then_some(self.position.landblock_id);
        PreciseJumpTargetView {
            anchor,
            point: self.position.coords,
            normal: self.normal.unwrap_or(Vector3::new(0.0, 0.0, 1.0)),
            committed_cell,
        }
    }
}

/// Request admitted by `ClientCommand::JumpTo`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TargetedJumpRequest {
    pub target: TargetedJumpTarget,
    pub power: JumpExtent,
    /// Optional world-generation guard for commands preceded by an off-tick auto-solve.
    pub expected_world_generation: Option<u64>,
}

/// Immutable snapshot captured on the runtime loop for off-tick jump solving.
pub struct TargetedJumpSnapshot {
    pub world_generation: u64,
    pub body: SpatialBody,
    pub capabilities: SelfJumpCapabilities,
    pub collision_scene: Arc<CollisionScene>,
    pub entity_collision: Arc<EntityCollisionSnapshot>,
}

/// Structured reason why a targeted jump preview or auto-solve could not reach its target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum TargetedJumpUnreachableReason {
    Airborne,
    OutOfRange,
    InsufficientPower,
    Blocked,
    NonWalkableTarget,
    CollisionUnavailable,
    FlightHorizonExhausted,
    BodyUnavailable,
    InvalidTarget,
}

/// Outcome of camera-free jump solving (single explicit power or auto-power ladder).
#[derive(Debug, Clone, PartialEq)]
pub struct TargetedJumpSolution {
    /// `true` iff a collision-verified landing matched the requested target surface.
    pub reachable: bool,
    /// Selected or auto-solved power (`None` if validation/pre-flight failed before rollout).
    pub power: Option<JumpExtent>,
    /// Predicted landing surface position (best attempt when `reachable == false`).
    pub landed_position: Option<WorldPosition>,
    /// Maximum body Z altitude reached along the predicted trajectory (useful under low ceilings).
    pub apex_z: Option<f32>,
    /// Predicted flight duration in milliseconds for the selected/best rollout.
    pub flight_duration_ms: Option<u32>,
    /// Structured reason when `reachable == false`.
    pub reason: Option<TargetedJumpUnreachableReason>,
    /// Number of collision rollouts performed (`0` on pre-flight rejection, `1` for explicit power, `1..=6` for auto).
    pub attempts: u8,
}

/// Active targeted jump snapshot exposed on `SelfView` while a jump is queued or in-flight.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct TargetedJumpStatus {
    pub correlation_id: u64,
    pub target: WorldPosition,
    pub power: f32,
}

/// Terminal outcome of an admitted or pre-flight-rejected targeted jump command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum TargetedJumpOutcome {
    Landed,
    RejectedUnreachable,
    RejectedAirborne,
    RejectedUnsupported,
    RejectedOverburdened,
    RejectedLaunch,
    InterruptedByUser,
    Cancelled,
    Superseded,
    Teleported,
    TimedOut,
}

/// Terminal outcome emitted on `jump-finished` (for admitted jumps) or returned inline on
/// pre-flight rejections (`correlation_id: None`, no event emitted).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct TargetedJumpFinished {
    /// Core-minted correlation ID for admitted jumps (`None` for pre-flight rejections).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<u64>,
    pub origin: ControlSource,
    pub outcome: TargetedJumpOutcome,
    /// Power actually committed (`None` if rejected before takeoff).
    pub power: Option<f32>,
    /// Actual player position when the jump settled or was rejected.
    pub position: Option<WorldPosition>,
    /// Diagnostic predicted first-impact landing point when `outcome == RejectedUnreachable`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predicted_landing: Option<WorldPosition>,
    /// Whether touchdown was within support-sphere tolerance of the requested target.
    pub matched_target: bool,
    /// Structured reachability reason when `outcome == RejectedUnreachable`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unreachable_reason: Option<TargetedJumpUnreachableReason>,
}

/// Converts a landing contact point in `flight_anchor` coordinates back to a canonical `WorldPosition`.
pub(in crate::client) fn world_position_from_landing(
    flight_anchor: Guid,
    contact_point: Vector3,
    committed_cell: Option<Guid>,
) -> WorldPosition {
    if let Some(cell) = committed_cell {
        let cell_anchor = owner_for_position(cell);
        let cell_coords = point_between_anchors(contact_point, flight_anchor, cell_anchor);
        return WorldPosition {
            landblock_id: cell,
            coords: cell_coords,
            rotation: Quaternion::identity(),
        };
    }
    let outdoor_frame = Guid((flight_anchor.0 & 0xffff_0000) | 1);
    let pos =
        WorldPosition::from_outdoor_frame(outdoor_frame, contact_point, Quaternion::identity());
    pos.normalize_outdoor_landblock_frame()
        .unwrap_or(pos)
        .normalize_outdoor_cell()
}

/// Computes the minimum unconstrained `JumpExtent` required to ballistically reach `delta`
/// at or below `max_run_speed` under discrete integration step `dt`.
///
/// Returns `None` if capabilities/gravity are invalid, or a raw extent that may exceed `1.0`
/// when the target is out of open-air ballistic range.
fn compute_minimum_analytic_extent(
    delta: Vector3,
    gravity: f32,
    dt: f32,
    max_run_speed: f32,
    full_extent_jump_height: f32,
) -> Option<f32> {
    if !gravity.is_finite()
        || gravity <= 0.0
        || !max_run_speed.is_finite()
        || max_run_speed <= 0.0
        || !full_extent_jump_height.is_finite()
        || full_extent_jump_height <= 0.0
    {
        return None;
    }
    let half_g_dt = 0.5 * gravity * dt;

    // Height floor: v_c^2 >= 2 * g * delta.z
    let v_c_height = if delta.z > 0.0 {
        (2.0 * gravity * delta.z).sqrt()
    } else {
        0.0
    };

    // Horizontal range floor: T_min = d_xy / max_run_speed, and
    // delta.z = v_c * T - 0.5 * g * T^2 => v_c >= (0.5 * g * T^2 + delta.z) / T.
    let d_xy = (delta.x * delta.x + delta.y * delta.y).sqrt();
    let v_c_range = if d_xy > 1e-4 {
        let t_min = d_xy / max_run_speed;
        ((0.5 * gravity * t_min * t_min + delta.z) / t_min).max(0.0)
    } else {
        0.0
    };

    let v_z_min = v_c_height.max(v_c_range) + half_g_dt;
    let raw_extent = (v_z_min * v_z_min / RETAIL_DOUBLE_GRAVITY) / full_extent_jump_height;
    raw_extent.is_finite().then_some(raw_extent.max(0.0))
}

/// Builds a deterministic, deduplicated ascending ladder of at most 6 candidate powers
/// from `min_extent` up to `JumpExtent::MAXIMUM`.
fn build_power_ladder(min_extent: f32) -> Vec<JumpExtent> {
    let min_val = min_extent.clamp(JumpExtent::MINIMUM.get(), JumpExtent::MAXIMUM.get());
    let margin_val = (min_val + AUTO_POWER_SAFETY_MARGIN).min(JumpExtent::MAXIMUM.get());

    let mut raw = Vec::with_capacity(6);
    raw.push(min_val);
    if margin_val > min_val + AUTO_POWER_DEDUP_EPSILON {
        raw.push(margin_val);
    }
    let span = JumpExtent::MAXIMUM.get() - margin_val;
    if span > AUTO_POWER_DEDUP_EPSILON {
        for frac in [0.25_f32, 0.50, 0.75, 1.0] {
            raw.push((margin_val + span * frac).min(JumpExtent::MAXIMUM.get()));
        }
    } else {
        raw.push(JumpExtent::MAXIMUM.get());
    }

    let mut ladder = Vec::with_capacity(6);
    for value in raw {
        let Ok(extent) = JumpExtent::new(value) else {
            continue;
        };
        let is_duplicate = ladder.last().is_some_and(|prev: &JumpExtent| {
            (extent.get() - prev.get()).abs() < AUTO_POWER_DEDUP_EPSILON
        });
        if !is_duplicate {
            ladder.push(extent);
        }
    }
    if ladder.is_empty() {
        ladder.push(JumpExtent::MAXIMUM);
    }
    ladder
}

/// Solves a camera-free targeted jump against immutable collision snapshots.
///
/// When `power` is `Some(p)`, evaluates exactly that power (`attempts == 1`).
/// When `power` is `None`, computes the minimum analytic feasibility floor and probes an
/// ascending ladder (up to 6 candidates), returning the first collision-verified landing.
pub fn solve_targeted_jump(
    snapshot: &TargetedJumpSnapshot,
    target: TargetedJumpTarget,
    power: Option<JumpExtent>,
    cancelled: &AtomicBool,
) -> Result<TargetedJumpSolution, PreciseJumpPredictionError> {
    let unreachable = |reason| {
        Ok(TargetedJumpSolution {
            reachable: false,
            power: None,
            landed_position: None,
            apex_z: None,
            flight_duration_ms: None,
            reason: Some(reason),
            attempts: 0,
        })
    };

    let target_view = target.into_view();
    if snapshot.body.contact == ContactState::Airborne {
        return unreachable(TargetedJumpUnreachableReason::Airborne);
    }
    let Some(physical) = snapshot.body.physical.as_ref() else {
        return unreachable(TargetedJumpUnreachableReason::BodyUnavailable);
    };
    let PhysicalBodyDefinition::Grounded { spheres, config } = physical.definition else {
        return unreachable(TargetedJumpUnreachableReason::BodyUnavailable);
    };
    if target_view.normal.z < config.walkable_normal_z {
        return unreachable(TargetedJumpUnreachableReason::NonWalkableTarget);
    }
    let Ok(validated_target) = PreciseJumpTarget::from_view(target_view) else {
        return unreachable(TargetedJumpUnreachableReason::InvalidTarget);
    };
    let Ok(kinematics) = retail_jump_kinematics(
        snapshot.capabilities.run_rate_scalar,
        snapshot.capabilities.full_extent_jump_height,
    ) else {
        return unreachable(TargetedJumpUnreachableReason::BodyUnavailable);
    };

    let desired =
        desired_landing_body_point(&snapshot.body, validated_target.view(), spheres.support);
    let Ok(displacement) = PreciseJumpWorldDisplacement::new(desired - snapshot.body.pose.coords)
    else {
        return unreachable(TargetedJumpUnreachableReason::InvalidTarget);
    };

    let max_run_speed =
        kinematics.movement().base_run_forward_speed() * kinematics.movement().run_rate_scalar();
    let gravity = -config.gravity;
    let dt = PRECISE_JUMP_FIXED_TICK.as_secs_f32();
    let heading = snapshot.body.pose.rotation.to_heading();
    let max_ticks = NonZeroU32::new(TARGETED_JUMP_MAXIMUM_TICKS).expect("non-zero max ticks");
    let now = Instant::now();

    let Some(min_raw) = compute_minimum_analytic_extent(
        displacement.get(),
        gravity,
        dt,
        max_run_speed,
        snapshot.capabilities.full_extent_jump_height,
    ) else {
        return unreachable(TargetedJumpUnreachableReason::BodyUnavailable);
    };

    let (candidates, out_of_range_ballistic, insufficient_explicit_power) = match power {
        Some(explicit) => (vec![explicit], false, min_raw > explicit.get() + 1e-4),
        None => {
            if min_raw > JumpExtent::MAXIMUM.get() {
                // Target is ballistically out of range even at full power; run 1 rollout at
                // MAXIMUM to provide a diagnostic landing position.
                (vec![JumpExtent::MAXIMUM], true, false)
            } else {
                (build_power_ladder(min_raw), false, false)
            }
        }
    };

    let mut attempts: u8 = 0;
    let mut best_miss: Option<(f32, JumpExtent, WorldPosition, Option<f32>, u32)> = None;
    let mut incomplete_reason: Option<TargetedJumpUnreachableReason> = None;

    for extent in candidates {
        let Ok(selected) = resolve_selected_precise_jump(
            PRECISE_JUMP_FIXED_TICK,
            &snapshot.capabilities,
            physical.definition,
            heading,
            displacement,
            extent,
        ) else {
            return unreachable(TargetedJumpUnreachableReason::BodyUnavailable);
        };

        attempts = attempts.saturating_add(1);
        let flight = predict_selected_precise_jump(
            PreciseJumpFlightRequest {
                body: &snapshot.body,
                collision_scene: &snapshot.collision_scene,
                entity_collision: &snapshot.entity_collision,
                target: &validated_target,
                candidate: selected.candidate(),
                maximum_ticks: max_ticks,
                start_time: now,
            },
            PreciseJumpPredictionControl { cancelled },
        )?;
        let duration_ms = ((flight.solver_ticks as f32) * dt * 1000.0).round() as u32;
        let apex_z = flight
            .segments
            .iter()
            .flat_map(|seg| [seg.start.z, seg.end.z])
            .reduce(f32::max);

        match flight.outcome {
            PreciseJumpFlightOutcome::Landed {
                contact_point,
                committed_cell,
                matches_target,
                ..
            } => {
                let landed_pos =
                    world_position_from_landing(flight.anchor, contact_point, committed_cell);
                if matches_target {
                    return Ok(TargetedJumpSolution {
                        reachable: true,
                        power: Some(extent),
                        landed_position: Some(landed_pos),
                        apex_z,
                        flight_duration_ms: Some(duration_ms),
                        reason: None,
                        attempts,
                    });
                }
                let miss_distance = contact_point.distance(&validated_target.view().point);
                if best_miss
                    .as_ref()
                    .is_none_or(|(best_dist, ..)| miss_distance < *best_dist)
                {
                    best_miss = Some((miss_distance, extent, landed_pos, apex_z, duration_ms));
                }
            }
            PreciseJumpFlightOutcome::Incomplete(reason) => {
                let mapped = match reason {
                    PreciseJumpPredictionIncompleteReason::CollisionUnavailable { .. }
                    | PreciseJumpPredictionIncompleteReason::EnvCellUnavailable { .. } => {
                        TargetedJumpUnreachableReason::CollisionUnavailable
                    }
                    PreciseJumpPredictionIncompleteReason::FlightHorizonExhausted => {
                        TargetedJumpUnreachableReason::FlightHorizonExhausted
                    }
                    PreciseJumpPredictionIncompleteReason::BodyUnavailable
                    | PreciseJumpPredictionIncompleteReason::BodyDefinitionChanged
                    | PreciseJumpPredictionIncompleteReason::SessionChanged
                    | PreciseJumpPredictionIncompleteReason::Cancelled => {
                        TargetedJumpUnreachableReason::BodyUnavailable
                    }
                };
                if mapped == TargetedJumpUnreachableReason::CollisionUnavailable {
                    return Ok(TargetedJumpSolution {
                        reachable: false,
                        power: Some(extent),
                        landed_position: best_miss.as_ref().map(|(_, _, pos, _, _)| *pos),
                        apex_z: best_miss.as_ref().and_then(|(_, _, _, z, _)| *z),
                        flight_duration_ms: best_miss.as_ref().map(|(_, _, _, _, ms)| *ms),
                        reason: Some(mapped),
                        attempts,
                    });
                }
                incomplete_reason.get_or_insert(mapped);
            }
        }
    }

    let reason = if out_of_range_ballistic {
        TargetedJumpUnreachableReason::OutOfRange
    } else if insufficient_explicit_power {
        TargetedJumpUnreachableReason::InsufficientPower
    } else if best_miss.is_some() {
        TargetedJumpUnreachableReason::Blocked
    } else {
        incomplete_reason.unwrap_or(TargetedJumpUnreachableReason::Blocked)
    };

    Ok(TargetedJumpSolution {
        reachable: false,
        power: best_miss.as_ref().map(|(_, e, _, _, _)| *e).or(power),
        landed_position: best_miss.as_ref().map(|(_, _, pos, _, _)| *pos),
        apex_z: best_miss.as_ref().and_then(|(_, _, _, z, _)| *z),
        flight_duration_ms: best_miss.as_ref().map(|(_, _, _, _, ms)| *ms),
        reason: Some(reason),
        attempts,
    })
}

#[derive(Debug, Clone, Copy)]
struct ActiveTargetedJump {
    correlation_id: u64,
    origin: ControlSource,
    extent: JumpExtent,
    target: PreciseJumpTargetView,
    target_position: WorldPosition,
}

#[derive(Debug, Default)]
enum TargetedJumpState {
    #[default]
    Idle,
    Queued(ActiveTargetedJump),
    InFlight {
        jump: ActiveTargetedJump,
        /// Last observed airborne pose, used to measure touchdown proximity before post-impact slide.
        last_airborne_pose: Option<WorldPosition>,
        deadline: Instant,
    },
}

/// Tracks one camera-free targeted jump from command admission through grounded touchdown.
#[derive(Debug, Default)]
pub(in crate::client) struct TargetedJumpTracker {
    state: TargetedJumpState,
}

impl TargetedJumpTracker {
    /// Whether a targeted jump is currently in-flight.
    pub(in crate::client) fn is_in_flight(&self) -> bool {
        matches!(self.state, TargetedJumpState::InFlight { .. })
    }

    fn active(&self) -> Option<&ActiveTargetedJump> {
        match &self.state {
            TargetedJumpState::Idle => None,
            TargetedJumpState::Queued(jump) | TargetedJumpState::InFlight { jump, .. } => {
                Some(jump)
            }
        }
    }

    /// Returns a read-only summary of the active queued or in-flight targeted jump.
    pub(in crate::client) fn status(&self) -> Option<TargetedJumpStatus> {
        self.active().map(|jump| TargetedJumpStatus {
            correlation_id: jump.correlation_id,
            target: jump.target_position,
            power: jump.extent.get(),
        })
    }

    /// Queues a validated targeted jump, superseding any prior queued jump.
    pub(in crate::client) fn enqueue(
        &mut self,
        correlation_id: u64,
        origin: ControlSource,
        extent: JumpExtent,
        target: PreciseJumpTargetView,
        target_position: WorldPosition,
        current_position: Option<WorldPosition>,
    ) -> Option<TargetedJumpFinished> {
        let prev_is_automation = self
            .active()
            .is_some_and(|jump| jump.origin == ControlSource::Automation);
        let supersede_outcome = if origin == ControlSource::User && prev_is_automation {
            TargetedJumpOutcome::InterruptedByUser
        } else {
            TargetedJumpOutcome::Superseded
        };
        let superseded = self.retire(supersede_outcome, current_position);
        self.state = TargetedJumpState::Queued(ActiveTargetedJump {
            correlation_id,
            origin,
            extent,
            target,
            target_position,
        });
        superseded
    }

    /// Returns a `PreparedPreciseJumpCommit` if a targeted jump is queued for this tick.
    ///
    /// Does not clear `Queued` until `on_launch_result` or `preempt_queued` completes.
    pub(in crate::client) fn prepare_queued_commit(&self) -> Option<PreparedPreciseJumpCommit> {
        match self.state {
            TargetedJumpState::Queued(queued) => Some(PreparedPreciseJumpCommit::from_targeted(
                PreciseJumpActionSequence(queued.correlation_id),
                queued.extent,
                queued.target,
            )),
            TargetedJumpState::Idle | TargetedJumpState::InFlight { .. } => None,
        }
    }

    /// Preempts a queued jump when an interactive user precise jump owns the same tick.
    pub(in crate::client) fn preempt_queued(
        &mut self,
        current_position: Option<WorldPosition>,
    ) -> Option<TargetedJumpFinished> {
        let TargetedJumpState::Queued(queued) = self.state else {
            return None;
        };
        self.state = TargetedJumpState::Idle;
        let outcome = if queued.origin == ControlSource::Automation {
            TargetedJumpOutcome::InterruptedByUser
        } else {
            TargetedJumpOutcome::Superseded
        };
        Some(Self::finish(
            queued.correlation_id,
            queued.origin,
            outcome,
            None,
            current_position,
        ))
    }

    /// Processes the launch result from `tick_with_precise_jump` for a queued targeted jump.
    ///
    /// On immediate 1-tick touchdown (`ContactState::Grounded && velocity.z <= 0`), settles
    /// immediately as `Landed`.
    pub(in crate::client) fn on_launch_result(
        &mut self,
        feedback: Option<PreciseJumpTransactionFeedback>,
        body: Option<&SpatialBody>,
        now: Instant,
    ) -> Option<TargetedJumpFinished> {
        let TargetedJumpState::Queued(queued) = self.state else {
            return None;
        };
        let position = body.map(|b| b.pose);
        match feedback.map(|f| f.outcome) {
            Some(PreciseJumpTransactionOutcome::Committed) => {
                // Handle immediate 1-tick micro-hop / low-ceiling touchdown.
                if let Some(body) = body
                    && body.contact == ContactState::Grounded
                    && body.retained.velocity.z <= 0.0
                {
                    self.state = TargetedJumpState::Idle;
                    return Some(Self::landed_event(queued, None, body));
                }
                self.state = TargetedJumpState::InFlight {
                    jump: queued,
                    last_airborne_pose: position,
                    deadline: now + TARGETED_JUMP_AIRBORNE_DEADLINE,
                };
                None
            }
            Some(PreciseJumpTransactionOutcome::Rejected { reason }) => {
                self.state = TargetedJumpState::Idle;
                let outcome = match reason {
                    PreciseJumpTransactionRejection::Airborne => {
                        TargetedJumpOutcome::RejectedAirborne
                    }
                    PreciseJumpTransactionRejection::Unsupported => {
                        TargetedJumpOutcome::RejectedUnsupported
                    }
                    PreciseJumpTransactionRejection::Overburdened => {
                        TargetedJumpOutcome::RejectedOverburdened
                    }
                    PreciseJumpTransactionRejection::StaleAction
                    | PreciseJumpTransactionRejection::CommitPending
                    | PreciseJumpTransactionRejection::SessionChanged
                    | PreciseJumpTransactionRejection::LaunchRejected => {
                        TargetedJumpOutcome::RejectedLaunch
                    }
                };
                Some(Self::finish(
                    queued.correlation_id,
                    queued.origin,
                    outcome,
                    None,
                    position,
                ))
            }
            Some(PreciseJumpTransactionOutcome::Cancelled) | None => {
                self.state = TargetedJumpState::Idle;
                Some(Self::finish(
                    queued.correlation_id,
                    queued.origin,
                    TargetedJumpOutcome::RejectedLaunch,
                    None,
                    position,
                ))
            }
        }
    }

    /// Checks an in-flight targeted jump after a subsequent physics tick for touchdown or timeout.
    pub(in crate::client) fn on_post_tick(
        &mut self,
        body: Option<&SpatialBody>,
        now: Instant,
    ) -> Option<TargetedJumpFinished> {
        let TargetedJumpState::InFlight {
            jump,
            last_airborne_pose,
            deadline,
        } = &mut self.state
        else {
            return None;
        };
        if let Some(body) = body {
            if body.contact == ContactState::Grounded {
                let jump = *jump;
                let prev = *last_airborne_pose;
                self.state = TargetedJumpState::Idle;
                return Some(Self::landed_event(jump, prev, body));
            }
            *last_airborne_pose = Some(body.pose);
        }
        if now >= *deadline {
            let jump = *jump;
            self.state = TargetedJumpState::Idle;
            return Some(Self::finish(
                jump.correlation_id,
                jump.origin,
                TargetedJumpOutcome::TimedOut,
                Some(jump.extent.get()),
                body.map(|b| b.pose),
            ));
        }
        None
    }

    /// Retires any queued or in-flight jump with `outcome`.
    pub(in crate::client) fn retire(
        &mut self,
        outcome: TargetedJumpOutcome,
        current_position: Option<WorldPosition>,
    ) -> Option<TargetedJumpFinished> {
        let (jump, committed_power) = match std::mem::take(&mut self.state) {
            TargetedJumpState::Idle => return None,
            TargetedJumpState::Queued(jump) => (jump, None),
            TargetedJumpState::InFlight { jump, .. } => (jump, Some(jump.extent.get())),
        };
        Some(Self::finish(
            jump.correlation_id,
            jump.origin,
            outcome,
            committed_power,
            current_position,
        ))
    }

    /// Retires any queued or in-flight jump originated by `ControlSource::Automation`.
    pub(in crate::client) fn retire_automation(
        &mut self,
        outcome: TargetedJumpOutcome,
        current_position: Option<WorldPosition>,
    ) -> Option<TargetedJumpFinished> {
        if !self
            .active()
            .is_some_and(|jump| jump.origin == ControlSource::Automation)
        {
            return None;
        }
        self.retire(outcome, current_position)
    }

    fn finish(
        correlation_id: u64,
        origin: ControlSource,
        outcome: TargetedJumpOutcome,
        power: Option<f32>,
        position: Option<WorldPosition>,
    ) -> TargetedJumpFinished {
        TargetedJumpFinished {
            correlation_id: Some(correlation_id),
            origin,
            outcome,
            power,
            position,
            predicted_landing: None,
            matched_target: false,
            unreachable_reason: None,
        }
    }

    fn landed_event(
        jump: ActiveTargetedJump,
        last_airborne_pose: Option<WorldPosition>,
        body: &SpatialBody,
    ) -> TargetedJumpFinished {
        let body_anchor = owner_for_position(body.pose.landblock_id);
        let landed_in_target_frame =
            point_between_anchors(body.pose.coords, body_anchor, jump.target.anchor);
        let tolerance = body
            .physical
            .as_ref()
            .map_or(0.5, |phys| phys.definition.spheres().primary().radius);
        // Measure closest approach along the final landing tick so high-speed post-impact ground
        // coasting does not falsely flag a dead-on touchdown as a miss.
        let distance = match last_airborne_pose {
            Some(prev) => {
                let prev_anchor = owner_for_position(prev.landblock_id);
                let prev_in_target_frame =
                    point_between_anchors(prev.coords, prev_anchor, jump.target.anchor);
                point_to_segment_distance(
                    jump.target.point,
                    prev_in_target_frame,
                    landed_in_target_frame,
                )
            }
            None => landed_in_target_frame.distance(&jump.target.point),
        };
        TargetedJumpFinished {
            correlation_id: Some(jump.correlation_id),
            origin: jump.origin,
            outcome: TargetedJumpOutcome::Landed,
            power: Some(jump.extent.get()),
            position: Some(body.pose),
            predicted_landing: None,
            matched_target: distance <= tolerance,
            unreachable_reason: None,
        }
    }
}

fn point_to_segment_distance(point: Vector3, start: Vector3, end: Vector3) -> f32 {
    let ab = end - start;
    let ab_len_sq = ab.length_squared();
    if ab_len_sq <= 1e-8 {
        return point.distance(&start);
    }
    let t = ((point - start).dot(&ab) / ab_len_sq).clamp(0.0, 1.0);
    let closest = start + ab * t;
    point.distance(&closest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::precise_jump_prediction::tests::{
        PredictionFixture, fixture_with_polygons, flat_prediction_fixture,
    };

    fn snapshot_from_fixture(fixture: PredictionFixture) -> TargetedJumpSnapshot {
        let body = fixture.scene.body(fixture.body_id).unwrap().clone();
        let entity_collision = fixture.scene.entity_collision_snapshot().unwrap();
        TargetedJumpSnapshot {
            world_generation: 1,
            body,
            capabilities: fixture.capabilities,
            collision_scene: Arc::new(fixture.collision),
            entity_collision,
        }
    }

    fn outdoor_target(x: f32, y: f32, z: f32) -> TargetedJumpTarget {
        TargetedJumpTarget::new(
            WorldPosition::from_outdoor_frame(
                Guid(0xda55_0001),
                Vector3::new(x, y, z),
                Quaternion::identity(),
            ),
            None,
        )
        .unwrap()
    }

    #[test]
    fn auto_solver_reaches_flat_open_air_target_with_low_power() {
        let snapshot = snapshot_from_fixture(flat_prediction_fixture());
        let target = outdoor_target(114.0, 96.0, 0.0);
        let cancelled = AtomicBool::new(false);
        let solution = solve_targeted_jump(&snapshot, target, None, &cancelled).unwrap();
        assert!(
            solution.reachable,
            "expected flat target to be reachable: {solution:?}"
        );
        assert!(solution.power.unwrap().get() < 0.8);
        assert!(solution.landed_position.is_some());
        assert!(solution.flight_duration_ms.unwrap() > 0);
        assert_eq!(solution.reason, None);
    }

    #[test]
    fn explicit_power_runs_exactly_one_rollout() {
        let snapshot = snapshot_from_fixture(flat_prediction_fixture());
        let target = outdoor_target(114.0, 96.0, 0.0);
        let cancelled = AtomicBool::new(false);
        let solution = solve_targeted_jump(
            &snapshot,
            target,
            Some(JumpExtent::new(0.8).unwrap()),
            &cancelled,
        )
        .unwrap();
        assert_eq!(solution.attempts, 1);
        assert!(solution.reachable);
        assert_eq!(solution.power, Some(JumpExtent::new(0.8).unwrap()));
        assert!(solution.apex_z.unwrap() > 1.0);

        // Explicit under-powered jump reports InsufficientPower rather than Blocked.
        let low = solve_targeted_jump(
            &snapshot,
            target,
            Some(JumpExtent::new(0.05).unwrap()),
            &cancelled,
        )
        .unwrap();
        assert!(!low.reachable);
        assert_eq!(low.attempts, 1);
        assert_eq!(
            low.reason,
            Some(TargetedJumpUnreachableReason::InsufficientPower)
        );
    }

    #[test]
    fn auto_solver_reports_out_of_range_in_single_diagnostic_rollout() {
        let snapshot = snapshot_from_fixture(flat_prediction_fixture());
        let target = outdoor_target(50.0, 96.0, 0.0);
        let cancelled = AtomicBool::new(false);
        let solution = solve_targeted_jump(&snapshot, target, None, &cancelled).unwrap();
        assert!(!solution.reachable);
        assert_eq!(
            solution.reason,
            Some(TargetedJumpUnreachableReason::OutOfRange)
        );
        assert_eq!(solution.attempts, 1);
        assert!(solution.landed_position.is_some());
    }

    #[test]
    fn auto_solver_clears_low_ceiling_by_picking_lower_arc() {
        // Low downward-facing ceiling plane at z = 3.5m over the path from x=120 to x=116:
        // full-power jumps (~4.2m rise + player height) bonk it, while a lower arc clears it.
        let ceiling = (
            vec![
                Vector3::new(114.0, 92.0, 3.5),
                Vector3::new(114.0, 100.0, 3.5),
                Vector3::new(122.0, 100.0, 3.5),
                Vector3::new(122.0, 92.0, 3.5),
            ],
            Vector3::new(0.0, 0.0, -1.0),
        );
        let snapshot = snapshot_from_fixture(fixture_with_polygons(vec![ceiling]));
        let target = outdoor_target(116.0, 96.0, 0.0);
        let cancelled = AtomicBool::new(false);
        let solution = solve_targeted_jump(&snapshot, target, None, &cancelled).unwrap();
        assert!(
            solution.reachable,
            "expected low arc under ceiling: {solution:?}"
        );
        assert!(solution.power.unwrap().get() < 0.6);

        // Confirm full power actually hits the ceiling and misses the target.
        let full_power =
            solve_targeted_jump(&snapshot, target, Some(JumpExtent::MAXIMUM), &cancelled).unwrap();
        assert!(
            !full_power.reachable,
            "expected full power to bonk the low ceiling: {full_power:?}"
        );
    }

    #[test]
    fn auto_solver_reports_blocked_when_wall_stands_in_path() {
        // Tall wall facing +X (toward player at x=120) at x = 117.0, z in [0, 8].
        let wall = (
            vec![
                Vector3::new(117.0, 92.0, 0.0),
                Vector3::new(117.0, 100.0, 0.0),
                Vector3::new(117.0, 100.0, 8.0),
                Vector3::new(117.0, 92.0, 8.0),
            ],
            Vector3::new(1.0, 0.0, 0.0),
        );
        let snapshot = snapshot_from_fixture(fixture_with_polygons(vec![wall]));
        let target = outdoor_target(114.0, 96.0, 0.0);
        let cancelled = AtomicBool::new(false);
        let solution = solve_targeted_jump(&snapshot, target, None, &cancelled).unwrap();
        assert!(!solution.reachable);
        assert_eq!(
            solution.reason,
            Some(TargetedJumpUnreachableReason::Blocked)
        );
        assert!(solution.landed_position.is_some());
    }

    #[test]
    fn rejects_invalid_and_non_walkable_targets() {
        let snapshot = snapshot_from_fixture(flat_prediction_fixture());
        let cancelled = AtomicBool::new(false);

        assert!(
            TargetedJumpTarget::new(
                WorldPosition {
                    landblock_id: Guid::NULL,
                    coords: Vector3::new(114.0, 96.0, 0.0),
                    rotation: Quaternion::identity(),
                },
                None,
            )
            .is_err()
        );

        let wall_normal_target = TargetedJumpTarget::new(
            WorldPosition::from_outdoor_frame(
                Guid(0xda55_0001),
                Vector3::new(114.0, 96.0, 0.0),
                Quaternion::identity(),
            ),
            Some(Vector3::new(1.0, 0.0, 0.0)),
        )
        .unwrap();
        let sol = solve_targeted_jump(&snapshot, wall_normal_target, None, &cancelled).unwrap();
        assert!(!sol.reachable);
        assert_eq!(
            sol.reason,
            Some(TargetedJumpUnreachableReason::NonWalkableTarget)
        );
        assert_eq!(sol.attempts, 0);

        let mut airborne_snapshot = snapshot;
        airborne_snapshot.body.contact = ContactState::Airborne;
        let sol = solve_targeted_jump(
            &airborne_snapshot,
            outdoor_target(114.0, 96.0, 0.0),
            None,
            &cancelled,
        )
        .unwrap();
        assert!(!sol.reachable);
        assert_eq!(sol.reason, Some(TargetedJumpUnreachableReason::Airborne));
        assert_eq!(sol.attempts, 0);
    }

    #[test]
    fn tracker_handles_launch_touchdown_rejection_preemption_and_timeout() {
        let fixture = flat_prediction_fixture();
        let mut body = fixture.scene.body(fixture.body_id).unwrap().clone();
        let target = PreciseJumpTargetView {
            anchor: Guid(0xda55_ffff),
            point: Vector3::new(114.0, 96.0, 0.0),
            normal: Vector3::new(0.0, 0.0, 1.0),
            committed_cell: None,
        };
        let target_pos = WorldPosition::from_outdoor_frame(
            Guid(0xda55_0001),
            Vector3::new(114.0, 96.0, 0.0),
            Quaternion::identity(),
        );
        let now = Instant::now();
        let mut tracker = TargetedJumpTracker::default();

        // 1. Enqueue, commit while airborne, then land (with post-impact slide across target).
        assert!(
            tracker
                .enqueue(
                    1,
                    ControlSource::Automation,
                    JumpExtent::new(0.8).unwrap(),
                    target,
                    target_pos,
                    Some(body.pose),
                )
                .is_none()
        );
        assert!(tracker.prepare_queued_commit().is_some());
        assert_eq!(tracker.status().unwrap().correlation_id, 1);
        body.contact = ContactState::Airborne;
        assert!(
            tracker
                .on_launch_result(
                    Some(PreciseJumpTransactionFeedback {
                        sequence: PreciseJumpActionSequence(1),
                        outcome: PreciseJumpTransactionOutcome::Committed,
                    }),
                    Some(&body),
                    now,
                )
                .is_none()
        );
        assert!(tracker.is_in_flight());
        // Final airborne sample just before landing on target, followed by 0.6m post-impact slide.
        body.pose.coords = Vector3::new(114.2, 96.0, 0.1);
        assert!(
            tracker
                .on_post_tick(Some(&body), now + Duration::from_millis(60))
                .is_none()
        );

        body.contact = ContactState::Grounded;
        body.pose.coords = Vector3::new(113.4, 96.0, 0.0);
        let landed = tracker
            .on_post_tick(Some(&body), now + Duration::from_millis(500))
            .expect("expected landing event");
        assert_eq!(landed.correlation_id, Some(1));
        assert_eq!(landed.outcome, TargetedJumpOutcome::Landed);
        assert!(landed.matched_target);
        assert_eq!(landed.power, Some(0.8));

        // 2. Launch rejection emits exact Rejected* outcome without entering InFlight.
        tracker.enqueue(
            2,
            ControlSource::Automation,
            JumpExtent::MAXIMUM,
            target,
            target_pos,
            Some(body.pose),
        );
        let rejected = tracker
            .on_launch_result(
                Some(PreciseJumpTransactionFeedback {
                    sequence: PreciseJumpActionSequence(2),
                    outcome: PreciseJumpTransactionOutcome::Rejected {
                        reason: PreciseJumpTransactionRejection::Overburdened,
                    },
                }),
                Some(&body),
                now,
            )
            .expect("expected rejection event");
        assert_eq!(rejected.outcome, TargetedJumpOutcome::RejectedOverburdened);
        assert_eq!(rejected.power, None);

        // 3. Interactive preemption retires automation jump with InterruptedByUser.
        tracker.enqueue(
            3,
            ControlSource::Automation,
            JumpExtent::MAXIMUM,
            target,
            target_pos,
            Some(body.pose),
        );
        let preempted = tracker
            .preempt_queued(Some(body.pose))
            .expect("expected preemption event");
        assert_eq!(preempted.outcome, TargetedJumpOutcome::InterruptedByUser);

        // 4. In-flight airborne timeout fires after deadline.
        tracker.enqueue(
            4,
            ControlSource::Automation,
            JumpExtent::MAXIMUM,
            target,
            target_pos,
            Some(body.pose),
        );
        body.contact = ContactState::Airborne;
        assert!(
            tracker
                .on_launch_result(
                    Some(PreciseJumpTransactionFeedback {
                        sequence: PreciseJumpActionSequence(4),
                        outcome: PreciseJumpTransactionOutcome::Committed,
                    }),
                    Some(&body),
                    now,
                )
                .is_none()
        );
        let timed_out = tracker
            .on_post_tick(Some(&body), now + TARGETED_JUMP_AIRBORNE_DEADLINE)
            .expect("expected timeout event");
        assert_eq!(timed_out.outcome, TargetedJumpOutcome::TimedOut);
    }
}
