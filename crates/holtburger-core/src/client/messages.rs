use super::{ClientRuntime, ClientWorldActivationState, types::*};
use anyhow::Result;
use holtburger_common::ConfirmationType;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::errors::{CharacterError, WeenieError};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::ProtocolUnpack;
use holtburger_world::entity::Entity;
use holtburger_world::{AuthoritativePoseEffect, AuthoritativePoseResetCause, WorldEvent};

fn confirmation_done_requires_auto_response(confirmation_type: ConfirmationType) -> bool {
    matches!(
        confirmation_type,
        ConfirmationType::AlterSkill
            | ConfirmationType::AlterAttribute
            | ConfirmationType::CraftInteraction
            | ConfirmationType::Augmentation
            | ConfirmationType::YesNo
    )
}

impl ClientRuntime {
    fn apply_local_position_authority(
        &mut self,
        position: holtburger_common::position::WorldPosition,
        known_teleport_sequence: u16,
        known_force_position_sequence: u16,
        teleport_sequence: u16,
        force_position_sequence: u16,
        discontinuity_already_handled: bool,
    ) -> Vec<WorldEvent> {
        // PlayerTeleport establishes the destination epoch before ACE sends its position. That
        // makes the destination packet look same-epoch, even though portal activation requires
        // one unconditional runtime reset to the destination pose.
        let installs_teleport_destination = self.activation.as_ref().is_some_and(|activation| {
            matches!(
                activation.phase,
                super::ClientWorldActivationPhase::TeleportAwaitingDestination
            )
        });
        let reset_cause = if installs_teleport_destination
            || is_newer_u16(teleport_sequence, known_teleport_sequence)
        {
            Some(AuthoritativePoseResetCause::Teleport)
        } else if is_newer_u16(force_position_sequence, known_force_position_sequence) {
            Some(AuthoritativePoseResetCause::ForcedReposition)
        } else {
            None
        };
        let effect = reset_cause.map_or(
            AuthoritativePoseEffect::Confirm { pose: position },
            |cause| AuthoritativePoseEffect::Reset {
                pose: position,
                cause,
            },
        );
        let events = self.world.apply_player_pose_effect(effect);

        if installs_teleport_destination {
            self.activation
                .as_mut()
                .expect("teleport destination requires an active activation")
                .phase = super::ClientWorldActivationPhase::TeleportDestinationInstalled;
        }
        if reset_cause.is_some() && !discontinuity_already_handled && !installs_teleport_destination
        {
            self.reset_camera();
            if let Some(coordinator) = self.collision_coordinator.as_mut() {
                coordinator.invalidate();
            }
            self.bump_world_generation();
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::PresentationDiscontinuity {
                    world_generation: self.world_generation,
                    kind: ClientPresentationDiscontinuityKind::ForcedReposition,
                });
        }

