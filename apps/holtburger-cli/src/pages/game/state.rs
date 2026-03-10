use holtburger_common::Guid;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::types::ClientCommand;
use holtburger_protocol::messages::CombatMode;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;
use ratatui::text::Line;
use std::time::Instant;

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
        Self {
            data: GameData::new(guid, name, world_name),
            dashboard: DashboardState::default(),
            view: ViewState::default(),
            chat: ChatState::default(),
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
            ClientViewEvent::PlayerEnchantmentsUpdated { .. }
            | ClientViewEvent::PlayerStatsSkillsUpdated { .. }
            | ClientViewEvent::PlayerVitalsUpdated { .. }
            | ClientViewEvent::PlayerSpellsUpdated { .. }
            | ClientViewEvent::CombatModeUpdated { .. } => {
                self.handle_player_event(event);
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
            }
            ClientViewEvent::EntityDespawned { guid } => {
                self.handle_entity_removed(guid);
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
            ClientViewEvent::VendorItemIdentified { vendor_guid, item } => {
                if let Some(vendor) = self.view.vendor.as_mut()
                    && vendor.vendor_guid == vendor_guid
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
                        self.view.active_interaction = None;
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
                self.view.active_interaction = None;
                self.view.salvaging = None;
                result.needs_redraw = true;
            }
            AppAction::Approach { guid } => {
                result.commands.push(ClientCommand::MoveTo { target: guid });
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
                self.view.active_interaction = None;
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
            AppAction::SetCombatMode { mode } => {
                result.commands.push(ClientCommand::SetCombatMode(mode));
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
                    self.view.active_interaction = Some(interaction);
                }
                result.needs_redraw = true;
            }
            AppAction::CancelInteraction => {
                self.view.active_interaction = None;
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
            }
            _ => {}
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
        if let Some(session) = self.view.salvaging.as_mut() {
            session
                .queued_items
                .retain(|queued_guid| *queued_guid != guid);
            if session.ust_guid == guid {
                self.view.salvaging = None;
                if self.view.active_interaction == Some(Interaction::Salvaging) {
                    self.view.active_interaction = None;
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
    use holtburger_common::properties::{PropertyString, WorldObjectProperties};
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

        let result = state.handle_view_event(ClientViewEvent::VendorItemIdentified {
            vendor_guid,
            item: Box::new(vendor_item_named(item_guid, 1, "New Name")),
        });

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
}
