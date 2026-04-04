use holtburger_core::{ClientCommand, ClientState, ClientViewEvent};
use holtburger_protocol::messages::CharacterEntry;

use crate::components::text_input::SingleLineTextInput;
use crate::types::{AppAction, AppUiAction, ChatMessageKind, UpdateResult, Verb};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CharacterScreen {
    #[default]
    Dashboard,
    Creation,
}

#[derive(Debug, Clone)]
pub struct CharacterDashboardEntry {
    pub slot: u32,
    pub character: CharacterEntry,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteCharacterConfirmation {
    pub slot: u32,
    pub character_name: String,
    pub input: SingleLineTextInput,
    pub error_message: Option<String>,
}

impl DeleteCharacterConfirmation {
    pub(crate) fn new(slot: u32, character_name: String) -> Self {
        Self {
            slot,
            character_name,
            input: SingleLineTextInput::default(),
            error_message: None,
        }
    }

    pub fn expected_name_matches(&self) -> bool {
        normalize_character_name(self.input.text()) == normalize_character_name(&self.character_name)
    }
}

#[derive(Debug, Default)]
pub struct SelectionState {
    /// List of available characters shown in the dashboard.
    pub characters: Vec<CharacterDashboardEntry>,
    /// Index of character currently selected in the dashboard list.
    pub selected_character_index: usize,
    /// Automated character dashboard preference via CLI argument.
    pub character_preference: Option<String>,
    pub screen: CharacterScreen,
    pub delete_confirmation: Option<DeleteCharacterConfirmation>,
}

impl SelectionState {
    pub fn selected_character(&self) -> Option<&CharacterDashboardEntry> {
        self.characters.get(self.selected_character_index)
    }

    pub fn dashboard_verbs(&self) -> Vec<Verb> {
        let mut verbs = vec![Verb::new(
            AppUiAction::OpenCharacterCreationScreen,
            'n',
            "New",
        )];

        if self.selected_character().is_some() {
            verbs.push(Verb::new(
                AppUiAction::OpenDeleteCharacterConfirmation,
                'd',
                "Delete",
            ));
            verbs.push(Verb::new(AppAction::EnterSelectedCharacter, '\r', "World"));
        }

        verbs
    }

    pub fn creation_verbs(&self) -> Vec<Verb> {
        vec![Verb::new(AppUiAction::OpenCharacterDashboard, '\x1b', "Back")]
    }

    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        match event {
            ClientViewEvent::CharacterList(_) => {
                if self.selected_character_index >= self.characters.len() {
                    self.selected_character_index = self.characters.len().saturating_sub(1);
                }

                if let Some(pref) = self.character_preference.as_ref() {
                    let maybe_guid = if let Ok(idx) = pref.parse::<usize>() {
                        if idx > 0 && idx <= self.characters.len() {
                            Some((self.characters[idx - 1].character.guid, idx - 1))
                        } else {
                            None
                        }
                    } else {
                        let pref_lower = pref.to_lowercase();
                        self.characters
                            .iter()
                            .enumerate()
                            .find(|(_, c)| c.character.name.to_lowercase() == pref_lower)
                            .map(|(i, c)| (c.character.guid, i))
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
                        guid: char_info.character.guid,
                        name: char_info.character.name.clone(),
                    });
                }
            }
            _ => {}
        }
        UpdateResult::default()
    }

    pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult> {
        match action {
            AppAction::EnterSelectedCharacter => {
                let character = self.selected_character()?;
                Some(UpdateResult::commands(vec![ClientCommand::SelectCharacter(
                    character.character.guid,
                )]))
            }
            AppAction::DeleteCharacterAtSlot { slot } => {
                self.delete_confirmation = None;
                Some(UpdateResult::commands(vec![ClientCommand::DeleteCharacter {
                    slot,
                }]))
            }
            AppAction::UiAction {
                action: AppUiAction::OpenCharacterCreationScreen,
            } => {
                self.screen = CharacterScreen::Creation;
                Some(UpdateResult::redraw())
            }
            AppAction::UiAction {
                action: AppUiAction::OpenCharacterDashboard,
            } => {
                self.screen = CharacterScreen::Dashboard;
                Some(UpdateResult::redraw())
            }
            AppAction::UiAction {
                action: AppUiAction::OpenDeleteCharacterConfirmation,
            } => {
                let character = self.selected_character()?;
                self.delete_confirmation = Some(DeleteCharacterConfirmation::new(
                    character.slot,
                    character.character.name.clone(),
                ));
                Some(UpdateResult::redraw())
            }
            AppAction::UiAction {
                action: AppUiAction::CancelDeleteCharacterConfirmation,
            } => {
                if self.delete_confirmation.take().is_some() {
                    Some(UpdateResult::redraw())
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    pub fn handle_tick(&mut self, _elapsed: f64) -> UpdateResult {
        UpdateResult::default()
    }
}

fn normalize_character_name(name: &str) -> String {
    name.chars()
        .filter(|character| !character.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;

    fn test_state() -> SelectionState {
        SelectionState {
            characters: vec![CharacterDashboardEntry {
                slot: 7,
                character: CharacterEntry {
                    guid: Guid(0x5000_0001),
                    name: "Sho Girl".to_string(),
                    delete_time: 0,
                },
            }],
            selected_character_index: 0,
            character_preference: None,
            screen: CharacterScreen::Dashboard,
            delete_confirmation: None,
        }
    }

    #[test]
    fn dashboard_verbs_hide_delete_and_world_when_no_selection() {
        let state = SelectionState::default();
        let verbs = state.dashboard_verbs();

        assert_eq!(verbs.len(), 1);
        assert_eq!(verbs[0].label, "New");
    }

    #[test]
    fn enter_selected_character_uses_guid() {
        let mut state = test_state();
        let result = state
            .handle_action(AppAction::EnterSelectedCharacter)
            .expect("enter action should produce a result");

        assert!(matches!(
            result.commands.as_slice(),
            [ClientCommand::SelectCharacter(Guid(0x5000_0001))]
        ));
    }

    #[test]
    fn delete_selected_character_uses_preserved_slot() {
        let mut state = test_state();
        let result = state
            .handle_action(AppAction::DeleteCharacterAtSlot { slot: 7 })
            .expect("delete action should produce a result");

        assert!(matches!(
            result.commands.as_slice(),
            [ClientCommand::DeleteCharacter { slot: 7 }]
        ));
    }

    #[test]
    fn open_character_creation_switches_screen() {
        let mut state = test_state();
        let result = state
            .handle_action(AppUiAction::OpenCharacterCreationScreen.into())
            .expect("create screen action should produce a result");

        assert_eq!(state.screen, CharacterScreen::Creation);
        assert!(result.redraw_requested());
    }

    #[test]
    fn open_delete_confirmation_captures_selected_character() {
        let mut state = test_state();
        let result = state
            .handle_action(AppUiAction::OpenDeleteCharacterConfirmation.into())
            .expect("delete confirmation action should produce a result");

        let confirmation = state
            .delete_confirmation
            .as_ref()
            .expect("delete confirmation should be open");
        assert_eq!(confirmation.slot, 7);
        assert_eq!(confirmation.character_name, "Sho Girl");
        assert!(result.redraw_requested());
    }

    #[test]
    fn normalize_character_name_ignores_case_and_whitespace() {
        assert_eq!(
            normalize_character_name("  Sho   Girl  "),
            normalize_character_name("sho girl")
        );
    }
}
