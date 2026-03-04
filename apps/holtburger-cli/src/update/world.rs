use crate::pages::{game::GameState, selection::SelectionState};
use crate::state::AppState;
use crate::types::{ChatMessageKind, Page, UpdateResult};
use holtburger_core::{ClientState, ClientViewEvent, ErrorReason};
use holtburger_protocol::errors::CharacterError;

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
                let mut chars = chars.clone();
                chars.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
                self.page = Page::Selection(SelectionState {
                    characters: chars,
                    selected_character_index: 0,
                });
                self.logon_retry.reset();
            }
            ClientViewEvent::PlayerEntered { guid, name } => {
                if let Page::Game(game) = &mut self.page {
                    game.data.player_guid = Some(*guid);
                    game.data.character_name = Some(name.clone());
                    game.data.world_name = self.world_name.clone();
                } else {
                    self.page = Page::Game(Box::new(GameState::new(
                        *guid,
                        name.clone(),
                        self.world_name.clone(),
                    )));
                }
            }
            ClientViewEvent::ServerTimeUpdated { time } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.server_time = Some((*time, std::time::Instant::now()));
                }
            }
            _ => {}
        }
    }

    fn handle_client_status_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        let result = UpdateResult::new();
        match event {
            ClientViewEvent::StatusUpdate { state } => {
                self.client_state = state;
                if self.client_state == ClientState::InWorld {
                    self.logon_retry.reset();
                    self.enter_retry.reset();
                } else if self.client_state == ClientState::EnteringWorld
                    && let crate::types::Page::Selection(sel) = &self.page
                    && !sel.characters.is_empty()
                    && sel.selected_character_index < sel.characters.len()
                {
                    let char_info = &sel.characters[sel.selected_character_index];
                    self.page =
                        crate::types::Page::Game(Box::new(crate::pages::game::GameState::new(
                            char_info.guid,
                            char_info.name.clone(),
                            self.world_name.clone(),
                        )));
                }
            }
            ClientViewEvent::ErrorRaised {
                reason, message, ..
            } => {
                if let ErrorReason::Character(error) = reason {
                    if error == CharacterError::Logon {
                        self.logon_retry.schedule();
                        self.log(
                            ChatMessageKind::Warning,
                            format!(
                                "* Retrying login (attempt {}/{})...",
                                self.logon_retry.attempts, self.logon_retry.max_attempts
                            ),
                        );
                        return result;
                    } else if error == CharacterError::EnterGameCharacterInWorld {
                        self.enter_retry.schedule();
                        self.log(
                            ChatMessageKind::Warning,
                            format!(
                                "* Retrying enter world (attempt {}/{})...",
                                self.enter_retry.attempts, self.enter_retry.max_attempts
                            ),
                        );
                        return result;
                    }
                }

                let chat_kind = match reason {
                    ErrorReason::Weenie(_, _)
                    | ErrorReason::Character(_)
                    | ErrorReason::General(_) => ChatMessageKind::Error,
                    ErrorReason::Transport(_) => ChatMessageKind::Warning,
                };
                self.log(chat_kind, format!("[!] {}", message));
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
                result.merge(self.page.handle_view_event(ClientViewEvent::NetPulse { bytes_in, bytes_out }));
            }
            ClientViewEvent::Disconnected => {
                self.client_state = ClientState::Disconnected;
                self.log(
                    ChatMessageKind::Error,
                    "Lost connection to server.".to_string(),
                );
                // For now, staying on the Game page lets the user see the error,
                // but we could also transition back to selection.
                result.merge(self.page.handle_view_event(ClientViewEvent::Disconnected));
            }
            ClientViewEvent::StatusUpdate { .. } | ClientViewEvent::ErrorRaised { .. } => {
                result.merge(self.handle_client_status_event(event));
            }
            _ => {
                // All other entity, player, trade, and combat events delegate completely!
                result.merge(self.page.handle_view_event(event));
            }
        }
        result
    }
}
