use super::{Client, types::*};
use crate::world::StateEvent;
use anyhow::Result;
use holtburger_common::ProtocolUnpack;
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::*;

impl Client {
    pub(super) async fn handle_message(&mut self, data: &[u8]) -> Result<Vec<StateEvent>> {
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

        // Deduplicate events that are snapshots/derived
        let world_events = crate::world::dedupe_state_events(world_events);

        for event in world_events.iter() {
            self.emit_state_event(event.clone());
        }

        match message {
            GameMessage::UpdatePosition(data) => {
                if data.guid == self.world.player.guid {
                    let force_pos_seq = data.pos.force_position_sequence;

                    if let Some(old_seq) = self.movement.last_sent_pos_seq
                        && is_newer_u16(force_pos_seq, old_seq)
                    {
                        log::warn!(
                            "Server forced reposition (rubber band): seq {} -> {}",
                            old_seq,
                            force_pos_seq
                        );
                        // We don't abort movement here, we just accept the new sequence
                        // WorldState already updated the position via delegation above
                    }
                    self.movement.last_sent_pos_seq = Some(force_pos_seq);
                }
                Ok(())
            }
            GameMessage::UpdateMotion(data) => {
                if data.guid == self.world.player.guid && !data.is_autonomous {
                    let Client {
                        movement,
                        world,
                        session,
                        ..
                    } = self;
                    let (wire_events, state_events) = movement
                        .handle_server_controlled_movement(*data, world, session)
                        .await?;
                    for event in wire_events {
                        self.emit_wire_event(event);
                    }
                    for event in state_events {
                        self.emit_state_event(event);
                    }
                }
                Ok(())
            }
            GameMessage::AutonomousPosition(data) => {
                if data.guid == self.world.player.guid {
                    log::info!(
                        ">>> Server-forced resync: {:?}. Force Seq: {}",
                        data.position,
                        data.force_position_sequence
                    );
                    // WorldState already updated position and sequences via self.world.handle_message()
                    self.movement.last_sent_pos_seq = Some(data.force_position_sequence);
                }
                Ok(())
            }
            GameMessage::CharacterList(data) => {
                use crate::client::auth::find_preferred_character;
                self.auth.characters = data.characters.clone();

                log::info!("Character List for account: {}", data.account_name);
                for (i, c) in self.auth.characters.iter().enumerate() {
                    log::info!("  [{}] {} (0x{:08X})", i + 1, c.name, c.guid);
                }

                if let Some(id) =
                    find_preferred_character(&self.auth.characters, &self.auth.character_preference)
                {
                    self.state = ClientState::EnteringWorld;
                    self.send_status_event();
                    self.auth.select_character(id, &mut self.session).await?;
                    return Ok(world_events);
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
                GameEvent::WeenieError(data) => {
                    self.emit_wire_event(WireEvent::WeenieError {
                        error_id: data.error_id,
                        message: None,
                    });
                    Ok(())
                }
                GameEvent::WeenieErrorWithString(data) => {
                    self.emit_wire_event(WireEvent::WeenieError {
                        error_id: data.error_id,
                        message: Some(data.message.clone()),
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
                    self.emit_wire_event(WireEvent::UseDone {
                        error_id: data.error_id,
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
                self.emit_wire_event(WireEvent::ServerMessage(data.message.clone()));
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
