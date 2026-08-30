//! Retail server-directed MoveTo/TurnTo reduction into ordinary authored motion orders.

use crate::entity::{EntityMotionDirective, EntityMoveToParameters, OrderedMotionPosition};
use crate::spatial::ContactState;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;

use super::{CharacterMotionPresentation, MotionCommand, MotionOrder};

/// Retail physics epsilon expressed as radians (`acclient.c:331571-331617`).
const TURN_COMPLETION_THRESHOLD_RAD: f32 = 0.000_2_f32.to_radians();
/// Heading disagreement at which moving retail actors add an auxiliary turn.
const MOVING_TURN_THRESHOLD_RAD: f32 = 20.0_f32.to_radians();

const CAN_WALK: u32 = 0x0000_0001;
const CAN_RUN: u32 = 0x0000_0002;
const CAN_CHARGE: u32 = 0x0000_0010;
const USE_FINAL_HEADING: u32 = 0x0000_0040;
const MOVE_AWAY: u32 = 0x0000_0100;
const MOVE_TOWARDS: u32 = 0x0000_0200;
const STOP_COMPLETELY: u32 = 0x0001_0000;

/// Current authoritative facts for an object targeted by a server directive.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ServerDirectedTarget {
    /// Current authoritative target pose.
    pub pose: WorldPosition,
    /// Collision/use radius added to the desired center separation.
    pub use_radius: f32,
}

impl ServerDirectedTarget {
    /// Builds a target only when its radius is a usable physical distance.
    pub fn new(pose: WorldPosition, use_radius: f32) -> Option<Self> {
        (use_radius.is_finite() && use_radius >= 0.0).then_some(Self { pose, use_radius })
    }
}

/// Stateful retail node currently active inside one MoveTo command.
#[derive(Debug, Clone, Copy, PartialEq)]
enum MoveToPhase {
    /// Turn to the target line before starting translation.
    InitialTurn {
        /// Heading and direction chosen when the turn began.
        progress: Option<DirectedTurnProgress>,
    },
    /// Translate with the command and gait chosen when the node began.
    Moving {
        /// Walk/run/backwards command admitted to interpreted playback.
        command: MotionCommand,
        /// Authored animation-rate multiplier after applying the Run hold key.
        speed_mod: f32,
        /// Whether progress increases as distance from the target increases.
        moving_away: bool,
        /// Authored auxiliary-turn multiplier after applying the Run hold key.
        turn_speed_mod: f32,
    },
    /// Apply the authored final heading after translation completes.
    FinalTurn {
        /// Heading and direction chosen when the turn began.
        progress: Option<DirectedTurnProgress>,
    },
}

/// Direction of one retail TurnTo node before command canonicalization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirectedTurnDirection {
    /// Increasing heading, presented as positive-rate canonical TurnRight.
    Positive,
    /// Decreasing heading, presented as negative-rate canonical TurnRight.
    Negative,
}

/// Fixed decision facts for one active retail TurnTo node.
#[derive(Debug, Clone, Copy, PartialEq)]
struct DirectedTurnProgress {
    /// Normalized heading queued when the node began.
    desired_heading: f32,
    /// Direction selected from the initial signed heading delta.
    direction: DirectedTurnDirection,
}

/// Target ownership after retail's receipt-time object lookup.
#[derive(Debug, Clone, Copy, PartialEq)]
enum MoveToTarget {
    /// Fixed position command, including MoveToObject's retail fallback when lookup initially fails.
    Position(ServerDirectedTarget),
    /// Object lookup succeeded at admission and must remain available for tracking.
    Object {
        /// Target object identity.
        guid: Guid,
        /// Most recently sampled target facts.
        current: ServerDirectedTarget,
    },
}

/// Mutable progress facts for one MoveTo lifecycle.
#[derive(Debug, Clone, Copy, PartialEq)]
struct MoveToState {
    /// Complete retained movement policy.
    params: EntityMoveToParameters,
    /// Actor-specific rate applied when Run is held.
    run_rate: f32,
    /// Pose from which retail measures `fail_distance`.
    starting_pose: WorldPosition,
    /// Current fixed or tracked target.
    target: MoveToTarget,
    /// Ordered node currently executing.
    phase: MoveToPhase,
}

/// Target ownership for one TurnTo lifecycle.
#[derive(Debug, Clone, Copy, PartialEq)]
enum TurnToTarget {
    /// Absolute heading in radians.
    Heading(f32),
    /// Object lookup succeeded at admission and remains required while turning.
    Object {
        /// Target object identity.
        guid: Guid,
        /// Object-relative heading offset in radians.
        heading_offset: f32,
    },
}