        events
    }

    pub(super) async fn begin_world_entry_transition(&mut self) -> Result<()> {
        let player_guid = self.character_selection.character_id.ok_or_else(|| {
            anyhow::anyhow!("cannot enter the world without a selected character")
        })?;
        self.start_world_activation_with_reset(
            ClientWorldActivationState::InitialEntry,
            player_guid,
        );
        Ok(())
    }

    async fn enter_world(&mut self) -> Result<()> {
        if self.state == ClientState::InWorld && self.activation.is_none() {
            return Ok(());
        }

        // Synthetic/non-network callers may still feed StartGame directly. Real network entry
        // remains gated by `try_complete_world_activation`; this fallback preserves the broad
        // TUI authority API when no activation has been started.
        if self.activation.is_some() {
            return self.try_complete_world_activation().await;
        }
        self.state = ClientState::InWorld;
        self.send_status_event();
        Ok(())
    }

    async fn handle_world_events(&mut self, initial_events: Vec<WorldEvent>) -> Result<()> {
        let mut pending_events = initial_events;

        while !pending_events.is_empty() {
            let teleport_batch = pending_events
                .iter()
                .any(|event| matches!(event, WorldEvent::TeleportStarted { .. }));
            let discontinuity_already_handled = pending_events.iter().any(|event| {
                matches!(event, WorldEvent::RuntimeBodiesReset { .. } | WorldEvent::TeleportStarted { .. })
                    || matches!(event, WorldEvent::ForcedReposition { guid, .. } if *guid == self.world.player.guid)
            });
            let mut follow_up_events = Vec::new();
            // Packet-scoped authority/control effects must finish mutating the canonical runtime
            // before any event in this batch projects a dynamic entity view. Otherwise an
            // `EntityMoved` upsert can publish the newly authoritative pose before the local
            // correction/reset effect has established its runtime consequence.
            for event in &pending_events {
                match event {
                    WorldEvent::SelfServerControlledMotion(data) => {
                        self.movement
                            .record_server_control_sequence(data.server_control_sequence);
                        let world_events = {
                            let ClientRuntime {
                                simulation,
                                movement,
                                world,
                                session,
                                ..
                            } = self;
                            simulation
                                .handle_server_controlled_movement(data, movement, world, session)
                                .await?
                        };
                        follow_up_events.extend(world_events);
                    }
                    WorldEvent::SelfUpdatePosition {
                        position,
                        known_teleport_sequence,
                        known_force_position_sequence,
                        teleport_sequence,
                        force_position_sequence,
                        ..
                    } => {
                        self.movement
                            .record_force_position_sequence(*force_position_sequence);
                        follow_up_events.extend(self.apply_local_position_authority(
                            *position,
                            *known_teleport_sequence,
                            *known_force_position_sequence,
                            *teleport_sequence,
                            *force_position_sequence,
                            discontinuity_already_handled,
                        ));
                    }
                    WorldEvent::SelfAutonomousPosition {
                        position,
                        known_teleport_sequence,
                        known_force_position_sequence,
                        teleport_sequence,
                        force_position_sequence,
                        server_control_sequence,
                    } => {
                        self.movement.record_autonomous_position_sequences(
                            *teleport_sequence,
                            *force_position_sequence,
                            *server_control_sequence,
                        );
                        follow_up_events.extend(self.apply_local_position_authority(
                            *position,
                            *known_teleport_sequence,
                            *known_force_position_sequence,
                            *teleport_sequence,
                            *force_position_sequence,
                            discontinuity_already_handled,
                        ));
                    }
                    _ => {}
                }
            }

            for event in &pending_events {
                self.handle_runtime_world_event_with_context(event, teleport_batch);
            }

            pending_events = follow_up_events;
        }

        self.try_complete_world_activation().await?;
        Ok(())
    }

    pub(super) async fn handle_message(&mut self, data: &[u8]) -> Result<Vec<WorldEvent>> {
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

        if let GameMessage::ServerName(data) = &message {
            self.world_name = Some(data.name.clone());
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::WorldNameUpdated(data.name.clone()));
        }

        // Pass to world state for tracking positioning and spawning
        let world_events = self.world.handle_message(&message);
        self.handle_world_events(world_events.clone()).await?;

        match message {
            GameMessage::UpdatePosition(_) => Ok(()),
            GameMessage::UpdateMotion(_) => Ok(()),
            GameMessage::AutonomousPosition(_) => Ok(()),
            GameMessage::CharacterList(data) => {
                self.authenticating = false;
                self.character_selection.characters = data.characters.clone();
                self.turbine_chat.enabled = data.use_turbine_chat;
                if !data.use_turbine_chat {
                    self.turbine_chat.channels = None;
                }
                self.character_selection.pending_character_operation = None;

                log::info!("Character List for account: {}", data.account_name);
                for (i, c) in self.character_selection.characters.iter().enumerate() {
                    log::info!("  [{}] {} (0x{:08X})", i + 1, c.name, c.guid);
                }

                self.state =
                    ClientState::CharacterSelection(self.character_selection.characters.clone());
                self.send_status_event();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CharacterList(
                        self.character_selection.characters.clone(),
                    ));
                Ok(())
            }
            GameMessage::CharacterCreateResponse(data) => {
                let operation = self.character_selection.take_pending_character_operation();
                let _ =
                    self.client_view_event_tx
                        .send(ClientViewEvent::CharacterManagementResponse {
                            operation,
                            response: (*data).clone(),
                        });
                Ok(())
            }
            GameMessage::CharacterDeleteResponse => {
                self.character_selection.take_pending_character_operation();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CharacterDeleteResponse);
                Ok(())
            }
            GameMessage::CharacterEnterWorldServerReady => {
                if let Some(guid) = self.character_selection.character_id
                    && !self.character_selection.enter_world_sent
                {
                    let account = self.character_selection.account_name.clone();
                    self.character_selection
                        .send_character_enter_world(guid, account, &mut self.session)
                        .await?;
                    self.character_selection.enter_world_sent = true;
                }
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CharacterEnterWorldServerReady);
                Ok(())
            }
            GameMessage::GameEvent(ev) => match &ev.event {
                GameEvent::PlayerDescription(_) | GameEvent::StartGame => {
                    if self.state == ClientState::EnteringWorld {
                        self.enter_world().await?;
                    }
                    Ok(())
                }
                GameEvent::PingResponse(_) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::PingResponse);
                    Ok(())
                }
                GameEvent::ViewContents(_data) => Ok(()),
                GameEvent::Tell(data) => {
                    let _ = self.client_view_event_tx.send(ClientViewEvent::Tell {
                        sender: data.sender_name.clone(),
                        message: data.message.clone(),
                    });
                    Ok(())
                }
                GameEvent::ChannelBroadcast(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::ChannelMessage {
                            channel: ChatChannelInfo::legacy(data.channel),
                            sender: data.sender_name.clone(),
                            message: data.message.clone(),
                        });
                    Ok(())
                }
                GameEvent::SetTurbineChatChannels(data) => {
                    self.turbine_chat.channels = Some((**data).clone());
                    Ok(())
                }
                GameEvent::PopupString(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::ServerMessage {
                            message: data.message.clone(),
                            chat_type: (ChatMessageType::System as u32).into(),
                        });
                    Ok(())
                }
                GameEvent::CharacterConfirmationRequest(data) => {
                    self.active_confirmation = Some(ActiveCharacterConfirmation {
                        confirmation_type: data.confirmation_type,
                        context: data.context,
                        text: data.text.clone(),
                    });
                    self.emit_active_character_confirmation_updated();
                    Ok(())
                }
                GameEvent::CharacterConfirmationDone(data) => {
                    if let Some(confirmation) =
                        self.active_confirmation.clone().filter(|confirmation| {
                            confirmation.confirmation_type == data.confirmation_type
                                && confirmation.context == data.context
                        })
                    {
                        if confirmation_done_requires_auto_response(confirmation.confirmation_type)
                        {
                            self.session
                                .send_action(GameAction::ConfirmationResponse(Box::new(
                                    ConfirmationResponseActionData {
                                        confirmation_type: confirmation.confirmation_type,
                                        context: confirmation.context,
                                        accepted: false,
                                    },
                                )))
                                .await?;
                        }

                        self.active_confirmation = None;
                        self.emit_active_character_confirmation_updated();
                    }
                    Ok(())
                }
                GameEvent::CommunicationTransientString(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::ServerMessage {
                            message: data.message.clone(),
                            chat_type: (ChatMessageType::System as u32).into(),
                        });
                    Ok(())
                }
                GameEvent::AttackDone(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatFeedback(
                            crate::client::types::CombatFeedback::AttackDone { error: data.error },
                        ));
                    Ok(())
                }
                GameEvent::AttackerNotification(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatFeedback(
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
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatFeedback(
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
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatFeedback(
                            crate::client::types::CombatFeedback::EvasionAttackerNotification {
                                defender_name: data.defender_name.clone(),
                            },
                        ));
                    Ok(())
                }
                GameEvent::EvasionDefenderNotification(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatFeedback(
                            crate::client::types::CombatFeedback::EvasionDefenderNotification {
                                attacker_name: data.attacker_name.clone(),
                            },
                        ));
                    Ok(())
                }
                GameEvent::CombatCommenceAttack => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatFeedback(
                            crate::client::types::CombatFeedback::AttackCommenced,
                        ));
                    Ok(())
                }
                GameEvent::VictimNotification(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatFeedback(
                            crate::client::types::CombatFeedback::VictimNotification {
                                death_message: data.death_message.clone(),
                            },
                        ));
                    Ok(())
                }
                GameEvent::KillerNotification(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatFeedback(
                            crate::client::types::CombatFeedback::KillerNotification {
                                death_message: data.death_message.clone(),
                            },
                        ));
                    Ok(())
                }
                GameEvent::WeenieError(data) => {
                    self.note_busy_error(data.error, None);
                    self.emit_action_result(
                        ActionResultSource::Wire,
                        ActionResultReason::Weenie(data.error, None),
                    );
                    Ok(())
                }
                GameEvent::WeenieErrorWithString(data) => {
                    self.note_busy_error(data.error, Some(data.parameter.clone()));
                    self.emit_action_result(
                        ActionResultSource::Wire,
                        ActionResultReason::Weenie(data.error, Some(data.parameter.clone())),
                    );
                    Ok(())
                }
                GameEvent::InventoryServerSaveFailed(data) => {
                    self.emit_action_result(
                        ActionResultSource::Wire,
                        ActionResultReason::InventoryServerSaveFailed {
                            item_guid: data.item_guid,
                            error: data.error,
                        },
                    );
                    Ok(())
                }
                GameEvent::UseDone(data) => {
                    self.finish_busy_operation_from_use_done(data.error);
                    if data.error != WeenieError::None {
                        self.emit_action_result(
                            ActionResultSource::Wire,
                            ActionResultReason::Weenie(data.error, None),
                        );
                    }
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
                    let message = format!("Trade started with {}.", partner_name);
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::ServerMessage {
                            message: message.clone(),
                            chat_type: (ChatMessageType::System as u32).into(),
                        });
                    Ok(())
                }
                GameEvent::QueryItemManaResponse(data) => {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::ItemManaResponse {
                            target: ev.target,
                            mana: data.mana,
                            success: data.success,
                        });
                    Ok(())
                }
                _ => Ok(()),
            },
            GameMessage::PlayerCreate(data) => {
                let player_id = data.guid;
                self.world.player.guid = player_id;
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::LocalPlayerEstablished {
                        player_guid: player_id,
                    });

                if self.activation.is_none() {
                    self.start_world_activation_with_reset(
                        ClientWorldActivationState::InitialEntry,
                        player_id,
                    );
                } else if let Some(activation) = self.activation.as_ref()
                    && activation.player_guid != player_id
                {
                    // The server's PlayerCreate is the first exact local-player identity. Keep
                    // the selected identity in the activation so a mismatched response cannot
                    // silently retarget the barrier to a different character.
                    log::error!(
                        "PlayerCreate identity 0x{:08X} disagrees with activation character 0x{:08X}",
                        player_id.0,
                        activation.player_guid.0
                    );
                }

                let name = self
                    .character_selection
                    .characters
                    .iter()
                    .find(|c| c.guid == player_id)
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| {
                        // try search by character_id if we have it
                        if let Some(char_id) = self.character_selection.character_id {
                            self.character_selection
                                .characters
                                .iter()
                                .find(|c| c.guid == char_id)
                                .map(|c| c.name.clone())
                                .unwrap_or_else(|| "Unknown".to_string())
                        } else {
                            "Unknown".to_string()
                        }
                    });

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerEntered {
                        guid: player_id,
                        name: name.clone(),
                    });

                self.try_complete_world_activation().await?;
                Ok(())
            }
            GameMessage::PlayerKilled(data) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CombatFeedback(
                        crate::client::types::CombatFeedback::PlayerKilled {
                            death_message: data.death_message.clone(),
                            victim_id: data.victim_id,
                            killer_id: data.killer_id,
                        },
                    ));
                Ok(())
            }
            GameMessage::PlayerTeleport(data) => {
                log::info!(
                    "Portal transition started (seq: {})",
                    data.teleport_sequence
                );
                // `WorldState::handle_message` already emitted the paired reset and
                // `TeleportStarted` edge above. Its batch handler owns the one activation
                // generation; starting another transition here would make a single server
                // teleport observable as two generations.
                Ok(())
            }
            GameMessage::PrivateUpdatePropertyInt(_) | GameMessage::PublicUpdatePropertyInt(_) => {
                Ok(())
            }
            GameMessage::GameAction(data) => self.handle_game_action(&data.action).await,
            GameMessage::ServerMessage(data) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ServerMessage {
                        message: data.message.clone(),
                        chat_type: data.chat_type.into(),
                    });
                Ok(())
            }
            GameMessage::CharacterError(data) => {
                let error = self
                    .character_selection
                    .handle_character_error(data.error_id);
                self.emit_action_result(
                    ActionResultSource::Wire,
                    ActionResultReason::Character(error),
                );
                // ACE terminates an already-logged-in account with CharacterError.Logon. Treat
                // this authentication edge as a typed server disconnect instead of leaving the
                // client waiting for the generic receive timeout.
                if error == CharacterError::Logon && self.authenticating {
                    self.authenticating = false;
                    self.set_exit_cause(ClientExitCause::ServerDisconnect);
                    self.state = ClientState::Disconnected;
                    self.send_status_event();
                }
                Ok(())
            }
            GameMessage::AccountBoot(data) => {
                let reason = self.character_selection.handle_boot_account(*data);
                self.set_exit_cause(ClientExitCause::ServerDisconnect);
                self.state = ClientState::Disconnected;
                self.send_status_event();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::BootAccount(reason.clone()));
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
                let _ = self.client_view_event_tx.send(ClientViewEvent::Chat {
                    sender: sender.clone(),
                    message: data.message.clone(),
                    chat_type: data.chat_type.into(),
                });
                Ok(())
            }
            GameMessage::HearRangedSpeech(data) => {
                let _ = self.client_view_event_tx.send(ClientViewEvent::Chat {
                    sender: data.sender_name.clone(),
                    message: data.message.clone(),
                    chat_type: data.chat_type.into(),
                });
                Ok(())
            }
            GameMessage::EmoteText(data) => {
                let _ = self.client_view_event_tx.send(ClientViewEvent::Emote {
                    sender: data.sender_name.clone(),
                    text: data.text.clone(),
                });
                Ok(())
            }
            GameMessage::SoulEmote(data) => {
                let _ = self.client_view_event_tx.send(ClientViewEvent::SoulEmote {
                    sender: data.sender_name.clone(),
                    text: data.text.clone(),
                });
                Ok(())
            }
            GameMessage::TurbineChat(data) => {
                if let TurbineChatPayload::EventSendToRoom {
                    channel,
                    sender_name,
                    message,
                    chat_type,
                    ..
                } = &data.payload
                {
                    let channel_info =
                        ChatChannelInfo::turbine(*channel, *chat_type, data.dispatch_type);
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::ChannelMessage {
                            channel: channel_info,
                            sender: sender_name.clone(),
                            message: message.clone(),
                        });
                }
                Ok(())
            }
            _ => Ok(()),
        }?;

        Ok(world_events)
    }

    async fn handle_game_action(&mut self, _data: &GameAction) -> Result<()> {
        // `LoginComplete` is a client action (opcode 0x00A1), not a server completion echo. The
        // active lifecycle is published by `try_complete_world_activation` after the outbound
        // action succeeds; waiting for an inbound mirror would leave the client in portal space.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DynamicEntityEvent;
    use crate::client::{ClientState, PHYSICS_TICK_MS, builder};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::WorldObjectPropertyAccessorsMut;
    use holtburger_common::{CharacterOptions1, CharacterOptions2, ConfirmationType, Quaternion};
    use holtburger_protocol::errors::WeenieError;
    use holtburger_protocol::messages::movement::MotionStance;
    use holtburger_protocol::traits::ProtocolPack;
    use holtburger_world::WorldEvent;
    use holtburger_world::stats::CharacterLevelInfo;

    fn build_test_client() -> ClientRuntime {
        builder::build_test_client(ClientState::Connected)
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

    fn server_controlled_move_to_position(
        guid: holtburger_common::Guid,
        server_control_sequence: u16,
        movement_sequence: u16,
        origin: WorldPosition,
        desired_heading: f32,
    ) -> GameMessage {
        GameMessage::UpdateMotion(Box::new(MovementEventData {
            guid,
            object_instance_sequence: 7,
            movement_sequence,
            server_control_sequence,
            is_autonomous: false,
            movement_type: MovementType::MoveToPosition,
            motion_flags: 0,
            current_style: MotionStance::SwordCombat.interpreted(),
            data: MovementTypeData::MoveToPosition(MoveToPosition {
                origin: Origin {
                    cell_id: origin.landblock_id,
                    position: origin.coords,
                },
                params: MoveToParameters {
                    desired_heading,
                    ..Default::default()
                },
                run_rate: 1.0,
            }),
        }))
    }

    #[tokio::test]
    async fn test_player_teleport_emits_teleport_started_view_event() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();
        let generation_before = client.world_generation;

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
        assert_eq!(client.world_generation, generation_before + 1);
        assert!(matches!(
            client.lifecycle(),
            ClientLifecycleState::PortalSpace {
                cause: ClientWorldActivationCause::Teleport,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn teleport_destination_position_replaces_the_pre_portal_runtime_pose() {
        let mut client = build_test_client();
        let guid = holtburger_common::Guid(0x5000_0001);
        let outdoors = WorldPosition {
            landblock_id: holtburger_common::Guid(0x7c65_0032),
            coords: holtburger_common::Vector3::new(10.0, 10.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let dungeon = WorldPosition {
            landblock_id: holtburger_common::Guid(0x01d9_0100),
            // Keep the local-coordinate delta below the ordinary snap threshold. The portal edge,
            // rather than incidental coordinate distance or grounded state, owns this reset.
            coords: holtburger_common::Vector3::new(11.0, 10.0, 0.0),
            rotation: Quaternion::identity(),
        };
        client
            .world
            .seed_local_player_entity(guid, "Player", outdoors);
        let _ = client.world.set_local_player_runtime_pose(outdoors);
        let _ = client.world.set_player_vector(
            holtburger_common::Vector3::new(1.0, 2.0, 3.0),
            holtburger_common::Vector3::new(0.0, 0.0, 1.0),
        );

        let teleport = encode_message(&GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
            teleport_sequence: 42,
        })));
        client.handle_message(&teleport).await.unwrap();
        let teleport_generation = client.world_generation;

        let destination =
            encode_message(&GameMessage::UpdatePosition(Box::new(UpdatePositionData {
                guid,
                pos: PositionPack {
                    flags: UpdatePositionFlag::NONE,
                    pos: dungeon,
                    teleport_sequence: 42,
                    ..PositionPack::default()
                },
            })));
        client.handle_message(&destination).await.unwrap();

        assert_eq!(client.world.local_player_runtime_pose(), Some(dungeon));
        assert_eq!(client.world_generation, teleport_generation);
        let runtime = client
            .world
            .runtime_body_view(holtburger_world::SpatialBodyId::LocalPlayer(guid))
            .unwrap();
        assert_eq!(runtime.velocity, holtburger_common::Vector3::zero());
        assert_eq!(runtime.omega, holtburger_common::Vector3::zero());
    }

    #[tokio::test]
    async fn five_self_position_echoes_confirm_without_replacing_runtime_pose() {
        let mut client = build_test_client();
        let guid = holtburger_common::Guid(0x5000_0002);
        let authoritative = WorldPosition {
            landblock_id: holtburger_common::Guid(0x7c65_0032),
            coords: holtburger_common::Vector3::new(10.0, 10.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let runtime = WorldPosition {
            coords: holtburger_common::Vector3::new(12.0, 10.0, 0.0),
            ..authoritative
        };
        client
            .world
            .seed_local_player_entity(guid, "Player", authoritative);
        let player = client
            .world
            .entities
            .get_mut(guid)
            .expect("seeded player entity must exist");
        player.wcid = Some(42);
        player.set_did_prop(
            holtburger_common::properties::PropertyDataId::Setup,
            holtburger_common::Guid(0x0200_0001),
        );
        client.world.set_local_player_runtime_pose(runtime);
        let mut events = client.subscribe_client_view_events();

        let mut echoed = authoritative;
        for position_sequence in 1..=5 {
            echoed.coords.x = 10.0 + position_sequence as f32 * 0.1;
            let update =
                encode_message(&GameMessage::UpdatePosition(Box::new(UpdatePositionData {
                    guid,
                    pos: PositionPack {
                        flags: UpdatePositionFlag::HAS_CONTACT,
                        pos: echoed,
                        position_sequence,
                        ..PositionPack::default()
                    },
                })));
            client.handle_message(&update).await.unwrap();
            assert_eq!(client.world.local_player_runtime_pose(), Some(runtime));
        }

        let projected_poses = std::iter::from_fn(|| events.try_recv().ok())
            .filter_map(|event| {
                let ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity }) = event
                else {
                    return None;
                };
                if entity.identity.guid != guid {
                    return None;
                }
                let crate::DynamicEntityPlacementView::World { pose, .. } = entity.placement else {
                    return None;
                };
                Some(pose)
            })
            .collect::<Vec<_>>();

        assert!(projected_poses.len() >= 5);
        assert!(projected_poses.into_iter().all(|pose| pose == runtime));
        assert_eq!(client.world.player_position(), Some(echoed));
        assert_eq!(client.world.local_player_runtime_pose(), Some(runtime));
    }

    #[tokio::test]
    async fn test_item_mana_response_projects_to_client_view_event() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        let encoded = encode_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: holtburger_common::Guid(0x8000_0006),
            sequence: 0,
            event: GameEvent::QueryItemManaResponse(Box::new(QueryItemManaResponseEventData {
                mana: 0.5,
                success: 1,
            })),
        })));

        client.handle_message(&encoded).await.unwrap();

        let mut saw_item_mana_response = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::ItemManaResponse {
                    target: holtburger_common::Guid(0x8000_0006),
                    mana,
                    success: 1,
                } if (mana - 0.5).abs() < f32::EPSILON
            ) {
                saw_item_mana_response = true;
                break;
            }
        }

        assert!(saw_item_mana_response);
    }

    #[tokio::test]
    async fn soul_emote_message_projects_distinct_view_event_with_resolution() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        client.world.soul_emote_catalog =
            std::sync::Arc::new(holtburger_content::SoulEmoteCatalog {
                tokens: std::collections::BTreeMap::from([(
                    "wave".to_string(),
                    holtburger_content::SoulEmoteToken {
                        token: "wave".to_string(),
                        pose: "Wave".to_string(),
                    },
                )]),
                poses: std::collections::BTreeMap::from([(
                    "Wave".to_string(),
                    holtburger_content::SoulEmotePose {
                        pose: "Wave".to_string(),
                        my_emote: "wave.".to_string(),
                        other_emote: "waves.".to_string(),
                    },
                )]),
            });

        let encoded = encode_message(&GameMessage::SoulEmote(Box::new(SoulEmoteData {
            sender: 0x5000_0002,
            sender_name: "Fellow".to_string(),
            text: "wave.".to_string(),
        })));

        client.handle_message(&encoded).await.unwrap();

        let mut saw_soul_emote = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::SoulEmote { sender, text } = event {
                assert_eq!(sender, "Fellow");
                assert_eq!(text, "wave.");
                saw_soul_emote = true;
                break;
            }
        }

        assert!(saw_soul_emote);
    }

    #[tokio::test]
    async fn unknown_soul_emote_message_preserves_raw_token_without_inventing_resolution() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        let encoded = encode_message(&GameMessage::SoulEmote(Box::new(SoulEmoteData {
            sender: 0x5000_0002,
            sender_name: "Fellow".to_string(),
            text: "*mystery*".to_string(),
        })));

        client.handle_message(&encoded).await.unwrap();

        let mut saw_soul_emote = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::SoulEmote { sender, text } = event {
                assert_eq!(sender, "Fellow");
                assert_eq!(text, "*mystery*");
                saw_soul_emote = true;
                break;
            }
        }

        assert!(saw_soul_emote);
    }

    #[tokio::test]
    async fn test_current_server_controlled_update_motion_sends_heartbeat() {
        let mut client = build_test_client();
        let player_guid = holtburger_common::Guid(0x50000001);
        let position = WorldPosition {
            landblock_id: holtburger_common::Guid(0x01000000),
            ..WorldPosition::default()
        };
        client.world.player.guid = player_guid;
        client.world.player.server_control_sequence = 9;
        client
            .world
            .seed_local_player_entity(player_guid, "Player", position);

        let encoded = encode_message(&server_controlled_motion(player_guid, 10, 20));

        client.handle_message(&encoded).await.unwrap();

        assert_eq!(client.world.player.server_control_sequence, 10);
        assert_eq!(client.session.packet_sequence, 1);
        assert_eq!(client.session.bytes_out, 0);
    }

    #[tokio::test]
    async fn test_entering_world_does_not_auto_subscribe_to_fellowship_updates() {
        let mut client = build_test_client();
        client.state = ClientState::EnteringWorld;

        let encoded = encode_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: holtburger_common::Guid::NULL,
            sequence: 1,
            event: GameEvent::StartGame,
        })));

        client.handle_message(&encoded).await.unwrap();

        assert_eq!(client.state, ClientState::InWorld);
        assert_eq!(client.session.game_action_sequence, 0);
        assert_eq!(client.session.bytes_out, 0);
    }

    #[tokio::test]
    async fn character_enter_world_server_ready_completes_entry_in_core() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();
        client.character_selection.character_id = Some(holtburger_common::Guid(0x5000_0001));

        let encoded = encode_message(&GameMessage::CharacterEnterWorldServerReady);

        client.handle_message(&encoded).await.unwrap();

        let mut saw_ready = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::CharacterEnterWorldServerReady) {
                saw_ready = true;
                break;
            }
        }

        assert!(saw_ready);
        assert!(client.session.bytes_out > 0);
        assert_eq!(client.session.packet_sequence, 2);
    }

    #[tokio::test]
    async fn test_stale_server_controlled_update_motion_skips_heartbeat() {
        let mut client = build_test_client();
        let player_guid = holtburger_common::Guid(0x50000001);
        client.world.player.guid = player_guid;
        client.world.player.server_control_sequence = 10;
        client
            .world
            .seed_local_player_entity(player_guid, "Player", WorldPosition::default());

        let encoded = encode_message(&server_controlled_motion(player_guid, 9, 19));

        client.handle_message(&encoded).await.unwrap();

        assert_eq!(client.world.player.server_control_sequence, 10);
        assert_eq!(client.session.packet_sequence, 1);
        assert_eq!(client.session.bytes_out, 0);
    }

    #[tokio::test]
    async fn server_controlled_move_to_position_registers_deferred_projection() {
        let mut client = build_test_client();
        let player_guid = holtburger_common::Guid(0x50000001);
        let start = WorldPosition {
            landblock_id: holtburger_common::Guid(0x01000000),
            coords: holtburger_common::Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let destination = WorldPosition {
            landblock_id: holtburger_common::Guid(0x01000000),
            coords: holtburger_common::Vector3::new(32.0, 48.0, 0.0),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };

        client.world.player.guid = player_guid;
        client.world.player.server_control_sequence = 9;
        client
            .world
            .seed_local_player_entity(player_guid, "Player", start);

        let encoded = encode_message(&server_controlled_move_to_position(
            player_guid,
            10,
            20,
            destination,
            90.0_f32.to_radians(),
        ));

        client.handle_message(&encoded).await.unwrap();

        assert_eq!(client.world.player.server_control_sequence, 10);
        assert_eq!(client.world.player_position(), Some(start));
        let body = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::LocalPlayer(player_guid))
            .expect("server-controlled movement should retain the local runtime body");
        assert_eq!(body.pose, start);
        let drive = client
            .movement
            .current_local_drive_control(
                &client.world,
                std::time::Duration::from_millis(PHYSICS_TICK_MS),
            )
            .expect("server-controlled movement should expose an ordinary drive target");
        assert_eq!(drive.target_hint, Some(destination));
        assert!(drive.desired_world_delta.length_squared() > 0.0);
        assert_eq!(client.session.packet_sequence, 1);
    }

    #[tokio::test]
    async fn test_level_info_world_event_projects_directly() {
        let client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        client.handle_world_event(&WorldEvent::LevelInfoUpdated(CharacterLevelInfo {
            level: 23,
            current_xp: 1234,
            unspent_xp: 456,
            unspent_skill_points: 7,
            available_luminance: 89,
            next_level_xp: 9999,
            xp_into_level: 111,
            xp_for_next_level: 222,
        }));

        let mut saw_level_info = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::PlayerLevelInfoUpdated {
                    level_info: CharacterLevelInfo { level: 23, .. }
                }
            ) {
                saw_level_info = true;
                break;
            }
        }

        assert!(saw_level_info);
    }

    #[tokio::test]
    async fn test_spell_world_event_projects_supplied_snapshot() {
        let client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        client.handle_world_event(&WorldEvent::SpellUpdated {
            spell_id: 100,
            name: Some("Test Spell".to_string()),
            spell_ids: vec![300, 100, 200],
        });

        let mut saw_spell_snapshot = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::PlayerSpellsUpdated { spell_ids }
                    if spell_ids == vec![300, 100, 200]
            ) {
                saw_spell_snapshot = true;
                break;
            }
        }

        assert!(saw_spell_snapshot);
    }

    #[tokio::test]
    async fn test_confirmation_request_projects_active_confirmation_state() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        let encoded = encode_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: holtburger_common::Guid::NULL,
            sequence: 0x0E,
            event: GameEvent::CharacterConfirmationRequest(Box::new(
                CharacterConfirmationRequestEventData {
                    confirmation_type: ConfirmationType::CraftInteraction,
                    context: 0xDEADBEEF,
                    text: "Craft this item? Success chance is 42%.".to_string(),
                },
            )),
        })));

        client.handle_message(&encoded).await.unwrap();

        assert!(matches!(
            client.active_confirmation,
            Some(ActiveCharacterConfirmation {
                confirmation_type: ConfirmationType::CraftInteraction,
                context: 0xDEADBEEF,
                ..
            })
        ));

        let mut saw_projection = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::ActiveCharacterConfirmationUpdated {
                    confirmation: Some(ActiveCharacterConfirmation {
                        confirmation_type: ConfirmationType::CraftInteraction,
                        context: 0xDEADBEEF,
                        ..
                    }),
                }
            ) {
                saw_projection = true;
                break;
            }
        }

        assert!(saw_projection);
    }

    #[tokio::test]
    async fn test_confirmation_done_clears_matching_active_confirmation_state() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();
        client.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::CraftInteraction,
            context: 0xDEADBEEF,
            text: "Craft this item?".to_string(),
        });

        let encoded = encode_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: holtburger_common::Guid::NULL,
            sequence: 0x0F,
            event: GameEvent::CharacterConfirmationDone(Box::new(
                CharacterConfirmationDoneEventData {
                    confirmation_type: ConfirmationType::CraftInteraction,
                    context: 0xDEADBEEF,
                },
            )),
        })));

        client.handle_message(&encoded).await.unwrap();

        assert!(client.active_confirmation.is_none());
        assert_eq!(client.session.game_action_sequence, 1);

        let mut saw_clear = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::ActiveCharacterConfirmationUpdated { confirmation: None }
            ) {
                saw_clear = true;
                break;
            }
        }

        assert!(saw_clear);
    }

    #[tokio::test]
    async fn test_confirmation_done_does_not_auto_respond_for_fellowship() {
        let mut client = build_test_client();
        client.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::Fellowship,
            context: 0xDEADBEEF,
            text: "Join fellowship?".to_string(),
        });

        let encoded = encode_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: holtburger_common::Guid::NULL,
            sequence: 0x10,
            event: GameEvent::CharacterConfirmationDone(Box::new(
                CharacterConfirmationDoneEventData {
                    confirmation_type: ConfirmationType::Fellowship,
                    context: 0xDEADBEEF,
                },
            )),
        })));

        client.handle_message(&encoded).await.unwrap();

        assert!(client.active_confirmation.is_none());
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[tokio::test]
    async fn test_character_create_response_projects_pending_operation() {
        let mut client = build_test_client();
        let mut view_events = client.subscribe_client_view_events();
        client.character_selection.pending_character_operation =
            Some(CharacterManagementOperation::Create);

        let encoded = encode_message(&GameMessage::CharacterCreateResponse(Box::new(
            CharacterCreateResponseData {
                response: CharacterGenerationVerificationResponse::Ok,
                guid: Some(holtburger_common::Guid(0x5000_1234)),
                name: Some("Bestie".to_string()),
                seconds_disabled: Some(0),
            },
        )));

        client.handle_message(&encoded).await.unwrap();

        let mut saw_view = false;
        while let Ok(event) = view_events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::CharacterManagementResponse {
                    operation: Some(CharacterManagementOperation::Create),
                    response: CharacterCreateResponseData {
                        response: CharacterGenerationVerificationResponse::Ok,
                        ..
                    },
                }
            ) {
                saw_view = true;
                break;
            }
        }
        assert!(saw_view);
    }

    #[tokio::test]
    async fn test_character_delete_response_projects_event() {
        let mut client = build_test_client();
        let mut view_events = client.subscribe_client_view_events();
        client.character_selection.pending_character_operation =
            Some(CharacterManagementOperation::Delete);

        let encoded = encode_message(&GameMessage::CharacterDeleteResponse);

        client.handle_message(&encoded).await.unwrap();

        let mut saw_view = false;
        while let Ok(event) = view_events.try_recv() {
            if matches!(event, ClientViewEvent::CharacterDeleteResponse) {
                saw_view = true;
                break;
            }
        }
        assert!(saw_view);
    }

    #[tokio::test]
    async fn test_player_info_world_event_projects_player_options() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();
        client.world.player.options1 = CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG;
        client.world.player.options2 = CharacterOptions2::SHOW_HELM;

        client.handle_world_event(&WorldEvent::PlayerInfo(Box::new(
            holtburger_world::PlayerInfoData {
                entity: Box::new(Entity::new(
                    holtburger_common::Guid(0x50000001),
                    "Test Player".to_string(),
                    WorldPosition::default(),
                )),
                attributes: Vec::new(),
                vitals: Vec::new(),
                skills: Vec::new(),
                enchantments: Vec::new(),
                spells: Vec::new(),
                level_info: CharacterLevelInfo::default(),
                resistances: holtburger_world::stats::Resistances::default(),
                armor: 0,
                vitae: 1.0,
                inventory: Default::default(),
                equipment: Default::default(),
            },
        )));

        let mut saw_options_projection = false;
        let mut saw_authoritative_player_spawn = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::PlayerOptionsUpdated { options }
                    if options.options1 == CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG
                        && options.options2 == CharacterOptions2::SHOW_HELM
            ) {
                saw_options_projection = true;
            }

            if matches!(
                event,
                ClientViewEvent::EntitySpawned { entity }
                    if entity.guid == holtburger_common::Guid(0x50000001)
                        && entity.name() == "Test Player"
            ) {
                saw_authoritative_player_spawn = true;
            }
        }

        assert!(saw_options_projection);
        assert!(saw_authoritative_player_spawn);
    }

    #[tokio::test]
    async fn use_done_finishes_busy_operation_with_weenie_hint() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();
        client.arm_busy_operation(BusyOperationKind::Sell);

        let encoded_error = encode_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: holtburger_common::Guid::NULL,
            sequence: 0x11,
            event: GameEvent::WeenieError(Box::new(WeenieErrorEventData {
                error: WeenieError::FullInventoryLocation,
            })),
        })));
        client.handle_message(&encoded_error).await.unwrap();

        let encoded_done = encode_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: holtburger_common::Guid::NULL,
            sequence: 0x12,
            event: GameEvent::UseDone(Box::new(UseDoneEventData {
                error: WeenieError::None,
            })),
        })));
        client.handle_message(&encoded_done).await.unwrap();

        assert!(client.active_busy_operation.is_none());

        let mut saw_completion = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::BusyOperationFinished {
                    operation: BusyOperationKind::Sell,
                    result: BusyOperationResult::Completed {
                        error: WeenieError::FullInventoryLocation,
                        parameter: None,
                    },
                }
            ) {
                saw_completion = true;
                break;
            }
        }

        assert!(saw_completion);
    }

    #[tokio::test]
    async fn use_done_with_explicit_error_finishes_busy_operation_directly() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();
        client.arm_busy_operation(BusyOperationKind::Buy);

        let encoded = encode_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: holtburger_common::Guid::NULL,
            sequence: 0x13,
            event: GameEvent::UseDone(Box::new(UseDoneEventData {
                error: WeenieError::NoObject,
            })),
        })));
        client.handle_message(&encoded).await.unwrap();

        let mut saw_completion = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::BusyOperationFinished {
                    operation: BusyOperationKind::Buy,
                    result: BusyOperationResult::Completed {
                        error: WeenieError::NoObject,
                        parameter: None,
                    },
                }
            ) {
                saw_completion = true;
                break;
            }
        }

        assert!(saw_completion);
    }

    #[tokio::test]
    async fn logon_character_error_terminates_authentication_as_server_disconnect() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();
        client.authenticating = true;

        let encoded = encode_message(&GameMessage::CharacterError(Box::new(CharacterErrorData {
            error_id: CharacterError::Logon as u32,
        })));
        client.handle_message(&encoded).await.unwrap();

        assert_eq!(client.state, ClientState::Disconnected);
        assert_eq!(
            client.lifecycle(),
            ClientLifecycleState::Exiting {
                cause: ClientExitCause::ServerDisconnect,
            }
        );
        let mut saw_exit = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::LifecycleChanged(ClientLifecycleState::Exiting {
                    cause: ClientExitCause::ServerDisconnect,
                })
            ) {
                saw_exit = true;
                break;
            }
        }
        assert!(saw_exit);
    }
}
