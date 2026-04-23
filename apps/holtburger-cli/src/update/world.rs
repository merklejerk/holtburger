use crate::pages::selection::creation::CharacterCreationState;
use crate::pages::selection::{CharacterDashboardEntry, SelectionState};
use crate::state::AppState;
use crate::state::EventContext;
use crate::types::{Page, UpdateResult};
use crate::utils::format_action_result_message;
use holtburger_core::{ActionResultReason, ClientCommand, ClientState, ClientViewEvent};
use holtburger_protocol::errors::CharacterError;

impl AppState {
    fn handle_setup_event(&mut self, event: &ClientViewEvent, _result: &mut UpdateResult) {
        match event {
            ClientViewEvent::WorldNameUpdated(name) => {
                self.world_name = name.clone();
                if let Page::Game(ref mut game) = self.page {
                    game.data.world_name = name.clone();
                }
            }
            ClientViewEvent::CharacterList(chars) => {
                let mut chars = chars
                    .iter()
                    .cloned()
                    .enumerate()
                    .map(|(slot, character)| CharacterDashboardEntry {
                        slot: slot as u32,
                        character,
                    })
                    .collect::<Vec<_>>();
                chars.sort_by(|a, b| {
                    a.character
                        .name
                        .to_lowercase()
                        .cmp(&b.character.name.to_lowercase())
                });
                log::info!(
                    "Page transition: {:?} -> Selection (character list received)",
                    self.page_name()
                );
                self.page = Page::Selection(Box::new(SelectionState {
                    characters: chars,
                    selected_character_index: 0,
                    character_preference: self.character_preference.take(),
                    account_name: self.account_name.clone(),
                    screen: Default::default(),
                    creation: CharacterCreationState::from_repository(self.content.as_ref()),
                    pending_create: None,
                    delete_confirmation: None,
                }));
            }
            ClientViewEvent::ServerTimeUpdated { time } => {
                let value = Some((*time, std::time::Instant::now()));
                self.server_time = value;
            }
            _ => {}
        }
    }

