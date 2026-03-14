use holtburger_common::Guid;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::controllers::{
    ApproachTargetController, ApproachTargetEffect, ApproachTargetFinishReason,
    ApproachTargetInput, CombatAutomationController, CombatAutomationEffect, CombatAutomationInput,
    Controller, DesiredAttackProfile, MaintainRangeConfig, MaintainRangeController,
    MaintainRangeEffect, MaintainRangeFinishReason, MaintainRangeInput, TargetedAttackRequest,
};
use holtburger_core::client::locomotion::{LocomotionRequest, MovementPacketMetadata};
use holtburger_core::client::types::ClientCommand;
use holtburger_core::client::types::CombatFeedback;
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;
use ratatui::text::Line;
use std::fs::File;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::pages::game::GameData;
use crate::pages::game::panels::chat::ChatState;
use crate::pages::game::panels::chat_input::ChatInputState;
use crate::pages::game::panels::context::build_context_panel_content;
use crate::pages::game::panels::dashboard::DashboardState;
use crate::types::{
    AppAction, AppUiAction, ChatMessageKind, ContextView, DashboardTab, FocusedPane, InspectTarget,
    Interaction, UpdateResult,
};
use holtburger_common::properties::WorldObjectExt as _;

#[derive(Default)]
pub struct GameState {
    pub data: GameData,
    pub dashboard: DashboardState,
    pub view: ViewState,
    pub chat: ChatState,
    pub chat_input: ChatInputState,
}

const MELEE_ATTACK_DISTANCE: f32 = 0.6;
const MELEE_STICKY_DISTANCE: f32 = 4.0;
const MELEE_REPEAT_DISTANCE: f32 = 16.0;
const STICKY_MOVE_REISSUE_INTERVAL: Duration = Duration::from_millis(250);
const GENERIC_APPROACH_DISTANCE: f32 = 1.0;
const DEFAULT_APPROACH_RUN_RATE: f32 = 4.5;

enum EnterCombatModeResult {
    Success(UpdateResult),
    Failed(UpdateResult),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalvagingState {
    pub ust_guid: Guid,
    pub queued_items: Vec<Guid>,
}

impl GameState {
    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self::with_chat_log(guid, name, world_name, None)
    }

