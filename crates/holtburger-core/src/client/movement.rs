use crate::client::WireEvent;
use crate::client::locomotion::{LocomotionPrimitive, LocomotionRequest, MovementPacketMetadata};
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::{StateEvent, WorldState};
/// Maximum distance (in meters) to allow an automated server-controlled teleport.
const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;
const WALK_FORWARD_MOTION_COMMAND: u32 = 0x4500_0005;
const DRIVE_HEADING_CHANGE_THRESHOLD: f32 = 0.05;
const DRIVE_SPEED_CHANGE_THRESHOLD: f32 = 0.05;

#[derive(Debug, Clone, Copy)]
struct DriveSyncState {
    heading: f32,
    speed: f32,
}

fn heading_delta(lhs: f32, rhs: f32) -> f32 {
    let delta = (lhs - rhs).rem_euclid(std::f32::consts::TAU);
    delta.min(std::f32::consts::TAU - delta)
}

/// Computes the position a player should stop at when moving toward a target at a specific distance.
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

pub(super) fn raw_motion_state_with_player_style(
    world: &WorldState,
    mut raw_motion_state: RawMotionState,
) -> RawMotionState {
    if let Some(current_style) = world.player.current_motion_style {
        raw_motion_state.flags |= RawMotionFlags::CURRENT_STYLE;
        raw_motion_state.current_style = Some(current_style);
    }

    raw_motion_state
}

pub(super) fn resolve_movement_contact(
    _world: &WorldState,
    metadata: MovementPacketMetadata,
) -> bool {
    metadata.contact.unwrap_or(true)
}

pub(super) fn default_movement_metadata(_world: &WorldState) -> MovementPacketMetadata {
    MovementPacketMetadata::default()
}

pub(super) fn encode_contact_long_jump(world: &WorldState, metadata: MovementPacketMetadata) -> u8 {
    u8::from(resolve_movement_contact(world, metadata))
}

pub(super) fn encode_last_contact(world: &WorldState, metadata: MovementPacketMetadata) -> u8 {
    u8::from(resolve_movement_contact(world, metadata))
}

pub(super) struct MovementSystem {
    pub(super) last_sent_pos_seq: Option<u16>,
    last_drive_sync: Option<DriveSyncState>,
}

impl MovementSystem {
    pub(super) fn new() -> Self {
        Self {
            last_sent_pos_seq: None,
            last_drive_sync: None,
        }
    }

    pub(super) async fn execute_locomotion_request(
        &mut self,
        request: LocomotionRequest,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<StateEvent>> {
        let primitive = request.primitive;
        let state_events = self.apply_locomotion_primitive(primitive, world);

        if primitive.refresh_server() {
            match primitive {
                LocomotionPrimitive::Drive { heading, speed, .. } => {
                    let should_send_drive_pulse = self.last_drive_sync.is_none_or(|last_sync| {
                        heading_delta(heading, last_sync.heading) > DRIVE_HEADING_CHANGE_THRESHOLD
                            || (speed - last_sync.speed).abs() > DRIVE_SPEED_CHANGE_THRESHOLD
                    });

                    if should_send_drive_pulse {
                        Self::send_drive_pulse(world, session, heading, speed, request.metadata)
                            .await?;
                        self.last_drive_sync = Some(DriveSyncState { heading, speed });
                    }
                }
                LocomotionPrimitive::Stop { .. } => {
                    Self::send_stop_pulse(world, session, request.metadata).await?;
                    self.last_drive_sync = None;
                }
            }
        }

        Ok(state_events)
    }

    pub(super) fn apply_locomotion_primitive(
        &mut self,
        primitive: LocomotionPrimitive,
        world: &mut WorldState,
    ) -> Vec<StateEvent> {
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
            raw_motion_state: raw_motion_state_with_player_style(
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
            ),
            position,
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(world, metadata),
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
            raw_motion_state: raw_motion_state_with_player_style(world, RawMotionState::default()),
            position: world.player.position,
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(world, metadata),
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
    ) -> Result<(Vec<WireEvent>, Vec<StateEvent>)> {
        self.last_drive_sync = None;
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
            last_contact: encode_last_contact(world, MovementPacketMetadata::default()),
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
    fn test_raw_motion_state_preserves_cached_player_style() {
        let mut world = WorldState::new(None, None);
        world.player.current_motion_style = Some(0x8000_003e);

        let raw_motion_state = raw_motion_state_with_player_style(
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
        assert_eq!(raw_motion_state.current_style, Some(0x8000_003e));
        assert_eq!(raw_motion_state.current_hold_key, Some(HoldKey::Run as u32));
        assert_eq!(
            raw_motion_state.forward_command,
            Some(WALK_FORWARD_MOTION_COMMAND)
        );
        assert_eq!(raw_motion_state.forward_speed, Some(7.0));
    }

    #[test]
    fn movement_contact_defaults_to_grounded_even_if_server_flag_is_false() {
        let mut world = WorldState::new(None, None);
        world.player.server_grounded = Some(false);

        assert!(resolve_movement_contact(
            &world,
            MovementPacketMetadata::default(),
        ));
    }

    #[test]
    fn movement_contact_still_honors_explicit_metadata() {
        let mut world = WorldState::new(None, None);
        world.player.server_grounded = Some(true);

        assert!(!resolve_movement_contact(
            &world,
            MovementPacketMetadata::with_contact(false),
        ));
    }
}
