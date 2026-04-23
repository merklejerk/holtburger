use crate::client::types::{
    ActionResultReason, ActionResultSource, BusyOperationKind, ClientCommand, TargetSlot,
};
use crate::client::{ClientRuntime, ClientState};
use crate::motion_command_for_soul_emote_pose;
use anyhow::{Result, anyhow};
use holtburger_common::CharacterOption;
use holtburger_common::Guid;
use holtburger_common::properties::{EquipMask, PseudoEquipMask, WorldObjectExt as _};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::GameMessage;
use holtburger_protocol::messages::transport::packet_flags;
use holtburger_protocol::messages::*;
use holtburger_world::spell::MagicSchool;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NormalizedSpellCast {
    Targeted { target: Guid, spell_id: u32 },
    Untargeted { spell_id: u32 },
}

fn normalize_spell_cast(
    world: &holtburger_world::WorldState,
    spell_id: u32,
    requested_target: Option<Guid>,
) -> NormalizedSpellCast {
    let player_guid = world.player.guid;

    if let Some(spell) = world.spell_catalog.get(spell_id) {
        if spell.is_untargeted() {
            return NormalizedSpellCast::Untargeted { spell_id };
        }

        if spell.is_self_targeted() {
            return NormalizedSpellCast::Targeted {
                target: player_guid,
                spell_id,
            };
        }

        if requested_target == Some(player_guid) && spell.school == MagicSchool::WarMagic {
            return NormalizedSpellCast::Untargeted { spell_id };
        }
    }

    match requested_target {
        Some(target) => NormalizedSpellCast::Targeted { target, spell_id },
        None => NormalizedSpellCast::Untargeted { spell_id },
    }
}

fn render_soul_emote_text(text: &str) -> String {
    text.replace("%p", "their")
}

impl ClientRuntime {
    fn resolve_legacy_channel(kind: crate::client::types::ChatChannelKind) -> Option<ChatChannel> {
        match kind {
            crate::client::types::ChatChannelKind::Fellowship => Some(ChatChannel::Fellow),
            crate::client::types::ChatChannelKind::Allegiance => {
                Some(ChatChannel::AllegianceBroadcast)
            }
            crate::client::types::ChatChannelKind::Vassals => Some(ChatChannel::Vassals),
            crate::client::types::ChatChannelKind::Patron => Some(ChatChannel::Patron),
            crate::client::types::ChatChannelKind::Monarch => Some(ChatChannel::Monarch),
            crate::client::types::ChatChannelKind::CoVassals => Some(ChatChannel::CoVassals),
            _ => None,
        }
    }

    fn resolve_turbine_channel(
        &self,
        kind: crate::client::types::ChatChannelKind,
    ) -> Option<(TurbineChatChannelId, TurbineChatType)> {
        if !self.turbine_chat.enabled {
            return None;
        }

        let channels = self.turbine_chat.channels.as_ref()?;

        match kind {
            crate::client::types::ChatChannelKind::Allegiance => channels
                .allegiance
                .map(|channel| (channel, TurbineChatType::Allegiance)),
            crate::client::types::ChatChannelKind::General => channels
                .channel_for_type(TurbineChatType::General)
                .map(|channel| (channel, TurbineChatType::General)),
            crate::client::types::ChatChannelKind::Trade => channels
                .channel_for_type(TurbineChatType::Trade)
                .map(|channel| (channel, TurbineChatType::Trade)),
            crate::client::types::ChatChannelKind::Lfg => channels
                .channel_for_type(TurbineChatType::Lfg)
                .map(|channel| (channel, TurbineChatType::Lfg)),
            crate::client::types::ChatChannelKind::Roleplay => channels
                .channel_for_type(TurbineChatType::Roleplay)
                .map(|channel| (channel, TurbineChatType::Roleplay)),
            crate::client::types::ChatChannelKind::Society => channels
                .channel_for_type(TurbineChatType::Society)
                .map(|channel| (channel, TurbineChatType::Society)),
            crate::client::types::ChatChannelKind::Olthoi => channels
                .channel_for_type(TurbineChatType::Olthoi)
                .map(|channel| (channel, TurbineChatType::Olthoi)),
            _ => None,
        }
    }

    pub(super) async fn handle_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Login(_)
            | ClientCommand::SelectCharacter(_)
            | ClientCommand::SendCharacterEnterWorld { .. }
            | ClientCommand::CreateCharacter(_)
            | ClientCommand::DeleteCharacter { .. }
            | ClientCommand::RestoreCharacter(_)
            | ClientCommand::EnterWorld => self.handle_auth_command(cmd).await,

            ClientCommand::Talk(_)
            | ClientCommand::Tell { .. }
            | ClientCommand::ChannelMessage { .. }
            | ClientCommand::Emote(_)
            | ClientCommand::SoulEmote(_) => self.handle_chat_command(cmd).await,

            ClientCommand::Identify(_)
            | ClientCommand::ReadBookPage { .. }
            | ClientCommand::QueryHealth(_)
            | ClientCommand::Use(_)
            | ClientCommand::CloseContainer(_)
            | ClientCommand::UseWithTarget { .. }
            | ClientCommand::SalvageItemsWith { .. }
            | ClientCommand::CastTargetedSpell { .. }
            | ClientCommand::CastUntargetedSpell { .. }
            | ClientCommand::TargetedMeleeAttack { .. }
            | ClientCommand::TargetedMissileAttack { .. }
            | ClientCommand::Buy { .. }
            | ClientCommand::Sell { .. }
            | ClientCommand::OpenTrade(_)
            | ClientCommand::CloseTrade
            | ClientCommand::AcceptTrade
            | ClientCommand::DeclineTrade
            | ClientCommand::ResetTrade
            | ClientCommand::AddToTrade { .. }
            | ClientCommand::GiveObjectRequest { .. }
            | ClientCommand::SetCharacterOption { .. }
            | ClientCommand::RecallLifestone
            | ClientCommand::TeleportToPklArena
            | ClientCommand::TeleportToMarketplace
            | ClientCommand::RecallAllegianceHousing
            | ClientCommand::SwearAllegiance { .. }
            | ClientCommand::Unswear { .. }
            | ClientCommand::Suicide
            | ClientCommand::EnterPkLite
            | ClientCommand::AddPlayerPermission { .. }
            | ClientCommand::RemovePlayerPermission { .. }
            | ClientCommand::RespondToConfirmation { .. } => {
                self.handle_interaction_command(cmd).await
            }

            ClientCommand::CreateParty { .. }
            | ClientCommand::ShowPartyStatus
            | ClientCommand::InviteToParty { .. }
            | ClientCommand::PromotePartyLeader { .. }
            | ClientCommand::LeaveParty
            | ClientCommand::UninviteFromParty { .. } => self.handle_social_command(cmd).await,

            ClientCommand::Drop(_)
            | ClientCommand::Get(_)
            | ClientCommand::Stack { .. }
            | ClientCommand::Split { .. }
            | ClientCommand::MoveItem { .. }
            | ClientCommand::GetAndWield { .. }
            | ClientCommand::SplitToWield { .. } => self.handle_inventory_command(cmd).await,

            ClientCommand::DriveSelf(_) => self.handle_movement_command(cmd).await,

            ClientCommand::RaiseAttribute { .. }
            | ClientCommand::RaiseVital { .. }
            | ClientCommand::RaiseSkill { .. }
            | ClientCommand::TrainSkill { .. } => self.handle_progression_command(cmd).await,

