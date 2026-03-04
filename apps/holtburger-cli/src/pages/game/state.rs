use holtburger_common::Guid;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::types::ClientCommand;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;
use ratatui::text::Line;
use std::time::Instant;

use crate::pages::game::GameData;
use crate::pages::game::panels::chat::ChatState;
use crate::pages::game::panels::chat_input::ChatInputState;
use crate::pages::game::panels::dashboard::DashboardState;
use crate::types::{AppAction, ChatMessageKind, ContextView, FocusedPane, Interaction, UpdateResult};

#[derive(Default)]
pub struct GameState {
    pub data: GameData,
    pub dashboard: DashboardState,
    pub view: ViewState,
    pub chat: ChatState,
    pub chat_input: ChatInputState,
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
            ClientViewEvent::EntityDebugInfoSnapshot { entity } => {
                let entity_ref = entity.as_ref();
                self.data.entities.insert(entity_ref.guid, entity_ref.clone());
            }
            ClientViewEvent::EntitySpawned { entity } => {
                let entity_ref = entity.as_ref();
                self.data.entities.insert(entity_ref.guid, entity_ref.clone());
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
                if needs_update
                    && let Some(entity) = self.data.entities.get(&guid).cloned() {
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
                let vendor_guid = vendor.as_ref().map(|v| v.vendor_guid);
                self.view.vendor = vendor;
                // If we just opened a vendor and we initiated it, switch to Trade tab.
                if let Some(v_guid) = vendor_guid
                    && let Some((last_time, target_guid)) = self.view.last_trade_initiation
                        && target_guid == v_guid && last_time.elapsed() < std::time::Duration::from_secs(5) {
                            self.dashboard.active_tab = crate::types::DashboardTab::Trade;
                        }
            }
            ClientViewEvent::TradeStateUpdated { trade } => {
                let partner_guid = trade.as_ref().map(|t| t.partner_side.guid);
                self.data.trade = trade;
                // If we just opened a trade and we initiated it, switch to Trade tab.
                if let Some(p_guid) = partner_guid
                    && let Some((last_time, target_guid)) = self.view.last_trade_initiation
                        && target_guid == p_guid && last_time.elapsed() < std::time::Duration::from_secs(5) {
                            self.dashboard.active_tab = crate::types::DashboardTab::Trade;
                        }
            }
            ClientViewEvent::EntityIdentified { entity } => {
                let entity_ref = entity.as_ref();
                self.update_inventory_and_equipment(entity_ref);
                self.handle_entity_identified(entity_ref);
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
            AppAction::Identify(guid) => {
                result.commands.push(ClientCommand::Identify(guid));
            }
            AppAction::Assess(guid) => {
                result.commands.push(ClientCommand::Identify(guid));
                result.merge(
                    self.handle_action(AppAction::ChangeContextView(crate::types::ContextView::Assess(
                        guid,
                    )))
                    .unwrap_or_default(),
                );
            }
            AppAction::Use(guid) => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::UseOn(item, target) => {
                result
                    .commands
                    .push(ClientCommand::UseWithTarget { item, target });
            }
            AppAction::Approach(guid) => {
                result.commands.push(ClientCommand::MoveTo { target: guid });
            }
            AppAction::PickUp(guid) => {
                result.commands.push(ClientCommand::MoveItem {
                    item: guid,
                    container: Guid::NULL,
                    placement: 0,
                });
            }
            AppAction::Drop(guid) => {
                result.commands.push(ClientCommand::Drop(guid));
            }
            AppAction::Equip(guid) => {
                result.commands.push(ClientCommand::GetAndWield {
                    item: guid,
                    slot: None,
                });
            }
            AppAction::Unequip(guid) => {
                result.commands.push(ClientCommand::MoveItem {
                    item: guid,
                    container: Guid::NULL,
                    placement: 0,
                });
            }
            AppAction::TalkTo(guid) => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::Open(guid) => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::Close(guid) => {
                result.commands.push(ClientCommand::CloseContainer(guid));
            }
            AppAction::OpenTrade(guid) => {
                result.commands.push(ClientCommand::OpenTrade(guid));
            }
            AppAction::AddToTrade(guid) => {
                result
                    .commands
                    .push(ClientCommand::AddToTrade { item: guid });
            }
            AppAction::SellToVendor(vendor, item, amount) => {
                result.commands.push(ClientCommand::Sell {
                    vendor,
                    items: vec![ItemProfileActionData {
                        object_guid: item,
                        amount: amount as i32,
                    }],
                });
            }
            AppAction::BuyFromVendor(vendor, item, amount) => {
                result.commands.push(ClientCommand::Buy {
                    vendor,
                    items: vec![ItemProfileActionData {
                        object_guid: item,
                        amount: amount as i32,
                    }],
                });
            }
            AppAction::MoveItem(item, container) => {
                result.commands.push(ClientCommand::MoveItem {
                    item,
                    container,
                    placement: 0,
                });
            }
            AppAction::StackItems(source, destination, amount) => {
                result.commands.push(ClientCommand::Stack {
                    source,
                    destination,
                    amount,
                });
            }
            AppAction::SplitItem(item, container) => {
                result.commands.push(ClientCommand::Split {
                    item,
                    container,
                    amount: 1, // TODO
                });
            }
            AppAction::UseWith(item, target) => {
                result
                    .commands
                    .push(ClientCommand::UseWithTarget { item, target });
            }
            AppAction::QueryDebugInfo(guid) => {
                result
                    .commands
                    .push(ClientCommand::QueryEntityDebugInfo(guid));
                result.merge(
                    self.handle_action(AppAction::RequestDebugContext(Some(guid)))
                        .unwrap_or_default(),
                );
            }
            AppAction::CastSpell(spell_id, target) => {
                // TODO: Auto toggle combat mode.
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
            AppAction::SetCombatMode(mode) => {
                result.commands.push(ClientCommand::SetCombatMode(mode));
            }
            AppAction::Pickup(guid) => {
                if let Some(container_id) = self.data.find_non_full_pack(None) {
                    result.commands.push(ClientCommand::MoveItem {
                        item: guid,
                        container: container_id,
                        placement: 0,
                    });
                }
            }
            AppAction::Give(item, recipient, amount) => {
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
            AppAction::ChangeContextView(view) => {
                self.view.context_view = view;
                self.view.context_scroll_offset = 0;
                result.needs_redraw = true;
                self.refresh_context_buffer();
            }
            AppAction::RequestDebugContext(guid) => {
                self.view.current_debug_guid = guid;
                self.view.context_view = crate::types::ContextView::Custom;
                self.view.context_scroll_offset = 0;
                result.needs_redraw = true;
                self.refresh_context_buffer();
            }
            AppAction::BeginInteraction(interaction) => {
                self.view.active_interaction = Some(interaction);
                result.needs_redraw = true;
            }
            AppAction::CancelInteraction => {
                self.view.active_interaction = None;
                result.needs_redraw = true;
            }
            AppAction::ClearVendor => {
                self.view.vendor = None;
                result.needs_redraw = true;
            }
            AppAction::ViewDetails(view) => {
                return self.handle_action(AppAction::ChangeContextView(view));
            }
            _ => return None,
        }
        Some(result)
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
        let content = {
            let data = &self.data;
            let view = &self.view;
            self.dashboard
                .active_tab_mut()
                .get_context_panel_content(data, view)
        };
        self.view.context_buffer = content;
    }

    pub(crate) fn handle_player_event(&mut self, event: ClientViewEvent) {
        match event {
            ClientViewEvent::PlayerEnchantmentsUpdated {
                enchantments,
                resolved_names,
            } => {
                self.data.player_enchantments = enchantments;
                for (id, name) in resolved_names {
                    self.data.spell_names.insert(id, name);
                }
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
            ClientViewEvent::PlayerSpellsUpdated { spell_ids, spells } => {
                self.data.player_spells = spell_ids;
                for (id, info) in spells {
                    self.data.spell_names.insert(id, info.name.clone());
                    self.data.spell_info.insert(id, Box::new(info));
                }
            }
            ClientViewEvent::CombatModeUpdated { mode } => {
                self.data.combat_mode = mode;
            }
            _ => {}
        }
    }

    pub(crate) fn handle_entity_identified(&mut self, entity: &Entity) {
        let guid = entity.guid;
        self.data.entities.insert(guid, entity.clone());
        self.view.context_view = ContextView::Assess(guid);
    }

    pub(crate) fn update_inventory_and_equipment(&mut self, entity: &Entity) {
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

    pub(crate) fn handle_entity_removed(&mut self, guid: Guid) {
        self.data.update_inventory_recursive(guid, false);
        self.data.entities.remove(&guid);
        self.data.equipment.remove(&guid);
        if self.view.current_debug_guid == Some(guid) {
            self.view.current_debug_guid = None;
        }
    }

    pub(crate) fn handle_navigation_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        if let ClientViewEvent::NoClipUpdated { enabled } = event {
            self.data.noclip = enabled;
            let status = if enabled { "ENABLED" } else { "DISABLED" };
            result.actions.push(AppAction::Log(
                ChatMessageKind::System,
                format!(">> NoClip is now {}", status),
            ));
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
    /// GUID of the entity we are currently "debugging".
    pub current_debug_guid: Option<Guid>,
    /// Current vendor state (inventory and multipliers) - note: pseudo-client state.
    pub vendor: Option<holtburger_world::vendor::VendorState>,
    /// State of current interaction like vendor transactions.
    pub active_interaction: Option<Interaction>,
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
            current_debug_guid: None,
            vendor: None,
            active_interaction: None,
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
