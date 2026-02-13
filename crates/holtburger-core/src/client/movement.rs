use crate::client::{Client, ClientEvent};
use crate::world::WorldEvent;
use anyhow::Result;
use holtburger_common::{Guid, Quaternion};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::RawMotionFlags;
use holtburger_protocol::messages::*;
use std::time::{Duration, Instant};

/// Maximum distance (in meters) to allow an automated server-controlled teleport.
const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;

impl Client {
    pub(super) async fn handle_approach_task(&mut self, target_guid: Guid, _dt: f32) -> Result<()> {
        let player_pos = self.world.player.position.coords;
        let target_pos = if let Some(target) = self.world.entities.get(target_guid) {
            target.position.coords
        } else {
            log::warn!("Approach aborted: Target 0x{:08X} not found", target_guid);
            self.move_target = None;
            return Ok(());
        };

        let diff = target_pos - player_pos;
        let dist = diff.length();

        if dist < 1.0 {
            log::info!("Arrived at target 0x{:08X}", target_guid);
            self.move_target = None;
            if let Some(player) = self.world.entities.get_mut(self.world.player.guid) {
                player.velocity = holtburger_common::Vector3::zero();
            }
            return Ok(());
        }

        // Stuck detection
        let now = Instant::now();
        if now.duration_since(self.last_move_pos_time) > Duration::from_millis(500) {
            let dist_since_last =
                (self.world.player.position.coords - self.last_move_pos.coords).length();
            if dist_since_last < 0.1 {
                log::warn!("Approach aborted: Player seems stuck");
                self.move_target = None;
                if let Some(player) = self.world.entities.get_mut(self.world.player.guid) {
                    player.velocity = holtburger_common::Vector3::zero();
                }
                return Ok(());
            }
            self.last_move_pos = self.world.player.position;
            self.last_move_pos_time = now;
        }

        // Set velocity toward target (Running speed ~ 7.0m/s)
        let dir = diff / dist;
        let velocity = dir * 7.0;

        if let Some(player) = self.world.entities.get_mut(self.world.player.guid) {
            player.velocity = velocity;
        }

        // Send MoveToState to server periodically (~100ms)
        if now.duration_since(self.last_move_sync) > Duration::from_millis(100) {
            self.last_move_sync = now;

            let data = holtburger_protocol::messages::game_action::MoveToStateData {
                raw_motion_state: holtburger_protocol::messages::game_message::RawMotionState {
                    flags: RawMotionFlags::CURRENT_HOLD_KEY | RawMotionFlags::FORWARD_SPEED,
                    current_hold_key: Some(HoldKey::Run as u32),
                    forward_speed: Some(7.0),
                    ..Default::default()
                },
                position: self.world.player.position,
                instance_sequence: self.world.player.instance_sequence,
                server_control_sequence: self.world.player.server_control_sequence,
                teleport_sequence: self.world.player.teleport_sequence,
                force_position_sequence: self.world.player.force_position_sequence,
                contact_long_jump: 1, // On Ground
            };

            self.session
                .send_action(GameAction::MoveToState(Box::new(data)))
                .await?;
        }

        Ok(())
    }