    pub fn with_chat_log(
        guid: Guid,
        name: String,
        world_name: String,
        chat_log: Option<Mutex<File>>,
    ) -> Self {
        Self {
            data: GameData::new(guid, name, world_name),
            dashboard: DashboardState::default(),
            view: ViewState::default(),
            chat: ChatState::new(chat_log),
            chat_input: ChatInputState::default(),
        }
    }

    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        match event {
            ClientViewEvent::LogMessage(_)
            | ClientViewEvent::ServerMessage { .. }
            | ClientViewEvent::Chat { .. }
            | ClientViewEvent::Emote { .. }
            | ClientViewEvent::PingResponse
            | ClientViewEvent::BootAccount(_)
            | ClientViewEvent::NetPulse { .. }
            | ClientViewEvent::Disconnected => {
                self.chat.handle_event(event);
            }
            ClientViewEvent::CombatFeedback(feedback) => {
                result.merge(self.handle_combat_feedback(&feedback));
                self.chat
                    .handle_event(ClientViewEvent::CombatFeedback(feedback));
                self.sync_sticky_melee_pursuit(&mut result);
                result.needs_redraw = true;
            }
            ClientViewEvent::PlayerEnchantmentsUpdated { .. }
            | ClientViewEvent::PlayerStatsSkillsUpdated { .. }
            | ClientViewEvent::PlayerVitalsUpdated { .. }
            | ClientViewEvent::PlayerSpellsUpdated { .. }
            | ClientViewEvent::CombatModeUpdated { .. } => {
                self.handle_player_event(event);
                self.sync_sticky_melee_pursuit(&mut result);
                result.needs_redraw = true;
            }
            ClientViewEvent::SpellCatalogLoaded { .. } => {
                self.handle_reference_data_event(event);
            }
            ClientViewEvent::EntityDebugInfoSnapshot { entity } => {
                let entity_ref = entity.as_ref();
                self.data
                    .entities
                    .insert(entity_ref.guid, entity_ref.clone());
            }
            ClientViewEvent::EntitySpawned { entity } => {
                let entity_ref = entity.as_ref();
                self.data
                    .entities
                    .insert(entity_ref.guid, entity_ref.clone());
                self.update_inventory_and_equipment(entity_ref);
            }
            ClientViewEvent::EntityReplaced { entity } => {
                let entity_ref = entity.as_ref();
                self.data
                    .entities
                    .insert(entity_ref.guid, entity_ref.clone());
                self.update_inventory_and_equipment(entity_ref);
            }
            ClientViewEvent::EntityPropertiesUpdated { guid, mut updates } => {
                let mut needs_update = false;
                if let Some(entity) = self.data.entities.get_mut(&guid) {
                    for update in updates.drain(..) {
                        entity.properties.apply(update);
                    }
                    needs_update = true;
                }
                if needs_update && let Some(entity) = self.data.entities.get(&guid).cloned() {
                    self.update_inventory_and_equipment(&entity);
                }
            }
            ClientViewEvent::EntityMoved { guid, pos } => {
                let is_player_move = Some(guid) == self.data.player_guid;
                if let Some(entity) = self.data.entities.get_mut(&guid) {
                    entity.position = pos;
                    if is_player_move {
                        self.data.player_pos = Some(pos);
                    }
                }
                if !is_player_move {
                    self.sync_approach_target(Instant::now(), &mut result);
                    self.sync_sticky_melee_pursuit(&mut result);
                }
                result.needs_redraw = true;
            }
            ClientViewEvent::PlayerGroundedUpdated { grounded } => {
                self.data.player_grounded = Some(grounded);
            }
            ClientViewEvent::ForcedReposition { guid, .. } => {
                if Some(guid) == self.data.player_guid {
                    self.cancel_active_approach_due_to_forced_reposition(&mut result);
                }
            }
            ClientViewEvent::EntityDespawned { guid } => {
                self.handle_entity_removed(guid);
                self.sync_approach_target(Instant::now(), &mut result);
                self.sync_sticky_melee_pursuit(&mut result);
            }
            ClientViewEvent::VendorStateUpdated { vendor } => {
                if self.data.trade.is_some() {
                    // If we're in a trade, ignore vendor sessions.
                    return result;
                }
                let vendor_guid = vendor.as_ref().map(|v| v.vendor_guid);
                self.view.vendor = vendor;
                // If we just opened a vendor and we initiated it, switch to Trade tab.
                if let Some(v_guid) = vendor_guid
                    && let Some((last_time, target_guid)) = self.view.last_trade_initiation
                    && target_guid == v_guid
                    && last_time.elapsed() < std::time::Duration::from_secs(5)
                {
                    result.actions.push(AppAction::UiAction {
                        action: AppUiAction::SetDashboardActiveTab(DashboardTab::Trade),
                    });
                }
            }
            ClientViewEvent::VendorItemIdentified(item) => {
                if let Some(vendor) = self.view.vendor.as_mut()
                    && let Some(existing) = vendor.items.iter_mut().find(|i| i.guid == item.guid)
                {
                    *existing = *item.clone();
                    self.refresh_vendor_item_context_if_visible(item.guid);
                    result.needs_redraw = true;
                }
            }
            ClientViewEvent::TradeStateUpdated { trade } => {
                let partner_guid = trade.as_ref().map(|t| t.partner_side.guid);
                // Cancel vendor session.
                self.view.vendor = None;
                self.data.trade = trade;
                // If we just opened a trade and we initiated it, switch to Trade tab.
                if let Some(p_guid) = partner_guid
                    && let Some((last_time, target_guid)) = self.view.last_trade_initiation
                    && target_guid == p_guid
                    && last_time.elapsed() < std::time::Duration::from_secs(5)
                {
                    result.actions.push(AppAction::UiAction {
                        action: AppUiAction::SetDashboardActiveTab(DashboardTab::Trade),
                    });
                }
            }
            ClientViewEvent::EntityIdentified { entity } => {
                let entity_ref = entity.as_ref();
                self.update_inventory_and_equipment(entity_ref);
                self.handle_entity_identified(entity_ref);
                result.needs_redraw = true;
            }
            ClientViewEvent::NoClipUpdated { .. } => {
                result.merge(self.handle_navigation_event(event));
            }
            ClientViewEvent::ContainerOpened { guid } => {
                self.data.open_containers.insert(guid);
            }
            ClientViewEvent::ContainerClosed { guid } => {
                self.data.open_containers.remove(&guid);
            }
            _ => {}
        }
        result
    }

    pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult> {
        let mut result = UpdateResult::new();
        match action {
            AppAction::Assess { target } => {
                let guid = match target {
                    InspectTarget::Entity(guid) | InspectTarget::VendorItem(guid) => guid,
                };
                result.commands.push(ClientCommand::Identify(guid));
                result.merge(
                    self.handle_action(AppAction::ChangeContextView {
                        view: crate::types::ContextView::Assess(target),
                    })
                    .unwrap_or_default(),
                );
            }
            AppAction::Use { guid } => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::QueueSalvageItem { guid } => {
                if (self.view.active_interaction != Some(Interaction::Salvaging)
                    || self.view.salvaging.is_none())
                    && !self.reset_salvaging_state(&mut result)
                {
                    return Some(result);
                }

                if self.data.is_salvage_candidate(guid)
                    && let Some(session) = self.view.salvaging.as_mut()
                    && !session.queued_items.contains(&guid)
                {
                    session.queued_items.push(guid);
                    result.needs_redraw = true;
                }
            }
            AppAction::UnqueueSalvageItem { guid } => {
                if let Some(session) = self.view.salvaging.as_mut() {
                    session
                        .queued_items
                        .retain(|queued_guid| *queued_guid != guid);

                    if session.queued_items.is_empty() {
                        self.set_active_interaction(None, &mut result);
                        self.view.salvaging = None;
                    }
                    result.needs_redraw = true;
                }
            }
            AppAction::SalvageItems {
                ust_guid,
                item_guids,
            } => {
                if !item_guids.is_empty() {
                    result.commands.push(ClientCommand::SalvageItemsWith {
                        tool: ust_guid,
                        items: item_guids,
                    });
                }
                self.set_active_interaction(None, &mut result);
                self.view.salvaging = None;
                result.needs_redraw = true;
            }
            AppAction::Approach { guid } => {
                self.start_approach_target(guid, GENERIC_APPROACH_DISTANCE, &mut result);
            }
            AppAction::Drop { guid } => {
                result.commands.push(ClientCommand::Drop(guid));
            }
            AppAction::Equip { guid } => {
                result.commands.push(ClientCommand::GetAndWield {
                    item: guid,
                    slot: None,
                });
            }
            AppAction::EquipInSlot { guid, slot } => {
                result.commands.push(ClientCommand::GetAndWield {
                    item: guid,
                    slot: Some(slot),
                });
            }
            AppAction::Unequip { guid } => {
                if let Some(container) = self.data.find_non_full_pack(None) {
                    result.commands.push(ClientCommand::MoveItem {
                        item: guid,
                        container,
                        placement: 0,
                    });
                } else {
                    result.actions.push(AppAction::Log {
                        kind: ChatMessageKind::System,
                        message: "No available inventory space to unequip item.".to_string(),
                    });
                }
            }
            AppAction::TalkTo { guid } => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::Open { guid } => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::Close { guid } => {
                result.commands.push(ClientCommand::CloseContainer(guid));
            }
            AppAction::OpenTrade { guid } => {
                match self.try_enter_combat_mode(CombatMode::NonCombat) {
                    EnterCombatModeResult::Failed(res) => {
                        result.merge(res);
                    }
                    EnterCombatModeResult::Success(res) => {
                        result.merge(res);
                        self.view.last_trade_initiation = Some((Instant::now(), guid));
                        result.commands.push(ClientCommand::OpenTrade(guid));
                    }
                }
            }
            AppAction::AddToTrade { guid } => {
                result
                    .commands
                    .push(ClientCommand::AddToTrade { item: guid });
            }
            AppAction::OpenShop { vendor } => {
                if self.data.trade.is_some() {
                    // If we're in a trade, do not initiate vendor sessions.
                    result.actions.push(AppAction::Log {
                        kind: ChatMessageKind::Warning,
                        message: "You are currently in a trade.".to_string(),
                    });
                } else {
                    self.view.last_trade_initiation = Some((Instant::now(), vendor));
                    result.commands.push(ClientCommand::Use(vendor));
                }
            }
            AppAction::SellToVendor {
                vendor,
                item,
                amount,
            } => {
                result.commands.push(ClientCommand::Sell {
                    vendor,
                    items: vec![ItemProfileActionData {
                        object_guid: item,
                        amount: amount as i32,
                    }],
                });
            }
            AppAction::BuyFromVendor {
                vendor,
                item,
                amount,
            } => {
                result.commands.push(ClientCommand::Buy {
                    vendor,
                    items: vec![ItemProfileActionData {
                        object_guid: item,
                        amount: amount as i32,
                    }],
                });
            }
            AppAction::MoveItem { item, container } => {
                result.commands.push(ClientCommand::MoveItem {
                    item,
                    container,
                    placement: 0,
                });
                self.set_active_interaction(None, &mut result);
            }
            AppAction::StackItems {
                source,
                destination,
                amount,
            } => {
                result.commands.push(ClientCommand::Stack {
                    source,
                    destination,
                    amount,
                });
            }
            AppAction::SplitItem {
                item,
                container,
                amount,
            } => {
                result.commands.push(ClientCommand::Split {
                    item,
                    container,
                    amount,
                });
            }
            AppAction::UseWith { item, target } => {
                result
                    .commands
                    .push(ClientCommand::UseWithTarget { item, target });
                // If we were combining with this item, cancel the interaction after using it.
                if let Some(Interaction::Combining {
                    item_guid: interact_guid,
                }) = self.view.active_interaction
                    && interact_guid == item
                {
                    self.view.active_interaction = None;
                }
            }
            AppAction::QueryDebugInfo { target } => match target {
                InspectTarget::Entity(guid) => {
                    result
                        .commands
                        .push(ClientCommand::QueryEntityDebugInfo(guid));
                    result.merge(
                        self.handle_action(AppAction::ChangeContextView {
                            view: ContextView::Debug(InspectTarget::Entity(guid)),
                        })
                        .unwrap_or_default(),
                    );
                }
                InspectTarget::VendorItem(guid) => {
                    result.commands.push(ClientCommand::Identify(guid));
                    result.merge(
                        self.handle_action(AppAction::ChangeContextView {
                            view: ContextView::Debug(InspectTarget::VendorItem(guid)),
                        })
                        .unwrap_or_default(),
                    );
                }
            },
            AppAction::CastSpell { spell_id, target } => {
                match self.try_enter_combat_mode(CombatMode::Magic) {
                    EnterCombatModeResult::Failed(res) => {
                        result.merge(res);
                    }
                    EnterCombatModeResult::Success(res) => {
                        result.merge(res);
                        // TODO: Always cast on self for ring spells and never cast on self for wall spells.
                        if let Some(target) = target {
                            result
                                .commands
                                .push(ClientCommand::CastTargetedSpell { spell_id, target });
                        } else {
                            result
                                .commands
                                .push(ClientCommand::CastUntargetedSpell { spell_id });
                        }
                    }
                }
            }
            AppAction::CycleCombatProfileLevel => {
                self.data.combat_controls.cycle_profile_level();
                self.queue_auto_attack_for_mode(self.data.combat_mode, &mut result);
                result.needs_redraw = true;
            }
            AppAction::CycleCombatAttackHeight => {
                self.data.combat_controls.cycle_attack_height();
                self.queue_auto_attack_for_mode(self.data.combat_mode, &mut result);
                result.needs_redraw = true;
            }
            AppAction::SetCombatMode { mode } => match self.try_enter_combat_mode(mode) {
                EnterCombatModeResult::Failed(res) => {
                    result.merge(res);
                }
                EnterCombatModeResult::Success(res) => {
                    result.merge(res);
                    self.queue_auto_attack_for_mode(mode, &mut result);
                }
            },
            AppAction::LevelUpStat {
                stat,
                amount: xp_spent,
            } => match stat {
                crate::types::StatType::Attribute(attribute) => {
                    result.commands.push(ClientCommand::RaiseAttribute {
                        attribute,
                        xp_spent,
                    });
                }
                crate::types::StatType::Vital(vital) => {
                    result
                        .commands
                        .push(ClientCommand::RaiseVital { vital, xp_spent });
                }
                crate::types::StatType::Skill(skill) => {
                    result
                        .commands
                        .push(ClientCommand::RaiseSkill { skill, xp_spent });
                }
            },
            AppAction::TrainSkill {
                skill,
                amount: credits,
            } => {
                result
                    .commands
                    .push(ClientCommand::TrainSkill { skill, credits });
            }
            AppAction::PickUp {
                item: guid,
                container: preferred_container_id,
            } => {
                if let Some(container_id) = self.data.find_non_full_pack(preferred_container_id) {
                    result.commands.push(ClientCommand::MoveItem {
                        item: guid,
                        container: container_id,
                        placement: 0,
                    });
                } else {
                    result.actions.push(AppAction::Log {
                        kind: ChatMessageKind::System,
                        message: "No space left.".to_string(),
                    });
                }
            }
            AppAction::Give {
                item,
                recipient,
                amount,
            } => {
                result.commands.push(ClientCommand::GiveObjectRequest {
                    target: recipient,
                    item,
                    amount,
                });
            }
            AppAction::AcceptTrade => {
                result.commands.push(ClientCommand::AcceptTrade);
            }
            AppAction::DeclineTrade => {
                result.commands.push(ClientCommand::DeclineTrade);
            }
            AppAction::ResetTrade => {
                result.commands.push(ClientCommand::ResetTrade);
            }
            AppAction::ExitTrade => {
                result.commands.push(ClientCommand::CloseTrade);
            }
            AppAction::ChangeContextView { view } => {
                self.view.context_view = view;
                self.view.context_scroll_offset = 0;
                result.needs_redraw = true;
                self.refresh_context_buffer();
            }
            AppAction::BeginInteraction { interaction } => {
                if interaction == Interaction::Salvaging {
                    if !self.reset_salvaging_state(&mut result) {
                        return Some(result);
                    }
                } else {
                    self.set_active_interaction(Some(interaction), &mut result);
                }
                result.needs_redraw = true;
            }
            AppAction::CancelInteraction => {
                self.set_active_interaction(None, &mut result);
                self.view.salvaging = None;
                result.needs_redraw = true;
            }
            AppAction::ClearVendor => {
                self.view.vendor = None;
                result.needs_redraw = true;
            }
            AppAction::ViewDetails { view } => {
                return self.handle_action(AppAction::ChangeContextView { view });
            }
            AppAction::UiAction { action } => {
                return Some(self.handle_ui_action(action));
            }
            AppAction::Sequence { actions } => {
                for inner_action in actions {
                    if let Some(inner_result) = self.handle_action(inner_action) {
                        result.merge(inner_result);
                    }
                }
            }
            _ => return None,
        }
        self.sync_sticky_melee_pursuit(&mut result);

        Some(result)
    }

    pub fn handle_ui_action(&mut self, action: AppUiAction) -> UpdateResult {
        self.dashboard
            .handle_ui_action(action, &self.data, &self.view)
            .unwrap_or_default()
    }

    pub fn handle_tick(&mut self, elapsed: f64) -> UpdateResult {
        let mut result = UpdateResult::new();

        // Proactive enchantment purge
        let old_count = self.data.player_enchantments.len();
        self.data.player_enchantments.retain(|e| {
            if e.duration < 0.0 {
                return true;
            }
            let expires_at = e.start_time + e.duration;
            expires_at > 0.0
        });
        if self.data.player_enchantments.len() != old_count {
            result.needs_redraw = true;
        }

        // Update enchantment timers locally
        for enchant in &mut self.data.player_enchantments {
            if enchant.duration >= 0.0 {
                enchant.start_time -= elapsed;
            }
        }

        self.refresh_stale_attack_sequence(Instant::now(), &mut result);

        self.sync_approach_target(Instant::now(), &mut result);
        self.sync_sticky_melee_pursuit(&mut result);

        result
    }

    pub fn refresh_context_buffer(&mut self) {
        if self.view.context_view == crate::types::ContextView::Default {
            self.view.context_buffer.clear();
            return;
        }
        let content = build_context_panel_content(&self.data, &self.view);
        self.view.context_buffer = content;
    }

    pub(crate) fn handle_player_event(&mut self, event: ClientViewEvent) {
        match event {
            ClientViewEvent::PlayerEnchantmentsUpdated {
                enchantments,
                resolved_names: _,
            } => {
                self.data.player_enchantments = enchantments;
            }
            ClientViewEvent::PlayerStatsSkillsUpdated {
                attributes,
                skills,
                resistances,
                armor,
                vitae,
                level_info,
            } => {
                self.data.attributes = attributes;
                self.data.skills = skills;
                self.data.resistances = resistances;
                self.data.armor = armor;
                self.data.vitae = vitae;
                self.data.level_info = Some(level_info);
            }
            ClientViewEvent::PlayerVitalsUpdated { vitals } => {
                for (vt, v) in vitals {
                    self.data.vitals.insert(vt, v);
                }
            }
            ClientViewEvent::PlayerSpellsUpdated { spell_ids } => {
                self.data.player_spells = spell_ids;
            }
            ClientViewEvent::CombatModeUpdated { mode } => {
                if mode != CombatMode::NonCombat {
                    // Clear active p2p trade. Vendoring in combat is allowed!
                    self.data.trade = None;
                }
                self.data.combat_mode = mode;
                self.data.combat_runtime.handle_mode_updated(mode);
                if matches!(
                    mode,
                    CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic
                ) {
                    self.view.combat_automation = None;
                }
            }
            _ => {}
        }
    }

    fn handle_combat_feedback(&mut self, feedback: &CombatFeedback) -> UpdateResult {
        let mut result = UpdateResult::new();
        let had_attack_activity = self
            .data
            .combat_runtime
            .attack_activity(self.data.combat_mode)
            .is_some();

        self.data.combat_runtime.handle_feedback(feedback);

        if self.should_rearm_auto_attack_after_cancel(feedback, had_attack_activity) {
            if let Some(target_guid) = self.current_target_guid() {
                log::info!(
                    "sticky melee: re-arming auto attack after cancellation for target 0x{:08X}",
                    target_guid.0
                );
            }
            self.queue_auto_attack_for_mode(self.data.combat_mode, &mut result);
        }

        result
    }

    fn should_rearm_auto_attack_after_cancel(
        &self,
        feedback: &CombatFeedback,
        had_attack_activity: bool,
    ) -> bool {
        had_attack_activity
            && matches!(
                feedback,
                CombatFeedback::AttackDone {
                    error: WeenieError::ActionCancelled
                }
            )
            && matches!(
                self.view.active_interaction,
                Some(Interaction::Targeting { .. })
            )
    }

    pub(crate) fn toggled_combat_mode(&self) -> CombatMode {
        if self.data.combat_mode != CombatMode::NonCombat {
            CombatMode::NonCombat
        } else {
            self.data.get_suggested_combat_mode()
        }
    }

    pub(crate) fn handle_reference_data_event(&mut self, event: ClientViewEvent) {
        if let ClientViewEvent::SpellCatalogLoaded { catalog } = event {
            self.data.spell_catalog = Some(catalog);
        }
    }

    fn try_enter_combat_mode(&mut self, mode: CombatMode) -> EnterCombatModeResult {
        let mut result = UpdateResult::new();
        if self.data.combat_mode == mode {
            // Already in desired mode, do nothing.
            return EnterCombatModeResult::Success(result);
        }
        if mode != CombatMode::NonCombat && self.data.get_suggested_combat_mode() != mode {
            result.actions.push(AppAction::Log {
                kind: ChatMessageKind::Warning,
                message: "Wrong weapon equipped!".to_string(),
            });
            return EnterCombatModeResult::Failed(result);
        }
        result.commands.push(ClientCommand::SetCombatMode(mode));
        EnterCombatModeResult::Success(result)
    }

    pub(crate) fn clear_active_interaction(&mut self, result: &mut UpdateResult) {
        self.set_active_interaction(None, result);
    }

    fn set_active_interaction(
        &mut self,
        next_interaction: Option<Interaction>,
        result: &mut UpdateResult,
    ) {
        let previous_interaction = self.view.active_interaction;
        self.view.active_interaction = next_interaction;

        if self.should_cancel_attack(previous_interaction, next_interaction) {
            result.commands.push(ClientCommand::CancelAttack);
            self.data.combat_runtime.cancel_attack();
            self.view.combat_automation = None;
        }

        if self.should_resume_attack(previous_interaction, next_interaction) {
            self.queue_auto_attack_for_mode(self.data.combat_mode, result);
        }
    }

    fn should_cancel_attack(
        &self,
        previous_interaction: Option<Interaction>,
        next_interaction: Option<Interaction>,
    ) -> bool {
        matches!(
            self.data.combat_mode,
            CombatMode::Melee | CombatMode::Missile
        ) && match (previous_interaction, next_interaction) {
            (
                Some(Interaction::Targeting {
                    target_guid: previous_target,
                }),
                Some(Interaction::Targeting {
                    target_guid: next_target,
                }),
            ) => previous_target != next_target,
            (
                Some(Interaction::Targeting { .. }),
                None
                | Some(Interaction::Moving { .. })
                | Some(Interaction::Healing { .. })
                | Some(Interaction::Combining { .. })
                | Some(Interaction::Salvaging),
            ) => true,
            _ => false,
        }
    }

    fn should_resume_attack(
        &self,
        previous_interaction: Option<Interaction>,
        next_interaction: Option<Interaction>,
    ) -> bool {
        matches!(
            (
                previous_interaction,
                next_interaction,
                self.data.combat_mode
            ),
            (
                None | Some(Interaction::Moving { .. })
                    | Some(Interaction::Healing { .. })
                    | Some(Interaction::Combining { .. })
                    | Some(Interaction::Salvaging)
                    | Some(Interaction::Targeting { .. }),
                Some(Interaction::Targeting { .. }),
                CombatMode::Melee | CombatMode::Missile
            )
        )
    }

    fn queue_auto_attack_for_mode(&mut self, mode: CombatMode, result: &mut UpdateResult) {
        self.sync_combat_automation(Instant::now(), mode, true, result);
    }

    fn refresh_stale_attack_sequence(&mut self, now: Instant, result: &mut UpdateResult) {
        self.sync_combat_automation(now, self.data.combat_mode, false, result);
    }

    fn sync_combat_automation(
        &mut self,
        now: Instant,
        mode: CombatMode,
        force_attack: bool,
        result: &mut UpdateResult,
    ) {
        let Some(input) = self.combat_automation_input(now, mode, force_attack) else {
            self.view.combat_automation = None;
            return;
        };

        let update = self
            .view
            .combat_automation
            .get_or_insert_with(CombatAutomationController::default)
            .handle(&input);

        for effect in update.effects {
            self.apply_combat_automation_effect(effect, result);
        }
    }

    fn combat_automation_input(
        &self,
        now: Instant,
        mode: CombatMode,
        force_attack: bool,
    ) -> Option<CombatAutomationInput> {
        let target_guid = self.current_target_guid()?;
        let attack_profile = self.desired_attack_profile(mode)?;

        Some(CombatAutomationInput::Tick {
            now,
            target_guid,
            target_available: self.is_valid_combat_target(target_guid),
            player_position: self.data.player_pos,
            target_position: self
                .data
                .entities
                .get(&target_guid)
                .map(|entity| entity.position),
            attack_profile,
            attack_sequence_active: self.data.combat_runtime.attack_sequence_active,
            force_attack,
        })
    }

    fn desired_attack_profile(&self, mode: CombatMode) -> Option<DesiredAttackProfile> {
        match mode {
            CombatMode::Melee | CombatMode::Missile => Some(DesiredAttackProfile {
                mode,
                attack_height: self.data.combat_controls.attack_height,
                charge_level: self.data.combat_controls.profile_level.wire_value(),
            }),
            CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
        }
    }

    fn apply_combat_automation_effect(
        &mut self,
        effect: CombatAutomationEffect,
        result: &mut UpdateResult,
    ) {
        match effect {
            CombatAutomationEffect::TurnTo { heading } => {
                self.data.combat_runtime.queue_attack();
                result.needs_redraw = true;
                result.commands.push(ClientCommand::TurnTo {
                    heading,
                    metadata: self.current_movement_metadata(),
                });
            }
            CombatAutomationEffect::Attack(request) => {
                self.data.combat_runtime.queue_attack();
                result.needs_redraw = true;
                match request {
                    TargetedAttackRequest::Melee {
                        target,
                        attack_height,
                        power_level,
                    } => result.commands.push(ClientCommand::TargetedMeleeAttack {
                        target,
                        attack_height,
                        power_level,
                    }),
                    TargetedAttackRequest::Missile {
                        target,
                        attack_height,
                        accuracy_level,
                    } => result.commands.push(ClientCommand::TargetedMissileAttack {
                        target,
                        attack_height,
                        accuracy_level,
                    }),
                }
            }
        }
    }

    fn sync_sticky_melee_pursuit(&mut self, result: &mut UpdateResult) {
        let now = Instant::now();
        let Some(input) = self.sticky_melee_input(now) else {
            self.suspend_sticky_melee(result);
            return;
        };

        let update = self
            .view
            .sticky_melee
            .get_or_insert_with(|| {
                MaintainRangeController::new(MaintainRangeConfig {
                    arrival_distance: MELEE_ATTACK_DISTANCE,
                    acquire_distance: MELEE_STICKY_DISTANCE,
                    repeat_distance: MELEE_REPEAT_DISTANCE,
                    reissue_interval: STICKY_MOVE_REISSUE_INTERVAL,
                })
            })
            .handle(&input);

        let completed = update.is_terminal();
        for effect in update.effects {
            self.apply_sticky_melee_effect(effect, result);
        }

        if completed {
            self.view.sticky_melee = None;
        }
    }

    fn sticky_melee_input(&self, now: Instant) -> Option<MaintainRangeInput> {
        if self.data.combat_mode != CombatMode::Melee {
            return None;
        }

        self.data
            .combat_runtime
            .attack_activity(self.data.combat_mode)?;

        let target_guid = self.current_target_guid()?;
        if !self.is_valid_combat_target(target_guid) {
            return None;
        }

        let player_position = self.data.player_pos?;
        let target_position = self
            .data
            .entities
            .get(&target_guid)
            .map(|entity| entity.position);

        Some(MaintainRangeInput::Tick {
            now,
            target_guid,
            player_position,
            target_position,
        })
    }

    fn suspend_sticky_melee(&mut self, result: &mut UpdateResult) {
        let Some(controller) = self.view.sticky_melee.as_mut() else {
            return;
        };

        let update = controller.handle(&MaintainRangeInput::Suspend { clear_latch: true });
        for effect in update.effects {
            self.apply_sticky_melee_effect(effect, result);
        }
        self.view.sticky_melee = None;
    }

    fn apply_sticky_melee_effect(
        &mut self,
        effect: MaintainRangeEffect,
        result: &mut UpdateResult,
    ) {
        match effect {
            MaintainRangeEffect::StartApproach {
                target,
                arrival_distance,
            } => {
                log::info!(
                    "sticky melee: issuing pursuit for target 0x{:08X}",
                    target.0
                );
                self.start_approach_target(target, arrival_distance, result);
            }
            MaintainRangeEffect::Stop => {
                log::info!("sticky melee: pausing pursuit");
                self.view.approach_target = None;
                result.commands.push(ClientCommand::StopMoving {
                    metadata: self.current_movement_metadata(),
                });
            }
            MaintainRangeEffect::Finished(reason) => match reason {
                MaintainRangeFinishReason::OutsideFollowDistance => {
                    log::info!(
                        "sticky melee: stopping pursuit (target moved beyond sticky follow range)"
                    );
                }
                MaintainRangeFinishReason::TargetUnavailable => {
                    log::info!("sticky melee: stopping pursuit (target entity is unavailable)");
                }
                MaintainRangeFinishReason::Suspended => {}
            },
        }
    }

    fn start_approach_target(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        result: &mut UpdateResult,
    ) {
        if let Some(controller) = self.view.approach_target.as_ref()
            && controller.target_guid() == target
            && (controller.arrival_distance() - arrival_distance).abs() <= f32::EPSILON
        {
            log::debug!(
                "approach: keeping existing controller for target 0x{:08X} at {:.2}m",
                target.0,
                arrival_distance
            );
            return;
        }

        let Some(player_position) = self.data.player_pos else {
            log::warn!(
                "approach: cannot start controller for target 0x{:08X} without player position",
                target.0
            );
            return;
        };

        if let Some(controller) = self.view.approach_target.as_ref() {
            log::info!(
                "approach: replacing controller from target 0x{:08X} ({:.2}m) to 0x{:08X} ({:.2}m)",
                controller.target_guid().0,
                controller.arrival_distance(),
                target.0,
                arrival_distance
            );
        }

        self.view.approach_target = Some(ApproachTargetController::new(
            target,
            arrival_distance,
            player_position,
            Instant::now(),
        ));
        self.sync_approach_target(Instant::now(), result);
    }

    fn sync_approach_target(&mut self, now: Instant, result: &mut UpdateResult) {
        let Some(controller) = self.view.approach_target.as_mut() else {
            return;
        };

        let Some(player_position) = self.data.player_pos else {
            self.view.approach_target = None;
            return;
        };

        let target_guid = controller.target_guid();
        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position,
            target_position: self
                .data
                .entities
                .get(&target_guid)
                .map(|entity| entity.position),
            move_speed: self
                .data
                .get_run_rate()
                .unwrap_or(DEFAULT_APPROACH_RUN_RATE),
        });

        let completed = update.is_terminal();
        for effect in update.effects {
            self.apply_approach_target_effect(effect, result);
        }

        if completed {
            self.view.approach_target = None;
        }
    }

    fn cancel_active_approach_due_to_forced_reposition(&mut self, result: &mut UpdateResult) {
        let Some(controller) = self.view.approach_target.as_mut() else {
            return;
        };

        let update = controller.handle(&ApproachTargetInput::ForcedReposition);
        for effect in update.effects {
            self.apply_approach_target_effect(effect, result);
        }
        self.view.approach_target = None;
    }

    fn apply_approach_target_effect(
        &mut self,
        effect: ApproachTargetEffect,
        result: &mut UpdateResult,
    ) {
        match effect {
            ApproachTargetEffect::Locomotion(primitive) => {
                result.commands.push(ClientCommand::ExecuteLocomotion(
                    self.locomotion_request(primitive),
                ));
            }
            ApproachTargetEffect::Finished(reason) => match reason {
                ApproachTargetFinishReason::Arrived => {
                    if let Some(controller) = self.view.approach_target.as_ref() {
                        log::info!(
                            "approach: arrived at target 0x{:08X} within {:.2}m",
                            controller.target_guid().0,
                            controller.arrival_distance()
                        );
                    }
                }
                ApproachTargetFinishReason::TargetUnavailable => {
                    log::warn!("approach: target became unavailable");
                }
                ApproachTargetFinishReason::NoProgress => {
                    log::warn!("approach: controller aborted because the player made no progress");
                }
                ApproachTargetFinishReason::ForcedReposition => {
                    log::warn!("approach: controller aborted after forced reposition");
                }
            },
        }
    }

    fn current_target_guid(&self) -> Option<Guid> {
        match self.view.active_interaction {
            Some(Interaction::Targeting { target_guid }) => Some(target_guid),
            _ => None,
        }
    }

    fn is_valid_combat_target(&self, target_guid: Guid) -> bool {
        if Some(target_guid) == self.data.player_guid {
            return false;
        }

        let Some(entity) = self.data.entities.get(&target_guid) else {
            return false;
        };

        if entity.position.landblock_id == Guid::NULL {
            return false;
        }

        entity.is_creature()
    }

    fn reset_salvaging_state(&mut self, result: &mut UpdateResult) -> bool {
        let Some(ust_guid) = self.data.find_salvage_tool_guid() else {
            self.push_missing_ust_warning(result);
            return false;
        };

        self.view.active_interaction = Some(Interaction::Salvaging);
        self.view.salvaging = Some(SalvagingState {
            ust_guid,
            queued_items: Vec::new(),
        });
        true
    }

    fn push_missing_ust_warning(&self, result: &mut UpdateResult) {
        result.actions.push(AppAction::Log {
            kind: ChatMessageKind::Warning,
            message: "You do not have an Ust in your inventory.".to_string(),
        });
    }

    fn handle_entity_identified(&mut self, entity: &Entity) {
        let guid = entity.guid;
        self.data.entities.insert(guid, entity.clone());
        self.view.context_view = ContextView::Assess(InspectTarget::Entity(guid));
        self.refresh_context_buffer();
    }

    fn refresh_vendor_item_context_if_visible(&mut self, guid: Guid) {
        if matches!(
            self.view.context_view,
            ContextView::Assess(InspectTarget::VendorItem(target_guid))
                | ContextView::Debug(InspectTarget::VendorItem(target_guid))
                if target_guid == guid
        ) {
            self.refresh_context_buffer();
        }
    }

    fn update_inventory_and_equipment(&mut self, entity: &Entity) {
        let guid = entity.guid;
        let pguid = self.data.player_guid;

        // Handle player position if it's the player entity
        if Some(guid) == pguid {
            self.data.player_pos = Some(entity.position);
        }

        // Update inventory tracking
        if let Some(pguid) = pguid {
            if let Some(cid) = entity.container_id()
                && (cid == pguid || self.data.inventory.contains(&cid))
            {
                self.data.inventory.insert(guid);
            } else if let Some(wid) = entity.wielder_id()
                && wid == pguid
            {
                self.data.inventory.insert(guid);
            } else {
                // If it's no longer in our inventory/wielded, remove it
                self.data.inventory.remove(&guid);
            }
        }

        // Update equipment tracking
        if let Some(pguid) = pguid
            && entity.wielder_id() == Some(pguid)
        {
            let mask = entity.wield_location();
            if mask.is_empty() {
                self.data.equipment.remove(&guid);
            } else {
                self.data.equipment.insert(guid, mask);
            }
        } else {
            self.data.equipment.remove(&guid);
        }

        self.data.entities.insert(entity.guid, entity.clone());
    }

    fn handle_entity_removed(&mut self, guid: Guid) {
        self.data.update_inventory_recursive(guid, false);
        self.data.entities.remove(&guid);
        self.data.equipment.remove(&guid);
        if matches!(
            self.view.context_view,
            ContextView::Assess(InspectTarget::Entity(target_guid))
                | ContextView::Debug(InspectTarget::Entity(target_guid))
                if target_guid == guid
        ) {
            self.view.context_view = ContextView::Default;
            self.refresh_context_buffer();
        }
        if matches!(
            self.view.active_interaction,
            Some(Interaction::Targeting { target_guid }) if target_guid == guid
        ) {
            let mut result = UpdateResult::new();
            self.set_active_interaction(None, &mut result);
        }
        if let Some(session) = self.view.salvaging.as_mut() {
            session
                .queued_items
                .retain(|queued_guid| *queued_guid != guid);
            if session.ust_guid == guid {
                self.view.salvaging = None;
                if self.view.active_interaction == Some(Interaction::Salvaging) {
                    let mut result = UpdateResult::new();
                    self.set_active_interaction(None, &mut result);
                }
            }
        }
    }

    fn handle_navigation_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        if let ClientViewEvent::NoClipUpdated { enabled } = event {
            self.data.noclip = enabled;
            let status = if enabled { "ENABLED" } else { "DISABLED" };
            result.actions.push(AppAction::Log {
                kind: ChatMessageKind::System,
                message: format!(">> NoClip is now {}", status),
            });
        }
        result
    }

    pub(crate) fn current_movement_metadata(&self) -> MovementPacketMetadata {
        MovementPacketMetadata::default()
    }

    fn locomotion_request(
        &self,
        primitive: holtburger_core::client::locomotion::LocomotionPrimitive,
    ) -> LocomotionRequest {
        LocomotionRequest::new(primitive).with_metadata(self.current_movement_metadata())
    }
}