/// Mutable progress facts for one TurnTo lifecycle.
#[derive(Debug, Clone, Copy, PartialEq)]
struct TurnToState {
    /// Turn target selected at admission.
    target: TurnToTarget,
    /// Authored animation-rate multiplier.
    speed_mod: f32,
    /// Whether receipt stops retained forward/sidestep state.
    stop_completely: bool,
    /// Heading and direction chosen when the turn began.
    progress: Option<DirectedTurnProgress>,
}

/// Internal command-kind state for one admitted server directive.
#[derive(Debug, Clone, Copy, PartialEq)]
enum ServerDirectedMotionKind {
    /// MoveTo node/progress state.
    MoveTo(MoveToState),
    /// TurnTo node/progress state.
    TurnTo(TurnToState),
}

/// Opaque caller-owned runtime state for one admitted server directive.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ServerDirectedMotionState {
    /// Interdependent progress fields for the directive's concrete kind.
    kind: ServerDirectedMotionKind,
}

impl ServerDirectedMotionState {
    /// Object identity that must be resampled while this admitted directive remains active.
    pub const fn target_guid(self) -> Option<Guid> {
        match self.kind {
            ServerDirectedMotionKind::MoveTo(MoveToState {
                target: MoveToTarget::Object { guid, .. },
                ..
            })
            | ServerDirectedMotionKind::TurnTo(TurnToState {
                target: TurnToTarget::Object { guid, .. },
                ..
            }) => Some(guid),
            ServerDirectedMotionKind::MoveTo(_) | ServerDirectedMotionKind::TurnTo(_) => None,
        }
    }
}

/// Why a retained directive could no longer execute.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerDirectedMotionFailure {
    /// An object resolved at admission but disappeared before completion.
    TargetUnavailable { guid: Guid },
    /// Travel from the starting pose exceeded the authored fail distance.
    FailDistanceExceeded,
}

/// Active authored order and successor state produced by one pure reduction.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ServerDirectedMotionStep {
    /// State to supply to the next reduction.
    pub state: ServerDirectedMotionState,
    /// Ordinary authored order consumed by the shared motion runtime.
    pub order: MotionOrder,
}

/// Result of reducing one directive against current body/target/support facts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ServerDirectedMotionResolution {
    /// The directive remains active for another tick.
    Active(ServerDirectedMotionStep),
    /// All translation and final-heading nodes completed.
    Complete,
    /// The directive failed for one explicit retail-owned reason.
    Failed(ServerDirectedMotionFailure),
}

/// Installs a fresh directive using retail's receipt-time object fallback rule.
pub fn begin_server_directed_motion(
    directive: EntityMotionDirective,
    current_pose: WorldPosition,
    object_target: Option<ServerDirectedTarget>,
) -> ServerDirectedMotionState {
    match directive {
        EntityMotionDirective::MoveToPosition {
            target,
            params,
            run_rate,
            ..
        } => ServerDirectedMotionState {
            kind: ServerDirectedMotionKind::MoveTo(MoveToState {
                params,
                run_rate: run_rate.to_f32(),
                starting_pose: current_pose,
                target: MoveToTarget::Position(position_target(target)),
                phase: MoveToPhase::InitialTurn { progress: None },
            }),
        },
        EntityMotionDirective::MoveToObject {
            target,
            fallback_target,
            params,
            run_rate,
            ..
        } => ServerDirectedMotionState {
            kind: ServerDirectedMotionKind::MoveTo(MoveToState {
                params,
                run_rate: run_rate.to_f32(),
                starting_pose: current_pose,
                target: object_target.map_or_else(
                    || MoveToTarget::Position(position_target(fallback_target)),
                    |current| MoveToTarget::Object {
                        guid: target,
                        current,
                    },
                ),
                phase: MoveToPhase::InitialTurn { progress: None },
            }),
        },
        EntityMotionDirective::TurnToHeading { params, .. } => ServerDirectedMotionState {
            kind: ServerDirectedMotionKind::TurnTo(TurnToState {
                target: TurnToTarget::Heading(degrees_to_heading(
                    params.desired_heading_degrees.to_f32(),
                )),
                speed_mod: params.speed.to_f32(),
                stop_completely: params.flags & STOP_COMPLETELY != 0,
                progress: None,
            }),
        },
        EntityMotionDirective::TurnToObject {
            target,
            fallback_heading_degrees,
            params,
            ..
        } => ServerDirectedMotionState {
            kind: ServerDirectedMotionKind::TurnTo(TurnToState {
                target: object_target.map_or_else(
                    || TurnToTarget::Heading(degrees_to_heading(fallback_heading_degrees.to_f32())),
                    |_| TurnToTarget::Object {
                        guid: target,
                        heading_offset: params.desired_heading_degrees.to_f32().to_radians(),
                    },
                ),
                speed_mod: params.speed.to_f32(),
                stop_completely: params.flags & STOP_COMPLETELY != 0,
                progress: None,
            }),
        },
    }
}

