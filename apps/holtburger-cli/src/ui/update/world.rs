use crate::ui::DashboardTab;
use crate::ui::state::AppState;
use holtburger_core::{ClientViewEvent, StateEvent, WireEvent};

impl AppState {
    pub(super) fn handle_received_event(&mut self, event: WireEvent) {
        match event {
            WireEvent::CharacterList(_)
            | WireEvent::PlayerEntered { .. }
            | WireEvent::GameMessage(_) => {
                self.handle_setup_event(event);
            }
            WireEvent::LogMessage(_)
            | WireEvent::ServerMessage(_)
            | WireEvent::Chat { .. }
            | WireEvent::Emote { .. }
            | WireEvent::PingResponse => {
                self.handle_chat_event(event);
            }
            WireEvent::RawMessage(data) => {
                self.net_stats.bytes_in += data.len() as u64;
            }
            _ => {}
        }
    }

    pub(super) fn handle_received_state_event(&mut self, event: StateEvent) {
        self.handle_state_event(event);
    }

    pub(super) fn handle_client_view_event(&mut self, event: ClientViewEvent) {
        // Skip events if not in-game, unless it's a StatusUpdate or ErrorRaised
        // that handles transitions.
        if !matches!(
            event,
            ClientViewEvent::StatusUpdate { .. } | ClientViewEvent::ErrorRaised { .. }
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
            ClientViewEvent::EntityUpserted { ref entity } => {
                self.update_inventory_and_equipment(entity);
            }
            ClientViewEvent::EntityRemoved { guid } => {
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
                        game.view.dashboard_tab = DashboardTab::Trade;
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
                        game.view.dashboard_tab = DashboardTab::Trade;
                    }
                }
            }
            ClientViewEvent::ServerTimeUpdated { .. } | ClientViewEvent::NoClipUpdated { .. } => {
                self.handle_navigation_event(event);
            }
        }
    }
}
