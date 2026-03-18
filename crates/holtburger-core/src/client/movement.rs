use crate::client::WireEvent;
use crate::client::locomotion::{
    LocomotionPrimitive, LocomotionRequest, MotionStyle, MovementPacketMetadata,
};
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::sequence::is_newer_u16;
use holtburger_common::{Guid, Quaternion};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::{WorldEvent, WorldState};
/// Maximum distance (in meters) to allow an automated server-controlled teleport.
const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;
const WALK_FORWARD_MOTION_COMMAND: u32 = 0x4500_0005;

fn calculate_arrival_position(
    source: &WorldPosition,
    target_pos: &holtburger_common::Vector3,
    distance: f32,
) -> holtburger_common::Vector3 {
    let to_player = source.coords - *target_pos;
    if to_player.length_squared() > 1e-6 {
        *target_pos + (to_player.normalize() * distance)
    } else {
        let mut fallback = *target_pos;
        fallback.x += distance;
        fallback
    }
}

pub(super) fn raw_motion_state_with_motion_style(
    world: &WorldState,
    mut raw_motion_state: RawMotionState,
    motion_style: MotionStyle,
) -> RawMotionState {
    match motion_style {
        MotionStyle::PreserveServer => {
            if let Some(current_style) = world.player.last_server_motion_style {
                raw_motion_state.set_current_stance(current_style);
            }
        }
        MotionStyle::Explicit(current_style) => {
            raw_motion_state.set_current_stance(current_style);
        }
        MotionStyle::Omit => {
            raw_motion_state.flags.remove(RawMotionFlags::CURRENT_STYLE);
            raw_motion_state.current_style = None;
        }
    }

    raw_motion_state
}

pub(super) fn encode_contact_long_jump(metadata: MovementPacketMetadata) -> u8 {
    u8::from(metadata.contact.unwrap_or(true))
}

pub(super) fn encode_last_contact(metadata: MovementPacketMetadata) -> u8 {
    u8::from(metadata.contact.unwrap_or(true))
}

#[derive(Debug, Default)]
pub(super) struct MovementSequenceDiagnostics {
    last_force_position_sequence: Option<u16>,
    last_teleport_sequence: Option<u16>,
    last_server_control_sequence: Option<u16>,
}

impl MovementSequenceDiagnostics {
    pub(super) fn record_force_position_sequence(&mut self, force_position_sequence: u16) {
        if let Some(old_seq) = self.last_force_position_sequence {
            if is_newer_u16(force_position_sequence, old_seq) {
                log::warn!(
                    "Server forced reposition (rubber band): force seq {} -> {}",
                    old_seq,
                    force_position_sequence
                );
            } else if force_position_sequence != old_seq {
                log::debug!(
                    "Ignoring stale forced reposition: force seq {} after {}",
                    force_position_sequence,
                    old_seq
                );
            }
        }

        self.last_force_position_sequence = Some(force_position_sequence);
    }