    pub(super) async fn handle_server_controlled_movement(&mut self, data: MovementEventData) -> Result<()> {
        log::info!(
            ">>> Processing server-initiated movement: {:?}. Control Sequence: {}",
            data.movement_type,
            data.server_control_sequence
        );

        let mut next_pos = self.world.player.position;

        match &data.data {
            MovementTypeData::MoveToObject(mto) => {
                // We use the origin provided in the packet as the source of truth for the target's position.
                // This is more reliable than our local entity tracking which might be uninitialized (e.g. landblock 0).
                next_pos.landblock_id = mto.origin.cell_id;
                next_pos.coords = mto.origin.position;

                let arrival_dist = mto.params.distance_to_object;

                // Calculate arrival on the line between the player and the target
                if self.world.player.position.landblock_id >> 16 == next_pos.landblock_id >> 16 {
                    let to_player = self.world.player.position.coords - next_pos.coords;
                    if to_player.length_squared() > 1e-6 {
                        next_pos.coords = next_pos.coords + (to_player.normalize() * arrival_dist);

                        // If desired_heading is 0.0, face the target
                        if mto.params.desired_heading.abs() <= 1e-6 {
                            // atan2(-dx, dy) returns math radians (0=North, pi/2=West, pi=South, 3pi/2=East)
                            let math_rad = f32::atan2(-to_player.x, to_player.y);
                            let mut heading_deg = 450.0 - math_rad.to_degrees();
                            heading_deg %= 360.0;
                            if heading_deg < 0.0 {
                                heading_deg += 360.0;
                            }
                            next_pos.rotation = Quaternion::from_heading(heading_deg.to_radians());
                        } else {
                            next_pos.rotation =
                                Quaternion::from_heading(mto.params.desired_heading);
                        }
                    } else {
                        // If we are exactly on top, just offset X
                        next_pos.coords.x += arrival_dist;
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
                    let diff = next_pos.coords - self.world.player.position.coords;
                    if diff.length_squared() > 1e-6 {
                        let math_rad = f32::atan2(-diff.x, diff.y);
                        let mut heading_deg = 450.0 - math_rad.to_degrees();
                        heading_deg %= 360.0;
                        if heading_deg < 0.0 {
                            heading_deg += 360.0;
                        }
                        next_pos.rotation = Quaternion::from_heading(heading_deg.to_radians());
                    }
                }
            }
            MovementTypeData::TurnToHeading(tth) => {
                next_pos.rotation = Quaternion::from_heading(tth.params.desired_heading);
            }
            MovementTypeData::TurnToObject(tto) => {
                // If the turn has a heading, use it. Some TurnToObjects have 0.0 which means "compute it".
                if tto.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(tto.desired_heading);
                } else if let Some(target) = self.world.entities.get(tto.target) {
                    // Try to compute heading to target (West = 0, North = 90, East = 180, South = 270)
                    // We only do this if they are in the same landblock for now.
                    if target.position.landblock_id == next_pos.landblock_id {
                        let diff = target.position.coords - next_pos.coords;
                        // atan2(-dx, dy) returns math radians (0=North, pi/2=West, pi=South, 3pi/2=East)
                        let math_rad = f32::atan2(-diff.x, diff.y);
                        let mut heading_deg = 450.0 - math_rad.to_degrees();
                        heading_deg %= 360.0;
                        if heading_deg < 0.0 {
                            heading_deg += 360.0;
                        }

                        next_pos.rotation = Quaternion::from_heading(heading_deg.to_radians());
                    }
                }
            }
            _ => {
                // For other movement types (like Stop), we just accept current position
            }
        }

        // Update local world state (Teleport)
        // Check distance safely - ignore check if we are uninitialized (landblock 0) or just logging in
        let distance = if self.world.player.position.landblock_id == Guid::NULL {
            0.0
        } else {
            self.world.player.position.distance_to(&next_pos)
        };

        if distance > AUTO_MOVE_DISTANCE_LIMIT {
            log::warn!(
                "Aborting auto-move: target is {:.2}m away (limit {}m)",
                distance,
                AUTO_MOVE_DISTANCE_LIMIT
            );
            if let Some(tx) = &self.event_tx {
                let _ = tx.send(ClientEvent::ClientError(format!(
                    "Item is too far away ({:.1}m). Move closer!",
                    distance
                )));
            }
            return Ok(());
        }

        self.world.player.position = next_pos;

        // Emit event so TUI knows we "arrived"
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::World(Box::new(WorldEvent::EntityMoved {
                guid: self.world.player.guid,
                pos: next_pos,
            })));
        }

        // Respond with AutonomousPosition heartbeat to confirm arrival
        // We use AutonomousPosition instead of MoveToState because MoveToState
        // cancels server-side movement chains (like pickups) on the ACE server.
        let pulse = AutonomousPositionActionData {
            position: next_pos,
            instance_sequence: self.world.player.instance_sequence,
            server_control_sequence: self.world.player.server_control_sequence,
            teleport_sequence: self.world.player.teleport_sequence,
            force_position_sequence: self.world.player.force_position_sequence,
            last_contact: 1, // Logged as 0x1 (Contact) in retail
        };

        log::debug!(
            ">>>> Sending AutonomousPosition heartbeat. ServerSeq: {}, Pos: {:?}",
            self.world.player.server_control_sequence,
            next_pos
        );

        let action = GameActionMessage {
            sequence: 0, // Heartbeats usually use 0 or a separate counter
            action: GameAction::AutonomousPosition(Box::new(pulse)),
        };

        self.session
            .send_message(&GameMessage::GameAction(Box::new(action)))
            .await?;

        Ok(())
    }
}
