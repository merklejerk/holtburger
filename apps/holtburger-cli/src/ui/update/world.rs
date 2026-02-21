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
                    game.data.vendor = vendor;
                }
            }
            ClientViewEvent::TradeStateUpdated { trade } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.trade = trade;
                }
            }
            ClientViewEvent::ServerTimeUpdated { .. } | ClientViewEvent::NoClipUpdated { .. } => {
                self.handle_navigation_event(event);
            }
        }
    }
}
