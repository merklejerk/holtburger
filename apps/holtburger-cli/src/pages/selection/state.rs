use holtburger_core::client::types::CharacterManagementOperation;
use holtburger_core::errors::is_actually_weenie_error;
use holtburger_core::{ActionResultReason, ClientCommand, ClientViewEvent};
use holtburger_protocol::messages::{CharacterCreateResponseData, CharacterEntry};

use crate::components::text_input::SingleLineTextInput;
use crate::pages::selection::creation::{CharacterCreationState, format_creation_errors};
use crate::state::{EventContext, TickContext};
use crate::types::{AppAction, AppUiAction, ChatMessageTags, UpdateResult};
use crate::utils::format_action_result_message;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingCharacterCreation {
    pub slot: u32,
    pub name: String,
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
        normalize_character_name(self.input.text())
            == normalize_character_name(&self.character_name)
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
    /// Account name used to complete the world-entry handshake.
    pub account_name: String,
    pub screen: CharacterScreen,
    pub creation: CharacterCreationState,
    pub pending_create: Option<PendingCharacterCreation>,
    pub delete_confirmation: Option<DeleteCharacterConfirmation>,
}

impl SelectionState {
    pub fn selected_character(&self) -> Option<&CharacterDashboardEntry> {
        self.characters.get(self.selected_character_index)
    }

    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        self.handle_view_event_with_context(event, &EventContext::default())
    }

    pub fn handle_view_event_with_context(
        &mut self,
        event: ClientViewEvent,
        _ctx: &EventContext,
    ) -> UpdateResult {
        match event {
            ClientViewEvent::ActionResult { reason, .. } => {
                let message = format_action_result_message(&reason);

                match &reason {
                    ActionResultReason::Weenie(error, _) if is_actually_weenie_error(*error) => {
                        log::error!("{}", message);
                    }
                    ActionResultReason::Weenie(_, _) => {
                        log::info!("{}", message);
                    }
                    ActionResultReason::Transport(_) => {
                        log::warn!("{}", message);
                    }
                    _ => {
                        log::error!("{}", message);
                    }
                }
            }
            ClientViewEvent::CharacterList(_) => {
                self.pending_create = None;
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
                            chat_tags: ChatMessageTags::system(),
                            message: format!("Auto-selecting character: {:08X}", guid),
                        });
                    } else {
                        return UpdateResult::new().with_action(AppAction::Log {
                            chat_tags: ChatMessageTags::warning(),
                            message: format!(
                                "Character preference '{}' not found in available characters.",
                                pref
                            ),
                        });
                    }
                }
            }
            ClientViewEvent::CharacterManagementResponse {
                operation: Some(CharacterManagementOperation::Create),
                response,
            } => return self.handle_create_response(response),
            ClientViewEvent::CharacterManagementResponse {
                operation: Some(CharacterManagementOperation::Restore),
                response,
            } => return self.handle_restore_response(response),
            ClientViewEvent::CharacterEnterWorldServerReady => {
                if let Some(char_info) = self.characters.get(self.selected_character_index) {
                    return UpdateResult::new().with_action(AppAction::TransitionToGame {
                        guid: char_info.character.guid,
                        name: char_info.character.name.clone(),
                        account: self.account_name.clone(),
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
                if character.character.delete_time != 0 {
                    return None;
                }

                Some(UpdateResult::commands(vec![
                    ClientCommand::SelectCharacter(character.character.guid),
                ]))
            }
            AppAction::SubmitCharacterCreation => {
                let creation = self.creation.ready_mut()?;
                match creation.build_request(self.characters.iter().map(|character| character.slot))
                {
                    Ok(request) => {
                        self.pending_create = Some(PendingCharacterCreation {
                            slot: request.character_slot,
                            name: request.name.clone(),
                        });
                        creation.set_feedback("Submitting character creation request...", false);

                        let mut result = UpdateResult::new();
                        result
                            .commands
                            .push(ClientCommand::CreateCharacter(Box::new(request)));
                        result.request_redraw(crate::types::RedrawPriority::Immediate);
                        Some(result)
                    }
                    Err(errors) => {
                        creation.set_feedback(format_creation_errors(&errors), true);
                        Some(UpdateResult::redraw())
                    }
                }
            }
            AppAction::DeleteCharacterAtSlot { slot } => {
                self.delete_confirmation = None;
                Some(UpdateResult::commands(vec![
                    ClientCommand::DeleteCharacter { slot },
                ]))
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
            AppAction::UiAction {
                action: AppUiAction::RaiseSelectedCharacterCreationSkill,
            } => {
                let creation = self.creation.ready_mut()?;
                let changed = creation.raise_selected_skill();
                if changed || creation.feedback.is_some() {
                    Some(UpdateResult::redraw())
                } else {
                    None
                }
            }
            AppAction::UiAction {
                action: AppUiAction::LowerSelectedCharacterCreationSkill,
            } => {
                let creation = self.creation.ready_mut()?;
                let changed = creation.lower_selected_skill();
                if changed || creation.feedback.is_some() {
                    Some(UpdateResult::redraw())
                } else {
                    None
                }
            }
            AppAction::RestoreSelectedCharacter => {
                let character = self.selected_character()?;
                if character.character.delete_time == 0 {
                    return None;
                }

                Some(UpdateResult::commands(vec![
                    ClientCommand::RestoreCharacter(character.character.guid),
                ]))
            }
            _ => None,
        }
    }

    pub fn handle_tick(&mut self, elapsed: f64) -> UpdateResult {
        self.handle_tick_with_context(elapsed, &TickContext::default())
    }

    pub fn handle_tick_with_context(&mut self, _elapsed: f64, _ctx: &TickContext) -> UpdateResult {
        UpdateResult::default()
    }
}

fn normalize_character_name(name: &str) -> String {
    name.chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

impl SelectionState {
    fn handle_create_response(&mut self, response: CharacterCreateResponseData) -> UpdateResult {
        match response.response {
            holtburger_protocol::messages::CharacterGenerationVerificationResponse::Ok => {
                let pending = self.pending_create.take();
                if let Some((guid, slot)) = response
                    .guid
                    .zip(pending.as_ref().map(|pending| pending.slot))
                {
                    let name = response
                        .name
                        .clone()
                        .or_else(|| pending.as_ref().map(|pending| pending.name.clone()))
                        .unwrap_or_else(|| "New Character".to_string());
                    self.characters.push(CharacterDashboardEntry {
                        slot,
                        character: CharacterEntry {
                            guid,
                            name: name.clone(),
                            delete_time: 0,
                        },
                    });
                    self.characters.sort_by(|left, right| {
                        left.character
                            .name
                            .to_lowercase()
                            .cmp(&right.character.name.to_lowercase())
                    });
                    if let Some(index) = self
                        .characters
                        .iter()
                        .position(|entry| entry.character.guid == guid)
                    {
                        self.selected_character_index = index;
                    }
                    self.screen = CharacterScreen::Dashboard;
                    if let Some(creation) = self.creation.ready_mut() {
                        creation.set_feedback(format!("Character '{}' created.", name), false);
                    }
                } else if let Some(creation) = self.creation.ready_mut() {
                    creation.set_feedback(
                        "Character created, but the response was missing append metadata."
                            .to_string(),
                        false,
                    );
                }
            }
            other => {
                self.pending_create = None;
                if let Some(creation) = self.creation.ready_mut() {
                    creation.set_feedback(
                        format!("Character creation rejected by server: {:?}.", other),
                        true,
                    );
                }
            }
        }

        UpdateResult::redraw()
    }

    fn handle_restore_response(&mut self, response: CharacterCreateResponseData) -> UpdateResult {
        self.pending_create = None;

        match response.response {
            holtburger_protocol::messages::CharacterGenerationVerificationResponse::Ok => {
                if let Some(guid) = response.guid
                    && let Some(entry) = self
                        .characters
                        .iter_mut()
                        .find(|entry| entry.character.guid == guid)
                {
                    entry.character.delete_time = 0;
                    if let Some(name) = response.name {
                        entry.character.name = name;
                    }
                    if self.selected_character_index >= self.characters.len() {
                        self.selected_character_index = self.characters.len().saturating_sub(1);
                    }
                    return UpdateResult::redraw();
                }

                UpdateResult::redraw()
            }
            other => {
                if let Some(creation) = self.creation.ready_mut() {
                    creation.set_feedback(
                        format!("Character restore rejected by server: {:?}.", other),
                        true,
                    );
                }

                UpdateResult::redraw()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::selection::presentation_utils as selection_presentation;
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
            account_name: "account".to_string(),
            screen: CharacterScreen::Dashboard,
            creation: CharacterCreationState::default(),
            pending_create: None,
            delete_confirmation: None,
        }
    }

    #[test]
    fn dashboard_verbs_hide_delete_and_world_when_no_selection() {
        let state = SelectionState::default();
        let verbs = selection_presentation::dashboard_verbs(&state);

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
    fn enter_selected_character_is_blocked_for_pending_delete_character() {
        let mut state = test_state();
        state.characters[0].character.delete_time = 123;

        assert!(
            state
                .handle_action(AppAction::EnterSelectedCharacter)
                .is_none()
        );
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
    fn dashboard_verbs_show_restore_for_pending_delete_character() {
        let mut state = test_state();
        state.characters[0].character.delete_time = 123;

        let verbs = selection_presentation::dashboard_verbs(&state);

        assert!(
            verbs
                .iter()
                .any(|verb| matches!(verb.action, AppAction::RestoreSelectedCharacter))
        );
    }

    #[test]
    fn restore_selected_character_uses_guid() {
        let mut state = test_state();
        state.characters[0].character.delete_time = 123;

        let result = state
            .handle_action(AppAction::RestoreSelectedCharacter)
            .expect("restore action should produce a result");

        assert!(matches!(
            result.commands.as_slice(),
            [ClientCommand::RestoreCharacter(Guid(0x5000_0001))]
        ));
    }

    #[test]
    fn character_enter_world_server_ready_transitions_to_game_with_selected_identity() {
        let mut state = test_state();

        let result = state.handle_view_event(ClientViewEvent::CharacterEnterWorldServerReady);

        assert!(matches!(
            result.actions.as_slice(),
            [AppAction::TransitionToGame {
                guid: Guid(0x5000_0001),
                name,
                account,
            }] if name == "Sho Girl" && account == "account"
        ));
    }

    #[test]
    fn normalize_character_name_ignores_case_and_whitespace() {
        assert_eq!(
            normalize_character_name("  Sho   Girl  "),
            normalize_character_name("sho girl")
        );
    }

    #[test]
    fn normalize_character_name_ignores_non_alphanumeric_characters() {
        assert_eq!(
            normalize_character_name("Sho-Girl!"),
            normalize_character_name("sho girl")
        );
    }

    #[test]
    fn create_response_appends_character_locally_and_selects_it() {
        let mut state = test_state();
        state.pending_create = Some(PendingCharacterCreation {
            slot: 2,
            name: "Zappy".to_string(),
        });

        let result = state.handle_view_event(ClientViewEvent::CharacterManagementResponse {
            operation: Some(CharacterManagementOperation::Create),
            response: CharacterCreateResponseData {
                response:
                    holtburger_protocol::messages::CharacterGenerationVerificationResponse::Ok,
                guid: Some(Guid(0x5000_0009)),
                name: Some("Zappy".to_string()),
                seconds_disabled: Some(0),
            },
        });

        assert!(result.redraw_requested());
        assert_eq!(state.screen, CharacterScreen::Dashboard);
        assert_eq!(state.pending_create, None);
        assert!(
            state
                .characters
                .iter()
                .any(|entry| entry.slot == 2 && entry.character.name == "Zappy")
        );
        assert_eq!(
            state
                .selected_character()
                .map(|entry| entry.character.name.as_str()),
            Some("Zappy")
        );
    }

    #[test]
    fn restore_response_clears_pending_delete_marker() {
        let mut state = test_state();
        state.characters[0].character.delete_time = 123;

        let result = state.handle_view_event(ClientViewEvent::CharacterManagementResponse {
            operation: Some(CharacterManagementOperation::Restore),
            response: CharacterCreateResponseData {
                response:
                    holtburger_protocol::messages::CharacterGenerationVerificationResponse::Ok,
                guid: Some(Guid(0x5000_0001)),
                name: Some("Sho Girl".to_string()),
                seconds_disabled: Some(0),
            },
        });

        assert!(result.redraw_requested());
        assert_eq!(state.characters[0].character.delete_time, 0);
        assert_eq!(state.characters[0].character.name, "Sho Girl");
    }
}
