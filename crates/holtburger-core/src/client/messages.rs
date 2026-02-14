use super::{Client, types::*};
use crate::world::WorldEvent;
use anyhow::Result;
use holtburger_common::ProtocolUnpack;
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::*;

impl Client {
    pub(super) async fn handle_message(&mut self, data: &[u8]) -> Result<Vec<WorldEvent>> {
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::RawMessage(data.to_vec()));
        }

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

        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::GameMessage(Box::new(message.clone())));
        }

        // Pass to world state for tracking positioning and spawning
        let world_events = self.world.handle_message(&message);

        // Deduplicate events that are snapshots/derived
        let world_events = crate::world::dedupe_world_events(world_events);

        for event in world_events.iter() {
            if let Some(tx) = &self.event_tx {
                let _ = tx.send(ClientEvent::World(Box::new(event.clone())));
            }
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
                        event_tx,
                        ..
                    } = self;
                    movement
                        .handle_server_controlled_movement(*data, world, session, event_tx)
                        .await?;
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
                let Client {
                    auth,
                    session,
                    state,
                    event_tx,
                    ..
                } = self;
                auth.handle_character_list(*data, session, state, event_tx)
                    .await
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
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::PingResponse);
                    }
                    Ok(())
                }
                GameEvent::ViewContents(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::ViewContents {
                            container: data.container,
                            items: data.items.clone(),
                        });
                    }
                    Ok(())
                }
                GameEvent::Tell(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::Chat {
                            sender: data.sender_name.clone(),
                            message: data.message.clone(),
                        });
                    }
                    Ok(())
                }
                GameEvent::ChannelBroadcast(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::Chat {
                            sender: data.sender_name.clone(),
                            message: data.message.clone(),
                        });
                    }
                    Ok(())
                }
                GameEvent::WeenieError(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::WeenieError {
                            error_id: data.error_id,
                            message: None,
                        });
                    }
                    Ok(())
                }
                GameEvent::WeenieErrorWithString(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::WeenieError {
                            error_id: data.error_id,
                            message: Some(data.message.clone()),
                        });
                    }
                    Ok(())
                }
                GameEvent::InventoryServerSaveFailed(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::InventoryServerSaveFailed {
                            item_guid: data.item_guid,
                            error: data.error,
                        });
                    }
                    Ok(())
                }
                GameEvent::UseDone(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::UseDone {
                            error_id: data.error_id,
                        });
                    }
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

                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::PlayerEntered {
                        guid: player_id,
                        name: name.clone(),
                    });
                }

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
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::ServerMessage(data.message.clone()));
                }
                Ok(())
            }
            GameMessage::CharacterError(data) => self
                .auth
                .handle_character_error(data.error_id, &self.event_tx),
            GameMessage::BootAccount(data) => {
                self.auth
                    .handle_boot_account(*data, &mut self.state, &self.event_tx)
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
                if let Some(tx) = &self.event_tx {
                    let sender = if data.sender_name.is_empty() {
                        "You".to_string()
                    } else {
                        data.sender_name.clone()
                    };
                    let _ = tx.send(ClientEvent::Chat {
                        sender,
                        message: data.message.clone(),
                    });
                }
                Ok(())
            }
            GameMessage::HearRangedSpeech(data) => {
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::Chat {
                        sender: data.sender_name.clone(),
                        message: data.message.clone(),
                    });
                }
                Ok(())
            }
            GameMessage::EmoteText(data) => {
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::Emote {
                        sender: data.sender_name.clone(),
                        text: data.text.clone(),
                    });
                }
                Ok(())
            }
            GameMessage::SoulEmote(data) => {
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::Emote {
                        sender: data.sender_name.clone(),
                        text: data.text.clone(),
                    });
                }
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