#[derive(Debug, Clone)]
pub struct ViewState {
    /// Which area of the screen currently has focus.
    pub focused_pane: FocusedPane,
    /// Previous focus, used for returning from modals.
    pub previous_focused_pane: FocusedPane,
    /// Used to detect context resizing.
    pub context_total_lines: usize,
    /// Cached total line count for context/debug view.
    pub context_last_total_lines: usize,
    /// Pre-wrapped lines of text for the right-hand panel.
    pub context_buffer: Vec<Line<'static>>,
    /// Current vertical scroll position of the context panel.
    pub context_scroll_offset: usize,
    /// What information should be displayed in the context panel.
    pub context_view: ContextView,
    /// Current vendor state (inventory and multipliers) - note: pseudo-client state.
    pub vendor: Option<holtburger_world::vendor::VendorState>,
    /// State of current interaction like vendor transactions.
    pub active_interaction: Option<Interaction>,
    /// Current salvaging queue state when the player is in salvaging mode.
    pub salvaging: Option<SalvagingState>,
    /// Last time we sent a command that could initiate a trade or vendor interaction, and the target's GUID.
    pub last_trade_initiation: Option<(Instant, Guid)>,
    /// Current reusable approach controller for frontend-owned locomotion automation.
    pub approach_target: Option<ApproachTargetController>,
    /// Current reusable maintain-range controller for sticky melee pursuit.
    pub sticky_melee: Option<MaintainRangeController>,
    /// Current reusable combat automation controller for desired attack maintenance.
    pub combat_automation: Option<CombatAutomationController>,
    /// Cache of the exact bounding boxes computed during update_layout.
    pub layout_cache: LayoutCache,
}

