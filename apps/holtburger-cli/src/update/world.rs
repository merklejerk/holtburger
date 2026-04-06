use crate::pages::selection::creation::CharacterCreationState;
use crate::pages::selection::{CharacterDashboardEntry, SelectionState};
use crate::state::AppState;
use crate::types::{ChatMessageTags, Page, UpdateResult};
use crate::utils::format_action_result_message;
use holtburger_core::errors::is_actually_weenie_error;
use holtburger_core::{
    ActionResultReason, BusyOperationKind, BusyOperationResult, ClientCommand, ClientState,
    ClientViewEvent,
};
use holtburger_protocol::errors::CharacterError;

fn log_busy_operation_result(operation: BusyOperationKind, result: &BusyOperationResult) {
    let label = match operation {
        BusyOperationKind::Use => "Use",
        BusyOperationKind::UseWithTarget => "Use-with-target",
        BusyOperationKind::Salvage => "Salvage",
        BusyOperationKind::SpellCast => "Spell cast",
        BusyOperationKind::Buy => "Buy",
        BusyOperationKind::Sell => "Sell",
    };

    match result {
        BusyOperationResult::Completed {
            error: holtburger_protocol::errors::WeenieError::None,
            ..
        } => {
            log::debug!("{} finished.", label);
        }
        BusyOperationResult::Completed { error, parameter } => match parameter {
            Some(parameter) => {
                log::warn!("{} finished with {:?} ({}).", label, error, parameter);
            }
            None => {
                log::warn!("{} finished with {:?}.", label, error);
            }
        },
        BusyOperationResult::TimedOut => {
            log::warn!("{} timed out waiting for UseDone.", label);
        }
    }
}

impl AppState {
    fn handle_setup_event(&mut self, event: &ClientViewEvent) {
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
                self.page = Page::Selection(Box::new(SelectionState {
                    characters: chars,
                    selected_character_index: 0,
                    character_preference: self.character_preference.take(),
                    screen: Default::default(),
                    creation: CharacterCreationState::from_repository(self.content.as_ref()),
                    pending_create: None,
                    delete_confirmation: None,
                }));
            }
            ClientViewEvent::PlayerEntered { guid, name } => {
                if let Page::Game(game) = &mut self.page {
                    game.data.player_guid = Some(*guid);
                    game.data.character_name = Some(name.clone());
                    game.data.world_name = self.world_name.clone();
                }
            }
            ClientViewEvent::ServerTimeUpdated { time } => {
                let value = Some((*time, std::time::Instant::now()));
                self.server_time = value;
            }
            _ => {}
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
                            self.log(
                                ChatMessageTags::error(),
                                self.current_disconnect_chat_message(),
                            );
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
                let message = format_action_result_message(reason);

                if let ActionResultReason::Character(error) = &reason
                    && matches!(
                        error,
                        CharacterError::Logon | CharacterError::EnterGameCharacterInWorld
                    )
                {
                    self.remember_disconnect_reason(message.clone());
                    self.request_disconnect_exit();
                    self.log(ChatMessageTags::error(), format!("[!] {}", message));
                    return result;
                }

                let chat_kind = match &reason {
                    ActionResultReason::Weenie(error, _) if is_actually_weenie_error(*error) => {
                        ChatMessageTags::error()
                    }
                    ActionResultReason::Weenie(_, _) => ChatMessageTags::info(),
                    ActionResultReason::Character(_) | ActionResultReason::General(_) => {
                        ChatMessageTags::error()
                    }
                    ActionResultReason::Transport(_) => ChatMessageTags::warning(),
                };
                self.log(chat_kind, format!("[!] {}", message));
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
            | ClientViewEvent::PlayerEntered { .. }
            | ClientViewEvent::ServerTimeUpdated { .. }
            | ClientViewEvent::WorldNameUpdated(_) => {
                self.handle_setup_event(&event);
            }

            _ => {}
        }

        // Skip other events if not in-game, unless it's a StatusUpdate or ActionResult
        // that handles transitions.
        if !matches!(
            event,
            ClientViewEvent::CharacterList(_)
                | ClientViewEvent::PlayerEntered { .. }
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
                | ClientViewEvent::PingResponse
                | ClientViewEvent::BootAccount(_)
                | ClientViewEvent::NetPulse { .. }
                | ClientViewEvent::Disconnected
        ) && self.game_option().is_none()
        {
            return result;
        }

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
                result.merge(self.page.handle_view_event(ClientViewEvent::NetPulse {
                    bytes_in,
                    bytes_out,
                }));
            }
            ClientViewEvent::Disconnected => {
                self.client_state = ClientState::Disconnected;
                self.request_disconnect_exit();
                self.log(
                    ChatMessageTags::error(),
                    self.current_disconnect_chat_message(),
                );
                // For now, staying on the Game page lets the user see the error,
                // but we could also transition back to selection.
                result.merge(self.page.handle_view_event(ClientViewEvent::Disconnected));
            }
            ClientViewEvent::StatusUpdate { .. }
            | ClientViewEvent::ActionResult { .. }
            | ClientViewEvent::BootAccount(_) => {
                result.merge(self.handle_client_status_event(&event));
                result.merge(self.page.handle_view_event(event));
            }
            ClientViewEvent::BusyOperationFinished {
                operation,
                result: busy_result,
            } => {
                log_busy_operation_result(operation, &busy_result);
                result.merge(
                    self.page
                        .handle_view_event(ClientViewEvent::BusyOperationFinished {
                            operation,
                            result: busy_result,
                        }),
                );
            }
            _ => {
                // All other entity, player, trade, and combat events delegate completely!
                result.merge(self.page.handle_view_event(event));
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::NetStats;
    use crate::types::Page;

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
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
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