/// Reduces one retained directive without mutating world, body, playback, or target state.
pub fn resolve_server_directed_motion(
    state: ServerDirectedMotionState,
    steady_order: MotionOrder,
    current_pose: WorldPosition,
    contact: ContactState,
    object_target: Option<ServerDirectedTarget>,
) -> ServerDirectedMotionResolution {
    match state.kind {
        ServerDirectedMotionKind::MoveTo(state) => {
            resolve_move_to(state, steady_order, current_pose, contact, object_target)
        }
        ServerDirectedMotionKind::TurnTo(state) => {
            resolve_turn_to(state, steady_order, current_pose, contact, object_target)
        }
    }
}

fn resolve_move_to(
    mut state: MoveToState,
    steady_order: MotionOrder,
    current_pose: WorldPosition,
    contact: ContactState,
    object_target: Option<ServerDirectedTarget>,
) -> ServerDirectedMotionResolution {
    if let MoveToTarget::Object { guid, current } = &mut state.target {
        let Some(sample) = object_target else {
            return ServerDirectedMotionResolution::Failed(
                ServerDirectedMotionFailure::TargetUnavailable { guid: *guid },
            );
        };
        *current = sample;
    }
    let target = move_to_target(state.target);
    let distance = effective_target_distance(current_pose, target);

    loop {
        match state.phase {
            MoveToPhase::InitialTurn { progress } => {
                let Some((command, speed_mod, moving_away, turn_speed_mod)) =
                    select_move_command(state.params, state.run_rate, distance)
                else {
                    if contact != ContactState::Grounded {
                        return active_move_step(
                            state,
                            directed_order(steady_order, None, None),
                            contact,
                        );
                    }
                    state.phase = MoveToPhase::FinalTurn { progress: None };
                    continue;
                };
                let desired_heading =
                    travel_heading(current_pose, target.pose, command, moving_away);
                if let Some((turn, progress)) = progressing_turn_order(
                    current_pose,
                    desired_heading,
                    state.params.speed.to_f32(),
                    false,
                    progress,
                ) {
                    state.phase = MoveToPhase::InitialTurn {
                        progress: Some(progress),
                    };
                    return active_move_step(
                        state,
                        directed_order(steady_order, None, Some(turn)),
                        contact,
                    );
                }
                state.phase = MoveToPhase::Moving {
                    command,
                    speed_mod,
                    moving_away,
                    turn_speed_mod,
                };
            }
            MoveToPhase::Moving {
                command,
                speed_mod,
                moving_away,
                turn_speed_mod,
            } => {
                if contact == ContactState::Grounded
                    && move_completed(state.params, distance, moving_away)
                {
                    state.phase = MoveToPhase::FinalTurn { progress: None };
                    continue;
                }
                if contact == ContactState::Grounded
                    && current_pose.distance_to(&state.starting_pose)
                        > state.params.fail_distance.to_f32()
                {
                    return ServerDirectedMotionResolution::Failed(
                        ServerDirectedMotionFailure::FailDistanceExceeded,
                    );
                }
                let desired_heading =
                    travel_heading(current_pose, target.pose, command, moving_away);
                let turn = turn_order(current_pose, desired_heading, turn_speed_mod, true);
                let order = directed_order(steady_order, Some((command, speed_mod)), turn);
                return active_move_step(state, order, contact);
            }
            MoveToPhase::FinalTurn { progress } => {
                if state.params.flags & USE_FINAL_HEADING == 0 {
                    return ServerDirectedMotionResolution::Complete;
                }
                let desired_heading = final_move_heading(
                    state.params,
                    current_pose,
                    target.pose,
                    matches!(state.target, MoveToTarget::Object { .. }),
                );
                let Some((turn, progress)) = progressing_turn_order(
                    current_pose,
                    desired_heading,
                    state.params.speed.to_f32(),
                    false,
                    progress,
                ) else {
                    return ServerDirectedMotionResolution::Complete;
                };
                state.phase = MoveToPhase::FinalTurn {
                    progress: Some(progress),
                };
                return active_move_step(
                    state,
                    directed_order(steady_order, None, Some(turn)),
                    contact,
                );
            }
        }
    }
}

