use holtburger_common::Guid;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::controllers::{
    CombatAutomationController, CombatAutomationEffect, CombatAutomationInput, Controller,
    DesiredAttackProfile, TargetedAttackRequest,
};
use holtburger_core::client::movement_types::PlayerDriveIntent;
#[cfg(test)]
use holtburger_core::client::movement_types::{Locomotion, MotionState, Turn};
use holtburger_core::client::types::ClientCommand;
use holtburger_core::client::types::{
    ActiveCharacterConfirmation, BusyOperationKind, CombatFeedback,
};
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;
#[cfg(test)]
use holtburger_world::stats::{Skill, SkillType, TrainingLevel};
#[cfg(test)]
use holtburger_world::{PlayerMotionTableSource, SelfMovementKinematics};
use ratatui::layout::Rect;
use ratatui::text::Line;
use std::fs::File;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::navigation::{
    NavigationInput, NavigationInteractionChange, NavigationSnapshot, NavigationTick,
    NavigationUpdate, ResolvedNavigationTarget, TuiNavigation,
};
#[cfg(test)]
use crate::navigation::{NavigationMode, NavigationSyncInput};
use crate::pages::game::GameData;
use crate::pages::game::layout::LayoutMode;
use crate::pages::game::panels::chat::ChatState;
use crate::pages::game::panels::chat_input::ChatInputState;
use crate::pages::game::panels::context::build_context_panel_content;
use crate::pages::game::panels::dashboard::DashboardState;
use crate::pages::game::weapon_swap::{WeaponSwapController, WeaponSwapEffect, WeaponSwapInput};
use crate::types::{
    AppAction, AppUiAction, ChatMessageKind, ContextView, DashboardTab, FocusedPane, InspectTarget,
    Interaction, RedrawPriority, UpdateResult,
};
use holtburger_common::properties::WorldObjectExt as _;

#[derive(Default)]
pub struct GameState {
    pub data: GameData,
    pub dashboard: DashboardState,
    pub view: ViewState,
    runtime: GameRuntimeState,
    render_state: GameRenderState,
    pub chat: ChatState,
    pub chat_input: ChatInputState,
}

const INVENTORY_NOTIFICATION_ARM_DELAY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum InventoryNotificationState {
    #[default]
    Uninitialized,
    QuietUntil(Instant),
    Armed,
}

impl InventoryNotificationState {
    fn is_armed(self) -> bool {
        matches!(self, Self::Armed)
    }

    fn begin_quiet_period(&mut self, now: Instant) {
        *self = Self::QuietUntil(now + INVENTORY_NOTIFICATION_ARM_DELAY);
    }

    fn extend_quiet_period(&mut self, now: Instant) {
        if !self.is_armed() {
            *self = Self::QuietUntil(now + INVENTORY_NOTIFICATION_ARM_DELAY);
        }
    }

