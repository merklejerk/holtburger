use super::{Client, types::*};
use anyhow::Result;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::ProtocolUnpack;
use holtburger_world::WorldEvent;
use holtburger_world::entity::Entity;

impl Client {
    pub(super) async fn handle_message(&mut self, data: &[u8]) -> Result<Vec<WorldEvent>> {
        self.emit_wire_event(WireEvent::RawMessage(data.to_vec()));

        if let Some(ref dump_dir) = self.message_dump_dir {
            let path = dump_dir.join(format!("{:05}.bin", self.message_counter));
            std::fs::write(path, data)?;
            self.message_counter += 1;
        }

        let mut offset = 0;
        let message = <GameMessage as ProtocolUnpack>::unpack(data, &mut offset);
        if message.is_none() {
            let opcode_str = if data.len() >= 4 {
                let opcode = u32::from_le_bytes(data[0..4].try_into().unwrap_or([0; 4]));
                format!("0x{:08X}", opcode)
            } else {
                "Unknown".to_string()
            };
            log::warn!(
                "Failed to unpack GameMessage {} ({} bytes): {:02X?}",
                opcode_str,
                data.len(),
                data
            );
            return Ok(Vec::new());
        }
        let message = message.unwrap();

        log::debug!("GameMessage: {:?}", message);

        self.emit_wire_event(WireEvent::GameMessage(Box::new(message.clone())));

        // Pass to world state for tracking positioning and spawning
        let world_events = self.world.handle_message(&message);

        for event in world_events.iter() {
            self.emit_world_event(event.clone());
        }

        match message {
            GameMessage::UpdatePosition(data) => {
                if data.guid == self.world.player.guid {
                    let force_pos_seq = data.pos.force_position_sequence;
                    self.movement
                        .sequence_diagnostics
                        .record_force_position_sequence(force_pos_seq);
                }
                Ok(())
            }
            GameMessage::UpdateMotion(data) => {
                if data.guid == self.world.player.guid && !data.is_autonomous {
                    let accepted = world_events.iter().find_map(|event| match event {
                        WorldEvent::SelfUpdateMotionProcessed {
                            server_control_sequence,
                            accepted,
                            ..
                        } if *server_control_sequence == data.server_control_sequence => Some(*accepted),
                        _ => None,
                    }).unwrap_or(false);

                    if accepted {
                        self.movement
                            .sequence_diagnostics
                            .record_server_control_sequence(data.server_control_sequence);
                        let (wire_events, state_events) = {
                            let Client {
                                movement,
                                world,
                                session,
                                ..
                            } = self;
                            movement
                                .handle_server_controlled_movement(*data, world, session)
                                .await?
                        };
                        for event in wire_events {
                            self.emit_wire_event(event);
                        }
                        for event in state_events {
                            self.emit_world_event(event);
                        }
                    }
                }
                Ok(())
            }
            GameMessage::AutonomousPosition(data) => {
                if data.guid == self.world.player.guid {
                    self.movement.sequence_diagnostics.record_autonomous_position_sequences(
                        data.teleport_sequence,
                        data.force_position_sequence,
                        data.server_control_sequence,
                    );
                    // WorldState already updated position and sequences via self.world.handle_message()
                }
                Ok(())
            }
            GameMessage::CharacterList(data) => {
                self.auth.characters = data.characters.clone();

                log::info!("Character List for account: {}", data.account_name);
                for (i, c) in self.auth.characters.iter().enumerate() {
                    log::info!("  [{}] {} (0x{:08X})", i + 1, c.name, c.guid);
                }

                self.state = ClientState::CharacterSelection(self.auth.characters.clone());
                self.send_status_event();
                self.emit_wire_event(WireEvent::CharacterList(self.auth.characters.clone()));
                Ok(())
            }
            GameMessage::CharacterEnterWorldServerReady => {
                if let Some(char_id) = self.auth.character_id {
                    self.auth
                        .send_character_enter_world(char_id, &mut self.session)
                        .await
                } else {
                    Ok(())
                }
            }
            GameMessage::GameEvent(ev) => match &ev.event {
                GameEvent::PlayerDescription(_) | GameEvent::StartGame => {
                    if self.state == ClientState::EnteringWorld {
                        self.state = ClientState::InWorld;
                        self.send_status_event();
                    }
                    Ok(())
                }
                GameEvent::PingResponse(_) => {
                    self.emit_wire_event(WireEvent::PingResponse);
                    Ok(())
                }
                GameEvent::ViewContents(data) => {
                    self.emit_wire_event(WireEvent::ViewContents {
                        container: data.container,
                        items: data.items.clone(),
                    });
                    Ok(())
                }
                GameEvent::Tell(data) => {
                    self.emit_wire_event(WireEvent::Chat {
                        sender: data.sender_name.clone(),
                        message: data.message.clone(),
                    });
                    Ok(())
                }
                GameEvent::ChannelBroadcast(data) => {
                    self.emit_wire_event(WireEvent::Chat {
                        sender: data.sender_name.clone(),
                        message: data.message.clone(),
                    });
                    Ok(())
                }
                GameEvent::PopupString(data) => {
                    self.emit_wire_event(WireEvent::ServerMessage {
                        message: data.message.clone(),
                        chat_type: ChatMessageType::System as u32,
                    });
                    Ok(())
                }
                GameEvent::CommunicationTransientString(data) => {
                    self.emit_wire_event(WireEvent::ServerMessage {
                        message: data.message.clone(),
                        chat_type: ChatMessageType::System as u32,
                    });
                    Ok(())
                }
                GameEvent::AttackDone(data) => {
                    self.emit_wire_event(WireEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::AttackDone { error: data.error },
                    ));
                    Ok(())
                }
                GameEvent::AttackerNotification(data) => {
                    self.emit_wire_event(WireEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::AttackerNotification {
                            defender_name: data.defender_name.clone(),
                            damage_type: data.damage_type,
                            health_percent: data.health_percent,
                            damage: data.damage,
                            critical_hit: data.critical_hit,
                            attack_conditions: data.attack_conditions,
                        },
                    ));
                    Ok(())
                }
                GameEvent::DefenderNotification(data) => {
                    self.emit_wire_event(WireEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::DefenderNotification {
                            attacker_name: data.attacker_name.clone(),
                            damage_type: data.damage_type,
                            health_percent: data.health_percent,
                            damage: data.damage,
                            damage_location: data.damage_location,
                            critical_hit: data.critical_hit,
                            attack_conditions: data.attack_conditions,
                        },
                    ));
                    Ok(())
                }
                GameEvent::EvasionAttackerNotification(data) => {
                    self.emit_wire_event(WireEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::EvasionAttackerNotification {
                            defender_name: data.defender_name.clone(),
                        },
                    ));
                    Ok(())
                }
                GameEvent::EvasionDefenderNotification(data) => {
                    self.emit_wire_event(WireEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::EvasionDefenderNotification {
                            attacker_name: data.attacker_name.clone(),
                        },
                    ));
                    Ok(())
                }
                GameEvent::CombatCommenceAttack => {
                    self.emit_wire_event(WireEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::AttackCommenced,
                    ));
                    Ok(())
                }
                GameEvent::VictimNotification(data) => {
                    self.emit_wire_event(WireEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::VictimNotification {
                            death_message: data.death_message.clone(),
                        },
                    ));
                    Ok(())
                }
                GameEvent::KillerNotification(data) => {
                    self.emit_wire_event(WireEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::KillerNotification {
                            death_message: data.death_message.clone(),
                        },
                    ));
                    Ok(())
                }
                GameEvent::WeenieError(data) => {
                    self.emit_wire_event(WireEvent::WeenieError {
                        error: data.error,
                        parameter: None,
                    });
                    Ok(())
                }
                GameEvent::WeenieErrorWithString(data) => {
                    self.emit_wire_event(WireEvent::WeenieError {
                        error: data.error,
                        parameter: Some(data.parameter.clone()),
                    });
                    Ok(())
                }
                GameEvent::InventoryServerSaveFailed(data) => {
                    self.emit_wire_event(WireEvent::InventoryServerSaveFailed {
                        item_guid: data.item_guid,
                        error: data.error,
                    });
                    Ok(())
                }
                GameEvent::UseDone(data) => {
                    self.emit_wire_event(WireEvent::UseDone { error: data.error });
                    Ok(())
                }
                GameEvent::RegisterTrade(data) => {
                    let partner_guid = if data.initiator == self.world.player.guid {
                        data.partner
                    } else {
                        data.initiator
                    };
                    let partner_name = self
                        .world
                        .entities
                        .get(partner_guid)
                        .map(|e: &Entity| e.name().to_string())
                        .unwrap_or_else(|| format!("0x{:08X}", partner_guid.0));
                    self.emit_wire_event(WireEvent::ServerMessage {
                        message: format!("Trade started with {}.", partner_name),
                        chat_type: ChatMessageType::System as u32,
                    });
                    Ok(())
                }
                _ => Ok(()),
            },
            GameMessage::PlayerCreate(data) => {
                let player_id = data.guid;
                self.world.player.guid = player_id;

                let name = self
                    .auth
                    .characters
                    .iter()
                    .find(|c| c.guid == player_id)
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| {
                        // try search by character_id if we have it
                        if let Some(char_id) = self.auth.character_id {
                            self.auth
                                .characters
                                .iter()
                                .find(|c| c.guid == char_id)
                                .map(|c| c.name.clone())
                                .unwrap_or_else(|| "Unknown".to_string())
                        } else {
                            "Unknown".to_string()
                        }
                    });

                self.emit_wire_event(WireEvent::PlayerEntered {
                    guid: player_id,
                    name: name.clone(),
                });

                self.send_login_complete().await?;
                self.state = ClientState::InWorld;
                self.send_status_event();
                Ok(())
            }
            GameMessage::PlayerTeleport(data) => {
                log::info!(
                    "Portal transition started (seq: {})",
                    data.teleport_sequence
                );
                self.send_login_complete().await?;
                Ok(())
            }
            GameMessage::PrivateUpdatePropertyInt(_) | GameMessage::PublicUpdatePropertyInt(_) => {
                Ok(())
            }
            GameMessage::GameAction(data) => self.handle_game_action(&data.action).await,
            GameMessage::ServerMessage(data) => {
                self.emit_wire_event(WireEvent::ServerMessage {
                    message: data.message.clone(),
                    chat_type: data.chat_type,
                });
                Ok(())
            }
            GameMessage::CharacterError(data) => {
                let error = self.auth.handle_character_error(data.error_id);
                self.emit_wire_event(WireEvent::CharacterError(error));
                Ok(())
            }
            GameMessage::AccountBoot(data) => {
                let reason = self.auth.handle_boot_account(*data);
                self.state = ClientState::Disconnected;
                self.send_status_event();
                self.emit_wire_event(WireEvent::BootAccount(reason));
                Ok(())
            }
            GameMessage::DddInterrogation => {
                let resp =
                    GameMessage::DddInterrogationResponse(Box::new(DddInterrogationResponseData {
                        language: 1,
                        lists: Vec::new(),
                    }));
                self.session.send_message(&resp).await
            }
            GameMessage::ServerName(_data) => Ok(()),
            GameMessage::HearSpeech(data) => {
                let sender = if data.sender_name.is_empty() {
                    "You".to_string()
                } else {
                    data.sender_name.clone()
                };
                self.emit_wire_event(WireEvent::Chat {
                    sender,
                    message: data.message.clone(),
                });
                Ok(())
            }
            GameMessage::HearRangedSpeech(data) => {
                self.emit_wire_event(WireEvent::Chat {
                    sender: data.sender_name.clone(),
                    message: data.message.clone(),
                });
                Ok(())
            }
            GameMessage::EmoteText(data) => {
                self.emit_wire_event(WireEvent::Emote {
                    sender: data.sender_name.clone(),
                    text: data.text.clone(),
                });
                Ok(())
            }
            GameMessage::SoulEmote(data) => {
                self.emit_wire_event(WireEvent::Emote {
                    sender: data.sender_name.clone(),
                    text: data.text.clone(),
                });
                Ok(())
            }
            _ => Ok(()),
        }?;

        Ok(world_events)
    }

    async fn handle_game_action(&mut self, data: &GameAction) -> Result<()> {
        if let GameAction::LoginComplete(_) = data {
            self.state = ClientState::InWorld;
            self.send_status_event();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientState, auth::AuthState, movement::MovementSystem};
    use holtburger_common::position::WorldPosition;
    use holtburger_protocol::messages::movement::MotionStance;
    use holtburger_protocol::traits::ProtocolPack;
    use holtburger_session::Session;
    use holtburger_world::WorldState;
    use tokio::sync::broadcast;

    fn build_test_client() -> Client {
        let (wire_event_tx, _) = broadcast::channel(32);
        let (world_event_tx, _) = broadcast::channel(32);
        let (client_view_event_tx, _) = broadcast::channel(32);

        Client {
            session: Session::new_test(),
            world: WorldState::new(None, None),
            state: ClientState::Connected,
            wire_event_tx,
            world_event_tx,
            client_view_event_tx,
            command_rx: None,
            message_dump_dir: None,
            message_counter: 0,
            movement: MovementSystem::new(),
            auth: AuthState::new("test".to_string()),
        }
    }

    fn encode_message(message: &GameMessage) -> Vec<u8> {
        let mut encoded = Vec::new();
        message.pack(&mut encoded);
        encoded
    }

    fn server_controlled_motion(
        guid: holtburger_common::Guid,
        server_control_sequence: u16,
        movement_sequence: u16,
    ) -> GameMessage {
        GameMessage::UpdateMotion(Box::new(MovementEventData {
            guid,
            object_instance_sequence: 7,
            movement_sequence,
            server_control_sequence,
            is_autonomous: false,
            movement_type: MovementType::Invalid,
            motion_flags: 0,
            current_style: MotionStance::SwordCombat.interpreted(),
            data: MovementTypeData::Invalid(MovementInvalid::default()),
        }))
    }

    #[tokio::test]
    async fn test_player_teleport_emits_teleport_started_view_event() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        let encoded = encode_message(&GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
            teleport_sequence: 42,
        })));

        client.handle_message(&encoded).await.unwrap();

        let mut saw_teleport_started = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::TeleportStarted { sequence: 42 }) {
                saw_teleport_started = true;
                break;
            }
        }

        assert!(saw_teleport_started);
    }

    #[tokio::test]
    async fn test_current_server_controlled_update_motion_sends_heartbeat() {
        let mut client = build_test_client();
        let player_guid = holtburger_common::Guid(0x50000001);
        client.world.player.guid = player_guid;
        client.world.player.server_control_sequence = 9;
        client.world.player.position = WorldPosition::default();
        client.world.add_entity(holtburger_world::entity::Entity::new(
            player_guid,
            "Player".to_string(),
            WorldPosition::default(),
        ));

        let encoded = encode_message(&server_controlled_motion(player_guid, 10, 20));

        client.handle_message(&encoded).await.unwrap();

        assert_eq!(client.world.player.server_control_sequence, 10);
        assert_eq!(client.session.packet_sequence, 2);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn test_stale_server_controlled_update_motion_skips_heartbeat() {
        let mut client = build_test_client();
        let player_guid = holtburger_common::Guid(0x50000001);
        client.world.player.guid = player_guid;
        client.world.player.server_control_sequence = 10;
        client.world.player.position = WorldPosition::default();
        client.world.add_entity(holtburger_world::entity::Entity::new(
            player_guid,
            "Player".to_string(),
            WorldPosition::default(),
        ));

        let encoded = encode_message(&server_controlled_motion(player_guid, 9, 19));

        client.handle_message(&encoded).await.unwrap();

        assert_eq!(client.world.player.server_control_sequence, 10);
        assert_eq!(client.session.packet_sequence, 1);
        assert_eq!(client.session.bytes_out, 0);
    }
}