fn resolve_turn_to(
    mut state: TurnToState,
    steady_order: MotionOrder,
    current_pose: WorldPosition,
    contact: ContactState,
    object_target: Option<ServerDirectedTarget>,
) -> ServerDirectedMotionResolution {
    let desired_heading = if let Some(progress) = state.progress {
        progress.desired_heading
    } else {
        match state.target {
            TurnToTarget::Heading(heading) => heading,
            TurnToTarget::Object {
                guid,
                heading_offset,
            } => {
                let Some(target) = object_target else {
                    return ServerDirectedMotionResolution::Failed(
                        ServerDirectedMotionFailure::TargetUnavailable { guid },
                    );
                };
                normalize_heading(current_pose.heading_to(&target.pose) + heading_offset)
            }
        }
    };
    let Some((turn, progress)) = progressing_turn_order(
        current_pose,
        desired_heading,
        state.speed_mod,
        false,
        state.progress,
    ) else {
        return ServerDirectedMotionResolution::Complete;
    };
    state.progress = Some(progress);
    let base = if state.stop_completely {
        MotionOrder {
            style: steady_order.style,
            ..MotionOrder::default()
        }
    } else {
        steady_order
    };
    let order = present_for_contact(
        MotionOrder {
            turn: Some(turn),
            ..base
        },
        contact,
    );
    ServerDirectedMotionResolution::Active(ServerDirectedMotionStep {
        state: ServerDirectedMotionState {
            kind: ServerDirectedMotionKind::TurnTo(state),
        },
        order,
    })
}

fn active_move_step(
    state: MoveToState,
    order: MotionOrder,
    contact: ContactState,
) -> ServerDirectedMotionResolution {
    ServerDirectedMotionResolution::Active(ServerDirectedMotionStep {
        state: ServerDirectedMotionState {
            kind: ServerDirectedMotionKind::MoveTo(state),
        },
        order: present_for_contact(order, contact),
    })
}

fn directed_order(
    steady_order: MotionOrder,
    forward: Option<(MotionCommand, f32)>,
    turn: Option<(MotionCommand, f32)>,
) -> MotionOrder {
    MotionOrder {
        style: steady_order.style,
        forward,
        sidestep: None,
        turn,
    }
}

fn present_for_contact(order: MotionOrder, contact: ContactState) -> MotionOrder {
    let presentation = match contact {
        ContactState::Grounded => CharacterMotionPresentation::Grounded,
        ContactState::Airborne | ContactState::Sliding => CharacterMotionPresentation::Falling,
        ContactState::Unknown => CharacterMotionPresentation::StanceDefault,
    };
    order.with_character_presentation(presentation)
}

fn select_move_command(
    params: EntityMoveToParameters,
    run_rate: f32,
    distance: f32,
) -> Option<(MotionCommand, f32, bool, f32)> {
    let move_towards = params.flags & MOVE_TOWARDS != 0;
    let move_away = params.flags & MOVE_AWAY != 0;
    let distance_to_object = params.distance_to_object.to_f32();
    let min_distance = params.min_distance.to_f32();
    let (command, moving_away) = if move_towards || !move_away {
        if move_away && distance < min_distance {
            (MotionCommand::WALK_BACKWARDS, true)
        } else if distance > distance_to_object {
            (MotionCommand::WALK_FORWARD, false)
        } else {
            return None;
        }
    } else if distance < min_distance {
        (MotionCommand::WALK_FORWARD, true)
    } else {
        return None;
    };
    let run_held = params.flags & CAN_CHARGE != 0
        || params.flags & CAN_RUN != 0
            && (params.flags & CAN_WALK == 0
                || distance - distance_to_object > params.walk_run_threshold.to_f32());
    let speed = params.speed.to_f32();
    let turn_speed_mod = speed * 1.5;
    if run_held && command == MotionCommand::WALK_FORWARD && speed > 0.0 {
        Some((
            MotionCommand::RUN_FORWARD,
            run_rate * speed,
            moving_away,
            turn_speed_mod,
        ))
    } else {
        Some((command, speed, moving_away, turn_speed_mod))
    }
}

fn move_completed(params: EntityMoveToParameters, distance: f32, moving_away: bool) -> bool {
    if moving_away {
        distance >= params.min_distance.to_f32()
    } else {
        distance <= params.distance_to_object.to_f32()
    }
}

