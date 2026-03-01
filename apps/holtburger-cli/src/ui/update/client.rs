use crate::state::ChatMessageKind;
use crate::state::{AppState, GameState, Page, SelectionState};
use holtburger_core::{ClientState, ClientViewEvent, ErrorReason};
use holtburger_protocol::errors::CharacterError;

impl AppState {
    pub(super) fn handle_client_status_event(&mut self, event: ClientViewEvent) {
        match event {
            ClientViewEvent::StatusUpdate { state } => {
                self.core_state = state;
                if self.core_state == ClientState::InWorld {
                    self.logon_retry.reset();
                    self.enter_retry.reset();
                }
            }
            ClientViewEvent::ErrorRaised {
                reason, message, ..
            } => {
                if let ErrorReason::Character(error) = reason {
                    if error == CharacterError::Logon {
                        self.logon_retry.schedule();
                        self.chat.log(
                            ChatMessageKind::Warning,
                            format!(
                                "Account already logged on. Retrying in {}s...",
                                self.logon_retry.backoff_secs
                            ),
                        );
                        return;
                    } else if error == CharacterError::EnterGameCharacterInWorld {
                        self.enter_retry.schedule();
                        self.chat.log(
                            ChatMessageKind::Warning,
                            format!(
                                "Character still in world. Retrying in {}s...",
                                self.enter_retry.backoff_secs
                            ),
                        );
                        return;
                    }
                }

                let chat_kind = match reason {
                    ErrorReason::Weenie(_, _)
                    | ErrorReason::Character(_)
                    | ErrorReason::General(_) => ChatMessageKind::Error,
                    ErrorReason::Transport(_) => ChatMessageKind::Warning,
                };
                self.chat.log(chat_kind, format!("[!] {}", message));
            }
            _ => {}
        }
    }

    pub(super) fn handle_setup_event(&mut self, event: &ClientViewEvent) {
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
            _ => {}
        }
    }
}