            ClientCommand::SetCombatMode(_)
            | ClientCommand::CancelAttack
            | ClientCommand::Ping
            | ClientCommand::RequestInitialViewState
            | ClientCommand::SetFellowshipUpdatesSubscribed { .. }
            | ClientCommand::QueryEntityDebugInfo(_)
            | ClientCommand::Quit => self.handle_system_command(cmd).await,
        }
    }

    pub(super) async fn disconnect(&mut self) -> Result<()> {
        let header = PacketHeader {
            flags: packet_flags::DISCONNECT,
            sequence: self.session.packet_sequence,
            id: self.session.client_id,
            ..Default::default()
        };
        self.session.packet_sequence += 1;
        self.session
            .send_packet_to_addr(header, &[], self.session.server_addr)
            .await?;

        self.state = ClientState::Disconnected;
        self.send_status_event();

        Ok(())
    }

    async fn send_game_action(&mut self, action: GameAction) -> Result<()> {
        self.session.send_action(action).await
    }

    async fn handle_auth_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Login(password) => {
                log::info!("Attempting login...");
                self.session
                    .send_login_request(&self.character_selection.account_name, &password)
                    .await
            }
            ClientCommand::SelectCharacter(id) => {
                log::info!("Selecting character: 0x{:08X}", id);
                self.begin_world_entry_transition().await?;
                self.character_selection
                    .select_character(id, &mut self.session)
                    .await
            }
            ClientCommand::SendCharacterEnterWorld { guid, account } => {
                log::info!("Entering world with character: 0x{:08X}", guid);
                self.character_selection
                    .send_character_enter_world(guid, account, &mut self.session)
                    .await
            }
            ClientCommand::CreateCharacter(request) => {
                log::info!("Creating character: {}", request.name);
                self.character_selection
                    .create_character(*request, &mut self.session)
                    .await
            }
            ClientCommand::DeleteCharacter { slot } => {
                log::info!("Deleting character in slot {}", slot);
                self.character_selection
                    .delete_character(slot, &mut self.session)
                    .await
            }
            ClientCommand::RestoreCharacter(guid) => {
                log::info!("Restoring character: 0x{:08X}", guid);
                self.character_selection
                    .restore_character(guid, &mut self.session)
                    .await
            }
            ClientCommand::EnterWorld => {
                if let Some(char_id) = self.character_selection.character_id {
                    log::info!(
                        "Attempting to enter world with character: 0x{:08X}",
                        char_id
                    );
                    self.begin_world_entry_transition().await?;
                    self.character_selection
                        .select_character(char_id, &mut self.session)
                        .await
                } else {
                    Ok(())
                }
            }
            _ => unreachable!(),
        }
    }

    async fn handle_chat_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Talk(text) => {
                if matches!(self.state, ClientState::InWorld) {
                    log::info!(">>> You say: \"{}\"", text);
                    return self.send_talk(&text).await;
                }
                Ok(())
            }
            ClientCommand::Tell { target, message } => {
                if matches!(self.state, ClientState::InWorld) {
                    log::info!(">>> You tell {}, \"{}\"", target, message);
                    return self
                        .send_game_action(GameAction::Tell(Box::new(TellActionData {
                            target,
                            message,
                        })))
                        .await;
                }
                Ok(())
            }
            ClientCommand::ChannelMessage { channel, message } => {
                if matches!(self.state, ClientState::InWorld) {
                    log::info!(">>> You send {:?}: \"{}\"", channel, message);
                    if let Some((room_id, chat_type)) = self.resolve_turbine_channel(channel) {
                        let context_id = self.turbine_chat.next_context_id;
                        self.turbine_chat.next_context_id =
                            self.turbine_chat.next_context_id.wrapping_add(1).max(1);

                        return self
                            .session
                            .send_message(&GameMessage::TurbineChat(Box::new(
                                TurbineChatMessageData {
                                    blob_type: TurbineChatBlobType::RequestBinary,
                                    dispatch_type: TurbineChatDispatchType::SendToRoomById,
                                    target_type: 1,
                                    target_id: 0,
                                    transport_type: 0,
                                    transport_id: 0,
                                    cookie: 0,
                                    payload: TurbineChatPayload::RequestSendToRoomById {
                                        context_id,
                                        room_id,
                                        message,
                                        extra_data_size: 0x0C,
                                        sender_id: self.world.player.guid.0,
                                        hresult: 0,
                                        chat_type: chat_type.into(),
                                    },
                                },
                            )))
                            .await;
                    }

                    if let Some(channel) = Self::resolve_legacy_channel(channel) {
                        return self
                            .send_game_action(GameAction::ChatChannel(Box::new(
                                ChatChannelActionData {
                                    channel: channel.into(),
                                    message,
                                },
                            )))
                            .await;
                    }

                    self.emit_action_result(
                        ActionResultSource::Client,
                        ActionResultReason::General(format!(
                            "No supported chat transport is available for {:?}.",
                            channel
                        )),
                    );
                }
                Ok(())
            }
            ClientCommand::Emote(text) => {
                if matches!(self.state, ClientState::InWorld) {
                    log::info!(">>> You emote: \"{}\"", text);
                    return self
                        .send_game_action(GameAction::Emote(Box::new(EmoteActionData {
                            message: text,
                        })))
                        .await;
                }
                Ok(())
            }
            ClientCommand::SoulEmote(token) => {
                if matches!(self.state, ClientState::InWorld) {
                    let Some(resolved) = self.world.soul_emote_catalog.resolve(&token) else {
                        self.emit_action_result(
                            ActionResultSource::Client,
                            ActionResultReason::General(format!(
                                "Unknown soul emote token: {}",
                                token
                            )),
                        );
                        return Ok(());
                    };

                    let pose = resolved.pose.to_string();
                    let message = resolved
                        .other_emote
                        .map(render_soul_emote_text)
                        .or_else(|| resolved.my_emote.map(str::to_owned))
                        .unwrap_or_else(|| resolved.token.to_string());

                    if let Some(command) = motion_command_for_soul_emote_pose(&pose) {
                        let motion_style = self
                            .world
                            .player
                            .last_server_motion_style
                            .unwrap_or(MotionStance::NonCombat);
                        self.movement.enqueue_transient_motion(
                            command,
                            crate::client::movement_types::MotionStyle::Explicit(motion_style),
                        );
                    }

                    log::info!(">>> You soul emote: \"{}\"", message);
                    return self
                        .send_game_action(GameAction::SoulEmote(Box::new(SoulEmoteActionData {
                            message,
                        })))
                        .await;
                }
                Ok(())
            }
            _ => unreachable!(),
        }
    }

    async fn handle_interaction_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Identify(guid) => {
                log::info!(">>> Identifying: 0x{:08X}", guid);
                self.send_game_action(GameAction::IdentifyObject(Box::new(
                    IdentifyObjectActionData { guid },
                )))
                .await
            }
            ClientCommand::ReadBookPage { book, page_index } => {
                log::info!(">>> Reading book page {} from 0x{:08X}", page_index, book);
                let page_index = i32::try_from(page_index).map_err(|_| {
                    anyhow!("book page index {} exceeds i32 wire range", page_index)
                })?;
                self.send_game_action(GameAction::BookPageData(Box::new(BookPageDataActionData {
                    guid: book,
                    page_index,
                })))
                .await
            }
            ClientCommand::QueryHealth(guid) => {
                log::info!(">>> Querying health for: 0x{:08X}", guid.0);
                self.send_game_action(GameAction::QueryHealth(Box::new(QueryHealthActionData {
                    target_guid: guid,
                })))
                .await
            }
            ClientCommand::Use(guid) => {
                log::info!(">>> Using: 0x{:08X}", guid);
                if !self.arm_busy_operation(BusyOperationKind::Use) {
                    return Ok(());
                }
                self.send_game_action(GameAction::Use(Box::new(UseActionData { guid })))
                    .await
            }
            ClientCommand::UseWithTarget { item, target } => {
                log::info!(">>> Using: 0x{:08X} on 0x{:08X}", item, target);
                if !self.arm_busy_operation(BusyOperationKind::UseWithTarget) {
                    return Ok(());
                }
                self.send_game_action(GameAction::UseWithTarget(Box::new(
                    UseWithTargetActionData {
                        item_guid: item,
                        target_guid: target,
                    },
                )))
                .await
            }
            ClientCommand::SalvageItemsWith { tool, items } => {
                log::info!(">>> Salvaging {} item(s) with 0x{:08X}", items.len(), tool);
                self.send_game_action(GameAction::SalvageItemsWith(Box::new(
                    SalvageItemsWithActionData {
                        tool_guid: tool,
                        items,
                    },
                )))
                .await
            }
            ClientCommand::CastTargetedSpell { target, spell_id } => {
                self.send_normalized_spell_cast(spell_id, Some(target))
                    .await
            }
            ClientCommand::CastUntargetedSpell { spell_id } => {
                self.send_normalized_spell_cast(spell_id, None).await
            }
            ClientCommand::TargetedMeleeAttack {
                target,
                attack_height,
                power_level,
            } => {
                log::info!(
                    ">>> Targeted melee attack on 0x{:08X} ({:?}, power {:.2})",
                    target.0,
                    attack_height,
                    power_level
                );
                self.send_game_action(GameAction::TargetedMeleeAttack(Box::new(
                    TargetedMeleeAttackActionData {
                        target_guid: target,
                        attack_height,
                        power_level,
                    },
                )))
                .await
            }
            ClientCommand::TargetedMissileAttack {
                target,
                attack_height,
                accuracy_level,
            } => {
                log::info!(
                    ">>> Targeted missile attack on 0x{:08X} ({:?}, accuracy {:.2})",
                    target.0,
                    attack_height,
                    accuracy_level
                );
                self.send_game_action(GameAction::TargetedMissileAttack(Box::new(
                    TargetedMissileAttackActionData {
                        target_guid: target,
                        attack_height,
                        accuracy_level,
                    },
                )))
                .await
            }
            ClientCommand::GiveObjectRequest {
                target,
                item,
                amount,
            } => {
                log::info!(
                    ">>> Giving item 0x{:08X} to target 0x{:08X} (amount {})",
                    item,
                    target,
                    amount
                );
                self.send_game_action(GameAction::GiveObjectRequest(Box::new(
                    GiveObjectRequestActionData {
                        target_guid: target,
                        item_guid: item,
                        amount: amount as i32,
                    },
                )))
                .await
            }
            ClientCommand::Buy { vendor, items } => {
                if !self.arm_busy_operation(BusyOperationKind::Buy) {
                    return Ok(());
                }
                self.send_game_action(GameAction::Buy(Box::new(BuyActionData {
                    vendor_guid: vendor,
                    items,
                })))
                .await
            }
            ClientCommand::Sell { vendor, items } => {
                if !self.arm_busy_operation(BusyOperationKind::Sell) {
                    return Ok(());
                }
                self.send_game_action(GameAction::Sell(Box::new(SellActionData {
                    vendor_guid: vendor,
                    items,
                })))
                .await
            }
            ClientCommand::OpenTrade(target) => {
                self.send_game_action(GameAction::OpenTradeNegotiations(Box::new(
                    OpenTradeNegotiationsActionData {
                        trade_partner_guid: target,
                    },
                )))
                .await
            }
            ClientCommand::CloseTrade => {
                self.send_game_action(GameAction::CloseTradeNegotiations(Box::new(
                    CloseTradeNegotiationsActionData {},
                )))
                .await
            }
            ClientCommand::AcceptTrade => {
                let data = if let Some(trade) = self.world.trade.as_ref() {
                    AcceptTradeActionData {
                        partner_guid: trade.partner_guid,
                        trade_stamp: trade.trade_stamp,
                        trade_status: 1,
                        initiator_guid: trade.initiator_guid,
                        initiator_accepts: 1,
                        partner_accepts: if trade.partner_side.accepted { 1 } else { 0 },
                    }
                } else {
                    AcceptTradeActionData::default()
                };
                self.send_game_action(GameAction::AcceptTrade(Box::new(data)))
                    .await
            }
            ClientCommand::DeclineTrade => {
                self.send_game_action(GameAction::DeclineTrade(Box::new(
                    DeclineTradeActionData {},
                )))
                .await
            }
            ClientCommand::ResetTrade => {
                self.send_game_action(GameAction::ResetTrade(Box::new(ResetTradeActionData {})))
                    .await
            }
            ClientCommand::AddToTrade { item } => {
                self.send_game_action(GameAction::AddToTrade(Box::new(AddToTradeActionData {
                    item_guid: item,
                    trade_slot: 0,
                })))
                .await
            }
            ClientCommand::CloseContainer(guid) => {
                log::info!(">>> Closing container: 0x{:08X}", guid);

                self.send_game_action(GameAction::NoLongerViewingContents(Box::new(
                    NoLongerViewingContentsActionData {
                        container_guid: guid,
                    },
                )))
                .await
            }
            ClientCommand::SetCharacterOption { option, value } => {
                log::info!(">>> Setting character option {:?} to {}", option, value);
                self.send_game_action(GameAction::SetSingleCharacterOption(Box::new(
                    SetSingleCharacterOptionActionData { option, value },
                )))
                .await?;
                self.world
                    .player
                    .set_character_option_enabled(option, value);
                self.emit_player_options_updated();
                Ok(())
            }
            ClientCommand::AddPlayerPermission { player_name } => {
                log::info!(">>> Permitting {} to loot corpse", player_name);
                self.send_game_action(GameAction::AddPlayerPermission(Box::new(
                    AddPlayerPermissionActionData { player_name },
                )))
                .await
            }
            ClientCommand::RemovePlayerPermission { player_name } => {
                log::info!(">>> Revoking corpse permission from {}", player_name);
                self.send_game_action(GameAction::RemovePlayerPermission(Box::new(
                    RemovePlayerPermissionActionData { player_name },
                )))
                .await
            }
            ClientCommand::RecallLifestone => {
                log::info!(">>> Recalling to lifestone");
                self.send_game_action(GameAction::TeleToLifestone(Box::new(
                    TeleToLifestoneActionData,
                )))
                .await
            }
            ClientCommand::TeleportToPklArena => {
                log::info!(">>> Teleporting to PKL arena");
                self.send_game_action(GameAction::TeleToPklArena(Box::new(
                    TeleToPklArenaActionData,
                )))
                .await
            }
            ClientCommand::TeleportToMarketplace => {
                log::info!(">>> Teleporting to marketplace");
                self.send_game_action(GameAction::TeleToMarketPlace(Box::new(
                    TeleToMarketPlaceActionData,
                )))
                .await
            }
            ClientCommand::RecallAllegianceHousing => {
                log::info!(">>> Recalling to allegiance housing");
                self.send_game_action(GameAction::TeleToMansion(Box::new(TeleToMansionActionData)))
                    .await
            }
            ClientCommand::SwearAllegiance {
                target: target_guid,
            } => {
                log::info!(">>> Swearing allegiance to 0x{:08X}", target_guid.0);
                self.send_game_action(GameAction::SwearAllegiance(Box::new(
                    SwearAllegianceActionData { target_guid },
                )))
                .await
            }
            ClientCommand::Unswear {
                target: target_guid,
            } => {
                log::info!(">>> Breaking allegiance from 0x{:08X}", target_guid.0);
                self.send_game_action(GameAction::BreakAllegiance(Box::new(
                    BreakAllegianceActionData { target_guid },
                )))
                .await
            }
            ClientCommand::Suicide => {
                log::info!(">>> Initiating suicide");
                self.send_game_action(GameAction::Suicide(Box::new(SuicideActionData)))
                    .await
            }
            ClientCommand::EnterPkLite => {
                log::info!(">>> Entering PK Lite");
                self.send_game_action(GameAction::EnterPkLite(Box::new(EnterPkLiteActionData)))
                    .await
            }
            ClientCommand::RespondToConfirmation { accepted } => {
                let Some(confirmation) = self.active_confirmation.clone() else {
                    self.emit_action_result(
                        ActionResultSource::Client,
                        ActionResultReason::General(
                            "No active confirmation request to answer.".to_string(),
                        ),
                    );
                    return Ok(());
                };

                log::info!(
                    ">>> Responding to confirmation {:?} (context 0x{:08X}) with {}",
                    confirmation.confirmation_type,
                    confirmation.context,
                    accepted
                );
                self.send_game_action(GameAction::ConfirmationResponse(Box::new(
                    ConfirmationResponseActionData {
                        confirmation_type: confirmation.confirmation_type,
                        context: confirmation.context,
                        accepted,
                    },
                )))
                .await?;

                self.active_confirmation = None;
                self.emit_active_character_confirmation_updated();
                Ok(())
            }
            _ => unreachable!(),
        }
    }

    async fn handle_inventory_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Drop(guid) => {
                log::info!(">>> Dropping: 0x{:08X}", guid);
                self.send_game_action(GameAction::DropItem(Box::new(DropItemActionData {
                    item_guid: guid,
                })))
                .await
            }
            ClientCommand::Get(guid) => {
                log::info!(">>> Getting: 0x{:08X}", guid);
                self.send_game_action(GameAction::PutItemInContainer(Box::new(
                    PutItemInContainerActionData {
                        item_guid: guid,
                        container_guid: self.world.player.guid,
                        placement: 0,
                    },
                )))
                .await
            }
            ClientCommand::Stack {
                source,
                destination,
                amount,
            } => {
                log::info!(
                    ">>> Stacking 0x{:08X} ({}x) onto 0x{:08X}",
                    source,
                    amount,
                    destination
                );
                self.send_game_action(GameAction::StackableMerge(Box::new(
                    StackableMergeActionData {
                        merge_from_guid: source,
                        merge_to_guid: destination,
                        amount: amount as i32,
                    },
                )))
                .await
            }
            ClientCommand::Split {
                item,
                container,
                amount,
            } => {
                log::info!(
                    ">>> Splitting 0x{:08X} ({}x) to container 0x{:08X}",
                    item,
                    amount,
                    container
                );
                self.send_game_action(GameAction::StackableSplitToContainer(Box::new(
                    StackableSplitToContainerActionData {
                        stack_guid: item,
                        container_guid: container,
                        place: 0, // Auto-placement
                        amount: amount as i32,
                    },
                )))
                .await
            }
            ClientCommand::MoveItem {
                item,
                container,
                placement,
            } => {
                log::info!(
                    ">>> Moving item 0x{:08X} to container 0x{:08X} (slot {})",
                    item,
                    container,
                    placement
                );
                self.send_game_action(GameAction::PutItemInContainer(Box::new(
                    PutItemInContainerActionData {
                        item_guid: item,
                        container_guid: container,
                        placement,
                    },
                )))
                .await
            }
            ClientCommand::GetAndWield { item, slot } => {
                let (target_mask, resolved_slot) = self.resolve_and_clear_slots(item, slot).await?;

                log::info!(
                    ">>> Getting and wielding item 0x{:08X} in slot {:?}",
                    item,
                    resolved_slot,
                );

                // Sequencing is handled automatically by the send_game_action helper.
                self.send_game_action(GameAction::GetAndWieldItem(Box::new(
                    GetAndWieldItemActionData {
                        item_guid: item,
                        equip_mask: target_mask,
                    },
                )))
                .await
            }
            ClientCommand::SplitToWield { item, slot, amount } => {
                let (target_mask, resolved_slot) = self.resolve_and_clear_slots(item, slot).await?;

                log::info!(
                    ">>> Splitting 0x{:08X} ({}x) to wield in {:?}",
                    item,
                    amount,
                    resolved_slot,
                );

                self.send_game_action(GameAction::StackableSplitToWield(Box::new(
                    StackableSplitToWieldActionData {
                        stack_guid: item,
                        amount: amount as i32,
                        equip_mask: target_mask,
                    },
                )))
                .await
            }
            _ => unreachable!(),
        }
    }

    async fn handle_progression_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::RaiseAttribute {
                attribute,
                xp_spent,
            } => {
                log::info!(">>> Raising Attribute: {:?} (XP: {})", attribute, xp_spent);
                self.send_game_action(GameAction::RaiseAttribute(Box::new(
                    RaiseAttributeActionData {
                        attribute_type: attribute as u32,
                        xp_spent,
                    },
                )))
                .await
            }
            ClientCommand::RaiseVital { vital, xp_spent } => {
                log::info!(">>> Raising Vital: {:?} (XP: {})", vital, xp_spent);
                self.send_game_action(GameAction::RaiseVital(Box::new(RaiseVitalActionData {
                    vital_type: vital as u32,
                    xp_spent,
                })))
                .await
            }
            ClientCommand::RaiseSkill { skill, xp_spent } => {
                log::info!(">>> Raising Skill: {:?} (XP: {})", skill, xp_spent);
                self.send_game_action(GameAction::RaiseSkill(Box::new(RaiseSkillActionData {
                    skill_type: skill as u32,
                    xp_spent,
                })))
                .await
            }
            ClientCommand::TrainSkill { skill, credits } => {
                log::info!(">>> Training Skill: {:?} (Credits: {})", skill, credits);
                self.send_game_action(GameAction::TrainSkill(Box::new(TrainSkillActionData {
                    skill_type: skill as u32,
                    credits_spent: credits as i32,
                })))
                .await
            }
            _ => unreachable!(),
        }
    }

    async fn handle_movement_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::DriveSelf(intent) => {
                log::info!(">>> Queueing self drive intent: {:?}", intent);
                self.movement.enqueue_drive_intent(intent, Instant::now());
                Ok(())
            }
            _ => unreachable!(),
        }
    }

    async fn handle_system_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Ping => {
                log::info!(">>> Sending Ping");
                self.send_game_action(GameAction::PingRequest(Box::new(PingRequestActionData)))
                    .await
            }
            ClientCommand::RequestInitialViewState => {
                log::info!(">>> Client requested initial view state snapshot");
                self.emit_initial_view_state_snapshot();
                Ok(())
            }
            ClientCommand::SetFellowshipUpdatesSubscribed { enabled } => {
                if !matches!(self.state, ClientState::InWorld) {
                    return Ok(());
                }

                log::info!(">>> Setting fellowship update subscription to {}", enabled);
                self.send_game_action(GameAction::FellowshipUpdateRequest(Box::new(
                    FellowshipUpdateRequestActionData {
                        panel_open: enabled,
                    },
                )))
                .await
            }
            ClientCommand::SetCombatMode(mode) => {
                log::info!(">>> Changing combat mode to: {:?}", mode);
                self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                    ChangeCombatModeActionData { mode },
                )))
                .await
            }
            ClientCommand::CancelAttack => {
                log::info!(">>> Canceling attack");
                self.send_game_action(GameAction::CancelAttack(Box::new(
                    CancelAttackActionData {},
                )))
                .await
            }
            ClientCommand::QueryEntityDebugInfo(guid) => {
                log::info!(">>> Client requested Debug Snapshot for {}", guid);
                if let Some(entity) = self.world.get_visible_entity(guid) {
                    let snapshot_event =
                        crate::client::types::ClientViewEvent::EntityDebugInfoSnapshot {
                            entity: Box::new(entity.clone()),
                        };
                    let _ = self.client_view_event_tx.send(snapshot_event);
                }
                Ok(())
            }
            ClientCommand::Quit => {
                log::info!("Disconnecting...");
                // First attempt a graceful logout from the world
                if matches!(self.state, ClientState::InWorld) {
                    let _ = self
                        .session
                        .send_message(&GameMessage::CharacterLogOff)
                        .await;
                    // Small delay to allow logout to process? Or just proceed to session disconnect.
                    // AC usually waits for the Server's response, but here we can just fire and move on.
                }
                self.disconnect().await?;
                Ok(())
            }
            _ => unreachable!(),
        }
    }

    pub(super) async fn send_talk(&mut self, text: &str) -> Result<()> {
        self.send_game_action(GameAction::Talk(Box::new(TalkActionData {
            message: text.to_string(),
        })))
        .await
    }

    pub(super) async fn send_login_complete(&mut self) -> Result<()> {
        self.send_game_action(GameAction::LoginComplete(Box::new(LoginCompleteActionData)))
            .await
    }

    async fn send_normalized_spell_cast(
        &mut self,
        spell_id: u32,
        requested_target: Option<Guid>,
    ) -> Result<()> {
        match normalize_spell_cast(&self.world, spell_id, requested_target) {
            NormalizedSpellCast::Targeted { target, spell_id } => {
                log::info!(
                    ">>> Casting targeted spell {} on 0x{:08X}",
                    spell_id,
                    target.0
                );
                if !self.arm_busy_operation(BusyOperationKind::SpellCast) {
                    return Ok(());
                }
                self.send_game_action(GameAction::CastTargetedSpell(Box::new(
                    CastTargetedSpellActionData { target, spell_id },
                )))
                .await
            }
            NormalizedSpellCast::Untargeted { spell_id } => {
                log::info!(">>> Casting untargeted spell {}", spell_id);
                if !self.arm_busy_operation(BusyOperationKind::SpellCast) {
                    return Ok(());
                }
                self.send_game_action(GameAction::CastUntargetedSpell(Box::new(
                    CastUntargetedSpellActionData { spell_id },
                )))
                .await
            }
        }
    }

    async fn resolve_and_clear_slots(
        &mut self,
        item: Guid,
        slot: Option<TargetSlot>,
    ) -> Result<(EquipMask, TargetSlot)> {
        let item_mask = self
            .world
            .entities
            .get(item)
            .map(|e| e.valid_locations())
            .unwrap_or(EquipMask::NONE);

        let resolved_slot = slot.unwrap_or(TargetSlot::EquipMask(item_mask));

        let (target_mask, unequip_mask) = match resolved_slot {
            TargetSlot::EquipMask(m) => (m, get_equip_unequip_mask(item_mask, Some(resolved_slot))),
            TargetSlot::MainHand => {
                let tm = if item_mask.intersects(EquipMask::MELEE_WEAPON) {
                    EquipMask::MELEE_WEAPON
                } else if item_mask.intersects(EquipMask::MISSILE_WEAPON) {
                    EquipMask::MISSILE_WEAPON
                } else if item_mask.intersects(EquipMask::CASTER) {
                    EquipMask::CASTER
                } else {
                    item_mask
                };
                (tm, get_equip_unequip_mask(item_mask, Some(resolved_slot)))
            }
            TargetSlot::OffHand => (
                EquipMask::SHIELD,
                get_equip_unequip_mask(item_mask, Some(resolved_slot)),
            ),
            TargetSlot::TopClothes => (
                PseudoEquipMask::TOP_CLOTHES.into(),
                get_equip_unequip_mask(item_mask, Some(resolved_slot)),
            ),
            TargetSlot::BottomClothes => (
                PseudoEquipMask::BOTTOM_CLOTHES.into(),
                get_equip_unequip_mask(item_mask, Some(resolved_slot)),
            ),
        };

        // Auto-unequip overlapping items
        let to_unequip: Vec<holtburger_common::Guid> = self
            .world
            .player
            .equipment
            .iter()
            .filter(|&(eq_guid, eq_mask)| eq_mask.intersects(unequip_mask) && *eq_guid != item)
            .map(|(&eq_guid, _)| eq_guid)
            .collect();

        for guid in to_unequip {
            self.send_game_action(GameAction::PutItemInContainer(Box::new(
                PutItemInContainerActionData {
                    item_guid: guid,
                    container_guid: self.world.player.guid,
                    placement: 0,
                },
            )))
            .await?;
        }

        Ok((target_mask, resolved_slot))
    }

    async fn handle_social_command(&mut self, cmd: ClientCommand) -> Result<()> {
        if !matches!(self.state, ClientState::InWorld) {
            return Ok(());
        }

        match cmd {
            ClientCommand::CreateParty { name } => {
                log::info!(">>> Creating party: \"{}\"", name);
                let share_xp = self
                    .world
                    .player
                    .character_option_enabled(CharacterOption::ShareFellowshipExpAndLuminance);
                self.send_game_action(GameAction::FellowshipCreate(Box::new(
                    FellowshipCreateActionData { name, share_xp },
                )))
                .await
            }
            ClientCommand::ShowPartyStatus => {
                for line in self.format_party_status_lines() {
                    self.emit_log_message(line);
                }
                Ok(())
            }
            ClientCommand::InviteToParty { target } => {
                log::info!(">>> Inviting 0x{:08X} to party", target.0);
                self.send_game_action(GameAction::FellowshipRecruit(Box::new(
                    FellowshipRecruitActionData {
                        player_guid: target,
                    },
                )))
                .await
            }
            ClientCommand::PromotePartyLeader { target } => {
                let Some(fellowship) = self.world.fellowship.as_ref() else {
                    log::warn!(
                        ">>> Ignoring promote request because there is no active fellowship"
                    );
                    return Ok(());
                };

                let Some(member) = fellowship
                    .members
                    .iter()
                    .find(|member| member.guid == target)
                else {
                    log::warn!(
                        ">>> Ignoring promote request for 0x{:08X} because the player is not in the fellowship",
                        target.0
                    );
                    return Ok(());
                };

                log::info!(">>> Promoting {} to party leader", member.name);
                self.send_game_action(GameAction::FellowshipAssignNewLeader(Box::new(
                    FellowshipAssignNewLeaderActionData {
                        new_leader_guid: target,
                    },
                )))
                .await
            }
            ClientCommand::LeaveParty => {
                log::info!(">>> Leaving party");
                self.send_game_action(GameAction::FellowshipQuit(Box::new(
                    FellowshipQuitActionData { disband: false },
                )))
                .await
            }
            ClientCommand::UninviteFromParty { target } => {
                log::info!(">>> Removing 0x{:08X} from party", target.0);
                self.send_game_action(GameAction::FellowshipDismiss(Box::new(
                    FellowshipDismissActionData {
                        player_guid: target,
                    },
                )))
                .await
            }
            _ => unreachable!(),
        }
    }

    fn format_party_status_lines(&self) -> Vec<String> {
        let Some(fellowship) = self.world.fellowship.as_ref() else {
            return vec!["Not currently in a party.".to_string()];
        };

        let mut lines = Vec::new();
        let leader_name = fellowship
            .members
            .iter()
            .find(|member| member.guid == fellowship.leader_guid)
            .map(|member| member.name.as_str())
            .unwrap_or("Unknown");

        let party_name = if fellowship.name.is_empty() {
            "(unknown)"
        } else {
            fellowship.name.as_str()
        };

        lines.push(format!(
            "Party: {} | Leader: {} | Members: {}",
            party_name,
            leader_name,
            fellowship.members.len()
        ));
        lines.push(format!(
            "Sharing: XP {} | Even {} | Open {} | Locked {}",
            on_off(fellowship.share_xp),
            on_off(fellowship.even_share),
            on_off(fellowship.open),
            on_off(fellowship.is_locked)
        ));

        for member in &fellowship.members {
            let leader_suffix = if member.guid == fellowship.leader_guid {
                " [leader]"
            } else {
                ""
            };
            let self_suffix = if member.guid == self.world.player.guid {
                " [you]"
            } else {
                ""
            };

            lines.push(format!(
                "- {}{}{} L{} H {}/{} S {}/{} M {}/{} Loot {}",
                member.name,
                leader_suffix,
                self_suffix,
                member.level,
                member.current_health,
                member.max_health,
                member.current_stamina,
                member.max_stamina,
                member.current_mana,
                member.max_mana,
                on_off(member.share_loot)
            ));
        }

        if !fellowship.departed_members.is_empty() {
            lines.push(format!(
                "Departed members tracked: {}",
                fellowship.departed_members.len()
            ));
        }

        if !fellowship.locks.is_empty() {
            let lock_names = fellowship
                .locks
                .iter()
                .map(|lock| lock.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("Locks: {}", lock_names));
        }

        lines
    }
}

