use holtburger_core::{ClientCommand, ClientState, ClientViewEvent};
use holtburger_protocol::messages::CharacterEntry;

use crate::types::{AppAction, ChatMessageKind, UpdateResult};

#[derive(Debug, Default)]
pub struct SelectionState {
    /// List of available characters for selection.
    pub characters: Vec<CharacterEntry>,
    /// Index of character currently selected in selection screen.
    pub selected_character_index: usize,
    /// Automated character selection preference via CLI argument.
    pub character_preference: Option<String>,
}

impl SelectionState {
    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        match event {
            ClientViewEvent::CharacterList(_) => {
                if let Some(pref) = self.character_preference.as_ref() {
                    let maybe_guid = if let Ok(idx) = pref.parse::<usize>() {
                        if idx > 0 && idx <= self.characters.len() {
                            Some((self.characters[idx - 1].guid, idx - 1))
                        } else {
                            None
                        }
                    } else {
                        let pref_lower = pref.to_lowercase();
                        self.characters
                            .iter()
                            .enumerate()
                            .find(|(_, c)| c.name.to_lowercase() == pref_lower)
                            .map(|(i, c)| (c.guid, i))
                    };

                    if let Some((guid, char_index)) = maybe_guid {
                        self.selected_character_index = char_index;
                        self.character_preference = None;
                        let mut result = UpdateResult::new();
                        result.commands.push(ClientCommand::SelectCharacter(guid));
                        return result.with_action(AppAction::Log {
                            kind: ChatMessageKind::System,
                            message: format!("Auto-selecting character: {:08X}", guid),
                        });
                    } else {
                        return UpdateResult::new().with_action(AppAction::Log {
                            kind: ChatMessageKind::Warning,
                            message: format!(
                                "Character preference '{}' not found in available characters.",
                                pref
                            ),
                        });
                    }
                }
            }
            ClientViewEvent::StatusUpdate {
                state: ClientState::EnteringWorld,
            } => {
                if let Some(char_info) = self.characters.get(self.selected_character_index) {
                    return UpdateResult::new().with_action(AppAction::TransitionToGame {
                        guid: char_info.guid,
                        name: char_info.name.clone(),
                    });
                }
            }
            _ => {}
        }
        UpdateResult::default()
    }

    pub fn handle_action(&mut self, _action: AppAction) -> Option<UpdateResult> {
        None
    }

    pub fn handle_tick(&mut self, _elapsed: f64) -> UpdateResult {
        UpdateResult::default()
    }
}
