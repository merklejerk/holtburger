use crate::state::AppState;
use crate::ui::DashboardTab;
use holtburger_core::ClientViewEvent;

impl AppState {
    pub(super) fn handle_client_view_event(&mut self, event: ClientViewEvent) {
        // Handle setup and chat events regardless of being locally in-game
        match &event {
            ClientViewEvent::CharacterList(_)
            | ClientViewEvent::PlayerEntered { .. }
            | ClientViewEvent::WorldNameUpdated(_) => {
                self.handle_setup_event(&event);
            }
            ClientViewEvent::LogMessage(_)
            | ClientViewEvent::ServerMessage { .. }
            | ClientViewEvent::Chat { .. }
            | ClientViewEvent::Emote { .. }
            | ClientViewEvent::PingResponse
            | ClientViewEvent::BootAccount(_) => {
                self.chat.handle_event(&event);
            }
            _ => {}
        }

        // Skip other events if not in-game, unless it's a StatusUpdate or ErrorRaised
        // that handles transitions.
        if !matches!(
            event,
            ClientViewEvent::CharacterList(_)
                | ClientViewEvent::PlayerEntered { .. }
                | ClientViewEvent::WorldNameUpdated(_)
                | ClientViewEvent::StatusUpdate { .. }
                | ClientViewEvent::ErrorRaised { .. }
                | ClientViewEvent::LogMessage(_)
                | ClientViewEvent::ServerMessage { .. }
                | ClientViewEvent::Chat { .. }
                | ClientViewEvent::Emote { .. }
                | ClientViewEvent::PingResponse
                | ClientViewEvent::BootAccount(_)
        ) && self.game_option().is_none()
        {
            return;
        }

        match event {
            ClientViewEvent::StatusUpdate { .. } | ClientViewEvent::ErrorRaised { .. } => {
                self.handle_client_status_event(event);
            }
            ClientViewEvent::PlayerEnchantmentsUpdated { .. }
            | ClientViewEvent::PlayerStatsSkillsUpdated { .. }
            | ClientViewEvent::PlayerVitalsUpdated { .. }
            | ClientViewEvent::PlayerSpellsUpdated { .. }
            | ClientViewEvent::CombatModeUpdated { .. } => {
                self.handle_combat_event(event);
            }
            ClientViewEvent::EntityDebugInfoSnapshot { entity } => {
                let entity_ref = entity.as_ref();
                if let Some(game) = self.game_option_mut() {
                    // Update our local cache with the high-fidelity snapshot
                    game.data
                        .entities
                        .insert(entity_ref.guid, entity_ref.clone());
                }
            }
            ClientViewEvent::EntitySpawned { entity } => {
                let entity_ref = entity.as_ref();
                if let Some(game) = self.game_option_mut() {
                    game.data
                        .entities
                        .insert(entity_ref.guid, entity_ref.clone());
                }
                self.update_inventory_and_equipment(entity_ref);
            }
            ClientViewEvent::EntityPropertiesUpdated { guid, updates } => {
                let mut needs_update = false;
                if let Some(game) = self.game_option_mut()
                    && let Some(entity) = game.data.entities.get_mut(&guid)
                {
                    for update in updates {
                        entity.properties.apply(update);
                    }
                    needs_update = true;
                }
                if needs_update
                    && let Some(game) = self.game_option()
                    && let Some(entity) = game.data.entities.get(&guid).cloned()
                {
                    self.update_inventory_and_equipment(&entity);
                }
            }
            ClientViewEvent::EntityMoved { guid, pos } => {
                if let Some(game) = self.game_option_mut()
                    && let Some(entity) = game.data.entities.get_mut(&guid)
                {
                    entity.position = pos;
                    if Some(guid) == game.data.player_guid {
                        game.data.player_pos = Some(pos);
                    }
                }
            }
            ClientViewEvent::EntityDespawned { guid } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.entities.remove(&guid);
                }
                self.handle_entity_removed(guid);
            }
            ClientViewEvent::VendorStateUpdated { vendor } => {
                if let Some(game) = self.game_option_mut() {
                    let vendor_guid = vendor.as_ref().map(|v| v.vendor_guid);
                    game.data.vendor = vendor;
                    // If we just opened a vendor and we initiated it, switch to Trade tab.
                    if let Some(v_guid) = vendor_guid
                        && let Some((last_time, target_guid)) = game.view.last_trade_initiation
                        && target_guid == v_guid
                        && last_time.elapsed() < std::time::Duration::from_secs(5)
                    {
                        game.dashboard.active_tab = DashboardTab::Trade;
                    }
                }
            }
            ClientViewEvent::TradeStateUpdated { trade } => {
                if let Some(game) = self.game_option_mut() {
                    let partner_guid = trade.as_ref().map(|t| t.partner_side.guid);
                    game.data.trade = trade;
                    // If we just opened a trade and we initiated it, switch to Trade tab.
                    if let Some(p_guid) = partner_guid
                        && let Some((last_time, target_guid)) = game.view.last_trade_initiation
                        && target_guid == p_guid
                        && last_time.elapsed() < std::time::Duration::from_secs(5)
                    {
                        game.dashboard.active_tab = DashboardTab::Trade;
                    }
                }
            }
            ClientViewEvent::EntityIdentified { entity } => {
                let entity_ref = entity.as_ref();
                if let Some(game) = self.game_option_mut() {
                    game.data
                        .entities
                        .insert(entity_ref.guid, entity_ref.clone());
                }
                self.update_inventory_and_equipment(entity_ref);
                self.handle_entity_identified(entity_ref);
            }
            ClientViewEvent::ServerTimeUpdated { .. } | ClientViewEvent::NoClipUpdated { .. } => {
                self.handle_navigation_event(event);
            }
            ClientViewEvent::ContainerOpened { guid } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.open_containers.insert(guid);
                }
            }
            ClientViewEvent::ContainerClosed { guid } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.open_containers.remove(&guid);
                }
            }
            _ => {}
        }
    }
}