fn on_off(value: bool) -> &'static str {
    if value { "on" } else { "off" }
}

/// Pure/stateless function to determine the unequip mask for a given target slot and item.
///
/// Returns an `EquipMask` of all potential overlapping slots that must be cleared
/// to make room for the new item at the specified `target`.
fn get_equip_unequip_mask(item_mask: EquipMask, target: Option<TargetSlot>) -> EquipMask {
    log::info!(
        "Resolving equip/unequip masks for item_mask={:?}, target={:?}",
        item_mask,
        target
    );
    let target_mask = target.unwrap_or(TargetSlot::EquipMask(item_mask));
    match target_mask {
        TargetSlot::EquipMask(m) => {
            let mut unequip = m;
            // If we're equipping something that's a main hand exclusive (like a 2H weapon),
            // we must also clear the offhand slot.
            if item_mask.intersects(PseudoEquipMask::MAIN_HAND_EXCLUSIVE.into()) {
                unequip |= PseudoEquipMask::OFF_HAND_SLOT.into();
            }
            // Equipping in offhand must unequip anything in main hand that blocks it (2H).
            if item_mask.intersects(PseudoEquipMask::OFF_HAND_SLOT.into()) {
                unequip |= PseudoEquipMask::MAIN_HAND_EXCLUSIVE.into();
            }
            unequip
        }
        TargetSlot::MainHand => {
            // If the item is a main hand exclusive, we must also clear the offhand slot.
            let mut unequip = PseudoEquipMask::MAIN_HAND_IMPLEMENTS.into();
            if item_mask.intersects(PseudoEquipMask::MAIN_HAND_EXCLUSIVE.into()) {
                unequip |= PseudoEquipMask::OFF_HAND_SLOT.into();
            }
            unequip
        }
        TargetSlot::OffHand => {
            let mut unequip = PseudoEquipMask::OFF_HAND_SLOT.into();
            // If the item is a main hand exclusive, we must also clear the main hand slot.
            if item_mask.intersects(PseudoEquipMask::MAIN_HAND_EXCLUSIVE.into()) {
                unequip |= PseudoEquipMask::MAIN_HAND_IMPLEMENTS.into();
            }
            unequip
        }
        TargetSlot::TopClothes => PseudoEquipMask::TOP_CLOTHES.into(),
        TargetSlot::BottomClothes => PseudoEquipMask::BOTTOM_CLOTHES.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{NormalizedSpellCast, normalize_spell_cast};
    use crate::client::builder;
    use crate::client::types::{
        ActionResultReason, ActionResultSource, ActiveCharacterConfirmation, BusyOperationKind,
        CharacterManagementOperation, ClientCommand, ClientViewEvent,
    };
    use crate::client::{ClientRuntime, ClientState};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::{CharacterOption, CharacterOptions1, ConfirmationType, Guid};
    use holtburger_content::{SoulEmoteCatalog, SoulEmotePose, SoulEmoteToken};
    use holtburger_protocol::messages::{
        CharacterCreateAppearanceData, CharacterCreateRequestData, CharacterEntry,
        SkillAdvancementClass,
    };
    use holtburger_world::RuntimeBodyResetCause;
    use holtburger_world::WorldState;
    use holtburger_world::spell::{MagicSchool, SpellCatalog, SpellExtrasInfo, SpellInfo};
    use holtburger_world::state::{
        FellowshipDepartedMemberState, FellowshipLockEntryState, FellowshipLockState,
        FellowshipMemberState, FellowshipState, TradeSide, TradeState,
    };
    use holtburger_world::vendor::{CoreVendorItem, VendorState};
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::time::Instant;

    fn build_test_client() -> ClientRuntime {
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.soul_emote_catalog = Arc::new(SoulEmoteCatalog {
            tokens: std::collections::BTreeMap::from([(
                "wave".to_string(),
                SoulEmoteToken {
                    token: "wave".to_string(),
                    pose: "Wave".to_string(),
                },
            )]),
            poses: std::collections::BTreeMap::from([(
                "Wave".to_string(),
                SoulEmotePose {
                    pose: "Wave".to_string(),
                    my_emote: "wave.".to_string(),
                    other_emote: "waves.".to_string(),
                },
            )]),
        });
        client
    }

    fn spell_info(school: MagicSchool, bitfield: u32, non_component_target_type: u32) -> SpellInfo {
        SpellInfo {
            name: "Test Spell".to_string(),
            description: String::new(),
            school,
            icon_id: 0,
            category: 0,
            bitfield,
            base_mana: 0,
            base_range_constant: 0.0,
            base_range_mod: 0.0,
            power: 0,
            spell_economy_mod: 0.0,
            formula_version: 0,
            component_loss: 0.0,
            meta_spell_type: 0,
            meta_spell_id: 0,
            extras: SpellExtrasInfo::None,
            components: [0; 8],
            caster_effect: 0,
            target_effect: 0,
            fizzle_effect: 0,
            recovery_interval: 0.0,
            recovery_amount: 0.0,
            display_order: 0,
            non_component_target_type,
            mana_mod: 0,
        }
    }

    fn world_with_spell(player_guid: Guid, spell_id: u32, spell: SpellInfo) -> WorldState {
        let mut world = WorldState::synthetic();
        world.player.guid = player_guid;
        world.spell_catalog = Arc::new(SpellCatalog {
            spells: HashMap::from([(spell_id, spell)]),
            ..Default::default()
        });
        world
    }

    #[test]
    fn self_targeted_spells_are_normalized_to_target_self() {
        let player_guid = Guid(0x5000_0001);
        let world = world_with_spell(
            player_guid,
            100,
            spell_info(MagicSchool::CreatureEnchantment, 0x8, 1),
        );

        let normalized = normalize_spell_cast(&world, 100, None);

        assert_eq!(
            normalized,
            NormalizedSpellCast::Targeted {
                target: player_guid,
                spell_id: 100,
            }
        );
    }

    #[test]
    fn untargeted_spells_ignore_requested_self_target() {
        let player_guid = Guid(0x5000_0001);
        let world = world_with_spell(player_guid, 200, spell_info(MagicSchool::WarMagic, 0, 0));

        let normalized = normalize_spell_cast(&world, 200, Some(player_guid));

        assert_eq!(
            normalized,
            NormalizedSpellCast::Untargeted { spell_id: 200 }
        );
    }

    #[test]
    fn war_magic_self_casts_are_normalized_to_untargeted() {
        let player_guid = Guid(0x5000_0001);
        let world = world_with_spell(player_guid, 300, spell_info(MagicSchool::WarMagic, 0, 5));

        let normalized = normalize_spell_cast(&world, 300, Some(player_guid));

        assert_eq!(
            normalized,
            NormalizedSpellCast::Untargeted { spell_id: 300 }
        );
    }

    #[test]
    fn non_war_targeted_self_casts_remain_targeted() {
        let player_guid = Guid(0x5000_0001);
        let world = world_with_spell(player_guid, 400, spell_info(MagicSchool::LifeMagic, 0, 5));

        let normalized = normalize_spell_cast(&world, 400, Some(player_guid));

        assert_eq!(
            normalized,
            NormalizedSpellCast::Targeted {
                target: player_guid,
                spell_id: 400,
            }
        );
    }

    #[tokio::test]
    async fn set_character_option_updates_world_state_and_projects_view_event() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::SetCharacterOption {
                option: CharacterOption::UseCraftingChanceOfSuccessDialog,
                value: true,
            })
            .await
            .unwrap();

        assert!(
            client
                .world
                .player
                .character_option_enabled(CharacterOption::UseCraftingChanceOfSuccessDialog)
        );
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);

        let mut saw_projection = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::PlayerOptionsUpdated { options }
                    if options
                        .options1
                        .contains(CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG)
            ) {
                saw_projection = true;
                break;
            }
        }

        assert!(saw_projection);
    }

    #[tokio::test]
    async fn request_initial_view_state_does_not_emit_reference_data_events() {
        let mut client = build_test_client();
        client.world.spell_catalog = Arc::new(SpellCatalog::default());
        let mut events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::RequestInitialViewState)
            .await
            .unwrap();

        let mut saw_reference_data_event = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::PlayerSpellsUpdated { .. }) {
                saw_reference_data_event = true;
                break;
            }
        }
        assert!(!saw_reference_data_event);
    }

    #[tokio::test]
    async fn request_initial_view_state_projects_cached_fellowship_state() {
        let mut client = build_test_client();
        client.world.fellowship = Some(FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Guid(0x5000_0001),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: true,
            members: vec![FellowshipMemberState {
                guid: Guid(0x5000_0001),
                name: "Player".to_string(),
                level: 12,
                cached_cp: 0,
                cached_luminance: 0,
                max_health: 180,
                max_stamina: 150,
                max_mana: 120,
                current_health: 170,
                current_stamina: 140,
                current_mana: 110,
                share_loot: true,
            }],
            departed_members: vec![FellowshipDepartedMemberState {
                guid: Guid(0x5000_0044),
                departed_timestamp: 1_712_345_678,
            }],
            locks: vec![FellowshipLockEntryState {
                name: "Leader Lock".to_string(),
                lock: FellowshipLockState {
                    unknown_1: 1,
                    unknown_2: 2,
                    unknown_3: 3,
                    timestamp: 4,
                    sequence: 5,
                },
            }],
        });
        let mut events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::RequestInitialViewState)
            .await
            .unwrap();

        let mut saw_fellowship = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::FellowshipStateUpdated { fellowship: Some(fellowship) }
                    if fellowship.name == "Raid Bus"
                        && fellowship.members.len() == 1
                        && fellowship.departed_members.len() == 1
                        && fellowship.locks.len() == 1
            ) {
                saw_fellowship = true;
                break;
            }
        }

        assert!(saw_fellowship);
    }

    #[tokio::test]
    async fn request_initial_view_state_projects_runtime_body_snapshot() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::RequestInitialViewState)
            .await
            .unwrap();

        let mut saw_snapshot = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::RuntimeBodySnapshot { .. }) {
                saw_snapshot = true;
                break;
            }
        }

        assert!(saw_snapshot);
    }

    #[tokio::test]
    async fn request_initial_view_state_projects_trade_and_vendor_snapshot() {
        let mut client = build_test_client();
        let player_guid = client.world.player.guid;
        let vendor_guid = Guid(0x7000_0001);

        client.world.vendor = Some(VendorState {
            vendor_guid,
            items: vec![CoreVendorItem {
                guid: Guid(0x7000_1001),
                wcid: 1234,
                ..CoreVendorItem::default()
            }],
            buy_multiplier: 1.0,
            sell_multiplier: 1.0,
            merchandise_item_types: 0xDEAD_BEEF,
            alternate_currency_wcid: 0,
            alternate_currency_amount: 0,
            alternate_currency_name: String::from("Pyreals"),
        });
        client.world.trade = Some(TradeState {
            partner_guid: vendor_guid,
            initiator_guid: player_guid,
            trade_stamp: 0.0,
            self_side: TradeSide {
                guid: player_guid,
                accepted: false,
                items: vec![Guid(0x7000_2001)],
            },
            partner_side: TradeSide {
                guid: vendor_guid,
                accepted: false,
                items: vec![Guid(0x7000_2002)],
            },
        });

        let mut events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::RequestInitialViewState)
            .await
            .unwrap();

        let mut saw_vendor = false;
        let mut saw_trade = false;
        while let Ok(event) = events.try_recv() {
            match event {
                ClientViewEvent::VendorStateUpdated { vendor } if vendor.is_some() => {
                    saw_vendor = true;
                }
                ClientViewEvent::TradeStateUpdated { trade } if trade.is_some() => {
                    saw_trade = true;
                }
                _ => {}
            }
        }

        assert!(saw_vendor);
        assert!(saw_trade);
    }

    #[tokio::test]
    async fn respond_to_confirmation_uses_active_confirmation_state() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();
        client.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::CraftInteraction,
            context: 0xDEADBEEF,
            text: "Craft this item?".to_string(),
        });

        client
            .handle_command(ClientCommand::RespondToConfirmation { accepted: true })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
        assert!(client.active_confirmation.is_none());

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
    async fn invite_to_party_sends_guid_directly() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::InviteToParty {
                target: Guid(0x5000_0042),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn uninvite_from_party_sends_guid_directly() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::UninviteFromParty {
                target: Guid(0x5000_0042),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn promote_party_leader_sends_guid_directly() {
        let mut client = build_test_client();

        client.world.fellowship = Some(holtburger_world::state::FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Guid(0x5000_0001),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: false,
            members: vec![
                holtburger_world::state::FellowshipMemberState {
                    guid: Guid(0x5000_0001),
                    name: "Player".to_string(),
                    level: 42,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 200,
                    max_stamina: 180,
                    max_mana: 160,
                    current_health: 190,
                    current_stamina: 170,
                    current_mana: 150,
                    share_loot: true,
                },
                holtburger_world::state::FellowshipMemberState {
                    guid: Guid(0x5000_0042),
                    name: "Bestie".to_string(),
                    level: 37,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 180,
                    max_stamina: 160,
                    max_mana: 140,
                    current_health: 175,
                    current_stamina: 155,
                    current_mana: 135,
                    share_loot: true,
                },
            ],
            departed_members: Vec::new(),
            locks: Vec::new(),
        });

        client
            .handle_command(ClientCommand::PromotePartyLeader {
                target: Guid(0x5000_0042),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn swear_allegiance_sends_guid_directly() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::SwearAllegiance {
                target: Guid(0x5000_0042),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn unswear_sends_guid_directly() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::Unswear {
                target: Guid(0x5000_0042),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn select_character_resets_runtime_bodies_before_entering_world() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();
        let player_guid = Guid(0x5000_0001);
        let player_pose = WorldPosition {
            landblock_id: Guid(0x0102_0000),
            ..WorldPosition::default()
        };

        client.world.player.guid = player_guid;
        client.world.set_local_player_runtime_pose(player_pose);
        client.character_selection.characters = vec![CharacterEntry {
            guid: player_guid,
            name: "Player".to_string(),
            delete_time: 0,
        }];

        client
            .handle_command(ClientCommand::SelectCharacter(player_guid))
            .await
            .unwrap();

        let mut saw_reset = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::RuntimeBodiesReset {
                    cause: RuntimeBodyResetCause::TeleportOrWorldReset
                }
            ) {
                saw_reset = true;
                break;
            }
        }

        assert!(saw_reset);
        assert!(matches!(client.state, ClientState::EnteringWorld));
    }

    #[tokio::test]
    async fn show_party_status_logs_cached_fellowship_summary() {
        let mut client = build_test_client();
        client.world.player.guid = Guid(0x5000_0001);
        client.world.fellowship = Some(FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Guid(0x5000_0001),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: true,
            members: vec![
                FellowshipMemberState {
                    guid: Guid(0x5000_0001),
                    name: "Player".to_string(),
                    level: 12,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 180,
                    max_stamina: 150,
                    max_mana: 120,
                    current_health: 170,
                    current_stamina: 140,
                    current_mana: 110,
                    share_loot: true,
                },
                FellowshipMemberState {
                    guid: Guid(0x5000_0032),
                    name: "Bravo".to_string(),
                    level: 18,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 220,
                    max_stamina: 160,
                    max_mana: 140,
                    current_health: 215,
                    current_stamina: 150,
                    current_mana: 130,
                    share_loot: true,
                },
            ],
            departed_members: vec![FellowshipDepartedMemberState {
                guid: Guid(0x5000_0044),
                departed_timestamp: 1_712_345_678,
            }],
            locks: vec![FellowshipLockEntryState {
                name: "Leader Lock".to_string(),
                lock: FellowshipLockState {
                    unknown_1: 1,
                    unknown_2: 2,
                    unknown_3: 3,
                    timestamp: 4,
                    sequence: 5,
                },
            }],
        });
        let mut view_events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::ShowPartyStatus)
            .await
            .unwrap();

        let mut log_lines = Vec::new();
        while let Ok(event) = view_events.try_recv() {
            if let ClientViewEvent::LogMessage(line) = event {
                log_lines.push(line);
            }
        }

        assert!(
            log_lines
                .iter()
                .any(|line| line == "Party: Raid Bus | Leader: Player | Members: 2")
        );
        assert!(
            log_lines
                .iter()
                .any(|line| line == "Sharing: XP on | Even off | Open on | Locked on")
        );
        assert!(log_lines.iter().any(|line| {
            line == "- Player [leader] [you] L12 H 170/180 S 140/150 M 110/120 Loot on"
        }));
        assert!(
            log_lines
                .iter()
                .any(|line| line == "Departed members tracked: 1")
        );
        assert!(log_lines.iter().any(|line| line == "Locks: Leader Lock"));
    }

    #[tokio::test]
    async fn respond_to_confirmation_without_active_request_emits_client_action_result() {
        let mut client = build_test_client();
        let mut view_events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::RespondToConfirmation { accepted: true })
            .await
            .unwrap();

        let mut saw_result = false;
        while let Ok(event) = view_events.try_recv() {
            if let ClientViewEvent::ActionResult { source, reason } = event {
                assert_eq!(source, ActionResultSource::Client);
                assert_eq!(
                    reason,
                    ActionResultReason::General(
                        "No active confirmation request to answer.".to_string(),
                    )
                );
                saw_result = true;
                break;
            }
        }

        assert!(saw_result);
    }

    #[tokio::test]
    async fn set_fellowship_updates_subscribed_sends_update_request_in_world() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::SetFellowshipUpdatesSubscribed { enabled: true })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn soul_emote_command_sends_dedicated_game_action() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::SoulEmote("wave".to_string()))
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);

        client
            .movement
            .tick(Instant::now(), &mut client.world, &mut client.session)
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 2);
        assert!(client.session.bytes_out > 0);
    }

    #[test]
    fn render_soul_emote_text_expands_possessive_placeholder() {
        assert_eq!(
            super::render_soul_emote_text("puts %p hands on %p hips."),
            "puts their hands on their hips."
        );
    }

    #[tokio::test]
    async fn soul_emote_command_rejects_unknown_token() {
        let mut client = build_test_client();
        let mut view_events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::SoulEmote("ploop".to_string()))
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 0);
        assert_eq!(client.session.bytes_out, 0);

        let mut saw_result = false;
        while let Ok(event) = view_events.try_recv() {
            if let ClientViewEvent::ActionResult { source, reason } = event {
                assert_eq!(source, ActionResultSource::Client);
                assert_eq!(
                    reason,
                    ActionResultReason::General("Unknown soul emote token: ploop".to_string())
                );
                saw_result = true;
                break;
            }
        }

        assert!(saw_result);
    }

    #[tokio::test]
    async fn set_fellowship_updates_subscribed_is_ignored_outside_world() {
        let mut client = builder::build_test_client(ClientState::Connected);

        client
            .handle_command(ClientCommand::SetFellowshipUpdatesSubscribed { enabled: true })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 0);
        assert_eq!(client.session.bytes_out, 0);
    }

    #[tokio::test]
    async fn create_character_command_sends_auth_message() {
        let mut client = builder::build_test_client(ClientState::Connected);

        client
            .handle_command(ClientCommand::CreateCharacter(Box::new(
                CharacterCreateRequestData {
                    account_name: String::new(),
                    unknown_constant: 1,
                    heritage: 6,
                    gender: 1,
                    appearance: CharacterCreateAppearanceData {
                        eyes: 0,
                        nose: 0,
                        mouth: 0,
                        hair_color: 0,
                        eye_color: 0,
                        hair_style: 0,
                        headgear_style: u32::MAX,
                        headgear_color: 0,
                        shirt_style: 0,
                        shirt_color: 0,
                        pants_style: 0,
                        pants_color: 0,
                        footwear_style: 0,
                        footwear_color: 0,
                        skin_hue: 1.0,
                        hair_hue: 1.0,
                        headgear_hue: 0.0,
                        shirt_hue: 0.0,
                        pants_hue: 0.0,
                        footwear_hue: 0.0,
                    },
                    template_option: 0,
                    strength_ability: 100,
                    endurance_ability: 10,
                    coordination_ability: 100,
                    quickness_ability: 100,
                    focus_ability: 10,
                    self_ability: 10,
                    character_slot: 0,
                    class_id: 1,
                    skill_advancement_classes: vec![SkillAdvancementClass::Untrained; 55],
                    name: "Bestie".to_string(),
                    start_area: 2,
                    is_admin: false,
                    is_sentinel: false,
                },
            )))
            .await
            .unwrap();

        assert!(client.session.bytes_out > 0);
        assert_eq!(
            client.character_selection.pending_character_operation,
            Some(CharacterManagementOperation::Create)
        );
    }

    #[tokio::test]
    async fn delete_character_command_sends_auth_message() {
        let mut client = builder::build_test_client(ClientState::Connected);

        client
            .handle_command(ClientCommand::DeleteCharacter { slot: 2 })
            .await
            .unwrap();

        assert!(client.session.bytes_out > 0);
        assert_eq!(
            client.character_selection.pending_character_operation,
            Some(CharacterManagementOperation::Delete)
        );
    }

    #[tokio::test]
    async fn restore_character_command_sends_auth_message() {
        let mut client = builder::build_test_client(ClientState::Connected);

        client
            .handle_command(ClientCommand::RestoreCharacter(Guid(0x5000_1234)))
            .await
            .unwrap();

        assert!(client.session.bytes_out > 0);
        assert_eq!(
            client.character_selection.pending_character_operation,
            Some(CharacterManagementOperation::Restore)
        );
    }

    #[tokio::test]
    async fn buy_command_arms_busy_operation() {
        let mut client = build_test_client();
        let mut events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::Buy {
                vendor: Guid(0x7000_0001),
                items: Vec::new(),
            })
            .await
            .unwrap();

        assert!(matches!(
            client.active_busy_operation,
            Some(crate::client::PendingBusyOperation {
                operation: BusyOperationKind::Buy,
                ..
            })
        ));

        let mut saw_busy_projection = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::BusyStateUpdated {
                    busy: Some(BusyOperationKind::Buy),
                }
            ) {
                saw_busy_projection = true;
                break;
            }
        }

        assert!(saw_busy_projection);
    }

    #[tokio::test]
    async fn overlapping_busy_command_is_not_sent_to_wire() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::Buy {
                vendor: Guid(0x7000_0001),
                items: Vec::new(),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);

        client
            .handle_command(ClientCommand::Sell {
                vendor: Guid(0x7000_0001),
                items: Vec::new(),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(matches!(
            client.active_busy_operation,
            Some(crate::client::PendingBusyOperation {
                operation: BusyOperationKind::Buy,
                ..
            })
        ));
    }

    #[tokio::test]
    async fn salvage_command_does_not_arm_busy_operation() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::SalvageItemsWith {
                tool: Guid(0x7000_0001),
                items: vec![Guid(0x8000_0001)],
            })
            .await
            .unwrap();

        assert!(client.active_busy_operation.is_none());
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn teleport_to_pkl_arena_sends_game_action() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::TeleportToPklArena)
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn teleport_to_marketplace_sends_game_action() {
        let mut client = build_test_client();

        client
            .handle_command(ClientCommand::TeleportToMarketplace)
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }
}
