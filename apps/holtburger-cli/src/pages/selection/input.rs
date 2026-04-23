use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseEvent};

use crate::pages::selection::SelectionState;
use crate::pages::selection::creation::CharacterCreationFocus;
use crate::pages::selection::presentation_utils::dashboard_verbs;
use crate::types::{RedrawPriority, UpdateResult};

impl SelectionState {
    pub fn handle_input(&mut self, key: KeyEvent) -> UpdateResult {
        if let Some(result) = self.handle_delete_confirmation_input(key) {
            return result;
        }

        if matches!(self.screen, super::state::CharacterScreen::Creation) {
            return self.handle_creation_input(key);
        }

        let mut result = UpdateResult::new();
        match key.code {
            KeyCode::Up if self.selected_character_index > 0 => {
                self.selected_character_index -= 1;
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::Down
                if !self.characters.is_empty()
                    && self.selected_character_index + 1 < self.characters.len() =>
            {
                self.selected_character_index += 1;
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::Home if !self.characters.is_empty() => {
                self.selected_character_index = 0;
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::End if !self.characters.is_empty() => {
                self.selected_character_index = self.characters.len() - 1;
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::PageUp if !self.characters.is_empty() => {
                self.selected_character_index = self.selected_character_index.saturating_sub(10);
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::PageDown if !self.characters.is_empty() => {
                self.selected_character_index =
                    (self.selected_character_index + 10).min(self.characters.len() - 1);
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::Enter => {
                if let Some(verb) = dashboard_verbs(self)
                    .into_iter()
                    .find(|verb| verb.shortcut == '\r')
                {
                    result.actions.push(verb.action);
                }
            }
            KeyCode::Char(c) => {
                if let Some(digit) = c.to_digit(10)
                    && digit > 0
                {
                    let idx = (digit as usize).saturating_sub(1);
                    if self.characters.get(idx).is_some() {
                        self.selected_character_index = idx;
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                } else if let Some(verb) = dashboard_verbs(self)
                    .into_iter()
                    .find(|verb| verb.shortcut.eq_ignore_ascii_case(&c))
                {
                    result.actions.push(verb.action);
                }
            }
            KeyCode::Esc => {
                result.commands.push(holtburger_core::ClientCommand::Quit);
            }
            _ => {}
        }
        result
    }

    fn handle_delete_confirmation_input(&mut self, key: KeyEvent) -> Option<UpdateResult> {
        let confirmation = self.delete_confirmation.as_mut()?;
        let mut result = UpdateResult::new();

        match key.code {
            KeyCode::Esc => {
                result
                    .actions
                    .push(crate::types::AppUiAction::CancelDeleteCharacterConfirmation.into());
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::Enter => {
                if confirmation.expected_name_matches() {
                    result
                        .actions
                        .push(crate::types::AppAction::DeleteCharacterAtSlot {
                            slot: confirmation.slot,
                        });
                } else {
                    confirmation.error_message = Some(format!(
                        "Type '{}' to confirm delete.",
                        confirmation.character_name
                    ));
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            _ => {
                if confirmation.input.apply_key(key) {
                    confirmation.error_message = None;
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
        }

        Some(result)
    }

    fn handle_creation_input(&mut self, key: KeyEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        let Some(creation) = self.creation.ready_mut() else {
            if key.code == KeyCode::Esc {
                return result
                    .with_action(crate::types::AppUiAction::OpenCharacterDashboard.into());
            }
            return result;
        };

        match key.code {
            KeyCode::Esc => {
                return result
                    .with_action(crate::types::AppUiAction::OpenCharacterDashboard.into());
            }
            KeyCode::Tab => {
                creation.move_focus(1);
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::BackTab => {
                creation.move_focus(-1);
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::Enter => match creation.focus {
                CharacterCreationFocus::Submit => {
                    result
                        .actions
                        .push(crate::types::AppAction::SubmitCharacterCreation);
                }
                CharacterCreationFocus::Skills => {
                    result.actions.push(
                        crate::types::AppUiAction::RaiseSelectedCharacterCreationSkill.into(),
                    );
                }
                _ => {}
            },
            _ => match creation.focus {
                CharacterCreationFocus::Name => {
                    if creation.name_input.apply_key(key) {
                        creation.clear_feedback();
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                }
                CharacterCreationFocus::StarterTown => {
                    if cycle_selector_key(key, |delta| creation.cycle_start_area(delta)) {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                }
                CharacterCreationFocus::Heritage => {
                    if cycle_selector_key(key, |delta| creation.cycle_heritage(delta)) {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                }
                CharacterCreationFocus::Gender => {
                    if cycle_selector_key(key, |delta| creation.cycle_gender(delta)) {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                }
                CharacterCreationFocus::Attributes => match key.code {
                    KeyCode::Up if creation.move_attribute_selection(-1) => {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                    KeyCode::Down if creation.move_attribute_selection(1) => {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                    KeyCode::Left => {
                        let changed = if key.modifiers.contains(KeyModifiers::CONTROL) {
                            creation.minimize_selected_attribute()
                        } else if key.modifiers.contains(KeyModifiers::SHIFT) {
                            creation.adjust_selected_attribute(-10)
                        } else {
                            creation.adjust_selected_attribute(-1)
                        };

                        if changed {
                            result.request_redraw(RedrawPriority::Immediate);
                        }
                    }
                    KeyCode::Right => {
                        let changed = if key.modifiers.contains(KeyModifiers::CONTROL) {
                            creation.maximize_selected_attribute()
                        } else if key.modifiers.contains(KeyModifiers::SHIFT) {
                            creation.adjust_selected_attribute(10)
                        } else {
                            creation.adjust_selected_attribute(1)
                        };

                        if changed {
                            result.request_redraw(RedrawPriority::Immediate);
                        }
                    }
                    _ => {}
                },
                CharacterCreationFocus::Skills => match key.code {
                    KeyCode::Up if creation.move_skill_selection(-1) => {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                    KeyCode::Down if creation.move_skill_selection(1) => {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                    KeyCode::Left => {
                        result.actions.push(
                            crate::types::AppUiAction::LowerSelectedCharacterCreationSkill.into(),
                        );
                    }
                    KeyCode::Right => {
                        result.actions.push(
                            crate::types::AppUiAction::RaiseSelectedCharacterCreationSkill.into(),
                        );
                    }
                    _ => {}
                },
                CharacterCreationFocus::Submit => {}
            },
        }

        result
    }

    pub fn handle_mouse(&mut self, _mouse: MouseEvent) -> UpdateResult {
        UpdateResult::new()
    }
}

fn cycle_selector_key(key: KeyEvent, mut apply: impl FnMut(i32) -> bool) -> bool {
    match key.code {
        KeyCode::Left | KeyCode::Up => apply(-1),
        KeyCode::Right | KeyCode::Down => apply(1),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::selection::creation::{CharacterCreationFormState, CharacterCreationState};
    use crate::pages::selection::state::{
        CharacterDashboardEntry, CharacterScreen, DeleteCharacterConfirmation,
    };
    use crossterm::event::KeyModifiers;
    use holtburger_common::Guid;
    use holtburger_content::{CharacterGenCatalog, character_gen::CharacterGenHeritageGroup};
    use holtburger_protocol::messages::CharacterEntry;
    use std::collections::BTreeMap;
    use std::sync::Arc;

    fn test_state() -> SelectionState {
        SelectionState {
            characters: vec![CharacterDashboardEntry {
                slot: 4,
                character: CharacterEntry {
                    guid: Guid(0x5000_0001),
                    name: "Sho Girl".to_string(),
                    delete_time: 0,
                },
            }],
            selected_character_index: 0,
            character_preference: None,
            account_name: "account".to_string(),
            screen: CharacterScreen::Dashboard,
            creation: crate::pages::selection::creation::CharacterCreationState::default(),
            pending_create: None,
            delete_confirmation: Some(DeleteCharacterConfirmation::new(4, "Sho Girl".to_string())),
        }
    }

    fn ready_creation_state() -> CharacterCreationState {
        CharacterCreationState::Ready(Box::new(CharacterCreationFormState {
            catalog: Arc::new(CharacterGenCatalog {
                starter_areas: Vec::new(),
                heritage_groups: BTreeMap::from([(
                    0,
                    CharacterGenHeritageGroup {
                        heritage_id: 0,
                        name: "Test".to_string(),
                        icon_image: 0,
                        setup_id: 0,
                        environment_setup_id: 0,
                        attribute_credits: 66,
                        skill_credits: 0,
                        primary_start_area_ids: Vec::new(),
                        secondary_start_area_ids: Vec::new(),
                        skill_overrides: BTreeMap::new(),
                        templates: Vec::new(),
                        genders: BTreeMap::new(),
                    },
                )]),
                skill_definitions: BTreeMap::new(),
                expected_skill_slots: 0,
            }),
            focus: CharacterCreationFocus::Attributes,
            name_input: crate::components::text_input::SingleLineTextInput::default(),
            heritage_id: 0,
            gender_id: 0,
            start_area_id: 0,
            attribute_values: [holtburger_core::character_gen::CHARACTER_GEN_MIN_ATTRIBUTE; 6],
            selected_attribute_index: 0,
            skill_advancement_classes: Vec::new(),
            selected_skill_id: None,
            feedback: None,
        }))
    }

    #[test]
    fn delete_confirmation_enter_with_matching_name_emits_delete_action() {
        let mut state = test_state();
        state
            .delete_confirmation
            .as_mut()
            .expect("confirmation should exist")
            .input
            .set_text("  shogirl ");

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.as_slice(),
            [crate::types::AppAction::DeleteCharacterAtSlot { slot: 4 }]
        ));
    }

    #[test]
    fn delete_confirmation_enter_with_wrong_name_shows_error_and_keeps_modal() {
        let mut state = test_state();
        state
            .delete_confirmation
            .as_mut()
            .expect("confirmation should exist")
            .input
            .set_text("wrong");

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.actions.is_empty());
        assert!(result.redraw_requested());
        assert!(
            state
                .delete_confirmation
                .as_ref()
                .and_then(|confirmation| confirmation.error_message.as_ref())
                .is_some()
        );
    }

    #[test]
    fn attributes_ctrl_right_maxes_selected_attribute() {
        let mut state = test_state();
        state.screen = CharacterScreen::Creation;
        state.creation = ready_creation_state();
        state.delete_confirmation = None;

        let result = state.handle_input(KeyEvent::new(KeyCode::Right, KeyModifiers::CONTROL));

        assert!(result.redraw_requested());
        assert_eq!(
            state
                .creation
                .ready()
                .expect("creation should be ready")
                .attribute_values[0],
            16
        );
    }

    #[test]
    fn attributes_ctrl_left_minimizes_selected_attribute() {
        let mut state = test_state();
        state.screen = CharacterScreen::Creation;
        let mut creation = ready_creation_state();
        if let CharacterCreationState::Ready(form) = &mut creation {
            form.attribute_values[0] = 16;
        }
        state.creation = creation;
        state.delete_confirmation = None;

        let result = state.handle_input(KeyEvent::new(KeyCode::Left, KeyModifiers::CONTROL));

        assert!(result.redraw_requested());
        assert_eq!(
            state
                .creation
                .ready()
                .expect("creation should be ready")
                .attribute_values[0],
            holtburger_core::character_gen::CHARACTER_GEN_MIN_ATTRIBUTE
        );
    }
}
