//! Independent, asset-free reconstruction of the retail pose-reconciliation pipeline.
//!
//! This module deliberately does not import the production correction state. It transliterates
//! the cited decompile branches into a small oracle so the client implementation can be compared
//! against a second model rather than agreeing with itself. The ordering is fixed by
//! `PositionManager::adjust_offset` (`acclient.c:371277-371292`): interpolation assigns the
//! translation (`acclient.c:372004-372094`), then the constraint manager damps it
//! (`acclient.c:372268-372296`).

use holtburger_common::Vector3;

const NODE_COMPLETE_DISTANCE: f32 = 0.05;
const SNAP_DISTANCE: f32 = 96.0;
const DEFAULT_STEP_RATE: f32 = 7.5;
const EPSILON: f32 = 0.000_2;
const WATCHDOG_FRAMES: u32 = 5;
const WATCHDOG_RATIO: f32 = 0.3;
const WATCHDOG_NEAR_COMPLETE_DISTANCE: f32 = 0.2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OracleDisposition {
    Ignored,
    /// Accept only the outer position timestamp; retail does not install the packet pose.
    SequenceOnly,
    Reset(OracleResetCause),
    Snap,
    Interpolate {
        keep_heading: bool,
    },
}

/// Discontinuous placement reasons that must not collapse into an ordinary correction snap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OracleResetCause {
    MissingCell,
    Teleport,
}

/// Retail's local-player branch, which is distinct from generic `MoveOrTeleport` dispatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OracleSelfDisposition {
    Ignored,
    ForcePositionReset,
    TeleportReset,
    Confirm,
    ConfirmAndInterpolate { keep_heading: bool },
}

/// Packet and client-authority facts consumed by retail's self-player receive branch.
#[derive(Debug, Clone, Copy)]
struct OracleSelfUpdate {
    /// Whether `newer_event(FORCE_POSITION_TS)` accepted this packet's force timestamp.
    force_position_newer: bool,
    /// Whether `newer_event(POSITION_TS)` accepted this packet's position timestamp.
    position_newer: bool,
    /// Teleport epoch carried by this packet.
    teleport_sequence: u16,
    /// Packet `has_contact`, independently of locally solved contact state.
    contact: bool,
    /// Result of retail `CommandInterpreter::UsePositionFromServer`.
    use_position_from_server: bool,
    /// Whether an active MoveTo owns heading while interpolation applies.
    keep_heading: bool,
}

#[derive(Debug, Clone, Copy)]
struct OracleUpdate {
    teleport_sequence: u16,
    has_cell: bool,
    contact: bool,
    distance: f32,
    moving_to: bool,
}

fn retail_newer_u16(candidate: u16, reference: u16) -> bool {
    let delta = i32::from(candidate) - i32::from(reference);
    if delta.abs() > 0x7FFF {
        candidate < reference
    } else {
        reference < candidate
    }
}

fn oracle_move_or_teleport(
    update: OracleUpdate,
    known_teleport_sequence: u16,
) -> OracleDisposition {
    if retail_newer_u16(known_teleport_sequence, update.teleport_sequence) {
        return OracleDisposition::Ignored;
    }
    if retail_newer_u16(update.teleport_sequence, known_teleport_sequence) || !update.has_cell {
        return OracleDisposition::Reset(if update.has_cell {
            OracleResetCause::Teleport
        } else {
            OracleResetCause::MissingCell
        });
    }
    if !update.contact {
        return OracleDisposition::SequenceOnly;
    }
    if update.distance >= SNAP_DISTANCE {
        return OracleDisposition::Snap;
    }
    OracleDisposition::Interpolate {
        keep_heading: update.moving_to,
    }
}

/// Transliteration of the self-player half of `SmartBox::HandleReceivedPosition`
/// (`acclient.c:138968-139041`). Server-control state is deliberately absent: retail consults
/// `UsePositionFromServer`, whose input is autonomy level, not `controlled_by_server`.
fn oracle_self_received_position(
    update: OracleSelfUpdate,
    known_teleport_sequence: u16,
) -> OracleSelfDisposition {
    let packet_teleport_is_stale =
        retail_newer_u16(known_teleport_sequence, update.teleport_sequence);
    if update.force_position_newer && !packet_teleport_is_stale {
        return OracleSelfDisposition::ForcePositionReset;
    }
    if !update.position_newer || packet_teleport_is_stale {
        return OracleSelfDisposition::Ignored;
    }
    if retail_newer_u16(update.teleport_sequence, known_teleport_sequence) {
        return OracleSelfDisposition::TeleportReset;
    }
    if update.use_position_from_server && update.contact {
        return OracleSelfDisposition::ConfirmAndInterpolate {
            keep_heading: update.keep_heading,
        };
    }
    OracleSelfDisposition::Confirm
}