fn travel_heading(
    current_pose: WorldPosition,
    target_pose: WorldPosition,
    command: MotionCommand,
    moving_away: bool,
) -> f32 {
    let offset = if command == MotionCommand::WALK_BACKWARDS {
        if moving_away {
            0.0
        } else {
            std::f32::consts::PI
        }
    } else if moving_away {
        std::f32::consts::PI
    } else {
        0.0
    };
    normalize_heading(current_pose.heading_to(&target_pose) + offset)
}

fn final_move_heading(
    params: EntityMoveToParameters,
    current_pose: WorldPosition,
    target_pose: WorldPosition,
    object_relative: bool,
) -> f32 {
    let authored = params.desired_heading_degrees.to_f32().to_radians();
    if object_relative {
        normalize_heading(current_pose.heading_to(&target_pose) + authored)
    } else {
        normalize_heading(authored)
    }
}

fn turn_order(
    current_pose: WorldPosition,
    desired_heading: f32,
    speed_mod: f32,
    use_moving_threshold: bool,
) -> Option<(MotionCommand, f32)> {
    progressing_turn_order(
        current_pose,
        desired_heading,
        speed_mod,
        use_moving_threshold,
        None,
    )
    .map(|(order, _)| order)
}

/// Select one turn and retire it once authored rotation crosses its target heading.
///
/// Retail remembers the chosen command, detects when that command carries the body past the queued
/// heading, snaps to the target, and stops the command (`MoveToManager::HandleTurnToHeading`,
/// acclient.c:331826-331885). The world solver owns pose commits here, so crossing retires the
/// authored turn at the first solved pose beyond the target rather than reversing it indefinitely.
fn progressing_turn_order(
    current_pose: WorldPosition,
    desired_heading: f32,
    speed_mod: f32,
    use_moving_threshold: bool,
    active_progress: Option<DirectedTurnProgress>,
) -> Option<((MotionCommand, f32), DirectedTurnProgress)> {
    let desired_heading = active_progress
        .map(|progress| progress.desired_heading)
        .unwrap_or_else(|| normalize_heading(desired_heading));
    let delta = signed_heading_delta(current_pose.rotation.to_heading(), desired_heading);
    let threshold = if use_moving_threshold {
        MOVING_TURN_THRESHOLD_RAD
    } else {
        TURN_COMPLETION_THRESHOLD_RAD
    };
    let current_direction = turn_direction(delta);
    if delta.abs() <= threshold
        || active_progress.is_some_and(|active| active.direction != current_direction)
    {
        return None;
    }
    let progress = active_progress.unwrap_or(DirectedTurnProgress {
        desired_heading,
        direction: current_direction,
    });
    Some((
        (
            // Retail canonicalizes TurnLeft into TurnRight with a negative speed before table
            // selection (`CMotionInterp::adjust_motion`, acclient.c:330006-330055). Keeping the
            // family identity canonical also lets the ordinary absent-turn release retire either
            // direction by exact command identity.
            MotionCommand::TURN_RIGHT,
            match progress.direction {
                DirectedTurnDirection::Positive => speed_mod,
                DirectedTurnDirection::Negative => -speed_mod,
            },
        ),
        progress,
    ))
}

fn turn_direction(delta: f32) -> DirectedTurnDirection {
    if delta > 0.0 {
        DirectedTurnDirection::Positive
    } else {
        DirectedTurnDirection::Negative
    }
}

fn effective_target_distance(current: WorldPosition, target: ServerDirectedTarget) -> f32 {
    (current.distance_to(&target.pose) - target.use_radius).max(0.0)
}

fn move_to_target(target: MoveToTarget) -> ServerDirectedTarget {
    match target {
        MoveToTarget::Position(target)
        | MoveToTarget::Object {
            current: target, ..
        } => target,
    }
}

fn position_target(position: OrderedMotionPosition) -> ServerDirectedTarget {
    ServerDirectedTarget {
        pose: position.world_position(),
        use_radius: 0.0,
    }
}

fn degrees_to_heading(degrees: f32) -> f32 {
    normalize_heading(degrees.to_radians())
}

fn normalize_heading(heading: f32) -> f32 {
    heading.rem_euclid(std::f32::consts::TAU)
}

