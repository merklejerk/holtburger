use holtburger_common::Guid;
use holtburger_core::ClientViewEvent;
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
const ATTACK_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
const GENERIC_APPROACH_DISTANCE: f32 = 1.0;

enum StickyMeleeDecision {
    Follow {
        target_guid: Guid,
        distance: f32,
        max_follow_distance: f32,
    },
    Stop {
        reason: &'static str,
        clear_target: bool,
    },
}

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
                self.chat.handle_event(ClientViewEvent::CombatFeedback(feedback));
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
                if let Some(entity) = self.data.entities.get_mut(&guid) {
                    entity.position = pos;
                    if Some(guid) == self.data.player_guid {
                        self.data.player_pos = Some(pos);
                    }
                }
                self.sync_sticky_melee_pursuit(&mut result);
            }
            ClientViewEvent::EntityDespawned { guid } => {
                self.handle_entity_removed(guid);
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
                result.commands.push(ClientCommand::ApproachTarget {
                    target: guid,
                    arrival_distance: GENERIC_APPROACH_DISTANCE,
                });
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
            AppAction::SetCombatMode { mode } => {
                match self.try_enter_combat_mode(mode) {
                    EnterCombatModeResult::Failed(res) => {
                        result.merge(res);
                    }
                    EnterCombatModeResult::Success(res) => {
                        result.merge(res);
                        self.queue_auto_attack_for_mode(mode, &mut result);
                    }
                }
            }
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

        self.refresh_stale_attack_sequence(&mut result);

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
                if matches!(mode, CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic) {
                    self.view.last_attack_heartbeat_at = None;
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
            && matches!(feedback, CombatFeedback::AttackDone { error: WeenieError::ActionCancelled })
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
            self.view.last_attack_heartbeat_at = None;
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
        matches!(self.data.combat_mode, CombatMode::Melee | CombatMode::Missile)
            && match (previous_interaction, next_interaction) {
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
            (previous_interaction, next_interaction, self.data.combat_mode),
            (
                None
                    | Some(Interaction::Moving { .. })
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
        let Some(target_guid) = self.current_target_guid() else {
            return;
        };

        if !self.is_valid_combat_target(target_guid) {
            return;
        }

        let attack_height = self.data.combat_controls.attack_height;
        let profile_value = self.data.combat_controls.profile_level.wire_value();

        let command = match mode {
            CombatMode::Melee => Some(ClientCommand::TargetedMeleeAttack {
                target: target_guid,
                attack_height,
                power_level: profile_value,
            }),
            CombatMode::Missile => Some(ClientCommand::TargetedMissileAttack {
                target: target_guid,
                attack_height,
                accuracy_level: profile_value,
            }),
            _ => None,
        };

        if let Some(command) = command {
            self.data.combat_runtime.queue_attack();
            self.view.last_attack_heartbeat_at = Some(Instant::now());
            result.commands.push(command);
        }
    }

    fn refresh_stale_attack_sequence(&mut self, result: &mut UpdateResult) {
        if !matches!(self.data.combat_mode, CombatMode::Melee | CombatMode::Missile) {
            return;
        }

        if !matches!(self.view.active_interaction, Some(Interaction::Targeting { .. })) {
            return;
        }

        let Some(target_guid) = self.current_target_guid() else {
            return;
        };

        if !self.is_valid_combat_target(target_guid) {
            return;
        }

        if self.data.combat_runtime.attack_sequence_active {
            return;
        }

        let now = Instant::now();
        let should_refresh = self
            .view
            .last_attack_heartbeat_at
            .is_none_or(|last_attempt| now.duration_since(last_attempt) >= ATTACK_HEARTBEAT_INTERVAL);

        if should_refresh {
            log::info!(
                "combat heartbeat: refreshing desired attack for target 0x{:08X}",
                target_guid.0
            );
            self.queue_auto_attack_for_mode(self.data.combat_mode, result);
        }
    }

    fn sync_sticky_melee_pursuit(&mut self, result: &mut UpdateResult) {
        let decision = self.sticky_melee_decision();
        let (target_guid, distance, max_follow_distance) = match decision {
            StickyMeleeDecision::Follow {
                target_guid,
                distance,
                max_follow_distance,
            } => (target_guid, distance, max_follow_distance),
            StickyMeleeDecision::Stop {
                reason,
                clear_target,
            } => {
                if self.view.sticky_combat_target.is_some() {
                    let was_moving = self.view.last_sticky_move_at.take().is_some();
                    if clear_target || was_moving {
                        let action = if clear_target { "stopping" } else { "pausing" };
                        log::info!("sticky melee: {} pursuit ({})", action, reason);
                    }

                    if clear_target {
                        self.view.sticky_combat_target = None;
                    }

                    if was_moving {
                        result.commands.push(ClientCommand::StopMoving);
                    }
                }
                return;
            }
        };

        let now = Instant::now();
        let should_issue_move = self.view.sticky_combat_target != Some(target_guid)
            || self
                .view
                .last_sticky_move_at
                .map(|last_move| now.duration_since(last_move) >= STICKY_MOVE_REISSUE_INTERVAL)
                .unwrap_or(true);

        if should_issue_move {
            let action = if self.view.sticky_combat_target == Some(target_guid) {
                "refreshing"
            } else {
                "starting"
            };
            log::info!(
                "sticky melee: {} pursuit for target 0x{:08X} at {:.2}m (limit {:.2}m)",
                action,
                target_guid.0,
                distance,
                max_follow_distance
            );
            result.commands.push(ClientCommand::ApproachTarget {
                target: target_guid,
                arrival_distance: MELEE_ATTACK_DISTANCE,
            });
            self.view.sticky_combat_target = Some(target_guid);
            self.view.last_sticky_move_at = Some(now);
        }
    }

    fn sticky_melee_decision(&self) -> StickyMeleeDecision {
        if self.data.combat_mode != CombatMode::Melee {
            return StickyMeleeDecision::Stop {
                reason: "not in melee mode",
                clear_target: true,
            };
        }

        if self.data.combat_runtime.attack_activity(self.data.combat_mode).is_none() {
            return StickyMeleeDecision::Stop {
                reason: "no active or queued melee attack",
                clear_target: true,
            };
        }

        let Some(target_guid) = self.current_target_guid() else {
            return StickyMeleeDecision::Stop {
                reason: "no combat target selected",
                clear_target: true,
            };
        };

        if !self.is_valid_combat_target(target_guid) {
            return StickyMeleeDecision::Stop {
                reason: "target is no longer a valid combat target",
                clear_target: true,
            };
        }

        let Some(player_pos) = self.data.player_pos else {
            return StickyMeleeDecision::Stop {
                reason: "player position is unavailable",
                clear_target: true,
            };
        };

        let Some(target) = self.data.entities.get(&target_guid) else {
            return StickyMeleeDecision::Stop {
                reason: "target entity is unavailable",
                clear_target: true,
            };
        };

        let max_follow_distance = if self.view.sticky_combat_target == Some(target_guid) {
            MELEE_REPEAT_DISTANCE
        } else {
            MELEE_STICKY_DISTANCE
        };
        let distance = player_pos.distance_to(&target.position);

        if distance <= MELEE_ATTACK_DISTANCE || distance > max_follow_distance {
            return StickyMeleeDecision::Stop {
                reason: if distance <= MELEE_ATTACK_DISTANCE {
                    "already back in melee range"
                } else {
                    "target moved beyond sticky follow range"
                },
                clear_target: distance > max_follow_distance,
            };
        }

        StickyMeleeDecision::Follow {
            target_guid,
            distance,
            max_follow_distance,
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
    /// Current combat target we are locally sticking to with MoveTo.
    pub sticky_combat_target: Option<Guid>,
    /// Last time we refreshed sticky combat movement.
    pub last_sticky_move_at: Option<Instant>,
    /// Last time we sent an attack request for the current desired combat interaction.
    pub last_attack_heartbeat_at: Option<Instant>,
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
            sticky_combat_target: None,
            last_sticky_move_at: None,
            last_attack_heartbeat_at: None,
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

        state
            .data
            .entities
            .insert(target_guid, creature_entity(target_guid, "Drudge", target_position));
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

        state
            .data
            .entities
            .insert(target_guid, creature_entity(target_guid, "Tusker", target_position));

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
        assert_eq!(state.data.combat_controls.attack_height, AttackHeight::Medium);

        state.handle_action(AppAction::CycleCombatProfileLevel).unwrap();
        state.handle_action(AppAction::CycleCombatAttackHeight).unwrap();

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
        state
            .data
            .entities
            .insert(target_guid, creature_entity(target_guid, "Drudge", target_position));

        let result = state.handle_action(AppAction::CycleCombatProfileLevel).unwrap();

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
        state
            .data
            .entities
            .insert(target_guid, creature_entity(target_guid, "Tusker", target_position));

        let result = state.handle_action(AppAction::CycleCombatAttackHeight).unwrap();

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

        assert!(matches!(result.commands.first(), Some(ClientCommand::CancelAttack)));
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

        assert!(result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack)));
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
        state
            .data
            .entities
            .insert(target_guid, creature_entity(target_guid, "Drudge", target_position));

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

        assert!(result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack)));
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

        state.data.combat_runtime.attack_queued = true;
        state.data.combat_runtime.attack_sequence_active = false;
        state.view.last_attack_heartbeat_at =
            Some(Instant::now() - ATTACK_HEARTBEAT_INTERVAL);

        let result = state.handle_tick(0.016);

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

        assert!(!cancelled.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { .. })
        }));
        assert!(!state.data.combat_runtime.attack_queued);

        state.data.combat_mode = CombatMode::Melee;
        state.view.last_attack_heartbeat_at =
            Some(Instant::now() - ATTACK_HEARTBEAT_INTERVAL);

        let retry = state.handle_tick(0.016);

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

        assert!(result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack)));
        assert!(!result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack { .. } | ClientCommand::TargetedMissileAttack { .. }
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
        state
            .data
            .entities
            .insert(target_guid, creature_entity(target_guid, "Drudge", target_position));

        let result = state.handle_tick(0.016);

        assert!(result
            .commands
            .iter()
            .any(|command| {
                matches!(
                    command,
                    ClientCommand::ApproachTarget {
                        target,
                        arrival_distance,
                    } if *target == target_guid
                        && (*arrival_distance - MELEE_ATTACK_DISTANCE).abs() < f32::EPSILON
                )
            }));
        assert_eq!(state.view.sticky_combat_target, Some(target_guid));
    }

    #[test]
    fn cancelled_attack_stops_sticky_melee_follow() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });
        state.view.sticky_combat_target = Some(target_guid);
        state.view.last_sticky_move_at = Some(Instant::now() - STICKY_MOVE_REISSUE_INTERVAL);
        state.data.combat_runtime.attack_sequence_active = true;

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(1.5, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state
            .data
            .entities
            .insert(target_guid, creature_entity(target_guid, "Drudge", target_position));

        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)));
        assert!(result
            .commands
            .iter()
            .any(|command| {
                matches!(
                    command,
                    ClientCommand::ApproachTarget {
                        target,
                        arrival_distance,
                    } if *target == target_guid
                        && (*arrival_distance - MELEE_ATTACK_DISTANCE).abs() < f32::EPSILON
                )
            }));
        assert_eq!(state.view.sticky_combat_target, Some(target_guid));
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
        state
            .data
            .entities
            .insert(target_guid, creature_entity(target_guid, "Drudge", target_position));

        let _ = state.handle_action(AppAction::CancelInteraction).unwrap();

        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(!result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack { .. } | ClientCommand::ApproachTarget { .. }
            )
        }));
        assert_eq!(state.view.active_interaction, None);
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
        state.view.sticky_combat_target = Some(target_guid);
        state.view.last_sticky_move_at = Some(Instant::now() - STICKY_MOVE_REISSUE_INTERVAL);

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(0.5, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        state.data.entities.insert(target_guid, target.clone());

        let in_range = state.handle_tick(0.016);

        assert!(in_range
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::StopMoving)));
        assert_eq!(state.view.sticky_combat_target, Some(target_guid));
        assert_eq!(state.view.last_sticky_move_at, None);

        target.position.coords = holtburger_common::Vector3::new(6.0, 0.0, 0.0);
        state.data.entities.insert(target_guid, target);

        let slipped_again = state.handle_tick(0.016);

        assert!(slipped_again
            .commands
            .iter()
            .any(|command| {
                matches!(
                    command,
                    ClientCommand::ApproachTarget {
                        target,
                        arrival_distance,
                    } if *target == target_guid
                        && (*arrival_distance - MELEE_ATTACK_DISTANCE).abs() < f32::EPSILON
                )
            }));
        assert_eq!(state.view.sticky_combat_target, Some(target_guid));
        assert!(state.view.last_sticky_move_at.is_some());
    }
}
