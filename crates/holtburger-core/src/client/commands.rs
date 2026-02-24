use crate::client::types::{ClientCommand, TargetSlot};
use crate::client::{Client, ClientState};
use crate::world::StateEvent;
use anyhow::Result;
use holtburger_common::properties::{EquipMask, PseudoEquipMask};
use holtburger_common::{Guid, Quaternion};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{GameMessage, RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::transport::packet_flags;
use holtburger_protocol::messages::*;
use std::time::Instant;

impl Client {
    pub(super) async fn handle_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Login(_)
            | ClientCommand::SelectCharacter(_)
            | ClientCommand::SelectCharacterByIndex(_)
            | ClientCommand::EnterWorld => self.handle_auth_command(cmd).await,

            ClientCommand::Talk(_) | ClientCommand::Tell { .. } => {
                self.handle_chat_command(cmd).await
            }

            ClientCommand::Identify(_)
            | ClientCommand::Use(_)
            | ClientCommand::UseWithTarget { .. }
            | ClientCommand::CastTargetedSpell { .. }
            | ClientCommand::CastUntargetedSpell { .. }
            | ClientCommand::Buy { .. }
            | ClientCommand::Sell { .. }
            | ClientCommand::OpenTrade(_)
            | ClientCommand::CloseTrade
            | ClientCommand::AcceptTrade
            | ClientCommand::DeclineTrade
            | ClientCommand::ResetTrade
            | ClientCommand::AddToTrade { .. }
            | ClientCommand::GiveObjectRequest { .. } => self.handle_interaction_command(cmd).await,

            ClientCommand::Drop(_)
            | ClientCommand::Get(_)
            | ClientCommand::MoveItem { .. }
            | ClientCommand::GetAndWield { .. }
            | ClientCommand::SplitToWield { .. } => self.handle_inventory_command(cmd).await,

            ClientCommand::Jump { .. }
            | ClientCommand::SetState(_)
            | ClientCommand::TurnTo { .. }
            | ClientCommand::MoveTo { .. }
            | ClientCommand::SyncPosition => self.handle_movement_command(cmd).await,

            ClientCommand::RaiseAttribute { .. }
            | ClientCommand::RaiseVital { .. }
            | ClientCommand::RaiseSkill { .. }
            | ClientCommand::TrainSkill { .. } => self.handle_progression_command(cmd).await,

            ClientCommand::SetCombatMode(_)
            | ClientCommand::CancelAttack
            | ClientCommand::Ping
            | ClientCommand::SetNoClip(_)
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
            ClientCommand::SelectCharacterByIndex(idx) => match &self.state {
                ClientState::CharacterSelection(chars) if (1..=chars.len()).contains(&idx) => {
                    let char_guid = chars[idx - 1].guid;
                    let char_name = &chars[idx - 1].name;
                    log::info!(
                        "Selecting character by index {}: {} (0x{:08X})",
                        idx,
                        char_name,
                        char_guid
                    );
                    self.world.load_deferred_tables();
                    self.state = ClientState::EnteringWorld;
                    self.send_status_event();
                    self.auth
                        .select_character(char_guid, &mut self.session)
                        .await
                }
                _ => Ok(()),
            },
            ClientCommand::EnterWorld => {
                if let Some(char_id) = self.auth.character_id {
                    log::info!(
                        "Attempting to enter world with character: 0x{:08X}",
                        char_id
                    );
                    self.world.load_deferred_tables();
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
            ClientCommand::CastTargetedSpell { target, spell_id } => {
                log::info!(">>> Casting spell {} on 0x{:08X}", spell_id, target.0);
                self.send_game_action(GameAction::CastTargetedSpell(Box::new(
                    CastTargetedSpellActionData { target, spell_id },
                )))
                .await
            }
            ClientCommand::CastUntargetedSpell { spell_id } => {
                log::info!(">>> Casting spell {}", spell_id);
                self.send_game_action(GameAction::CastUntargetedSpell(Box::new(
                    CastUntargetedSpellActionData { spell_id },
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
                        amount,
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
            ClientCommand::Jump {
                extent,
                velocity: _,
            } => {
                log::info!(">>> Jumping: extent={}", extent);
                let obj_inst = self.world.player.instance_sequence;
                let srv_seq = self.world.player.server_control_sequence;
                let tele_seq = self.world.player.teleport_sequence;
                let force_seq = self.world.player.force_position_sequence;

                self.send_game_action(GameAction::Jump(Box::new(JumpActionData {
                    extent,
                    velocity: Default::default(),
                    instance_sequence: obj_inst,
                    server_control_sequence: srv_seq,
                    teleport_sequence: tele_seq,
                    force_position_sequence: force_seq,
                    object_guid: self.world.player.guid,
                    spell_id: 0,
                })))
                .await
            }
            ClientCommand::SetState(state_opcode) => {
                log::info!(">>> Setting state: 0x{:08X}", state_opcode);
                let obj_inst = self.world.player.instance_sequence;
                let srv_seq = self.world.player.server_control_sequence;
                let tele_seq = self.world.player.teleport_sequence;
                let force_seq = self.world.player.force_position_sequence;

                self.send_game_action(GameAction::MoveToState(Box::new(MoveToStateActionData {
                    raw_motion_state: RawMotionState {
                        flags: RawMotionFlags::CURRENT_STYLE,
                        current_style: Some(state_opcode),
                        ..Default::default()
                    },
                    position: self.world.player.position,
                    instance_sequence: obj_inst,
                    server_control_sequence: srv_seq,
                    teleport_sequence: tele_seq,
                    force_position_sequence: force_seq,
                    contact_long_jump: 0,
                })))
                .await
            }
            ClientCommand::TurnTo { heading } => {
                log::info!(">>> Turning to heading: {}", heading);

                // Prediction: update local state immediately so UI feels snappy
                let mut next_pos = self.world.player.position;
                next_pos.rotation = Quaternion::from_heading(heading);
                let world_events = self.world.set_player_position(next_pos);
                for event in world_events {
                    self.emit_state_event(event);
                }

                let obj_inst = self.world.player.instance_sequence;
                let srv_seq = self.world.player.server_control_sequence;
                let tele_seq = self.world.player.teleport_sequence;
                let force_seq = self.world.player.force_position_sequence;

                self.send_game_action(GameAction::MoveToState(Box::new(MoveToStateActionData {
                    raw_motion_state: RawMotionState::default(),
                    position: self.world.player.position,
                    instance_sequence: obj_inst,
                    server_control_sequence: srv_seq,
                    teleport_sequence: tele_seq,
                    force_position_sequence: force_seq,
                    contact_long_jump: 1, // Assume contact
                })))
                .await
            }
            ClientCommand::MoveTo { target } => {
                log::info!(">>> Starting approach to target: 0x{:08X}", target);
                self.movement.move_target = Some(target);
                self.movement.last_move_pos = self.world.player.position;
                self.movement.last_move_pos_time = Instant::now();
                Ok(())
            }
            ClientCommand::SyncPosition => {
                log::debug!(">>> Syncing Position (Heartbeat)");
                let pulse = AutonomousPositionActionData {
                    position: self.world.player.position,
                    instance_sequence: self.world.player.instance_sequence,
                    server_control_sequence: self.world.player.server_control_sequence,
                    teleport_sequence: self.world.player.teleport_sequence,
                    force_position_sequence: self.world.player.force_position_sequence,
                    last_contact: 1,
                };

                self.send_game_action(GameAction::AutonomousPosition(Box::new(pulse)))
                    .await
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
            ClientCommand::SetNoClip(enabled) => {
                log::info!(">>> NoClip set to: {}", enabled);
                self.world.player.noclip = enabled;
                self.emit_state_event(StateEvent::NoClipUpdated(enabled));
                Ok(())
            }
            ClientCommand::CancelAttack => {
                log::info!(">>> Canceling attack");
                self.send_game_action(GameAction::CancelAttack(Box::new(
                    CancelAttackActionData {},
                )))
                .await
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