/// Runtime contact projected from retail's `transient_state & Contact` bit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OracleRuntimeContact {
    Unknown,
    Airborne,
    Sliding,
    Grounded,
}

impl OracleRuntimeContact {
    /// `Sliding` is contact without `OnWalkable`; it still admits correction mechanics.
    const fn has_contact(self) -> bool {
        matches!(self, Self::Sliding | Self::Grounded)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct OracleNode {
    original_distance: f32,
    frame_counter: u32,
    progress_quantum: f32,
    failed_nodes: u8,
}

impl OracleNode {
    fn new(distance: f32) -> Self {
        Self {
            original_distance: distance,
            frame_counter: 0,
            progress_quantum: 0.0,
            failed_nodes: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum OracleInterpolationOutcome {
    NotApplied,
    Completed,
    Abandoned,
    Assigned {
        translation: Vector3,
        heading_zeroed: bool,
    },
    Snap,
}

fn oracle_interpolation_adjust(
    node: &mut OracleNode,
    contact: OracleRuntimeContact,
    to_target: Vector3,
    max_speed: Option<f32>,
    keep_heading: bool,
    quantum: f32,
    queued_successor: bool,
) -> OracleInterpolationOutcome {
    if !contact.has_contact() {
        return OracleInterpolationOutcome::NotApplied;
    }
    let distance = to_target.length();
    if distance < NODE_COMPLETE_DISTANCE {
        return OracleInterpolationOutcome::Completed;
    }
    let rate = max_speed
        .map(|speed| speed * 2.0)
        .filter(|speed| speed.is_finite() && *speed >= EPSILON)
        .unwrap_or(DEFAULT_STEP_RATE);
    node.frame_counter += 1;
    node.progress_quantum += quantum.max(0.0);
    if node.frame_counter >= WATCHDOG_FRAMES {
        let progress = node.original_distance - distance;
        let progressing = progress >= EPSILON
            && node.progress_quantum > EPSILON
            && progress / node.progress_quantum / rate >= WATCHDOG_RATIO;
        if !progressing {
            if distance < WATCHDOG_NEAR_COMPLETE_DISTANCE {
                return OracleInterpolationOutcome::Completed;
            }
            node.failed_nodes = node.failed_nodes.saturating_add(1);
            if !queued_successor || node.failed_nodes > 3 {
                return OracleInterpolationOutcome::Snap;
            }
            return OracleInterpolationOutcome::Abandoned;
        }
        node.frame_counter = 0;
        node.progress_quantum = 0.0;
        node.original_distance = distance;
    }
    let cap = rate * quantum.max(0.0);
    let translation = if distance > cap && distance > EPSILON {
        to_target * (cap / distance)
    } else {
        to_target
    };
    OracleInterpolationOutcome::Assigned {
        translation,
        heading_zeroed: keep_heading,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct OracleConstraint {
    start: f32,
    maximum: f32,
    accumulated: f32,
}

fn oracle_constraint(indoors: bool, current_drift: f32) -> OracleConstraint {
    let (start, maximum) = if indoors { (5.0, 20.0) } else { (10.0, 50.0) };
    OracleConstraint {
        start,
        maximum,
        accumulated: current_drift,
    }
}

fn oracle_constraint_adjust(
    constraint: &mut OracleConstraint,
    contact: OracleRuntimeContact,
    translation: Vector3,
) -> Vector3 {
    let mut damped = translation;
    if contact.has_contact() {
        if constraint.accumulated >= constraint.maximum {
            damped = Vector3::zero();
        } else if constraint.accumulated > constraint.start {
            let scale = (constraint.maximum - constraint.accumulated)
                / (constraint.maximum - constraint.start);
            damped = damped * scale.max(0.0);
        }
    }
    constraint.accumulated += damped.length();
    damped
}

/// One complete oracle tick. A returned `None` means that interpolation was gated and authored
/// translation survives; the caller still runs the constraint stage over that authored basis.
struct OracleTickInput {
    /// Whether retail's current placement reports contact.
    contact: OracleRuntimeContact,
    /// Authored translation retained when interpolation does not apply.
    authored_translation: Vector3,
    /// Current displacement from the body to its correction target.
    to_target: Vector3,
    /// Optional current motion-table speed bound.
    max_speed: Option<f32>,
    /// Whether interpolation preserves the authored heading.
    keep_heading: bool,
    /// Fixed oracle tick duration in seconds.
    quantum: f32,
}

fn oracle_tick(
    node: Option<&mut OracleNode>,
    constraint: &mut OracleConstraint,
    input: OracleTickInput,
) -> (Vector3, bool) {
    let OracleTickInput {
        contact,
        authored_translation,
        to_target,
        max_speed,
        keep_heading,
        quantum,
    } = input;
    let (translation, heading_zeroed) = match node {
        Some(node) => match oracle_interpolation_adjust(
            node,
            contact,
            to_target,
            max_speed,
            keep_heading,
            quantum,
            false,
        ) {
            OracleInterpolationOutcome::Assigned {
                translation,
                heading_zeroed,
            } => (translation, heading_zeroed),
            OracleInterpolationOutcome::NotApplied
            | OracleInterpolationOutcome::Completed
            | OracleInterpolationOutcome::Abandoned
            | OracleInterpolationOutcome::Snap => (authored_translation, false),
        },
        None => (authored_translation, false),
    };
    (
        oracle_constraint_adjust(constraint, contact, translation),
        heading_zeroed,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(sequence: u16, has_cell: bool, contact: bool, distance: f32) -> OracleUpdate {
        OracleUpdate {
            teleport_sequence: sequence,
            has_cell,
            contact,
            distance,
            moving_to: false,
        }
    }

    fn assert_close(actual: f32, expected: f32) {
        assert!(
            (actual - expected).abs() < 1e-5,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn stale_and_wrapped_teleport_sequences_follow_retail() {
        assert_eq!(
            oracle_move_or_teleport(update(3, true, true, 1.0), 4),
            OracleDisposition::Ignored
        );
        assert_eq!(
            oracle_move_or_teleport(update(1, true, true, 1.0), u16::MAX),
            OracleDisposition::Reset(OracleResetCause::Teleport)
        );
        assert_eq!(
            oracle_move_or_teleport(update(u16::MAX, true, true, 1.0), 1),
            OracleDisposition::Ignored
        );
    }

    #[test]
    fn missing_cell_new_epoch_airborne_and_far_branches_are_distinct() {
        assert_eq!(
            oracle_move_or_teleport(update(4, false, false, 1.0), 4),
            OracleDisposition::Reset(OracleResetCause::MissingCell)
        );
        assert_eq!(
            oracle_move_or_teleport(update(5, true, false, 1.0), 4),
            OracleDisposition::Reset(OracleResetCause::Teleport)
        );
        assert_eq!(
            oracle_move_or_teleport(update(4, true, false, 1.0), 4),
            OracleDisposition::SequenceOnly
        );
        assert_eq!(
            oracle_move_or_teleport(update(4, true, true, SNAP_DISTANCE), 4),
            OracleDisposition::Snap
        );
    }

    #[test]
    fn self_default_autonomy_confirms_without_interpolating() {
        let disposition = oracle_self_received_position(
            OracleSelfUpdate {
                force_position_newer: false,
                position_newer: true,
                teleport_sequence: 4,
                contact: true,
                use_position_from_server: false,
                keep_heading: true,
            },
            4,
        );
        assert_eq!(disposition, OracleSelfDisposition::Confirm);
    }

    #[test]
    fn self_non_default_autonomy_interpolates_only_with_packet_contact() {
        let update = |contact| OracleSelfUpdate {
            force_position_newer: false,
            position_newer: true,
            teleport_sequence: 4,
            contact,
            use_position_from_server: true,
            keep_heading: true,
        };
        assert_eq!(
            oracle_self_received_position(update(true), 4),
            OracleSelfDisposition::ConfirmAndInterpolate { keep_heading: true }
        );
        assert_eq!(
            oracle_self_received_position(update(false), 4),
            OracleSelfDisposition::Confirm
        );
    }

    #[test]
    fn self_force_and_teleport_resets_are_not_ordinary_corrections() {
        let update = |force_position_newer, teleport_sequence| OracleSelfUpdate {
            force_position_newer,
            position_newer: true,
            teleport_sequence,
            contact: true,
            use_position_from_server: false,
            keep_heading: false,
        };
        assert_eq!(
            oracle_self_received_position(update(true, 4), 4),
            OracleSelfDisposition::ForcePositionReset
        );
        assert_eq!(
            oracle_self_received_position(update(false, 5), 4),
            OracleSelfDisposition::TeleportReset
        );
    }

    #[test]
    fn moving_to_pins_heading_only_for_interpolation() {
        let mut move_to = update(4, true, true, 1.0);
        move_to.moving_to = true;
        assert_eq!(
            oracle_move_or_teleport(move_to, 4),
            OracleDisposition::Interpolate { keep_heading: true }
        );
    }

    #[test]
    fn interpolation_assigns_instead_of_adds_and_uses_twice_speed() {
        let mut node = OracleNode::new(10.0);
        let mut leash = oracle_constraint(false, 0.0);
        let (translation, heading_zeroed) = oracle_tick(
            Some(&mut node),
            &mut leash,
            OracleTickInput {
                contact: OracleRuntimeContact::Grounded,
                authored_translation: Vector3::new(1.0, 2.0, 0.0),
                to_target: Vector3::new(10.0, 0.0, 0.0),
                max_speed: Some(4.0),
                keep_heading: false,
                quantum: 0.03,
            },
        );
        assert_close(translation.x, 0.24);
        assert_close(translation.y, 0.0);
        assert!(!heading_zeroed);
    }

    #[test]
    fn watchdog_completes_near_and_distinguishes_last_from_queued_failure() {
        let mut node = OracleNode::new(10.0);
        for _ in 0..4 {
            assert!(matches!(
                oracle_interpolation_adjust(
                    &mut node,
                    OracleRuntimeContact::Grounded,
                    Vector3::new(10.0, 0.0, 0.0),
                    Some(1.0),
                    false,
                    0.03,
                    false,
                ),
                OracleInterpolationOutcome::Assigned { .. }
            ));
        }
        assert_eq!(
            oracle_interpolation_adjust(
                &mut node,
                OracleRuntimeContact::Grounded,
                Vector3::new(10.0, 0.0, 0.0),
                Some(1.0),
                false,
                0.03,
                false,
            ),
            OracleInterpolationOutcome::Snap
        );
        let mut queued = OracleNode::new(10.0);
        queued.frame_counter = 4;
        assert_eq!(
            oracle_interpolation_adjust(
                &mut queued,
                OracleRuntimeContact::Grounded,
                Vector3::new(10.0, 0.0, 0.0),
                Some(1.0),
                false,
                0.03,
                true,
            ),
            OracleInterpolationOutcome::Abandoned
        );
        let mut near = OracleNode::new(0.1);
        for _ in 0..4 {
            let _ = oracle_interpolation_adjust(
                &mut near,
                OracleRuntimeContact::Grounded,
                Vector3::new(0.1, 0.0, 0.0),
                Some(1.0),
                false,
                0.03,
                false,
            );
        }
        assert_eq!(
            oracle_interpolation_adjust(
                &mut near,
                OracleRuntimeContact::Grounded,
                Vector3::new(0.1, 0.0, 0.0),
                Some(1.0),
                false,
                0.03,
                false,
            ),
            OracleInterpolationOutcome::Completed
        );
    }

    #[test]
    fn constraint_uses_indoor_outdoor_edges_and_post_damping_accumulation() {
        let mut indoor = oracle_constraint(true, 5.0);
        assert_eq!(
            oracle_constraint_adjust(
                &mut indoor,
                OracleRuntimeContact::Grounded,
                Vector3::new(2.0, 0.0, 0.0),
            ),
            Vector3::new(2.0, 0.0, 0.0)
        );
        let mut outdoor = oracle_constraint(false, 30.0);
        let damped = oracle_constraint_adjust(
            &mut outdoor,
            OracleRuntimeContact::Sliding,
            Vector3::new(2.0, 0.0, 0.0),
        );
        assert_close(damped.x, 1.0);
        assert_close(outdoor.accumulated, 31.0);
        let airborne = oracle_constraint_adjust(
            &mut outdoor,
            OracleRuntimeContact::Airborne,
            Vector3::new(2.0, 0.0, 0.0),
        );
        assert_eq!(airborne, Vector3::new(2.0, 0.0, 0.0));
        assert_close(outdoor.accumulated, 33.0);
        let unknown = oracle_constraint_adjust(
            &mut outdoor,
            OracleRuntimeContact::Unknown,
            Vector3::new(1.0, 0.0, 0.0),
        );
        assert_eq!(unknown, Vector3::new(1.0, 0.0, 0.0));
        assert_close(outdoor.accumulated, 34.0);
    }
}