    pub(super) fn record_autonomous_position_sequences(
        &mut self,
        teleport_sequence: u16,
        force_position_sequence: u16,
        server_control_sequence: u16,
    ) {
        match self.last_teleport_sequence {
            Some(old_seq) if is_newer_u16(teleport_sequence, old_seq) => {
                log::info!(
                    "Server-forced resync teleport epoch advanced: teleport seq {} -> {} (force seq {}, server-control seq {})",
                    old_seq,
                    teleport_sequence,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            Some(old_seq) if teleport_sequence != old_seq => {
                log::debug!(
                    "Ignoring stale server-forced resync: teleport seq {} after {} (force seq {}, server-control seq {})",
                    teleport_sequence,
                    old_seq,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            None => {
                log::info!(
                    "Tracking teleport sequence {} for autonomous resync (force seq {}, server-control seq {})",
                    teleport_sequence,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            _ => {}
        }

        self.last_teleport_sequence = Some(teleport_sequence);
        self.last_force_position_sequence = Some(force_position_sequence);
        self.last_server_control_sequence = Some(server_control_sequence);
    }

    pub(super) fn record_server_control_sequence(&mut self, server_control_sequence: u16) {
        match self.last_server_control_sequence {
            Some(old_seq) if is_newer_u16(server_control_sequence, old_seq) => {
                log::debug!(
                    "Server-controlled motion epoch advanced: {} -> {}",
                    old_seq,
                    server_control_sequence
                );
            }
            Some(old_seq) if server_control_sequence != old_seq => {
                log::warn!(
                    "Server-controlled motion reordered/stale: {} after {}",
                    server_control_sequence,
                    old_seq
                );
            }
            None => {
                log::debug!(
                    "Tracking server-controlled motion sequence: {}",
                    server_control_sequence
                );
            }
            _ => {}
        }

        self.last_server_control_sequence = Some(server_control_sequence);
    }
}

pub(super) struct MovementSystem {
    pub(super) sequence_diagnostics: MovementSequenceDiagnostics,
}

impl MovementSystem {
    pub(super) fn new() -> Self {
        Self {
            sequence_diagnostics: MovementSequenceDiagnostics::default(),
        }
    }

    pub(super) async fn execute_locomotion_request(
        &mut self,
        request: LocomotionRequest,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
        let primitive = request.primitive;
        let state_events = self.apply_locomotion_primitive(primitive, world);

        if primitive.refresh_server() {
            match primitive {
                LocomotionPrimitive::Drive { heading, speed, .. } => {
                    // When refresh_server() is true, honor the explicit request by always
                    // sending a drive pulse, rather than suppressing it based on
                    // heading/speed thresholds.
                    Self::send_drive_pulse(world, session, heading, speed, request.metadata)
                        .await?;
                }
                LocomotionPrimitive::Stop { .. } => {
                    Self::send_stop_pulse(world, session, request.metadata).await?;
                }
            }
        }

        Ok(state_events)
    }

    pub(super) fn apply_locomotion_primitive(
        &mut self,
        primitive: LocomotionPrimitive,
        world: &mut WorldState,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        if let LocomotionPrimitive::Drive { heading, .. } = primitive {
            let mut next_pos = world.player.position;
            next_pos.rotation = Quaternion::from_heading(heading);
            events.extend(world.set_player_position(next_pos));
        }

        if let Some(velocity) = primitive.desired_velocity() {
            events.extend(world.set_player_velocity(velocity));
        }

        events
    }

    async fn send_drive_pulse(
        world: &WorldState,
        session: &mut Session,
        heading: f32,
        speed: f32,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let mut position = world.player.position;
        position.rotation = Quaternion::from_heading(heading);

        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: raw_motion_state_with_motion_style(
                world,
                RawMotionState {
                    flags: RawMotionFlags::CURRENT_HOLD_KEY
                        | RawMotionFlags::FORWARD_COMMAND
                        | RawMotionFlags::FORWARD_SPEED,
                    current_hold_key: Some(HoldKey::Run as u32),
                    forward_command: Some(WALK_FORWARD_MOTION_COMMAND),
                    forward_speed: Some(speed),
                    ..Default::default()
                },
                metadata.motion_style,
            ),
            position,
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(metadata),
        };

        session
            .send_action(GameAction::MoveToState(Box::new(data)))
            .await
    }

    async fn send_stop_pulse(
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: raw_motion_state_with_motion_style(
                world,
                RawMotionState::default(),
                metadata.motion_style,
            ),
            position: world.player.position,
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(metadata),
        };

        session
            .send_action(GameAction::MoveToState(Box::new(data)))
            .await
    }

    pub(super) async fn handle_server_controlled_movement(
        &mut self,
        data: MovementEventData,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<(Vec<WireEvent>, Vec<WorldEvent>)> {
        let mut wire_events = Vec::new();
        log::info!(
            ">>> Processing server-initiated movement: {:?}. Control Sequence: {}",
            data.movement_type,
            data.server_control_sequence
        );

        let mut next_pos = world.player.position;

        match &data.data {
            MovementTypeData::MoveToObject(mto) => {
                // We use the origin provided in the packet as the source of truth for the target's position.
                // This is more reliable than our local entity tracking which might be uninitialized (e.g. landblock 0).
                next_pos.landblock_id = mto.origin.cell_id;
                next_pos.coords = mto.origin.position;

                let arrival_dist = mto.params.distance_to_object;

                // Calculate arrival on the line between the player and the target
                if (world.player.position.landblock_id >> 16) == (next_pos.landblock_id >> 16) {
                    next_pos.coords = calculate_arrival_position(
                        &world.player.position,
                        &next_pos.coords,
                        arrival_dist,
                    );

                    // If desired_heading is 0.0, face the target
                    if mto.params.desired_heading.abs() <= 1e-6 {
                        next_pos.rotation = Quaternion::from_heading(
                            next_pos.coords.heading_to(&mto.origin.position),
                        );
                    } else {
                        next_pos.rotation = Quaternion::from_heading(mto.params.desired_heading);
                    }
                } else {
                    // Different landblocks, fallback to simple offset
                    next_pos.coords.x += arrival_dist;
                }
            }
            MovementTypeData::MoveToPosition(mtp) => {
                next_pos.landblock_id = mtp.origin.cell_id;
                next_pos.coords = mtp.origin.position;

                // If desired_heading is not zero, use it.
                if mtp.params.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(mtp.params.desired_heading);
                } else {
                    // Face the target position from our current position
                    next_pos.rotation = Quaternion::from_heading(
                        world.player.position.coords.heading_to(&next_pos.coords),
                    );
                }
            }
            MovementTypeData::TurnToHeading(tth) => {
                next_pos.rotation = Quaternion::from_heading(tth.params.desired_heading);
            }
            MovementTypeData::TurnToObject(tto) => {
                // If the turn has a heading, use it. Some TurnToObjects have 0.0 which means "compute it".
                if tto.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(tto.desired_heading);
                } else if let Some(target) = world.get_visible_entity(tto.target) {
                    // Try to compute heading to target (West = 0, North = 90, East = 180, South = 270)
                    // We only do this if they are in the same landblock for now.
                    if target.position.landblock_id == next_pos.landblock_id {
                        next_pos.rotation = Quaternion::from_heading(
                            next_pos.coords.heading_to(&target.position.coords),
                        );
                    }
                }
            }
            _ => {
                // For other movement types (like Stop), we just accept current position
            }
        }

        // Update local world state (Teleport)
        // Check distance safely - ignore check if we are uninitialized (landblock 0) or just logging in
        let distance = if world.player.position.landblock_id == Guid::NULL {
            0.0
        } else {
            world.player.position.distance_to(&next_pos)
        };

        if distance > AUTO_MOVE_DISTANCE_LIMIT {
            log::warn!(
                "Aborting auto-move: target is {:.2}m away (limit {}m)",
                distance,
                AUTO_MOVE_DISTANCE_LIMIT
            );
            wire_events.push(WireEvent::ClientError(format!(
                "Item is too far away ({:.1}m). Move closer!",
                distance
            )));
            return Ok((wire_events, Vec::new()));
        }

        let state_events = world.set_player_position(next_pos);

        // Respond with AutonomousPosition heartbeat to confirm arrival
        // We use AutonomousPosition instead of MoveToState because MoveToState
        // cancels server-side movement chains (like pickups) on the ACE server.
        let pulse = AutonomousPositionActionData {
            position: next_pos,
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            last_contact: encode_last_contact(MovementPacketMetadata::default()),
        };

        log::debug!(
            ">>>> Sending AutonomousPosition heartbeat. ServerSeq: {}, Pos: {:?}",
            world.player.server_control_sequence,
            next_pos
        );

        let action = GameActionMessage {
            sequence: 0, // Heartbeats usually use 0 or a separate counter
            action: GameAction::AutonomousPosition(Box::new(pulse)),
        };

        session
            .send_message(&GameMessage::GameAction(Box::new(action)))
            .await?;

        Ok((wire_events, state_events))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Vector3;
    use holtburger_protocol::messages::movement::MotionStance;
    use holtburger_world::WorldState;

    #[test]
    fn test_calculate_heading_to() {
        let source = Vector3::new(0.0, 0.0, 0.0);
        // North (0, 1, 0) -> Math Rad: atan2(0, 1) = 0. Deg: 450 - 0 = 450 % 360 = 90 deg (1.57 rad)
        // Wait, let's verify AC heading convention.
        // My function says 90 deg for North.
        let heading = source.heading_to(&Vector3::new(0.0, 1.0, 0.0));
        assert!((heading.to_degrees() - 90.0).abs() < 1e-4);

        // West (-1, 0, 0) -> Math Rad: atan2(1, 0) = pi/2 (90 deg). Deg: 450 - 90 = 360 % 360 = 0 deg
        let heading = source.heading_to(&Vector3::new(-1.0, 0.0, 0.0));
        assert!((heading.to_degrees() - 0.0).abs() < 1e-4);

        // East (1, 0, 0) -> Math Rad: atan2(-1, 0) = -pi/2 (-90 deg). Deg: 450 - (-90) = 540 % 360 = 180 deg
        let heading = source.heading_to(&Vector3::new(1.0, 0.0, 0.0));
        assert!((heading.to_degrees() - 180.0).abs() < 1e-4);

        // South (0, -1, 0) -> Math Rad: atan2(0, -1) = pi (180 deg). Deg: 450 - 180 = 270 deg
        let heading = source.heading_to(&Vector3::new(0.0, -1.0, 0.0));
        assert!((heading.to_degrees() - 270.0).abs() < 1e-4);
    }

    #[test]
    fn test_calculate_arrival_position() {
        let source = WorldPosition {
            coords: Vector3::new(0.0, 0.0, 0.0),
            ..Default::default()
        };
        let target_pos = Vector3::new(10.0, 0.0, 0.0);
        let arrival_dist = 2.0;

        // Should stop at (8, 0, 0)
        let pos = calculate_arrival_position(&source, &target_pos, arrival_dist);
        assert!((pos.x - 8.0).abs() < 1e-4);
        assert!(pos.y.abs() < 1e-4);
    }

    #[test]
    fn test_raw_motion_state_preserves_cached_server_style_by_default() {
        let mut world = WorldState::new(None, None);
        world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

        let raw_motion_state = raw_motion_state_with_motion_style(
            &world,
            RawMotionState {
                flags: RawMotionFlags::CURRENT_HOLD_KEY
                    | RawMotionFlags::FORWARD_COMMAND
                    | RawMotionFlags::FORWARD_SPEED,
                current_hold_key: Some(HoldKey::Run as u32),
                forward_command: Some(WALK_FORWARD_MOTION_COMMAND),
                forward_speed: Some(7.0),
                ..Default::default()
            },
            MotionStyle::PreserveServer,
        );

        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::CURRENT_STYLE)
        );
        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::FORWARD_COMMAND)
        );
        assert_eq!(
            raw_motion_state.current_stance(),
            Some(MotionStance::SwordCombat)
        );
        assert_eq!(raw_motion_state.current_hold_key, Some(HoldKey::Run as u32));
        assert_eq!(
            raw_motion_state.forward_command,
            Some(WALK_FORWARD_MOTION_COMMAND)
        );
        assert_eq!(raw_motion_state.forward_speed, Some(7.0));
    }

    #[test]
    fn test_raw_motion_state_can_override_cached_server_style() {
        let mut world = WorldState::new(None, None);
        world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

        let raw_motion_state = raw_motion_state_with_motion_style(
            &world,
            RawMotionState::default(),
            MotionStyle::Explicit(MotionStance::Magic),
        );

        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::CURRENT_STYLE)
        );
        assert_eq!(raw_motion_state.current_stance(), Some(MotionStance::Magic));
    }

    #[test]
    fn test_raw_motion_state_can_omit_cached_server_style() {
        let mut world = WorldState::new(None, None);
        world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

        let raw_motion_state = raw_motion_state_with_motion_style(
            &world,
            RawMotionState {
                flags: RawMotionFlags::CURRENT_STYLE,
                current_style: Some(MotionStance::Magic as u32),
                ..Default::default()
            },
            MotionStyle::Omit,
        );

        assert!(
            !raw_motion_state
                .flags
                .contains(RawMotionFlags::CURRENT_STYLE)
        );
        assert_eq!(raw_motion_state.current_style, None);
    }
}
