use crate::ui::state::ChatMessageKind;
use crate::ui::state::{AppState, GameState, Page, SelectionState};
use holtburger_core::ErrorKind;
use holtburger_core::{ClientState, ClientViewEvent, WireEvent};
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
                kind,
                code,
                message,
                ..
            } => {
                if let (ErrorKind::Character, Some(error_code)) = (kind, code) {
                    let error =
                        CharacterError::from_repr(error_code).unwrap_or(CharacterError::None);
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

                let chat_kind = match kind {
                    ErrorKind::Weenie | ErrorKind::Character | ErrorKind::Client => {
                        ChatMessageKind::Error
                    }
                    ErrorKind::Transport => ChatMessageKind::Warning,
                };
                self.chat.log(chat_kind, format!("[!] {}", message));
            }
            _ => {}
        }
    }

    pub(super) fn handle_setup_event(&mut self, event: WireEvent) {
        match event {
            WireEvent::CharacterList(mut chars) => {
                chars.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
                self.page = Page::Selection(SelectionState {
                    characters: chars,
                    selected_character_index: 0,
                });
                self.logon_retry.reset();
            }
            WireEvent::PlayerEntered { guid, name } => {
                if let Page::Game(game) = &mut self.page {
                    game.data.player_guid = Some(guid);
                    game.data.character_name = Some(name);
                } else {
                    self.page = Page::Game(Box::new(GameState::new(guid, name)));
                }
            }
            _ => {}
        }
    }
}