    fn sync(&mut self, now: Instant) {
        if matches!(self, Self::QuietUntil(arm_at) if now >= *arm_at) {
            *self = Self::Armed;
        }
    }
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
    pub(super) fn mark_fellowship_invite_accepted(&mut self) {
        self.runtime.open_party_tab_on_next_fellowship_update = true;
    }

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
            runtime: GameRuntimeState::default(),
            render_state: GameRenderState::default(),
            chat: ChatState::new(chat_log),
            chat_input: ChatInputState::default(),
        }
    }

    pub(super) fn main_chunks(&self) -> std::rc::Rc<Vec<Rect>> {
        std::rc::Rc::clone(&self.render_state.layout_cache.main_chunks)
    }

    pub(super) fn layout_mode(&self) -> LayoutMode {
        self.render_state.layout_cache.mode
    }

    pub(super) fn set_layout_cache(
        &mut self,
        main_chunks: Vec<Rect>,
        dynamic_chunk: Rect,
        mode: LayoutMode,
    ) {
        self.render_state.layout_cache.main_chunks = std::rc::Rc::new(main_chunks);
        self.render_state.layout_cache.dynamic_chunk = dynamic_chunk;
        self.render_state.layout_cache.mode = mode;
    }

    pub(super) fn context_buffer(&self) -> &[Line<'static>] {
        &self.render_state.context_buffer
    }

    pub(super) fn context_buffer_len(&self) -> usize {
        self.render_state.context_buffer.len()
    }

    pub(super) fn live_context_buffer(&self) -> Option<Vec<Line<'static>>> {
        match self.view.context_view {
            ContextView::Debug(InspectTarget::Entity(_)) => {
                Some(build_context_panel_content(&self.data, &self.view))
            }
            _ => None,
        }
    }

    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        let now = Instant::now();
        let navigation_interrupt = self.navigation_interrupt_for_view_event(&event);
        self.data.runtime_body_cache.apply_view_event(&event, now);
        match event {
            ClientViewEvent::LogMessage(_)
            | ClientViewEvent::ServerMessage { .. }
            | ClientViewEvent::Chat { .. }
            | ClientViewEvent::FellowshipActivity { .. }
            | ClientViewEvent::ChannelMessage { .. }
            | ClientViewEvent::Tell { .. }
            | ClientViewEvent::Emote { .. }
            | ClientViewEvent::PingResponse
            | ClientViewEvent::BootAccount(_)
            | ClientViewEvent::NetPulse { .. }
            | ClientViewEvent::Disconnected => {
                self.chat
                    .handle_event(event, self.data.character_name.as_deref());
            }
            ClientViewEvent::CombatFeedback(feedback) => {
                result.merge(self.handle_combat_feedback(&feedback));
                self.chat.handle_event(
                    ClientViewEvent::CombatFeedback(feedback),
                    self.data.character_name.as_deref(),
                );
                result.request_redraw(RedrawPriority::Immediate);
            }
            ClientViewEvent::PlayerEnchantmentsUpdated { .. }
            | ClientViewEvent::PlayerStatsSkillsUpdated { .. }
            | ClientViewEvent::PlayerLevelInfoUpdated { .. }
            | ClientViewEvent::PlayerVitalsUpdated { .. }
            | ClientViewEvent::PlayerSpellsUpdated { .. }
            | ClientViewEvent::PlayerOptionsUpdated { .. }
            | ClientViewEvent::ActiveCharacterConfirmationUpdated { .. }
            | ClientViewEvent::BusyStateUpdated { .. }
            | ClientViewEvent::CombatModeUpdated { .. } => {
                self.handle_player_event(event);
                self.sync_weapon_swap_controller(Instant::now(), &mut result);
                result.request_redraw(RedrawPriority::Immediate);
            }
            ClientViewEvent::BusyOperationFinished { .. } => {
                result.request_redraw(RedrawPriority::Immediate);
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
                self.refresh_entity_context_if_visible(entity_ref.guid, &mut result);
                if self.update_inventory_and_equipment(entity_ref) {
                    result.request_redraw(RedrawPriority::Immediate);
                }
                self.sync_weapon_swap_controller(now, &mut result);
            }
            ClientViewEvent::EntityReplaced { entity } => {
                let entity_ref = entity.as_ref();
                self.data
                    .entities
                    .insert(entity_ref.guid, entity_ref.clone());
                self.refresh_entity_context_if_visible(entity_ref.guid, &mut result);
                if self.update_inventory_and_equipment(entity_ref) {
                    result.request_redraw(RedrawPriority::Immediate);
                }
                self.sync_weapon_swap_controller(now, &mut result);
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
                    self.refresh_entity_context_if_visible(guid, &mut result);
                    if self.update_inventory_and_equipment(&entity) {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                    self.sync_weapon_swap_controller(now, &mut result);
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
                self.refresh_entity_context_if_visible(guid, &mut result);
                result.request_redraw(RedrawPriority::Motion);
            }
            ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity,
                omega,
            } => {
                if let Some(entity) = self.data.entities.get_mut(&guid) {
                    entity.velocity = velocity;
                    entity.omega = omega;
                    self.refresh_entity_context_if_visible(guid, &mut result);
                    result.request_redraw(RedrawPriority::Motion);
                }
            }
            ClientViewEvent::EntityMotionUpdated { guid, snapshot } => {
                if let Some(entity) = self.data.entities.get_mut(&guid) {
                    entity.motion_snapshot = snapshot;
                    self.refresh_entity_context_if_visible(guid, &mut result);
                    result.request_redraw(RedrawPriority::Motion);
                }
            }
            ClientViewEvent::PlayerGroundedUpdated { grounded } => {
                self.data.player_grounded = Some(grounded);
            }
            ClientViewEvent::SelfMovementKinematicsUpdated { kinematics } => {
                self.data.self_movement_kinematics = kinematics;
            }
            ClientViewEvent::RuntimeBodySnapshot { .. } => {
                self.refresh_context_buffer();
                result.request_redraw(RedrawPriority::Immediate);
            }
            ClientViewEvent::RuntimeBodyUpserted { body } => {
                if let Some(guid) = body.body_id.authoritative_guid() {
                    self.refresh_entity_context_if_visible(guid, &mut result);
                }
                result.request_redraw(RedrawPriority::Motion);
            }
            ClientViewEvent::RuntimeBodyRemoved { body_id } => {
                if let Some(guid) = body_id.authoritative_guid() {
                    self.refresh_entity_context_if_visible(guid, &mut result);
                }
                result.request_redraw(RedrawPriority::Immediate);
            }
            ClientViewEvent::RuntimeBodiesReset { .. } => {
                self.refresh_context_buffer();
                result.request_redraw(RedrawPriority::Immediate);
            }
            ClientViewEvent::ForcedReposition { guid, pos, .. } => {
                let is_player_move = Some(guid) == self.data.player_guid;
                if let Some(entity) = self.data.entities.get_mut(&guid) {
                    entity.position = pos;
                    if is_player_move {
                        self.data.player_pos = Some(pos);
                    }
                }
                self.refresh_entity_context_if_visible(guid, &mut result);
                result.request_redraw(RedrawPriority::Immediate);
            }
            ClientViewEvent::TeleportStarted { .. } => {}
            ClientViewEvent::EntityDespawned { guid } => {
                result.merge(self.handle_entity_removed(guid));
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
                    && let Some((last_time, target_guid)) = self.runtime.last_trade_initiation
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
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            ClientViewEvent::FellowshipStateUpdated { fellowship } => {
                let should_open_party_tab =
                    fellowship.is_some() && self.runtime.open_party_tab_on_next_fellowship_update;

                self.runtime.open_party_tab_on_next_fellowship_update = false;

                self.data.party = fellowship;
                if should_open_party_tab {
                    result.actions.push(AppAction::UiAction {
                        action: AppUiAction::SetDashboardActiveTab(DashboardTab::Party),
                    });
                }
                result.request_redraw(RedrawPriority::Immediate);
            }
            ClientViewEvent::TradeStateUpdated { trade } => {
                let partner_guid = trade.as_ref().map(|t| t.partner_side.guid);
                // Cancel vendor session.
                self.view.vendor = None;
                self.data.trade = trade;
                // If we just opened a trade and we initiated it, switch to Trade tab.
                if let Some(p_guid) = partner_guid
                    && let Some((last_time, target_guid)) = self.runtime.last_trade_initiation
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
                if self.update_inventory_and_equipment(entity_ref) {
                    result.request_redraw(RedrawPriority::Immediate);
                }
                self.handle_entity_identified(entity_ref);
                self.sync_weapon_swap_controller(now, &mut result);
                result.request_redraw(RedrawPriority::Immediate);
            }
            ClientViewEvent::NoClipUpdated { .. } => {
                result.merge(self.handle_navigation_event(event));
            }
            ClientViewEvent::ContainerOpened { guid } => {
                self.data.track_container_opened(guid);
            }
            ClientViewEvent::ContainerClosed { guid } => {
                self.data.track_container_closed(guid);
            }
            _ => {}
        }

        if let Some(input) = navigation_interrupt {
            self.handle_navigation_interrupt(input, &mut result);
        }

        result
    }

    pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult> {
        let mut result = UpdateResult::new();
        let navigation_input = self.navigation_input_for_app_action(&action);
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
            AppAction::Read { guid } => {
                result.commands.push(ClientCommand::Use(guid));
                result.merge(
                    self.handle_action(AppAction::ChangeContextView {
                        view: ContextView::Book(guid),
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
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            AppAction::UnqueueSalvageItem { guid } => {
                if let Some(session) = self.view.salvaging.as_mut() {
                    session
                        .queued_items
                        .retain(|queued_guid| *queued_guid != guid);

                    if session.queued_items.is_empty() {
                        self.clear_active_interaction(&mut result);
                        self.view.salvaging = None;
                    }
                    result.request_redraw(RedrawPriority::Immediate);
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
                self.clear_active_interaction(&mut result);
                self.view.salvaging = None;
                result.request_redraw(RedrawPriority::Immediate);
            }
            AppAction::Approach { .. } | AppAction::Follow { .. } | AppAction::Scoot { .. } => {
                self.apply_navigation_input(
                    navigation_input
                        .expect("navigation actions should project to navigation input"),
                    &mut result,
                );
            }
            AppAction::Drop { guid } => {
                result.commands.push(ClientCommand::Drop(guid));
            }
            AppAction::Equip { guid } => {
                if self.runtime.weapon_swap.is_active() {
                    result.actions.push(AppAction::Log {
                        kind: ChatMessageKind::Warning,
                        message: "Already waiting on a weapon swap.".to_string(),
                    });
                } else {
                    self.handle_equip_request(guid, None, &mut result);
                }
            }
            AppAction::EquipInSlot { guid, slot } => {
                if self.runtime.weapon_swap.is_active() {
                    result.actions.push(AppAction::Log {
                        kind: ChatMessageKind::Warning,
                        message: "Already waiting on a weapon swap.".to_string(),
                    });
                } else {
                    self.handle_equip_request(guid, Some(slot), &mut result);
                }
            }
            AppAction::Unequip { guid } => {
                if let Some(container) = self.data.find_non_full_pack(guid, None) {
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
            AppAction::InviteToParty { target } => {
                result
                    .commands
                    .push(ClientCommand::InviteToParty { target });
            }
            AppAction::UninviteFromParty { target } => {
                result
                    .commands
                    .push(ClientCommand::UninviteFromParty { target });
            }
            AppAction::SwearAllegiance { target } => {
                result
                    .commands
                    .push(ClientCommand::SwearAllegiance { target });
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
                        self.runtime.last_trade_initiation = Some((Instant::now(), guid));
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
                    result.actions.push(AppAction::Log {
                        kind: ChatMessageKind::Warning,
                        message: "You are currently in a trade.".to_string(),
                    });
                } else {
                    self.runtime.last_trade_initiation = Some((Instant::now(), vendor));
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
                self.clear_active_interaction(&mut result);
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
                result.request_redraw(RedrawPriority::Immediate);
            }
            AppAction::CycleCombatAttackHeight => {
                self.data.combat_controls.cycle_attack_height();
                self.queue_auto_attack_for_mode(self.data.combat_mode, &mut result);
                result.request_redraw(RedrawPriority::Immediate);
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
                if let Some(container_id) =
                    self.data.find_non_full_pack(guid, preferred_container_id)
                {
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
                result.request_redraw(RedrawPriority::Immediate);
                self.refresh_context_buffer();
            }
            AppAction::BeginInteraction { interaction } => {
                if interaction == Interaction::Salvaging {
                    if let Some(input) = navigation_input {
                        self.apply_navigation_input(input, &mut result);
                    }
                    if !self.reset_salvaging_state(&mut result) {
                        return Some(result);
                    }
                } else {
                    if let Some(input) = navigation_input {
                        self.apply_navigation_input(input, &mut result);
                    }
                    self.set_active_interaction(Some(interaction), &mut result);
                }
                result.request_redraw(RedrawPriority::Immediate);
            }
            AppAction::CancelInteraction => {
                if let Some(input) = navigation_input {
                    self.apply_navigation_input(input, &mut result);
                } else {
                    self.clear_active_interaction(&mut result);
                }
                self.view.salvaging = None;
                result.request_redraw(RedrawPriority::Immediate);
            }
            AppAction::ClearVendor => {
                self.view.vendor = None;
                result.request_redraw(RedrawPriority::Immediate);
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

        Some(result)
    }

    pub fn handle_ui_action(&mut self, action: AppUiAction) -> UpdateResult {
        self.dashboard
            .handle_ui_action(action, &self.data, &self.view)
            .unwrap_or_default()
    }

    pub fn handle_tick(&mut self, elapsed: f64) -> UpdateResult {
        let mut result = UpdateResult::new();
        let now = Instant::now();
        self.sync_inventory_notification_arming(now);

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
            result.request_redraw(RedrawPriority::Immediate);
        }

        // Update enchantment timers locally
        for enchant in &mut self.data.player_enchantments {
            if enchant.duration >= 0.0 {
                enchant.start_time -= elapsed;
            }
        }

        self.refresh_stale_attack_sequence(now, &mut result);
        self.sync_weapon_swap_controller(now, &mut result);

        let update = self
            .runtime
            .navigation
            .tick(self.navigation_tick(now, elapsed));
        self.apply_navigation_update(update, &mut result);

        result
    }

    pub fn refresh_context_buffer(&mut self) {
        if self.view.context_view == crate::types::ContextView::Default {
            self.render_state.context_buffer.clear();
            return;
        }
        let content = build_context_panel_content(&self.data, &self.view);
        self.render_state.context_buffer = content;
    }

    pub(crate) fn handle_player_event(&mut self, event: ClientViewEvent) {
        match event {
            ClientViewEvent::PlayerEnchantmentsUpdated { enchantments } => {
                self.data.player_enchantments = enchantments;
            }
            ClientViewEvent::PlayerStatsSkillsUpdated {
                attributes,
                skills,
                resistances,
                armor,
                vitae,
            } => {
                self.data.attributes = attributes;
                self.data.skills = skills;
                self.data.resistances = resistances;
                self.data.armor = armor;
                self.data.vitae = vitae;
            }
            ClientViewEvent::PlayerLevelInfoUpdated { level_info } => {
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
            ClientViewEvent::PlayerOptionsUpdated { options } => {
                self.data.player_options = Some(options);
            }
            ClientViewEvent::ActiveCharacterConfirmationUpdated { confirmation } => {
                self.view.active_confirmation = confirmation;
            }
            ClientViewEvent::BusyStateUpdated { busy } => {
                self.view.active_busy_operation = busy;
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
                    self.runtime.combat_automation = None;
                }
            }
            ClientViewEvent::StatusUpdate { state } => {
                if matches!(state, holtburger_core::client::types::ClientState::InWorld) {
                    self.runtime
                        .inventory_notifications
                        .begin_quiet_period(Instant::now());
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
            && self.should_rearm_sticky_auto_attack()
    }

    fn should_rearm_sticky_auto_attack(&self) -> bool {
        let Some(target_guid) = self.current_target_guid() else {
            return false;
        };

        self.data.combat_target_status(target_guid).is_available() && !self.player_is_dead()
    }

    fn player_is_dead(&self) -> bool {
        let Some(player_guid) = self.data.player_guid else {
            return false;
        };

        self.data
            .entities
            .get(&player_guid)
            .and_then(|entity| entity.motion_snapshot)
            .is_some_and(|snapshot| snapshot.indicates_death_motion())
    }

    pub(crate) fn toggled_combat_mode(&self) -> CombatMode {
        if self.data.combat_mode != CombatMode::NonCombat {
            CombatMode::NonCombat
        } else {
            self.data.get_suggested_combat_mode()
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
        if Self::is_frontend_navigation_interaction(self.view.active_interaction) {
            let update = self.runtime.navigation.handle_input(
                NavigationInput::Cancel,
                self.navigation_snapshot(self.navigation_tick_target_guid()),
            );
            self.apply_navigation_update(update, result);
            return;
        }

        self.set_active_interaction(None, result);
    }

    fn set_active_interaction(
        &mut self,
        next_interaction: Option<Interaction>,
        result: &mut UpdateResult,
    ) {
        let previous_interaction = self.view.active_interaction;
        self.view.active_interaction = next_interaction;

        self.sync_target_health_query(previous_interaction, next_interaction, result);

        if self.should_cancel_attack(previous_interaction, next_interaction) {
            result.commands.push(ClientCommand::CancelAttack);
            self.data.combat_runtime.cancel_attack();
            self.runtime.combat_automation = None;
        }

        if self.should_resume_attack(previous_interaction, next_interaction) {
            self.queue_auto_attack_for_mode(self.data.combat_mode, result);
        }
    }

    fn is_frontend_navigation_interaction(interaction: Option<Interaction>) -> bool {
        matches!(
            interaction,
            Some(Interaction::Approaching { .. }) | Some(Interaction::Following { .. })
        )
    }

    fn sync_target_health_query(
        &self,
        previous_interaction: Option<Interaction>,
        next_interaction: Option<Interaction>,
        result: &mut UpdateResult,
    ) {
        let previous_target = match previous_interaction {
            Some(Interaction::Targeting { target_guid }) => Some(target_guid),
            _ => None,
        };
        let next_target = match next_interaction {
            Some(Interaction::Targeting { target_guid }) => Some(target_guid),
            _ => None,
        };

        if previous_target == next_target {
            return;
        }

        match next_target {
            Some(target_guid) => result
                .commands
                .push(ClientCommand::QueryHealth(target_guid)),
            None if previous_target.is_some() => {
                result.commands.push(ClientCommand::QueryHealth(Guid::NULL))
            }
            None => {}
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
                | Some(Interaction::Approaching { .. })
                | Some(Interaction::Following { .. })
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
                    | Some(Interaction::Approaching { .. })
                    | Some(Interaction::Following { .. })
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
            self.runtime.combat_automation = None;
            return;
        };

        let update = self
            .runtime
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
        if self.player_is_dead() {
            return None;
        }

        let target_guid = self.current_target_guid()?;
        let attack_profile = self.desired_attack_profile(mode)?;
        let target_position = self.runtime.navigation.automation_target_position(
            self.data.runtime_player_position(),
            self.data.runtime_position_for_guid(target_guid),
        );

        Some(CombatAutomationInput::Tick {
            now,
            target_guid,
            target_available: self.is_valid_combat_target(target_guid),
            player_position: self.data.runtime_player_position(),
            target_position,
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
                result.request_redraw(RedrawPriority::Immediate);
                result
                    .commands
                    .push(ClientCommand::DriveSelf(PlayerDriveIntent::SnapFacing {
                        heading,
                    }));
            }
            CombatAutomationEffect::Attack(request) => {
                self.data.combat_runtime.queue_attack();
                result.request_redraw(RedrawPriority::Immediate);
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

    fn navigation_snapshot(&self, target_guid: Option<Guid>) -> NavigationSnapshot {
        let target_entity = target_guid.and_then(|guid| self.data.entities.get(&guid));
        let target_sample = target_guid.and_then(|guid| self.data.runtime_sample_for_guid(guid));
        let target_use_radius = target_entity
            .and_then(|entity| entity.use_radius())
            .map(|radius| radius as f32);
        NavigationSnapshot {
            player_position: self.data.runtime_player_position(),
            self_movement_kinematics: self.data.self_movement_kinematics.clone(),
            run_rate_scalar: self.data.player_run_rate(),
            combat_target_guid: self.current_target_guid(),
            combat_mode: self.data.combat_mode,
            attack_sequence_active: self
                .data
                .combat_runtime
                .attack_activity(self.data.combat_mode)
                .is_some(),
            tracked_target: target_guid.zip(target_sample).map(|(guid, sample)| {
                ResolvedNavigationTarget {
                    guid,
                    sample,
                    use_radius: target_use_radius,
                }
            }),
        }
    }

    fn navigation_tick(&self, now: Instant, elapsed: f64) -> NavigationTick {
        NavigationTick {
            now,
            dt: Duration::from_secs_f64(elapsed.max(0.0)),
            snapshot: self.navigation_snapshot(self.navigation_tick_target_guid()),
        }
    }

    fn navigation_tick_target_guid(&self) -> Option<Guid> {
        self.runtime.navigation.tracked_target_guid().or_else(|| {
            self.current_target_guid()
                .filter(|guid| self.is_valid_combat_target(*guid))
        })
    }

    fn apply_navigation_update(&mut self, update: NavigationUpdate, result: &mut UpdateResult) {
        if let Some(command) = update.drive_command {
            result.commands.push(ClientCommand::DriveSelf(command));
        }

        match update.interaction_change {
            NavigationInteractionChange::Unchanged => {}
            NavigationInteractionChange::Set(next_interaction) => {
                self.set_active_interaction(next_interaction, result);
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
    }

    fn apply_navigation_input(&mut self, input: NavigationInput, result: &mut UpdateResult) {
        let target_guid = match input {
            NavigationInput::StartApproach { target } | NavigationInput::StartFollow { target } => {
                Some(target)
            }
            NavigationInput::StartScoot { .. } => None,
            NavigationInput::Cancel
            | NavigationInput::ForcedReposition
            | NavigationInput::TeleportStarted => self.navigation_tick_target_guid(),
        };

        let update = self
            .runtime
            .navigation
            .handle_input(input, self.navigation_snapshot(target_guid));
        self.apply_navigation_update(update, result);
    }

    fn navigation_input_for_app_action(&self, action: &AppAction) -> Option<NavigationInput> {
        match action {
            AppAction::Approach { guid } => Some(NavigationInput::StartApproach { target: *guid }),
            AppAction::Follow { guid } => Some(NavigationInput::StartFollow { target: *guid }),
            AppAction::Scoot { distance_m } => Some(NavigationInput::StartScoot {
                distance_m: *distance_m,
            }),
            AppAction::CancelInteraction
                if Self::is_frontend_navigation_interaction(self.view.active_interaction) =>
            {
                Some(NavigationInput::Cancel)
            }
            AppAction::BeginInteraction { interaction }
                if Self::is_frontend_navigation_interaction(self.view.active_interaction)
                    && !Self::is_frontend_navigation_interaction(Some(*interaction)) =>
            {
                Some(NavigationInput::Cancel)
            }
            _ => None,
        }
    }

    fn navigation_interrupt_for_view_event(
        &self,
        event: &ClientViewEvent,
    ) -> Option<NavigationInput> {
        match event {
            ClientViewEvent::ForcedReposition { guid, .. }
                if Some(*guid) == self.data.player_guid =>
            {
                Some(NavigationInput::ForcedReposition)
            }
            ClientViewEvent::TeleportStarted { .. } => Some(NavigationInput::TeleportStarted),
            _ => None,
        }
    }

    fn handle_navigation_interrupt(&mut self, input: NavigationInput, result: &mut UpdateResult) {
        self.apply_navigation_input(input, result);

        if input != NavigationInput::TeleportStarted {
            return;
        }

        if matches!(
            self.view.active_interaction,
            Some(Interaction::Approaching { .. }) | Some(Interaction::Following { .. })
        ) {
            self.view.active_interaction = None;
            result.request_redraw(RedrawPriority::Immediate);
        }

        if matches!(
            self.view.active_interaction,
            Some(Interaction::Targeting { .. })
        ) {
            if matches!(
                self.data.combat_mode,
                CombatMode::Melee | CombatMode::Missile
            ) {
                result.commands.push(ClientCommand::CancelAttack);
                self.data.combat_runtime.cancel_attack();
                self.runtime.combat_automation = None;
            }
            self.view.active_interaction = None;
            result.request_redraw(RedrawPriority::Immediate);
        }
    }

    fn current_target_guid(&self) -> Option<Guid> {
        match self.view.active_interaction {
            Some(Interaction::Targeting { target_guid }) => Some(target_guid),
            _ => None,
        }
    }

    fn is_valid_combat_target(&self, target_guid: Guid) -> bool {
        if !self.data.entities.contains_key(&target_guid) {
            return false;
        }

        if self
            .runtime
            .navigation
            .automation_target_position(
                self.data.runtime_player_position(),
                self.data.runtime_position_for_guid(target_guid),
            )
            .is_none()
        {
            return false;
        }

        self.data.combat_target_status(target_guid).is_available()
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

    fn handle_equip_request(
        &mut self,
        guid: Guid,
        slot: Option<holtburger_core::client::types::TargetSlot>,
        result: &mut UpdateResult,
    ) {
        self.drive_weapon_swap(
            WeaponSwapInput::Start {
                now: Instant::now(),
                item_guid: guid,
                slot,
                current_mode: self.data.combat_mode,
                item_mask: self
                    .data
                    .entities
                    .get(&guid)
                    .map(|entity| entity.valid_locations()),
            },
            result,
        );
    }

    fn sync_weapon_swap_controller(&mut self, now: Instant, result: &mut UpdateResult) {
        let Some(item_guid) = self.runtime.weapon_swap.tracked_item_guid() else {
            return;
        };

        let equipped_mask = self
            .data
            .equipment
            .get(&item_guid)
            .copied()
            .unwrap_or(holtburger_protocol::messages::EquipMask::NONE);
        self.drive_weapon_swap(
            WeaponSwapInput::Tick {
                now,
                combat_mode: self.data.combat_mode,
                equipped_mask,
                suggested_mode: self.data.get_suggested_combat_mode(),
            },
            result,
        );
    }

    fn drive_weapon_swap(&mut self, input: WeaponSwapInput, result: &mut UpdateResult) {
        let update = self.runtime.weapon_swap.handle(&input);
        for effect in update.effects {
            self.apply_weapon_swap_effect(effect, result);
        }
    }

    fn apply_weapon_swap_effect(&mut self, effect: WeaponSwapEffect, result: &mut UpdateResult) {
        match effect {
            WeaponSwapEffect::Command(command) => result.commands.push(command),
        }
    }

    fn update_inventory_and_equipment(&mut self, entity: &Entity) -> bool {
        let guid = entity.guid;
        let was_owned = self.data.is_owned_by_player(guid);
        let should_be_owned = self.should_track_entity_as_owned_by_player(entity);
        let mut logged_inventory_change = false;

        // Handle player position if it's the player entity
        if Some(guid) == self.data.player_guid {
            self.data.player_pos = Some(entity.position);
        }

        if should_be_owned {
            self.delay_inventory_notification_arming();
        }

        // Update inventory tracking
        if should_be_owned != was_owned {
            self.data.update_inventory_recursive(guid, should_be_owned);
        } else if should_be_owned {
            self.data.inventory.insert(guid);
        }

        if should_be_owned {
            if self.runtime.inventory_notifications.is_armed() && !was_owned {
                self.log_inventory_addition(entity);
                logged_inventory_change = true;
            }
        } else {
            if self.runtime.inventory_notifications.is_armed() && was_owned {
                self.log_inventory_removal(entity);
                logged_inventory_change = true;
            }
            // If it's no longer in our inventory/wielded, remove it
            self.data.inventory.remove(&guid);
        }

        // Update equipment tracking
        if self.should_track_entity_as_equipped_by_player(entity) {
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
        logged_inventory_change
    }

    fn should_track_entity_as_owned_by_player(&self, entity: &Entity) -> bool {
        let Some(player_guid) = self.data.player_guid else {
            return false;
        };

        entity.container_id().is_some_and(|container_guid| {
            container_guid == player_guid || self.data.is_in_player_inventory(container_guid)
        }) || self.should_track_entity_as_equipped_by_player(entity)
    }

    fn should_track_entity_as_equipped_by_player(&self, entity: &Entity) -> bool {
        self.data
            .player_guid
            .is_some_and(|player_guid| entity.wielder_id() == Some(player_guid))
    }

    fn log_inventory_addition(&mut self, entity: &Entity) {
        self.log_inventory_change(entity, "Added to inventory");
    }

    fn log_inventory_removal(&mut self, entity: &Entity) {
        self.log_inventory_change(entity, "Removed from inventory");
    }

    fn log_inventory_change(&mut self, entity: &Entity, action: &str) {
        let mut label = if entity.name().is_empty() {
            format!("0x{:08X}", entity.guid.0)
        } else {
            entity.name().to_string()
        };
        let stack_size = entity.stack_size();
        if stack_size > 1 {
            label = format!("{} ({}x)", label, stack_size);
        }
        self.chat
            .log(ChatMessageKind::System, format!("{}: {}", action, label));
    }

    fn delay_inventory_notification_arming(&mut self) {
        self.runtime
            .inventory_notifications
            .extend_quiet_period(Instant::now());
    }

    fn sync_inventory_notification_arming(&mut self, now: Instant) {
        self.runtime.inventory_notifications.sync(now);
    }

    fn handle_entity_removed(&mut self, guid: Guid) -> UpdateResult {
        let mut result = UpdateResult::new();
        let removed_entity = self.data.entities.get(&guid).cloned();
        let was_owned = self.data.is_owned_by_player(guid);
        if self.runtime.inventory_notifications.is_armed()
            && was_owned
            && let Some(entity) = removed_entity.as_ref()
        {
            self.log_inventory_removal(entity);
            result.request_redraw(RedrawPriority::Immediate);
        }
        self.data.update_inventory_recursive(guid, false);
        self.data.entities.remove(&guid);
        self.data.equipment.remove(&guid);
        if matches!(
            self.view.context_view,
            ContextView::Assess(InspectTarget::Entity(target_guid))
                | ContextView::Debug(InspectTarget::Entity(target_guid))
                | ContextView::Book(target_guid)
                if target_guid == guid
        ) {
            self.view.context_view = ContextView::Default;
            self.refresh_context_buffer();
        }
        if matches!(
            self.view.active_interaction,
            Some(Interaction::Targeting { target_guid }) if target_guid == guid
        ) {
            self.clear_active_interaction(&mut result);
        }
        if let Some(session) = self.view.salvaging.as_mut() {
            session
                .queued_items
                .retain(|queued_guid| *queued_guid != guid);
            if session.ust_guid == guid {
                self.view.salvaging = None;
                if self.view.active_interaction == Some(Interaction::Salvaging) {
                    self.clear_active_interaction(&mut result);
                }
            }
        }

        result
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

    fn refresh_entity_context_if_visible(&mut self, guid: Guid, result: &mut UpdateResult) {
        if matches!(
            self.view.context_view,
            ContextView::Assess(InspectTarget::Entity(target_guid))
                | ContextView::Book(target_guid)
                if target_guid == guid
        ) {
            self.refresh_context_buffer();
            result.request_redraw(RedrawPriority::Immediate);
        }
    }
}

#[derive(Debug, Clone)]
pub struct ViewState {
    /// Which area of the screen currently has focus.
    pub focused_pane: FocusedPane,
    /// Previous focus, used for returning from modals.
    pub previous_focused_pane: FocusedPane,
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
    /// Current core-projected confirmation request being surfaced by the game page.
    pub active_confirmation: Option<ActiveCharacterConfirmation>,
    /// Current core-projected busy operation for local action sequencing.
    pub active_busy_operation: Option<BusyOperationKind>,
}

#[derive(Clone, Default)]
struct GameRuntimeState {
    last_trade_initiation: Option<(Instant, Guid)>,
    open_party_tab_on_next_fellowship_update: bool,
    navigation: TuiNavigation,
    combat_automation: Option<CombatAutomationController>,
    weapon_swap: WeaponSwapController,
    inventory_notifications: InventoryNotificationState,
}

#[derive(Debug, Clone, Default)]
struct LayoutCache {
    pub main_chunks: std::rc::Rc<Vec<ratatui::layout::Rect>>,
    pub dynamic_chunk: ratatui::layout::Rect,
    pub mode: LayoutMode,
}

#[derive(Debug, Clone, Default)]
struct GameRenderState {
    context_buffer: Vec<Line<'static>>,
    layout_cache: LayoutCache,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            focused_pane: FocusedPane::Dashboard,
            previous_focused_pane: FocusedPane::Dashboard,
            context_scroll_offset: 0,
            context_view: ContextView::Default,
            vendor: None,
            active_interaction: None,
            salvaging: None,
            active_confirmation: None,
            active_busy_operation: None,
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
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use holtburger_common::ConfirmationType;
    use holtburger_common::Vector3;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ItemType, PropertyBool, PropertyInstanceId, PropertyInt, PropertyString,
        WorldObjectProperties, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_core::ActiveCharacterConfirmation;
    use holtburger_protocol::messages::combat::AttackHeight;
    use holtburger_protocol::messages::object::types::{CreatureProfile, CreatureProfileFlags};
    use holtburger_world::book::{BookData, BookPage};
    use holtburger_world::vendor::{CoreVendorItem, VendorState};
    use holtburger_world::{RuntimeSpatialBodyView, SpatialBodyId, SpatialSampleMode};
    fn is_weapon_swap_active(state: &GameState) -> bool {
        state.runtime.weapon_swap.is_active()
    }

    fn has_active_approach(state: &GameState) -> bool {
        matches!(
            state.runtime.navigation.navigation_mode(),
            Some(NavigationMode::Approach { .. })
        )
    }

    fn is_run_movement_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(MotionState {
                locomotion: Some(Locomotion::Forward),
                ..
            })) | ClientCommand::DriveSelf(PlayerDriveIntent::ManualPulse {
                state: MotionState {
                    locomotion: Some(Locomotion::Forward),
                    ..
                },
                ..
            })
        )
    }

    fn is_turn_movement_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(MotionState {
                locomotion: None,
                turning: Some(Turn::Left | Turn::Right),
                ..
            }))
        )
    }

    fn is_navigation_movement_command(command: &ClientCommand) -> bool {
        is_run_movement_command(command) || is_turn_movement_command(command)
    }

    fn is_navigation_drive_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::Autonomous(_))
                | ClientCommand::DriveSelf(PlayerDriveIntent::ArriveAtPose { .. })
                | ClientCommand::DriveSelf(PlayerDriveIntent::Stop)
        )
    }

    fn has_autonomous_navigation_command(result: &UpdateResult) -> bool {
        result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::DriveSelf(PlayerDriveIntent::Autonomous(_))
            )
        })
    }

    fn has_stop_navigation_command(result: &UpdateResult) -> bool {
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::DriveSelf(PlayerDriveIntent::Stop)))
    }

    fn has_arrival_navigation_command(result: &UpdateResult) -> bool {
        result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::DriveSelf(PlayerDriveIntent::ArriveAtPose { .. })
            )
        })
    }

    fn is_snap_facing_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::SnapFacing { .. })
        )
    }

    fn runtime_body_view(
        body_id: SpatialBodyId,
        authoritative_pose: WorldPosition,
        runtime_pose: WorldPosition,
    ) -> RuntimeSpatialBodyView {
        RuntimeSpatialBodyView {
            body_id,
            authoritative_pose: Some(authoritative_pose),
            runtime_pose,
            velocity: Vector3::zero(),
            omega: Vector3::zero(),
            motion_state: None,
            contact: holtburger_world::ContactState::Grounded,
            sample_mode: SpatialSampleMode::SimulatingMotionState,
        }
    }

    fn seed_navigation_motion_model(state: &mut GameState) {
        state.data.self_movement_kinematics = Some(SelfMovementKinematics {
            source: PlayerMotionTableSource::DirectProperty {
                motion_table_id: 0x0900_0020,
            },
            motion_table_id: 0x0900_0020,
            stance: 0x8000_003D,
            base_walk_forward_velocity: Vector3::new(1.0, 0.0, 0.0),
            base_run_forward_velocity: Vector3::new(2.0, 0.0, 0.0),
            base_turn_left_omega: Vector3::new(0.0, 0.0, -1.5),
            base_turn_right_omega: Vector3::new(0.0, 0.0, 1.5),
        });
        state.data.skills.insert(
            SkillType::Run,
            Skill {
                skill_type: SkillType::Run,
                ranks: 0,
                init: 300,
                spent_xp: 0,
                next_rank_xp: None,
                base: 300,
                current: 300,
                training: TrainingLevel::Trained,
                trained_cost: 0,
                specialized_cost: 0,
            },
        );
    }

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
    fn book_response_refreshes_visible_context_and_requests_redraw() {
        let player_guid = Guid(0x50000001);
        let book_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        state.data.entities.insert(
            book_guid,
            Entity::new(book_guid, "Journal".to_string(), WorldPosition::default()),
        );
        state.view.context_view = ContextView::Book(book_guid);
        state.refresh_context_buffer();

        assert!(context_buffer_contains(
            state.context_buffer(),
            "Reading..."
        ));

        let mut book_entity =
            Entity::new(book_guid, "Journal".to_string(), WorldPosition::default());
        book_entity.book = Some(BookData {
            author_name: Some("Scribe".to_string()),
            pages: vec![BookPage {
                index: 0,
                author_id: 1,
                author_name: "Scribe".to_string(),
                author_account: "acct".to_string(),
                flags: 0,
                text_included: true,
                ignore_author: false,
                page_text: Some("Hello from the book".to_string()),
            }],
            ..BookData::default()
        });

        let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
            entity: Box::new(book_entity),
        });

        assert!(result.redraw_requested());
        assert!(context_buffer_contains(
            state.context_buffer(),
            "Hello from the book"
        ));
        assert!(context_buffer_contains(
            state.context_buffer(),
            "       --  Scribe"
        ));
    }

    #[test]
    fn read_action_uses_generic_use_command_for_books() {
        let player_guid = Guid(0x50000001);
        let book_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let result = state
            .handle_action(AppAction::Read { guid: book_guid })
            .expect("read action should produce an update result");

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::Use(guid) if *guid == book_guid))
        );
        assert_eq!(state.view.context_view, ContextView::Book(book_guid));
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

        assert!(context_buffer_contains(state.context_buffer(), "OLD NAME"));
        assert!(!context_buffer_contains(state.context_buffer(), "NEW NAME"));

        let result = state.handle_view_event(ClientViewEvent::VendorItemIdentified(Box::new(
            vendor_item_named(item_guid, 1, "New Name"),
        )));

        assert!(result.redraw_requested());
        assert!(context_buffer_contains(state.context_buffer(), "NEW NAME"));
        assert!(!context_buffer_contains(state.context_buffer(), "OLD NAME"));
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

    fn inventory_item_entity(guid: Guid, name: &str, container_id: Guid) -> Entity {
        let mut entity = Entity::new(guid, name.to_string(), WorldPosition::default());
        entity.set_iid_prop(PropertyInstanceId::Container, container_id);
        entity
    }

    fn stacked_inventory_item_entity(
        guid: Guid,
        name: &str,
        container_id: Guid,
        stack_size: u32,
    ) -> Entity {
        let mut entity = inventory_item_entity(guid, name, container_id);
        entity.set_int_prop(PropertyInt::StackSize, stack_size as i32);
        entity
    }

    #[test]
    fn entering_world_quiet_period_suppresses_initial_owned_spawns() {
        let player_guid = Guid(0x50000001);
        let item_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let status = state.handle_view_event(ClientViewEvent::StatusUpdate {
            state: holtburger_core::client::types::ClientState::InWorld,
        });

        let result = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
        });

        assert!(!status.redraw_requested());
        assert!(!result.redraw_requested());
        assert!(state.chat.messages.is_empty());
        assert!(matches!(
            state.runtime.inventory_notifications,
            InventoryNotificationState::QuietUntil(_)
        ));
    }

    #[test]
    fn newly_owned_item_logs_to_chat() {
        let player_guid = Guid(0x50000001);
        let item_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
            state: holtburger_core::client::types::ClientState::InWorld,
        });

        state.runtime.inventory_notifications =
            InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
        let _ = state.handle_tick(0.0);

        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(Entity::new(
                item_guid,
                "Pyreal".to_string(),
                WorldPosition::default(),
            )),
        });

        let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
            entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
        });

        assert!(result.redraw_requested());
        assert_eq!(state.chat.messages.len(), 1);
        assert_eq!(state.chat.messages[0].text, "Added to inventory: Pyreal");
    }

    #[test]
    fn newly_owned_stacked_item_logs_stack_size() {
        let player_guid = Guid(0x50000001);
        let item_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
            state: holtburger_core::client::types::ClientState::InWorld,
        });

        state.runtime.inventory_notifications =
            InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
        let _ = state.handle_tick(0.0);

        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(Entity::new(
                item_guid,
                "Pyreal".to_string(),
                WorldPosition::default(),
            )),
        });

        let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
            entity: Box::new(stacked_inventory_item_entity(
                item_guid,
                "Pyreal",
                player_guid,
                7,
            )),
        });

        assert!(result.redraw_requested());
        assert_eq!(state.chat.messages.len(), 1);
        assert_eq!(
            state.chat.messages[0].text,
            "Added to inventory: Pyreal (7x)"
        );
    }

    #[test]
    fn newly_unowned_item_logs_to_chat() {
        let player_guid = Guid(0x50000001);
        let item_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
            state: holtburger_core::client::types::ClientState::InWorld,
        });

        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
        });

        state.chat.messages.clear();
        state.runtime.inventory_notifications =
            InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
        let _ = state.handle_tick(0.0);

        let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
            entity: Box::new(Entity::new(
                item_guid,
                "Pyreal".to_string(),
                WorldPosition::default(),
            )),
        });

        assert!(result.redraw_requested());
        assert_eq!(state.chat.messages.len(), 1);
        assert_eq!(
            state.chat.messages[0].text,
            "Removed from inventory: Pyreal"
        );
    }

    #[test]
    fn moving_item_within_inventory_does_not_log_addition() {
        let player_guid = Guid(0x50000001);
        let pack_guid = Guid(0x60000001);
        let item_guid = Guid(0x60000002);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
            state: holtburger_core::client::types::ClientState::InWorld,
        });

        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(pack_guid, "Pack", player_guid)),
        });
        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
        });

        let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
            entity: Box::new(inventory_item_entity(item_guid, "Pyreal", pack_guid)),
        });

        assert!(!result.redraw_requested());
        assert!(state.chat.messages.is_empty());
    }

    #[test]
    fn entering_world_quiet_period_suppresses_initial_side_pack_contents() {
        let player_guid = Guid(0x50000001);
        let pack_guid = Guid(0x60000001);
        let initial_item_guid = Guid(0x60000002);
        let later_item_guid = Guid(0x60000003);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
            state: holtburger_core::client::types::ClientState::InWorld,
        });

        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(pack_guid, "Pack", player_guid)),
        });
        let initial = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(initial_item_guid, "Apple", pack_guid)),
        });

        assert!(!initial.redraw_requested());
        assert!(state.chat.messages.is_empty());

        state.runtime.inventory_notifications =
            InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
        let _ = state.handle_tick(0.0);
        assert!(state.runtime.inventory_notifications.is_armed());

        let later = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(later_item_guid, "Pear", pack_guid)),
        });

        assert!(later.redraw_requested());
        assert_eq!(state.chat.messages.len(), 1);
        assert_eq!(state.chat.messages[0].text, "Added to inventory: Pear");
    }

    #[test]
    fn despawning_owned_item_logs_removal_to_chat() {
        let player_guid = Guid(0x50000001);
        let item_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
            state: holtburger_core::client::types::ClientState::InWorld,
        });
        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
        });

        state.chat.messages.clear();
        state.runtime.inventory_notifications =
            InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
        let _ = state.handle_tick(0.0);

        let result = state.handle_view_event(ClientViewEvent::EntityDespawned { guid: item_guid });

        assert!(result.redraw_requested());
        assert_eq!(state.chat.messages.len(), 1);
        assert_eq!(
            state.chat.messages[0].text,
            "Removed from inventory: Pyreal"
        );
    }

    #[test]
    fn acquiring_pack_recursively_tracks_known_contents() {
        let player_guid = Guid(0x50000001);
        let pack_guid = Guid(0x60000001);
        let item_guid = Guid(0x60000002);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
            state: holtburger_core::client::types::ClientState::InWorld,
        });

        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(item_guid, "Apple", pack_guid)),
        });

        assert!(!state.data.is_in_player_inventory(item_guid));

        let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
            entity: Box::new(inventory_item_entity(pack_guid, "Pack", player_guid)),
        });

        assert!(state.data.is_in_player_inventory(pack_guid));
        assert!(state.data.is_in_player_inventory(item_guid));
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
    fn equip_weapon_in_combat_exits_peace_then_reenters() {
        let player_guid = Guid(0x50000001);
        let weapon_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;

        let mut weapon = Entity::new(weapon_guid, "Sword".to_string(), WorldPosition::default());
        weapon.set_int_prop(
            PropertyInt::ValidLocations,
            holtburger_protocol::messages::EquipMask::MELEE_WEAPON.bits() as i32,
        );
        state.data.entities.insert(weapon_guid, weapon.clone());

        let start = state
            .handle_action(AppAction::Equip { guid: weapon_guid })
            .unwrap();
        assert!(matches!(
            start.commands.first(),
            Some(ClientCommand::SetCombatMode(CombatMode::NonCombat))
        ));
        assert!(is_weapon_swap_active(&state));

        let peace = state.handle_view_event(ClientViewEvent::CombatModeUpdated {
            mode: CombatMode::NonCombat,
        });
        assert!(matches!(
            peace.commands.first(),
            Some(ClientCommand::GetAndWield { item, slot: None }) if *item == weapon_guid
        ));

        weapon.set_iid_prop(
            holtburger_common::properties::PropertyInstanceId::Wielder,
            player_guid,
        );
        weapon.set_int_prop(
            PropertyInt::CurrentWieldedLocation,
            holtburger_protocol::messages::EquipMask::MELEE_WEAPON.bits() as i32,
        );
        let finish = state.handle_view_event(ClientViewEvent::EntityReplaced {
            entity: Box::new(weapon),
        });

        assert!(matches!(
            finish.commands.first(),
            Some(ClientCommand::SetCombatMode(CombatMode::Melee))
        ));
        assert!(!is_weapon_swap_active(&state));
    }

    #[test]
    fn combat_mode_update_requests_redraw() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let result = state.handle_view_event(ClientViewEvent::CombatModeUpdated {
            mode: CombatMode::Melee,
        });

        assert!(result.redraw_requested());
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

        assert!(result.redraw_requested());
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
        let _ = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();

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
        assert!(has_active_approach(&state));
    }

    #[test]
    fn navigation_sync_input_prefers_runtime_body_mirror_for_player_and_target() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let authoritative_player = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        let authoritative_target = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(20.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let runtime_player = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(4.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let runtime_target = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(5.0, 0.0, 0.0),
            ..WorldPosition::default()
        };

        state.data.player_pos = Some(authoritative_player);
        state.data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), authoritative_player),
        );
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", authoritative_target),
        );

        let _ = state.handle_view_event(ClientViewEvent::RuntimeBodyUpserted {
            body: Box::new(runtime_body_view(
                SpatialBodyId::LocalPlayer(player_guid),
                authoritative_player,
                runtime_player,
            )),
        });
        let _ = state.handle_view_event(ClientViewEvent::RuntimeBodyUpserted {
            body: Box::new(runtime_body_view(
                SpatialBodyId::Entity(target_guid),
                authoritative_target,
                runtime_target,
            )),
        });

        let snapshot = state.navigation_snapshot(Some(target_guid));
        let input = NavigationSyncInput {
            now: Instant::now(),
            player_position: snapshot.player_position,
            target: snapshot.tracked_target,
            self_movement_kinematics: snapshot.self_movement_kinematics,
            run_rate_scalar: snapshot.run_rate_scalar,
        };
        let target = input.target.expect("target sample should exist");

        assert_eq!(input.player_position, Some(runtime_player));
        assert_eq!(target.sample.projected_pose, runtime_target);
        assert_eq!(target.sample.authoritative_pose, authoritative_target);
    }

    #[test]
    fn navigation_snapshot_includes_projected_self_movement_kinematics() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        let kinematics = SelfMovementKinematics {
            source: PlayerMotionTableSource::DirectProperty {
                motion_table_id: 0x0900_0020,
            },
            motion_table_id: 0x0900_0020,
            stance: 0x8000_003D,
            base_walk_forward_velocity: Vector3::new(1.0, 0.0, 0.0),
            base_run_forward_velocity: Vector3::new(2.0, 0.0, 0.0),
            base_turn_left_omega: Vector3::new(0.0, 0.0, -1.5),
            base_turn_right_omega: Vector3::new(0.0, 0.0, 1.5),
        };

        let result = state.handle_view_event(ClientViewEvent::SelfMovementKinematicsUpdated {
            kinematics: Some(kinematics.clone()),
        });

        assert!(result.commands.is_empty());
        let snapshot = state.navigation_snapshot(None);
        assert_eq!(snapshot.self_movement_kinematics, Some(kinematics));
    }

    #[test]
    fn entity_kinematics_event_updates_cached_entity_state_and_requests_redraw() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        state.data.entities.insert(
            target_guid,
            Entity::new(target_guid, "Drudge".to_string(), WorldPosition::default()),
        );

        let velocity = holtburger_common::Vector3::new(1.0, 2.0, 3.0);
        let omega = holtburger_common::Vector3::new(0.0, 0.0, 4.0);
        let result = state.handle_view_event(ClientViewEvent::EntityKinematicsUpdated {
            guid: target_guid,
            velocity,
            omega,
        });

        assert!(result.redraw_requested());
        let entity = state
            .data
            .entities
            .get(&target_guid)
            .expect("target entity should exist");
        assert_eq!(entity.velocity, velocity);
        assert_eq!(entity.omega, omega);
    }

    #[test]
    fn combat_feedback_updates_auto_attack_runtime_state() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let commenced = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackCommenced,
        ));

        assert!(commenced.redraw_requested());
        assert!(!state.data.combat_runtime.attack_queued);
        assert!(state.data.combat_runtime.attack_sequence_active);

        let done = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::None,
            },
        ));

        assert!(done.redraw_requested());
        assert!(state.data.combat_runtime.attack_queued);
        assert!(!state.data.combat_runtime.attack_sequence_active);

        let cancelled = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(cancelled.redraw_requested());
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

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMissileAttack {
                    target,
                    attack_height: AttackHeight::Medium,
                    accuracy_level,
                } if *target == target_guid && (*accuracy_level - 0.5).abs() < f32::EPSILON
            )
        }));
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
        let _ = state.handle_entity_removed(target_guid);

        assert_eq!(state.view.active_interaction, None);
    }

    #[test]
    fn despawning_target_sends_cancel_attack_when_targeting_it() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.combat_runtime.attack_queued = true;
        state.data.combat_runtime.attack_sequence_active = true;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let result =
            state.handle_view_event(ClientViewEvent::EntityDespawned { guid: target_guid });

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::CancelAttack))
        );
        assert_eq!(state.view.active_interaction, None);
        assert!(!state.data.combat_runtime.attack_queued);
        assert!(!state.data.combat_runtime.attack_sequence_active);
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

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::CancelAttack))
        );
        assert_eq!(state.view.active_interaction, None);
        assert!(!state.data.combat_runtime.attack_queued);
        assert!(!state.data.combat_runtime.attack_sequence_active);
    }

    #[test]
    fn swear_allegiance_action_dispatches_client_command() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let result = state
            .handle_action(AppAction::SwearAllegiance {
                target: Guid(0x50000042),
            })
            .unwrap();

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::SwearAllegiance { target }) if *target == Guid(0x50000042)
        ));
    }

    #[test]
    fn invite_to_party_action_dispatches_client_command() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let result = state
            .handle_action(AppAction::InviteToParty {
                target: Guid(0x50000042),
            })
            .unwrap();

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::InviteToParty { target }) if *target == Guid(0x50000042)
        ));
    }

    #[test]
    fn uninvite_from_party_action_dispatches_client_command() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let result = state
            .handle_action(AppAction::UninviteFromParty {
                target: Guid(0x50000042),
            })
            .unwrap();

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::UninviteFromParty { target }) if *target == Guid(0x50000042)
        ));
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
    fn death_motion_blocks_stale_attack_refresh_for_targeted_creature() {
        use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
        use holtburger_world::entity::EntityMotionSnapshot;

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

        let _ = state.handle_view_event(ClientViewEvent::EntityMotionUpdated {
            guid: target_guid,
            snapshot: Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                forward_command: Some(InterpretedMotionCommand::DEAD),
                sidestep_command: None,
                turn_command: None,
                ..Default::default()
            }),
        });

        let mut result = UpdateResult::new();
        state.refresh_stale_attack_sequence(
            now + Duration::from_secs(1) + Duration::from_millis(1),
            &mut result,
        );

        assert!(!result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
    }

    #[test]
    fn entity_motion_updated_none_clears_cached_motion_snapshot() {
        use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
        use holtburger_world::entity::EntityMotionSnapshot;

        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
        target.motion_snapshot = Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::DEAD),
            sidestep_command: None,
            turn_command: None,
            ..Default::default()
        });
        state.data.entities.insert(target_guid, target);

        let _ = state.handle_view_event(ClientViewEvent::EntityMotionUpdated {
            guid: target_guid,
            snapshot: None,
        });

        assert_eq!(
            state
                .data
                .entities
                .get(&target_guid)
                .and_then(|entity| entity.motion_snapshot),
            None
        );
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

        let _result = state.handle_tick(0.016);

        assert!(!has_active_approach(&state));
    }

    #[test]
    fn handle_tick_emits_autonomous_drive_for_active_approach() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(5.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let _ = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();

        let result = state.handle_tick(0.1);

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::DriveSelf(PlayerDriveIntent::Autonomous(intent))
                    if intent.force_grounded
                        && intent.desired_heading == Some(180.0f32.to_radians())
                        && intent.desired_world_delta.x > 0.0
            )
        }));
    }

    #[test]
    fn handle_tick_emits_stop_when_navigation_drive_goes_idle() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(5.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let _ = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();

        let first_tick = state.handle_tick(0.1);
        assert!(has_autonomous_navigation_command(&first_tick));

        let _ = state.handle_view_event(ClientViewEvent::EntityMoved {
            guid: target_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: Vector3::new(0.2, 0.0, 0.0),
                ..WorldPosition::default()
            },
        });

        let result = state.handle_tick(0.1);

        assert!(has_arrival_navigation_command(&result));
    }

    #[test]
    fn far_target_does_not_start_attack_automation() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(385.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let mut result = UpdateResult::new();
        state.sync_combat_automation(Instant::now(), CombatMode::Melee, true, &mut result);

        assert!(!result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack { .. }
                    | ClientCommand::TargetedMissileAttack { .. }
            ) || is_snap_facing_command(command)
        }));
        assert!(!state.data.combat_runtime.attack_queued);
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
            matches!(command, ClientCommand::TargetedMeleeAttack { .. })
                || is_run_movement_command(command)
        }));
        assert_eq!(state.view.active_interaction, None);
    }

    #[test]
    fn cancelled_attack_does_not_rearm_after_target_death_motion() {
        use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
        use holtburger_world::entity::EntityMotionSnapshot;

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
        let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
        target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target.set_bool_prop(PropertyBool::Attackable, true);
        target.motion_snapshot = Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::DEAD),
            sidestep_command: None,
            turn_command: None,
            ..Default::default()
        });
        state.data.entities.insert(target_guid, target);

        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(!result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { .. })
                || is_run_movement_command(command)
        }));

        let mut stale = UpdateResult::new();
        state.refresh_stale_attack_sequence(Instant::now() + Duration::from_secs(2), &mut stale);

        assert!(!stale.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { .. })
                || is_run_movement_command(command)
        }));
    }

    #[test]
    fn cancelled_attack_does_not_rearm_after_player_death_motion() {
        use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
        use holtburger_world::entity::EntityMotionSnapshot;

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
        let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
        target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
        player.motion_snapshot = Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::DEAD),
            sidestep_command: None,
            turn_command: None,
            ..Default::default()
        });
        state.data.entities.insert(player_guid, player);

        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(!result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { .. })
                || is_run_movement_command(command)
        }));
    }

    #[test]
    fn forced_reposition_cancels_frontend_owned_approach_controller() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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
        assert!(!started.commands.iter().any(is_navigation_drive_command));
        assert!(has_active_approach(&state));
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Approaching { target_guid })
        );

        let driving_tick = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&driving_tick));

        let result = state.handle_view_event(ClientViewEvent::ForcedReposition {
            guid: player_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(10.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
            sequence: 42,
        });

        assert!(has_stop_navigation_command(&result));
        assert!(!has_active_approach(&state));
        assert_eq!(state.view.active_interaction, None);
    }

    #[test]
    fn forced_reposition_keeps_follow_interaction_while_follow_is_paused() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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

        let _ = state
            .handle_action(AppAction::Follow { guid: target_guid })
            .unwrap();

        let driving_tick = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&driving_tick));

        let result = state.handle_view_event(ClientViewEvent::ForcedReposition {
            guid: player_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(10.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
            sequence: 42,
        });

        assert!(has_stop_navigation_command(&result));
        assert!(matches!(
            state.runtime.navigation.navigation_mode(),
            Some(NavigationMode::Follow { .. })
        ));
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Following { target_guid })
        );
    }

    #[test]
    fn remote_forced_reposition_updates_target_position_and_restarts_follow_when_out_of_range() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });

        state.data.entities.insert(
            target_guid,
            creature_entity(
                target_guid,
                "Drudge",
                WorldPosition {
                    landblock_id: Guid(0x01000000),
                    coords: holtburger_common::Vector3::new(0.0, 0.0, 0.0),
                    ..WorldPosition::default()
                },
            ),
        );

        let _ = state
            .handle_action(AppAction::Follow { guid: target_guid })
            .unwrap();

        let event_result = state.handle_view_event(ClientViewEvent::ForcedReposition {
            guid: target_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(6.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
            sequence: 42,
        });

        assert!(event_result.redraw_requested());

        assert_eq!(
            state
                .data
                .entities
                .get(&target_guid)
                .unwrap()
                .position
                .coords
                .x,
            6.0
        );

        let tick_result = state.handle_tick(0.016);

        assert!(has_autonomous_navigation_command(&tick_result));
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Following { target_guid })
        );
    }

    #[test]
    fn follow_keeps_interaction_after_arrival_and_restarts_when_target_moves() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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
            .handle_action(AppAction::Follow { guid: target_guid })
            .unwrap();

        assert!(!started.commands.iter().any(is_navigation_movement_command));
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Following { target_guid })
        );

        let first_tick = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&first_tick));

        let in_range_event = state.handle_view_event(ClientViewEvent::EntityMoved {
            guid: target_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(0.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
        });

        assert!(in_range_event.redraw_requested());

        let in_range_tick = state.handle_tick(0.016);

        assert!(has_arrival_navigation_command(&in_range_tick));
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Following { target_guid })
        );

        let slipped_event = state.handle_view_event(ClientViewEvent::EntityMoved {
            guid: target_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(6.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
        });

        assert!(slipped_event.redraw_requested());

        let slipped_tick = state.handle_tick(0.016);

        assert!(has_autonomous_navigation_command(&slipped_tick));
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Following { target_guid })
        );
    }

    #[test]
    fn cancel_interaction_stops_active_follow_and_clears_mode() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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

        let _ = state
            .handle_action(AppAction::Follow { guid: target_guid })
            .unwrap();

        let driving_tick = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&driving_tick));

        let result = state.handle_action(AppAction::CancelInteraction).unwrap();

        assert!(has_stop_navigation_command(&result));
        assert_eq!(state.view.active_interaction, None);
    }

    #[test]
    fn switching_from_follow_to_approach_stops_follow_before_new_drive() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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

        let _ = state
            .handle_action(AppAction::Follow { guid: target_guid })
            .unwrap();

        let result = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();

        assert!(!result.commands.iter().any(is_navigation_movement_command));
        assert!(has_active_approach(&state));
        assert!(!matches!(
            state.runtime.navigation.navigation_mode(),
            Some(NavigationMode::Follow { .. })
        ));
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Approaching { target_guid })
        );

        let tick_result = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&tick_result));
    }

    #[test]
    fn teleport_start_cancels_frontend_owned_approach_controller() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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
        assert!(!started.commands.iter().any(is_navigation_movement_command));
        assert!(has_active_approach(&state));

        let driving_tick = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&driving_tick));

        let result = state.handle_view_event(ClientViewEvent::TeleportStarted { sequence: 7 });

        assert!(has_stop_navigation_command(&result));
        assert!(!has_active_approach(&state));
        assert_eq!(state.view.active_interaction, None);
    }

    #[test]
    fn teleport_start_clears_sticky_melee_targeting_and_attack() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });
        state.data.combat_mode = CombatMode::Melee;
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
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let initial = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&initial));

        let result = state.handle_view_event(ClientViewEvent::TeleportStarted { sequence: 8 });

        assert!(has_stop_navigation_command(&result));
        assert!(
            result
                .commands
                .iter()
                .any(|command| { matches!(command, ClientCommand::CancelAttack) })
        );
        assert_eq!(state.view.active_interaction, None);
        assert!(!state.data.combat_runtime.attack_sequence_active);

        let post_teleport_tick = state.handle_tick(0.016);
        assert!(!has_autonomous_navigation_command(&post_teleport_tick));
    }

    #[test]
    fn cancel_interaction_stops_active_approach_and_clears_mode() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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

        let _ = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();

        let driving_tick = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&driving_tick));

        assert!(has_active_approach(&state));
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Approaching { target_guid })
        );

        let result = state.handle_action(AppAction::CancelInteraction).unwrap();

        assert!(has_stop_navigation_command(&result));
        assert!(!has_active_approach(&state));
        assert_eq!(state.view.active_interaction, None);
    }

    #[test]
    fn target_moving_beyond_tracking_distance_cancels_active_approach() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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
        assert!(!started.commands.iter().any(is_navigation_movement_command));
        assert!(has_active_approach(&state));

        let first_tick = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&first_tick));

        let event_result = state.handle_view_event(ClientViewEvent::EntityMoved {
            guid: target_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(385.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
        });

        assert!(event_result.redraw_requested());
        assert!(has_active_approach(&state));

        let tick_result = state.handle_tick(0.016);

        assert!(has_stop_navigation_command(&tick_result));
        assert!(!has_active_approach(&state));
    }

    #[test]
    fn ordinary_navigation_world_churn_reconciles_on_next_tick() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });

        state.data.entities.insert(
            target_guid,
            creature_entity(
                target_guid,
                "Drudge",
                WorldPosition {
                    landblock_id: Guid(0x01000000),
                    coords: holtburger_common::Vector3::new(5.0, 0.0, 0.0),
                    ..WorldPosition::default()
                },
            ),
        );

        let _ = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();

        let moved = state.handle_view_event(ClientViewEvent::EntityMoved {
            guid: target_guid,
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: holtburger_common::Vector3::new(385.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
        });

        assert!(moved.redraw_requested());
        assert!(has_active_approach(&state));

        let _ = state.handle_tick(0.016);

        assert!(!has_active_approach(&state));
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

        assert!(turn.commands.iter().any(is_snap_facing_command));
        assert!(
            !turn
                .commands
                .iter()
                .any(|command| { matches!(command, ClientCommand::TargetedMissileAttack { .. }) })
        );
    }

    #[test]
    fn projected_player_options_update_game_data() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());

        let result = state.handle_view_event(ClientViewEvent::PlayerOptionsUpdated {
            options: holtburger_core::PlayerCharacterOptions {
                options1: holtburger_common::CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG,
                options2: holtburger_common::CharacterOptions2::HEAR_GENERAL_CHAT,
            },
        });

        assert!(result.redraw_requested());
        assert!(matches!(
            state.data.player_options,
            Some(holtburger_core::PlayerCharacterOptions {
                options1: holtburger_common::CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG,
                options2: holtburger_common::CharacterOptions2::HEAR_GENERAL_CHAT,
            })
        ));
    }

    #[test]
    fn projected_fellowship_state_updates_game_data() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        let fellowship = holtburger_world::state::FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Guid(0x50000001),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: false,
            members: vec![holtburger_world::state::FellowshipMemberState {
                guid: Guid(0x50000001),
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
            }],
            departed_members: Vec::new(),
            locks: Vec::new(),
        };

        let result = state.handle_view_event(ClientViewEvent::FellowshipStateUpdated {
            fellowship: Some(fellowship.clone()),
        });

        assert!(result.redraw_requested());
        assert!(result.actions.is_empty());
        assert_eq!(state.data.party, Some(fellowship));
    }

    #[test]
    fn accepted_fellowship_invite_opens_party_tab_on_next_state_update() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::Fellowship,
            context: 42,
            text: "Leader".to_string(),
        });
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let accept_result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(accept_result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::RespondToConfirmation { accepted: true }
            )
        }));

        let fellowship = holtburger_world::state::FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Guid(0x50000002),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: false,
            members: vec![holtburger_world::state::FellowshipMemberState {
                guid: Guid(0x50000001),
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
            }],
            departed_members: Vec::new(),
            locks: Vec::new(),
        };

        let result = state.handle_view_event(ClientViewEvent::FellowshipStateUpdated {
            fellowship: Some(fellowship.clone()),
        });

        assert!(result.redraw_requested());
        assert!(result.actions.iter().any(|action| {
            matches!(
                action,
                AppAction::UiAction {
                    action: AppUiAction::SetDashboardActiveTab(DashboardTab::Party)
                }
            )
        }));
        assert_eq!(state.data.party, Some(fellowship));
        assert!(!state.runtime.open_party_tab_on_next_fellowship_update);
    }

    #[test]
    fn projected_active_confirmation_updates_view_state() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());

        let result = state.handle_view_event(ClientViewEvent::ActiveCharacterConfirmationUpdated {
            confirmation: Some(ActiveCharacterConfirmation {
                confirmation_type: holtburger_common::ConfirmationType::CraftInteraction,
                context: 7,
                text: "Apply the tinkering attempt?".to_string(),
            }),
        });

        assert!(result.redraw_requested());
        assert!(matches!(
            state.view.active_confirmation,
            Some(ActiveCharacterConfirmation {
                confirmation_type: holtburger_common::ConfirmationType::CraftInteraction,
                context: 7,
                ref text,
            }) if text == "Apply the tinkering attempt?"
        ));
    }

    #[test]
    fn repeated_start_approach_reuses_existing_controller_for_same_target() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        seed_navigation_motion_model(&mut state);
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

        let first = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();

        assert!(first.commands.is_empty());

        let first_tick = state.handle_tick(0.016);
        assert!(has_autonomous_navigation_command(&first_tick));

        let second = state
            .handle_action(AppAction::Approach { guid: target_guid })
            .unwrap();

        assert!(second.commands.is_empty());
        assert!(has_active_approach(&state));
    }
}
