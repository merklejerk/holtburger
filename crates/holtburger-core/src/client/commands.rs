use crate::client::movement::{encode_contact_long_jump, raw_motion_state_with_motion_style};
use crate::client::types::{ClientCommand, TargetSlot, WireEvent};
use crate::client::{Client, ClientState};
use anyhow::Result;
use holtburger_common::properties::{EquipMask, PseudoEquipMask, WorldObjectExt as _};
use holtburger_common::{Guid, Quaternion};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{GameMessage, RawMotionState};
use holtburger_protocol::messages::transport::packet_flags;
use holtburger_protocol::messages::*;
use holtburger_world::spell::MagicSchool;

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

    if let Some(spell) = world
        .spell_catalog
        .as_ref()
        .and_then(|catalog| catalog.get(spell_id))
    {
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
impl Client {
    pub(super) async fn handle_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Login(_)
            | ClientCommand::SelectCharacter(_)
            | ClientCommand::EnterWorld => self.handle_auth_command(cmd).await,

            ClientCommand::Talk(_) | ClientCommand::Tell { .. } => {
                self.handle_chat_command(cmd).await
            }

            ClientCommand::Identify(_)
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
            | ClientCommand::RespondToConfirmation { .. } => {
                self.handle_interaction_command(cmd).await
            }

            ClientCommand::Drop(_)
            | ClientCommand::Get(_)
            | ClientCommand::Stack { .. }
            | ClientCommand::Split { .. }
            | ClientCommand::MoveItem { .. }
            | ClientCommand::GetAndWield { .. }
            | ClientCommand::SplitToWield { .. } => self.handle_inventory_command(cmd).await,

            ClientCommand::TurnTo { .. } | ClientCommand::ExecuteLocomotion(_) => {
                self.handle_movement_command(cmd).await
            }

            ClientCommand::RaiseAttribute { .. }
            | ClientCommand::RaiseVital { .. }
            | ClientCommand::RaiseSkill { .. }
            | ClientCommand::TrainSkill { .. } => self.handle_progression_command(cmd).await,

            ClientCommand::SetCombatMode(_)
            | ClientCommand::CancelAttack
            | ClientCommand::Ping
            | ClientCommand::QueryEntityDebugInfo(_)
            | ClientCommand::Quit => self.handle_system_command(cmd).await,
        }
    }

    pub(super) async fn disconnect(&mut self) -> Result<()> {
        let header = PacketHeader {
            flags: packet_flags::DISCONNECT,
            sequence: self.session.packet_sequence,
            id: 0,
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
                self.auth
                    .send_login_request(&password, &mut self.session)
                    .await
            }
            ClientCommand::SelectCharacter(id) => {
                log::info!("Selecting character: 0x{:08X}", id);
                self.world.load_deferred_tables();
                self.state = ClientState::EnteringWorld;
                self.send_status_event();
                self.auth.select_character(id, &mut self.session).await
            }
            ClientCommand::EnterWorld => {
                if let Some(char_id) = self.auth.character_id {
                    log::info!(
                        "Attempting to enter world with character: 0x{:08X}",
                        char_id
                    );
                    self.world.load_deferred_tables();
                    self.emit_spell_catalog_loaded();
                    self.state = ClientState::EnteringWorld;
                    self.send_status_event();
                    self.auth.select_character(char_id, &mut self.session).await
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
            ClientCommand::QueryHealth(guid) => {
                log::info!(">>> Querying health for: 0x{:08X}", guid.0);
                self.send_game_action(GameAction::QueryHealth(Box::new(QueryHealthActionData {
                    target_guid: guid,
                })))
                .await
            }
            ClientCommand::Use(guid) => {
                log::info!(">>> Using: 0x{:08X}", guid);
                self.send_game_action(GameAction::Use(Box::new(UseActionData { guid })))
                    .await
            }
            ClientCommand::UseWithTarget { item, target } => {
                log::info!(">>> Using: 0x{:08X} on 0x{:08X}", item, target);
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
                self.send_game_action(GameAction::Buy(Box::new(BuyActionData {
                    vendor_guid: vendor,
                    items,
                })))
                .await
            }
            ClientCommand::Sell { vendor, items } => {
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
            ClientCommand::RespondToConfirmation { accepted } => {
                let Some(confirmation) = self.active_confirmation.clone() else {
                    self.emit_wire_event(WireEvent::ClientError(
                        "No active confirmation request to answer.".to_string(),
                    ));
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
                .await
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
            ClientCommand::TurnTo { heading, metadata } => {
                log::info!(">>> Turning to heading: {}", heading);

                // Prediction: update local state immediately so UI feels snappy
                let mut next_pos = self.world.player.position;
                next_pos.rotation = Quaternion::from_heading(heading);
                let world_events = self.world.set_player_position(next_pos);
                for event in world_events {
                    self.handle_world_event(&event);
                }

                let obj_inst = self.world.player.instance_sequence;
                let srv_seq = self.world.player.server_control_sequence;
                let tele_seq = self.world.player.teleport_sequence;
                let force_seq = self.world.player.force_position_sequence;

                self.send_game_action(GameAction::MoveToState(Box::new(MoveToStateActionData {
                    raw_motion_state: raw_motion_state_with_motion_style(
                        &self.world,
                        RawMotionState::default(),
                        metadata.motion_style,
                    ),
                    position: self.world.player.position,
                    instance_sequence: obj_inst,
                    server_control_sequence: srv_seq,
                    teleport_sequence: tele_seq,
                    force_position_sequence: force_seq,
                    contact_long_jump: encode_contact_long_jump(metadata),
                })))
                .await
            }
            ClientCommand::ExecuteLocomotion(request) => {
                if request.primitive.refresh_server() {
                    log::info!(
                        ">>> Executing locomotion primitive: {:?}",
                        request.primitive
                    );
                }
                let world_events = self
                    .movement
                    .execute_locomotion_request(request, &mut self.world, &mut self.session)
                    .await?;
                for event in world_events {
                    self.handle_world_event(&event);
                }
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
                self.send_game_action(GameAction::CastTargetedSpell(Box::new(
                    CastTargetedSpellActionData { target, spell_id },
                )))
                .await
            }
            NormalizedSpellCast::Untargeted { spell_id } => {
                log::info!(">>> Casting untargeted spell {}", spell_id);
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
    use crate::client::types::{ActiveCharacterConfirmation, ClientCommand, ClientViewEvent};
    use crate::client::{Client, ClientState, auth::AuthState, movement::MovementSystem};
    use holtburger_common::{CharacterOption, CharacterOptions1, ConfirmationType, Guid};
    use holtburger_session::Session;
    use holtburger_world::WorldState;
    use holtburger_world::spell::{MagicSchool, SpellCatalog, SpellExtrasInfo, SpellInfo};
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::broadcast;

    fn build_test_client() -> Client {
        let (wire_event_tx, _) = broadcast::channel(32);
        let (client_view_event_tx, _) = broadcast::channel(32);

        Client {
            session: Session::new_test(),
            world: WorldState::new(None, None),
            active_confirmation: None,
            state: ClientState::InWorld,
            wire_event_tx,
            client_view_event_tx,
            command_rx: None,
            message_dump_dir: None,
            message_counter: 0,
            movement: MovementSystem::new(),
            auth: AuthState::new("test".to_string()),
        }
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
        let mut world = WorldState::new(None, None);
        world.player.guid = player_guid;
        world.spell_catalog = Some(Arc::new(SpellCatalog {
            spells: HashMap::from([(spell_id, spell)]),
            ..Default::default()
        }));
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
    async fn respond_to_confirmation_uses_active_confirmation_state() {
        let mut client = build_test_client();
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
        assert!(client.active_confirmation.is_some());
    }
}