#[derive(Debug, Clone, Default)]
pub struct LayoutCache {
    pub main_chunks: std::rc::Rc<Vec<ratatui::layout::Rect>>,
    pub dynamic_chunk: ratatui::layout::Rect,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            focused_pane: FocusedPane::Dashboard,
            previous_focused_pane: FocusedPane::Dashboard,
            context_total_lines: 0,
            context_last_total_lines: 0,
            context_buffer: Vec::new(),
            context_scroll_offset: 0,
            context_view: ContextView::Default,
            vendor: None,
            active_interaction: None,
            salvaging: None,
            last_trade_initiation: None,
            approach_target: None,
            sticky_melee: None,
            combat_automation: None,
            layout_cache: LayoutCache::default(),
        }
    }
}

impl ViewState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ItemType, PropertyBool, PropertyInt, PropertyString, WorldObjectProperties,
        WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::messages::combat::AttackHeight;
    use holtburger_protocol::messages::object::types::{CreatureProfile, CreatureProfileFlags};
    use holtburger_world::vendor::{CoreVendorItem, VendorState};

    #[test]
    fn test_entity_replaced_updates_cached_entity_state() {
        let player_guid = Guid(0x50000001);
        let entity_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        state.data.entities.insert(
            entity_guid,
            Entity::new(
                entity_guid,
                "Old Name".to_string(),
                WorldPosition::default(),
            ),
        );

        let replacement = Entity::new(
            entity_guid,
            "New Name".to_string(),
            WorldPosition::default(),
        );

        let _ = state.handle_view_event(ClientViewEvent::EntityReplaced {
            entity: Box::new(replacement),
        });

        assert_eq!(
            state
                .data
                .entities
                .get(&entity_guid)
                .map(|entity| entity.name()),
            Some("New Name")
        );
    }

    #[test]
    fn vendor_item_identified_refreshes_visible_assess_context() {
        let player_guid = Guid(0x50000001);
        let vendor_guid = Guid(0x60000001);
        let item_guid = Guid(0x70000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        state.view.vendor = Some(VendorState {
            vendor_guid,
            items: vec![vendor_item_named(item_guid, 1, "Old Name")],
            buy_multiplier: 1.0,
            sell_multiplier: 1.0,
            merchandise_item_types: 0,
            alternate_currency_wcid: 0,
            alternate_currency_amount: 0,
            alternate_currency_name: String::new(),
        });
        state.view.context_view = ContextView::Assess(InspectTarget::VendorItem(item_guid));
        state.refresh_context_buffer();

        assert!(context_buffer_contains(
            &state.view.context_buffer,
            "OLD NAME"
        ));
        assert!(!context_buffer_contains(
            &state.view.context_buffer,
            "NEW NAME"
        ));

        let result = state.handle_view_event(ClientViewEvent::VendorItemIdentified(Box::new(
            vendor_item_named(item_guid, 1, "New Name"),
        )));

        assert!(result.needs_redraw);
        assert!(context_buffer_contains(
            &state.view.context_buffer,
            "NEW NAME"
        ));
        assert!(!context_buffer_contains(
            &state.view.context_buffer,
            "OLD NAME"
        ));
    }

    fn vendor_item_named(guid: Guid, wcid: u32, name: &str) -> CoreVendorItem {
        let mut properties = WorldObjectProperties::default();
        properties
            .strings
            .insert(PropertyString::Name, name.to_string());

        CoreVendorItem {
            guid,
            wcid,
            vendor_supply: None,
            properties,
            ..CoreVendorItem::default()
        }
    }

    fn context_buffer_contains(buffer: &[Line<'static>], needle: &str) -> bool {
        buffer.iter().any(|line| line.to_string().contains(needle))
    }

    fn creature_entity(guid: Guid, name: &str, position: WorldPosition) -> Entity {
        let mut entity = Entity::new(guid, name.to_string(), position);
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity.creature_profile = Some(CreatureProfile {
            flags: CreatureProfileFlags::empty(),
            health: 1,
            health_max: 1,
            attributes: None,
            buffs: None,
        });
        entity
    }

    #[test]
    fn set_combat_mode_with_valid_target_queues_melee_attack() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };

        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let result = state
            .handle_action(AppAction::SetCombatMode {
                mode: CombatMode::Melee,
            })
            .unwrap();

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::SetCombatMode(CombatMode::Melee))
        ));
        assert!(matches!(
            result.commands.get(1),
            Some(ClientCommand::TargetedMeleeAttack {
                target,
                attack_height: AttackHeight::Medium,
                power_level,
            }) if *target == target_guid && (*power_level - 0.5).abs() < f32::EPSILON
        ));
    }

    #[test]
    fn combat_mode_update_requests_redraw() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let result = state.handle_view_event(ClientViewEvent::CombatModeUpdated {
            mode: CombatMode::Melee,
        });

        assert!(result.needs_redraw);
        assert_eq!(state.data.combat_mode, CombatMode::Melee);
    }

    #[test]
    fn player_movement_event_requests_redraw() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), WorldPosition::default()),
        );

        let moved_pos = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        let result = state.handle_view_event(ClientViewEvent::EntityMoved {
            guid: player_guid,
            pos: moved_pos,
        });

        assert!(result.needs_redraw);
        assert_eq!(state.data.player_pos, Some(moved_pos));
    }

    #[test]
    fn player_movement_event_does_not_immediately_redrive_approach() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let start_pos = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        state.data.player_pos = Some(start_pos);
        state.data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), start_pos),
        );

        let target_pos = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(5.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_pos),
        );
        state.view.approach_target = Some(ApproachTargetController::new(
            target_guid,
            1.0,
            start_pos,
            Instant::now(),
        ));

        let moved_pos = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(0.2, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let result = state.handle_view_event(ClientViewEvent::EntityMoved {
            guid: player_guid,
            pos: moved_pos,
        });

        assert!(result.commands.is_empty());
        assert_eq!(state.data.player_pos, Some(moved_pos));
        assert!(state.view.approach_target.is_some());
    }

    #[test]
    fn combat_feedback_updates_auto_attack_runtime_state() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let commenced = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackCommenced,
        ));

        assert!(commenced.needs_redraw);
        assert!(!state.data.combat_runtime.attack_queued);
        assert!(state.data.combat_runtime.attack_sequence_active);

        let done = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::None,
            },
        ));

        assert!(done.needs_redraw);
        assert!(state.data.combat_runtime.attack_queued);
        assert!(!state.data.combat_runtime.attack_sequence_active);

        let cancelled = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(cancelled.needs_redraw);
        assert!(!state.data.combat_runtime.attack_queued);
        assert!(!state.data.combat_runtime.attack_sequence_active);
    }

    #[test]
    fn begin_targeting_in_missile_mode_queues_missile_attack() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Missile;
        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };

        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Tusker", target_position),
        );

        let result = state
            .handle_action(AppAction::BeginInteraction {
                interaction: Interaction::Targeting { target_guid },
            })
            .unwrap();

        assert!(state.data.combat_runtime.attack_queued);

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::TargetedMissileAttack {
                target,
                attack_height: AttackHeight::Medium,
                accuracy_level,
            }) if *target == target_guid && (*accuracy_level - 0.5).abs() < f32::EPSILON
        ));
    }

    #[test]
    fn combat_control_actions_cycle_defaults() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        assert_eq!(state.data.combat_controls.profile_level.wire_value(), 0.5);
        assert_eq!(
            state.data.combat_controls.attack_height,
            AttackHeight::Medium
        );

        state
            .handle_action(AppAction::CycleCombatProfileLevel)
            .unwrap();
        state
            .handle_action(AppAction::CycleCombatAttackHeight)
            .unwrap();

        assert_eq!(state.data.combat_controls.profile_level.wire_value(), 1.0);
        assert_eq!(state.data.combat_controls.attack_height, AttackHeight::High);
    }

    #[test]
    fn cycling_profile_while_targeting_resends_melee_attack_with_new_power() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let result = state
            .handle_action(AppAction::CycleCombatProfileLevel)
            .unwrap();

        assert!(state.data.combat_runtime.attack_queued);

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack {
                    target,
                    attack_height: AttackHeight::Medium,
                    power_level,
                } if *target == target_guid && (*power_level - 1.0).abs() < f32::EPSILON
            )
        }));
    }

    #[test]
    fn cycling_height_while_targeting_resends_missile_attack_with_new_height() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Missile;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Tusker", target_position),
        );

        let result = state
            .handle_action(AppAction::CycleCombatAttackHeight)
            .unwrap();

        assert!(state.data.combat_runtime.attack_queued);

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMissileAttack {
                    target,
                    attack_height: AttackHeight::High,
                    accuracy_level,
                } if *target == target_guid && (*accuracy_level - 0.5).abs() < f32::EPSILON
            )
        }));
    }

    #[test]
    fn despawning_target_clears_targeting_interaction() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        state.view.active_interaction = Some(Interaction::Targeting { target_guid });
        state.handle_entity_removed(target_guid);

        assert_eq!(state.view.active_interaction, None);
    }

    #[test]
    fn cancel_interaction_sends_cancel_attack_when_leaving_targeting() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.combat_runtime.attack_queued = true;
        state.data.combat_runtime.attack_sequence_active = true;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let result = state.handle_action(AppAction::CancelInteraction).unwrap();

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::CancelAttack)
        ));
        assert_eq!(state.view.active_interaction, None);
        assert!(!state.data.combat_runtime.attack_queued);
        assert!(!state.data.combat_runtime.attack_sequence_active);
    }

    #[test]
    fn switching_from_targeting_to_non_targeting_cancels_attack() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Missile;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let result = state
            .handle_action(AppAction::BeginInteraction {
                interaction: Interaction::Combining {
                    item_guid: Guid(0x70000001),
                },
            })
            .unwrap();

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::CancelAttack))
        );
        assert!(matches!(
            state.view.active_interaction,
            Some(Interaction::Combining { item_guid }) if item_guid == Guid(0x70000001)
        ));
    }

    #[test]
    fn switching_to_targeting_in_combat_mode_resumes_attack() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let result = state
            .handle_action(AppAction::BeginInteraction {
                interaction: Interaction::Targeting { target_guid },
            })
            .unwrap();

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack {
                    target,
                    attack_height: AttackHeight::Medium,
                    power_level,
                } if *target == target_guid && (*power_level - 0.5).abs() < f32::EPSILON
            )
        }));
    }

    #[test]
    fn switching_targets_retargets_attack_sequence() {
        let player_guid = Guid(0x50000001);
        let first_target_guid = Guid(0x60000001);
        let second_target_guid = Guid(0x60000002);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.combat_runtime.attack_sequence_active = true;
        state.view.active_interaction = Some(Interaction::Targeting {
            target_guid: first_target_guid,
        });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };

        state.data.entities.insert(
            first_target_guid,
            creature_entity(first_target_guid, "Drudge", target_position),
        );
        state.data.entities.insert(
            second_target_guid,
            creature_entity(second_target_guid, "Shreth", target_position),
        );

        let result = state
            .handle_action(AppAction::BeginInteraction {
                interaction: Interaction::Targeting {
                    target_guid: second_target_guid,
                },
            })
            .unwrap();

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::CancelAttack))
        );
        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack { target, .. } if *target == second_target_guid
            )
        }));
        assert!(state.data.combat_runtime.attack_queued);
        assert!(!state.data.combat_runtime.attack_sequence_active);
    }

    #[test]
    fn targeting_creature_item_type_without_profile_still_starts_attack() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };

        let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
        target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let result = state
            .handle_action(AppAction::BeginInteraction {
                interaction: Interaction::Targeting { target_guid },
            })
            .unwrap();

        assert!(result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
    }

    #[test]
    fn handle_tick_refreshes_stale_queued_attack_sequence() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
        target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let now = Instant::now();
        let mut seeded = UpdateResult::new();
        state.sync_combat_automation(now, CombatMode::Melee, true, &mut seeded);
        state.data.combat_runtime.attack_queued = true;
        state.data.combat_runtime.attack_sequence_active = false;

        let mut result = UpdateResult::new();
        state.refresh_stale_attack_sequence(
            now + Duration::from_secs(1) + Duration::from_millis(1),
            &mut result,
        );

        assert!(result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
        assert!(state.data.combat_runtime.attack_queued);
    }

    #[test]
    fn handle_tick_retries_cancelled_attack_after_combat_mode_reentry() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::NonCombat;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
        target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        state.data.combat_runtime.queue_attack();

        let cancelled = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(
            !cancelled
                .commands
                .iter()
                .any(|command| { matches!(command, ClientCommand::TargetedMeleeAttack { .. }) })
        );
        assert!(!state.data.combat_runtime.attack_queued);

        state.data.combat_mode = CombatMode::Melee;

        let mut retry = UpdateResult::new();
        state.refresh_stale_attack_sequence(Instant::now(), &mut retry);

        assert!(retry.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
        assert!(state.data.combat_runtime.attack_queued);
    }

    #[test]
    fn switching_to_non_creature_target_cancels_attack_sequence() {
        let player_guid = Guid(0x50000001);
        let creature_guid = Guid(0x60000001);
        let non_creature_guid = Guid(0x70000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.combat_runtime.attack_sequence_active = true;
        state.view.active_interaction = Some(Interaction::Targeting {
            target_guid: creature_guid,
        });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };

        state.data.entities.insert(
            creature_guid,
            creature_entity(creature_guid, "Drudge", target_position),
        );

        let mut chest = Entity::new(non_creature_guid, "Chest".to_string(), target_position);
        chest.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(non_creature_guid, chest);

        let result = state
            .handle_action(AppAction::BeginInteraction {
                interaction: Interaction::Targeting {
                    target_guid: non_creature_guid,
                },
            })
            .unwrap();

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::CancelAttack))
        );
        assert!(!result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack { .. }
                    | ClientCommand::TargetedMissileAttack { .. }
            )
        }));
        assert!(!state.data.combat_runtime.attack_queued);
        assert!(!state.data.combat_runtime.attack_sequence_active);
    }

    #[test]
    fn handle_tick_starts_sticky_melee_follow_when_target_slips_out_of_range() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });
        state.data.combat_runtime.attack_sequence_active = true;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(1.5, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let result = state.handle_tick(0.016);

        assert!(
            result.commands.iter().any(|command| {
                matches!(
                    command,
                    ClientCommand::ExecuteLocomotion(LocomotionRequest {
                        primitive:
                            holtburger_core::client::locomotion::LocomotionPrimitive::Drive { .. },
                        ..
                    })
                )
            })
        );
        assert_eq!(
            state
                .view
                .sticky_melee
                .as_ref()
                .and_then(MaintainRangeController::latched_target_guid),
            Some(target_guid)
        );
    }

    #[test]
    fn cancelled_attack_stops_sticky_melee_follow() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            rotation: holtburger_common::Quaternion::from_heading(0.0),
            ..WorldPosition::default()
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });
        state.data.combat_runtime.attack_sequence_active = true;

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(1.5, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let mut sticky_melee = MaintainRangeController::new(MaintainRangeConfig {
            arrival_distance: MELEE_ATTACK_DISTANCE,
            acquire_distance: MELEE_STICKY_DISTANCE,
            repeat_distance: MELEE_REPEAT_DISTANCE,
            reissue_interval: STICKY_MOVE_REISSUE_INTERVAL,
        });
        let _ = sticky_melee.handle(&MaintainRangeInput::Tick {
            now: Instant::now() - STICKY_MOVE_REISSUE_INTERVAL,
            target_guid,
            player_position: state.data.player_pos.unwrap(),
            target_position: Some(target_position),
        });
        state.view.sticky_melee = Some(sticky_melee);

        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::TurnTo { .. }))
        );
        assert!(
            result.commands.iter().any(|command| {
                matches!(
                    command,
                    ClientCommand::ExecuteLocomotion(LocomotionRequest {
                        primitive:
                            holtburger_core::client::locomotion::LocomotionPrimitive::Drive { .. },
                        ..
                    })
                )
            })
        );
        assert_eq!(
            state
                .view
                .sticky_melee
                .as_ref()
                .and_then(MaintainRangeController::latched_target_guid),
            Some(target_guid)
        );

        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            rotation: holtburger_common::Quaternion::from_heading(180.0_f32.to_radians()),
            ..WorldPosition::default()
        });

        let mut retry = UpdateResult::new();
        state
            .refresh_stale_attack_sequence(Instant::now() + Duration::from_millis(200), &mut retry);

        assert!(retry.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
    }

    #[test]
    fn cancelled_attack_does_not_rearm_after_explicit_cancel() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.combat_runtime.attack_sequence_active = true;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(1.5, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let _ = state.handle_action(AppAction::CancelInteraction).unwrap();

        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(!result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack { .. }
                    | ClientCommand::ExecuteLocomotion(LocomotionRequest {
                        primitive:
                            holtburger_core::client::locomotion::LocomotionPrimitive::Drive { .. },
                        ..
                    })
            )
        }));
        assert_eq!(state.view.active_interaction, None);
    }

    #[test]
    fn forced_reposition_cancels_frontend_owned_approach_controller() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(5.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let started = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();
        assert!(
            started.commands.iter().any(|command| {
                matches!(
                    command,
                    ClientCommand::ExecuteLocomotion(LocomotionRequest {
                        primitive:
                            holtburger_core::client::locomotion::LocomotionPrimitive::Drive { .. },
                        ..
                    })
                )
            })
        );
        assert!(state.view.approach_target.is_some());

        let result = state.handle_view_event(ClientViewEvent::ForcedReposition {
            guid: player_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(10.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
            sequence: 42,
        });

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteLocomotion(LocomotionRequest {
                    primitive: holtburger_core::client::locomotion::LocomotionPrimitive::Stop {
                        refresh_server: false,
                    },
                    ..
                })
            )
        }));
        assert!(state.view.approach_target.is_none());
    }

    #[test]
    fn missile_targeting_turns_before_reissuing_attack_when_not_facing() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Missile;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            rotation: holtburger_common::Quaternion::from_heading(0.0),
            ..WorldPosition::default()
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(0.0, 10.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Tusker", target_position),
        );

        let now = Instant::now();
        let mut turn = UpdateResult::new();
        state.sync_combat_automation(now, CombatMode::Missile, true, &mut turn);

        assert!(
            turn.commands
                .iter()
                .any(|command| matches!(command, ClientCommand::TurnTo { .. }))
        );
        assert!(
            !turn
                .commands
                .iter()
                .any(|command| { matches!(command, ClientCommand::TargetedMissileAttack { .. }) })
        );

        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            rotation: holtburger_common::Quaternion::from_heading(90.0_f32.to_radians()),
            ..WorldPosition::default()
        });

        let mut attack = UpdateResult::new();
        state.refresh_stale_attack_sequence(now + Duration::from_millis(200), &mut attack);

        assert!(attack.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMissileAttack { target, .. } if *target == target_guid)
        }));
    }

    #[test]
    fn sticky_melee_keeps_repeat_latch_after_temporarily_returning_to_range() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });
        state.data.combat_runtime.attack_sequence_active = true;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(0.5, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        state.data.entities.insert(target_guid, target.clone());

        let mut sticky_melee = MaintainRangeController::new(MaintainRangeConfig {
            arrival_distance: MELEE_ATTACK_DISTANCE,
            acquire_distance: MELEE_STICKY_DISTANCE,
            repeat_distance: MELEE_REPEAT_DISTANCE,
            reissue_interval: STICKY_MOVE_REISSUE_INTERVAL,
        });
        let _ = sticky_melee.handle(&MaintainRangeInput::Tick {
            now: Instant::now() - STICKY_MOVE_REISSUE_INTERVAL,
            target_guid,
            player_position: state.data.player_pos.unwrap(),
            target_position: Some(WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(1.5, 0.0, 0.0),
                ..WorldPosition::default()
            }),
        });
        state.view.sticky_melee = Some(sticky_melee);

        let in_range = state.handle_tick(0.016);

        assert!(
            in_range
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::StopMoving { .. }))
        );
        assert_eq!(
            state
                .view
                .sticky_melee
                .as_ref()
                .and_then(MaintainRangeController::latched_target_guid),
            Some(target_guid)
        );
        assert!(
            !state
                .view
                .sticky_melee
                .as_ref()
                .is_some_and(MaintainRangeController::is_pursuing)
        );

        target.position.coords = holtburger_common::Vector3::new(6.0, 0.0, 0.0);
        state.data.entities.insert(target_guid, target);

        let slipped_again = state.handle_tick(0.016);

        assert!(
            slipped_again.commands.iter().any(|command| {
                matches!(
                    command,
                    ClientCommand::ExecuteLocomotion(LocomotionRequest {
                        primitive:
                            holtburger_core::client::locomotion::LocomotionPrimitive::Drive { .. },
                        ..
                    })
                )
            })
        );
        assert_eq!(
            state
                .view
                .sticky_melee
                .as_ref()
                .and_then(MaintainRangeController::latched_target_guid),
            Some(target_guid)
        );
        assert!(
            state
                .view
                .sticky_melee
                .as_ref()
                .is_some_and(MaintainRangeController::is_pursuing)
        );
    }

    #[test]
    fn repeated_start_approach_reuses_existing_controller_for_same_target() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(5.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let mut first = UpdateResult::new();
        state.start_approach_target(target_guid, 1.0, &mut first);

        assert!(first.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteLocomotion(LocomotionRequest {
                    primitive: holtburger_core::client::locomotion::LocomotionPrimitive::Drive {
                        refresh_server: true,
                        ..
                    },
                    ..
                })
            )
        }));

        let mut second = UpdateResult::new();
        state.start_approach_target(target_guid, 1.0, &mut second);

        assert!(second.commands.is_empty());
        assert!(state.view.approach_target.is_some());
    }

    #[test]
    fn movement_metadata_does_not_echo_server_grounded_state() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.player_grounded = Some(false);

        assert_eq!(state.current_movement_metadata().contact, None);
    }
}