    fn page_name(&self) -> &'static str {
        match self.page {
            Page::Selection(_) => "Selection",
            Page::Game(_) => "Game",
        }
    }

    fn handle_client_status_event(&mut self, event: &ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        match event {
            ClientViewEvent::StatusUpdate { state } => {
                let was_in_world = self.client_state == ClientState::InWorld;
                self.client_state = state.clone();
                match self.client_state {
                    ClientState::Disconnected => {
                        self.request_disconnect_exit();
                        if !self.should_exit_on_disconnect() && self.disconnect_reason.is_some() {
                            log::error!("{}", self.current_disconnect_chat_message());
                        }
                    }
                    _ => {
                        self.clear_disconnect_reason();
                    }
                }

                if self.client_state == ClientState::InWorld && !was_in_world {
                    result
                        .commands
                        .push(ClientCommand::SetFellowshipUpdatesSubscribed { enabled: true });
                }
            }
            ClientViewEvent::ActionResult { reason, .. } => {
                if let ActionResultReason::Character(error) = &reason
                    && matches!(
                        error,
                        CharacterError::Logon | CharacterError::EnterGameCharacterInWorld
                    )
                {
                    let message = format_action_result_message(reason);
                    self.remember_disconnect_reason(message.clone());
                    self.request_disconnect_exit();
                }
            }
            ClientViewEvent::BootAccount(reason) => {
                let message = if reason.trim().is_empty() {
                    "Booted from server.".to_string()
                } else {
                    format!("Booted from server: {}", reason)
                };
                self.remember_disconnect_reason(message);

                if matches!(self.client_state, ClientState::Disconnected)
                    && self.should_exit_on_disconnect()
                {
                    self.pending_exit_message = Some(self.current_disconnect_message());
                }
            }
            _ => {}
        }
        result
    }

    pub(super) fn handle_client_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        // Handle setup and chat events regardless of being locally in-game
        match &event {
            ClientViewEvent::CharacterList(_)
            | ClientViewEvent::CharacterEnterWorldServerReady
            | ClientViewEvent::ServerTimeUpdated { .. }
            | ClientViewEvent::WorldNameUpdated(_) => {
                self.handle_setup_event(&event, &mut result);
            }

            _ => {}
        }

        // Skip other events if not in-game, unless it's a StatusUpdate or ActionResult
        // that handles transitions.
        if !matches!(
            event,
            ClientViewEvent::CharacterList(_)
                | ClientViewEvent::CharacterEnterWorldServerReady
                | ClientViewEvent::WorldNameUpdated(_)
                | ClientViewEvent::CharacterManagementResponse { .. }
                | ClientViewEvent::CharacterDeleteResponse
                | ClientViewEvent::StatusUpdate { .. }
                | ClientViewEvent::ActionResult { .. }
                | ClientViewEvent::LogMessage(_)
                | ClientViewEvent::ServerMessage { .. }
                | ClientViewEvent::Chat { .. }
                | ClientViewEvent::ChannelMessage { .. }
                | ClientViewEvent::Tell { .. }
                | ClientViewEvent::Emote { .. }
                | ClientViewEvent::SoulEmote { .. }
                | ClientViewEvent::ItemManaResponse { .. }
                | ClientViewEvent::PingResponse
                | ClientViewEvent::BootAccount(_)
                | ClientViewEvent::NetPulse { .. }
                | ClientViewEvent::Disconnected
        ) && self.game_option().is_none()
        {
            return result;
        }

        let ctx = EventContext {
            server_time: self.server_time,
        };

        match event {
            ClientViewEvent::NetPulse {
                bytes_in,
                bytes_out,
            } => {
                let now = std::time::Instant::now();
                let delta_in = bytes_in.saturating_sub(self.net_stats.bytes_in);
                let delta_out = bytes_out.saturating_sub(self.net_stats.bytes_out);

                self.net_stats.bytes_in = bytes_in;
                self.net_stats.bytes_out = bytes_out;
                self.net_stats.last_update = Some(now);

                self.net_stats.history_in.rotate_left(1);
                if let Some(last) = self.net_stats.history_in.last_mut() {
                    *last = delta_in;
                }

                self.net_stats.history_out.rotate_left(1);
                if let Some(last) = self.net_stats.history_out.last_mut() {
                    *last = delta_out;
                }

                // Bubble down the event so chat/logs can still get network pings if needed
                result.merge(self.page.handle_view_event(
                    ClientViewEvent::NetPulse {
                        bytes_in,
                        bytes_out,
                    },
                    &ctx,
                ));
            }
            ClientViewEvent::Disconnected => {
                self.client_state = ClientState::Disconnected;
                self.request_disconnect_exit();
                log::error!("{}", self.current_disconnect_chat_message());
                // For now, staying on the Game page lets the user see the error,
                // but we could also transition back to selection.
                result.merge(
                    self.page
                        .handle_view_event(ClientViewEvent::Disconnected, &ctx),
                );
            }
            ClientViewEvent::StatusUpdate { .. }
            | ClientViewEvent::ActionResult { .. }
            | ClientViewEvent::BootAccount(_) => {
                result.merge(self.handle_client_status_event(&event));
                result.merge(self.page.handle_view_event(event, &ctx));
            }
            ClientViewEvent::BusyOperationFinished {
                operation,
                result: busy_result,
            } => {
                result.merge(self.page.handle_view_event(
                    ClientViewEvent::BusyOperationFinished {
                        operation,
                        result: busy_result,
                    },
                    &ctx,
                ));
            }
            _ => {
                // All other entity, player, trade, and combat events delegate completely!
                result.merge(self.page.handle_view_event(event, &ctx));
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::NetStats;
    use crate::types::{AppAction, ChatMessageTags, Page};
    use holtburger_scripting::ScriptHostConfig;

    fn build_test_app_state(client_state: ClientState) -> AppState {
        AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log: None,
            page: Page::Selection(Box::default()),
            client_state,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: None,
            content: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            queued_script_startup: None,
            script_host_config: ScriptHostConfig::default(),
        }
    }

    #[test]
    fn entering_world_subscribes_to_fellowship_updates() {
        let mut app_state = build_test_app_state(ClientState::EnteringWorld);

        let result = app_state.handle_client_view_event(ClientViewEvent::StatusUpdate {
            state: ClientState::InWorld,
        });

        assert!(matches!(app_state.client_state, ClientState::InWorld));
        assert_eq!(result.commands.len(), 1);
        assert!(matches!(
            result.commands[0],
            ClientCommand::SetFellowshipUpdatesSubscribed { enabled: true }
        ));
    }

    #[test]
    fn repeated_in_world_status_does_not_resubscribe() {
        let mut app_state = build_test_app_state(ClientState::InWorld);

        let result = app_state.handle_client_view_event(ClientViewEvent::StatusUpdate {
            state: ClientState::InWorld,
        });

        assert!(result.commands.is_empty());
    }

    #[test]
    fn boot_account_reason_is_used_for_disconnect_exit() {
        let mut app_state = build_test_app_state(ClientState::InWorld);
        app_state.quit_on_disconnect = true;
        let _ = app_state.handle_client_view_event(ClientViewEvent::StatusUpdate {
            state: ClientState::Disconnected,
        });
        let _ = app_state.handle_client_view_event(ClientViewEvent::BootAccount(
            "Server maintenance".to_string(),
        ));

        assert_eq!(
            app_state.take_pending_exit_message().as_deref(),
            Some("Booted from server: Server maintenance")
        );
    }

    #[test]
    fn post_world_logon_error_becomes_disconnect_exit_instead_of_retry() {
        let mut app_state = build_test_app_state(ClientState::InWorld);
        app_state.quit_on_disconnect = true;
        app_state.page = Page::Game(Box::new(crate::pages::game::GameState::new(
            holtburger_common::Guid(0x50000001),
            "Player".to_string(),
            "World".to_string(),
        )));

        let result = app_state.handle_client_view_event(ClientViewEvent::ActionResult {
            source: holtburger_core::client::types::ActionResultSource::Wire,
            reason: ActionResultReason::Character(CharacterError::Logon),
        });

        assert!(result.commands.is_empty());
        assert_eq!(
            app_state.take_pending_exit_message().as_deref(),
            Some("Character error: Logon")
        );
    }

    #[test]
    fn pre_world_logon_error_exits_without_retry() {
        let mut app_state = build_test_app_state(ClientState::Connected);

        let result = app_state.handle_client_view_event(ClientViewEvent::ActionResult {
            source: holtburger_core::client::types::ActionResultSource::Wire,
            reason: ActionResultReason::Character(CharacterError::Logon),
        });

        assert!(result.commands.is_empty());
        assert_eq!(
            app_state.take_pending_exit_message().as_deref(),
            Some("Character error: Logon")
        );
    }

    #[test]
    fn missing_spell_components_are_surfaced_in_chat() {
        let mut app_state = build_test_app_state(ClientState::InWorld);
        app_state.page = Page::Game(Box::new(crate::pages::game::GameState::new(
            holtburger_common::Guid(0x50000001),
            "Player".to_string(),
            "World".to_string(),
        )));

        let result = app_state.handle_client_view_event(ClientViewEvent::ActionResult {
            source: holtburger_core::client::types::ActionResultSource::Wire,
            reason: ActionResultReason::Weenie(
                holtburger_protocol::errors::WeenieError::YouDontHaveAllTheComponents,
                None,
            ),
        });

        assert!(result.commands.is_empty());
        assert_eq!(result.actions.len(), 1);
        match &result.actions[0] {
            AppAction::Log { chat_tags, message } => {
                assert_eq!(*chat_tags, ChatMessageTags::error());
                assert_eq!(message, "You don't have all the components.");
            }
            other => panic!("expected chat log action, got {:?}", other),
        }
    }

    #[test]
    fn post_world_disconnect_stays_open_without_quit_flag() {
        let mut app_state = build_test_app_state(ClientState::InWorld);
        app_state.page = Page::Game(Box::new(crate::pages::game::GameState::new(
            holtburger_common::Guid(0x50000001),
            "Player".to_string(),
            "World".to_string(),
        )));

        let result = app_state.handle_client_view_event(ClientViewEvent::StatusUpdate {
            state: ClientState::Disconnected,
        });

        assert!(result.commands.is_empty());

        let result = app_state.handle_client_view_event(ClientViewEvent::BootAccount(
            "Server maintenance".to_string(),
        ));

        assert!(result.commands.is_empty());
        assert!(app_state.take_pending_exit_message().is_none());
        assert_eq!(
            app_state.disconnect_reason.as_deref(),
            Some("Booted from server: Server maintenance")
        );

        let game = app_state
            .game_option()
            .expect("game page should remain active after disconnect");
        let last_message = game
            .chat
            .messages
            .last()
            .expect("boot reason should be logged to chat");
        assert_eq!(
            last_message.text,
            "Disconnected: Booted from server: Server maintenance"
        );
    }
}