fn signed_heading_delta(current: f32, desired: f32) -> f32 {
    let mut delta = (desired - current) % std::f32::consts::TAU;
    if delta <= -std::f32::consts::PI {
        delta += std::f32::consts::TAU;
    } else if delta > std::f32::consts::PI {
        delta -= std::f32::consts::TAU;
    }
    delta
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::{
        EntityMotionAdmission, EntityMoveToParameters, EntityTurnToParameters, OrderedMotionScalar,
    };
    use holtburger_common::{Quaternion, Vector3};

    const STYLE: MotionCommand = MotionCommand(0x8000_003D);

    fn scalar(value: f32) -> OrderedMotionScalar {
        OrderedMotionScalar::from_f32(value).expect("fixture scalar is finite")
    }

    fn admission() -> EntityMotionAdmission {
        EntityMotionAdmission {
            object_instance_sequence: 1,
            movement_sequence: 2,
            server_control_sequence: 3,
            is_autonomous: false,
        }
    }

    fn position(x: f32, y: f32, heading_degrees: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0xDA55_0001),
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::from_heading(heading_degrees.to_radians()),
        }
    }

    fn target_position(x: f32, y: f32) -> OrderedMotionPosition {
        OrderedMotionPosition {
            cell_id: Guid(0xDA55_0001),
            x: scalar(x),
            y: scalar(y),
            z: scalar(0.0),
        }
    }

    fn move_params(flags: u32) -> EntityMoveToParameters {
        EntityMoveToParameters {
            flags,
            distance_to_object: scalar(1.0),
            min_distance: scalar(2.0),
            fail_distance: scalar(100.0),
            speed: scalar(1.0),
            walk_run_threshold: scalar(5.0),
            desired_heading_degrees: scalar(90.0),
        }
    }

    fn steady() -> MotionOrder {
        MotionOrder {
            style: Some(STYLE),
            ..MotionOrder::default()
        }
    }

    #[test]
    fn move_to_turns_first_then_selects_retail_walk_run_threshold() {
        let directive = EntityMotionDirective::MoveToPosition {
            admission: admission(),
            target: target_position(20.0, 0.0),
            params: move_params(CAN_WALK | CAN_RUN | MOVE_TOWARDS),
            run_rate: scalar(1.25),
        };
        let current = position(0.0, 0.0, 90.0);
        let state = begin_server_directed_motion(directive, current, None);

        let ServerDirectedMotionResolution::Active(turning) =
            resolve_server_directed_motion(state, steady(), current, ContactState::Grounded, None)
        else {
            panic!("misaligned MoveTo should begin by turning");
        };
        assert!(turning.order.forward.is_none());
        assert!(turning.order.turn.is_some());

        let target = position(20.0, 0.0, 0.0);
        let aligned = position(0.0, 0.0, current.heading_to(&target).to_degrees());
        let ServerDirectedMotionResolution::Active(moving) = resolve_server_directed_motion(
            turning.state,
            steady(),
            aligned,
            ContactState::Grounded,
            None,
        ) else {
            panic!("aligned MoveTo should translate");
        };
        assert_eq!(
            moving.order.forward,
            Some((MotionCommand::RUN_FORWARD, 1.25))
        );
    }

    #[test]
    fn airborne_move_to_retains_progress_and_presents_falling_with_turn() {
        let current = position(0.0, 0.0, 0.0);
        let directive = EntityMotionDirective::MoveToPosition {
            admission: admission(),
            target: target_position(20.0, 0.0),
            params: move_params(CAN_WALK | MOVE_TOWARDS),
            run_rate: scalar(1.0),
        };
        let state = begin_server_directed_motion(directive, current, None);
        let ServerDirectedMotionResolution::Active(step) =
            resolve_server_directed_motion(state, steady(), current, ContactState::Airborne, None)
        else {
            panic!("airborne MoveTo remains pending");
        };

        assert_eq!(step.order.forward, Some((MotionCommand::FALLING, 1.0)));
        assert!(matches!(
            step.state.kind,
            ServerDirectedMotionKind::MoveTo(_)
        ));
    }

    #[test]
    fn turn_to_heading_converts_retail_degrees_once() {
        let current = position(0.0, 0.0, 90.0);
        let state = begin_server_directed_motion(
            EntityMotionDirective::TurnToHeading {
                admission: admission(),
                params: EntityTurnToParameters {
                    flags: STOP_COMPLETELY,
                    speed: scalar(1.0),
                    desired_heading_degrees: scalar(90.0),
                },
            },
            current,
            None,
        );
        assert_eq!(
            resolve_server_directed_motion(state, steady(), current, ContactState::Grounded, None,),
            ServerDirectedMotionResolution::Complete
        );
    }

    #[test]
    fn directed_turns_use_one_retail_command_with_signed_rates() {
        let current = position(0.0, 0.0, 90.0);
        let right = turn_order(current, 100.0_f32.to_radians(), 1.5, false)
            .expect("right target should require a turn");
        let left = turn_order(current, 80.0_f32.to_radians(), 1.5, false)
            .expect("left target should require a turn");

        assert_eq!(right, (MotionCommand::TURN_RIGHT, 1.5));
        assert_eq!(left, (MotionCommand::TURN_RIGHT, -1.5));
    }

    #[test]
    fn turn_to_retires_when_authored_rotation_crosses_the_target() {
        let start = position(0.0, 0.0, 90.0);
        let state = begin_server_directed_motion(
            EntityMotionDirective::TurnToHeading {
                admission: admission(),
                params: EntityTurnToParameters {
                    flags: STOP_COMPLETELY,
                    speed: scalar(1.0),
                    desired_heading_degrees: scalar(80.0),
                },
            },
            start,
            None,
        );
        let ServerDirectedMotionResolution::Active(turning) =
            resolve_server_directed_motion(state, steady(), start, ContactState::Grounded, None)
        else {
            panic!("left target should begin a directed turn");
        };
        assert_eq!(turning.order.turn, Some((MotionCommand::TURN_RIGHT, -1.0)));

        assert_eq!(
            resolve_server_directed_motion(
                turning.state,
                steady(),
                position(0.0, 0.0, 79.0),
                ContactState::Grounded,
                None,
            ),
            ServerDirectedMotionResolution::Complete
        );
    }

    #[test]
    fn active_turn_to_object_keeps_its_queued_heading_when_the_target_moves() {
        let current = position(0.0, 0.0, 90.0);
        let initial_target = ServerDirectedTarget::new(position(20.0, 0.0, 0.0), 0.5).unwrap();
        let moved_target = ServerDirectedTarget::new(position(-20.0, 0.0, 0.0), 0.5).unwrap();
        let state = begin_server_directed_motion(
            EntityMotionDirective::TurnToObject {
                admission: admission(),
                target: Guid(7),
                fallback_heading_degrees: scalar(0.0),
                params: EntityTurnToParameters {
                    flags: STOP_COMPLETELY,
                    speed: scalar(1.0),
                    desired_heading_degrees: scalar(0.0),
                },
            },
            current,
            Some(initial_target),
        );
        let ServerDirectedMotionResolution::Active(initial_turn) = resolve_server_directed_motion(
            state,
            steady(),
            current,
            ContactState::Grounded,
            Some(initial_target),
        ) else {
            panic!("misaligned object target should begin a directed turn");
        };

        let ServerDirectedMotionResolution::Active(retained_turn) = resolve_server_directed_motion(
            initial_turn.state,
            steady(),
            current,
            ContactState::Grounded,
            Some(moved_target),
        ) else {
            panic!("target motion must not masquerade as actor crossing");
        };
        assert_eq!(retained_turn.order.turn, initial_turn.order.turn);
    }

    #[test]
    fn move_to_crossing_retires_initial_turn_and_selects_run() {
        let start = position(0.0, 0.0, 1.0);
        let state = begin_server_directed_motion(
            EntityMotionDirective::MoveToPosition {
                admission: admission(),
                target: target_position(20.0, 0.0),
                params: move_params(CAN_WALK | CAN_RUN | MOVE_TOWARDS),
                run_rate: scalar(1.25),
            },
            start,
            None,
        );
        let ServerDirectedMotionResolution::Active(turning) =
            resolve_server_directed_motion(state, steady(), start, ContactState::Grounded, None)
        else {
            panic!("misaligned MoveTo should begin a directed turn");
        };
        assert_eq!(turning.order.turn, Some((MotionCommand::TURN_RIGHT, 1.0)));

        let ServerDirectedMotionResolution::Active(moving) = resolve_server_directed_motion(
            turning.state,
            steady(),
            position(0.0, 0.0, 181.0),
            ContactState::Grounded,
            None,
        ) else {
            panic!("crossed initial heading should advance to translation");
        };
        assert_eq!(
            moving.order.forward,
            Some((MotionCommand::RUN_FORWARD, 1.25))
        );
        assert_eq!(moving.order.turn, None);
    }

    #[test]
    fn an_object_resolved_at_admission_fails_if_it_disappears() {
        let current = position(0.0, 0.0, 0.0);
        let target = ServerDirectedTarget::new(position(20.0, 0.0, 0.0), 0.5).unwrap();
        let state = begin_server_directed_motion(
            EntityMotionDirective::MoveToObject {
                admission: admission(),
                target: Guid(7),
                fallback_target: target_position(20.0, 0.0),
                params: move_params(CAN_WALK | MOVE_TOWARDS),
                run_rate: scalar(1.0),
            },
            current,
            Some(target),
        );

        assert_eq!(
            resolve_server_directed_motion(state, steady(), current, ContactState::Grounded, None,),
            ServerDirectedMotionResolution::Failed(
                ServerDirectedMotionFailure::TargetUnavailable { guid: Guid(7) }
            )
        );
    }

    #[test]
    fn walk_run_threshold_is_strict_at_the_retail_boundary() {
        let params = move_params(CAN_WALK | CAN_RUN | MOVE_TOWARDS);
        let target_pose = position(6.0, 0.0, 0.0);
        let exactly_at_threshold = position(
            0.0,
            0.0,
            position(0.0, 0.0, 0.0)
                .heading_to(&target_pose)
                .to_degrees(),
        );
        let directive = EntityMotionDirective::MoveToPosition {
            admission: admission(),
            target: target_position(6.0, 0.0),
            params,
            run_rate: scalar(1.25),
        };
        let state = begin_server_directed_motion(directive, exactly_at_threshold, None);
        let ServerDirectedMotionResolution::Active(step) = resolve_server_directed_motion(
            state,
            steady(),
            exactly_at_threshold,
            ContactState::Grounded,
            None,
        ) else {
            panic!("threshold fixture should remain active");
        };
        assert_eq!(step.order.forward, Some((MotionCommand::WALK_FORWARD, 1.0)));
    }

    #[test]
    fn move_away_faces_outward_and_completes_at_minimum_distance() {
        let params = move_params(CAN_WALK | MOVE_AWAY);
        let target_pose = position(0.0, 0.0, 0.0);
        let unaligned = position(1.0, 0.0, 0.0);
        let outward_heading =
            normalize_heading(unaligned.heading_to(&target_pose) + std::f32::consts::PI);
        let close = position(1.0, 0.0, outward_heading.to_degrees());
        let target = target_position(0.0, 0.0);
        let directive = EntityMotionDirective::MoveToPosition {
            admission: admission(),
            target,
            params,
            run_rate: scalar(1.0),
        };
        let state = begin_server_directed_motion(directive, close, None);
        let ServerDirectedMotionResolution::Active(step) =
            resolve_server_directed_motion(state, steady(), close, ContactState::Grounded, None)
        else {
            panic!("close move-away fixture should remain active");
        };
        assert_eq!(step.order.forward, Some((MotionCommand::WALK_FORWARD, 1.0)));

        let separated = position(2.0, 0.0, 0.0);
        assert_eq!(
            resolve_server_directed_motion(
                step.state,
                steady(),
                separated,
                ContactState::Grounded,
                None,
            ),
            ServerDirectedMotionResolution::Complete,
        );
    }

    #[test]
    fn crossing_target_airborne_does_not_complete_until_grounded() {
        let target_pose = position(20.0, 0.0, 0.0);
        let start = position(
            0.0,
            0.0,
            position(0.0, 0.0, 0.0)
                .heading_to(&target_pose)
                .to_degrees(),
        );
        let directive = EntityMotionDirective::MoveToPosition {
            admission: admission(),
            target: target_position(20.0, 0.0),
            params: move_params(CAN_WALK | MOVE_TOWARDS),
            run_rate: scalar(1.0),
        };
        let state = begin_server_directed_motion(directive, start, None);
        let ServerDirectedMotionResolution::Active(moving) =
            resolve_server_directed_motion(state, steady(), start, ContactState::Grounded, None)
        else {
            panic!("grounded fixture should begin moving");
        };
        let crossed = position(20.0, 0.0, 0.0);
        let ServerDirectedMotionResolution::Active(airborne) = resolve_server_directed_motion(
            moving.state,
            steady(),
            crossed,
            ContactState::Airborne,
            None,
        ) else {
            panic!("airborne target crossing must retain the directive");
        };
        assert_eq!(airborne.order.forward, Some((MotionCommand::FALLING, 1.0)));
        assert_eq!(
            resolve_server_directed_motion(
                airborne.state,
                steady(),
                crossed,
                ContactState::Grounded,
                None,
            ),
            ServerDirectedMotionResolution::Complete,
        );
    }
}
