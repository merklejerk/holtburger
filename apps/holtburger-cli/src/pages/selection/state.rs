use holtburger_core::ClientViewEvent;
use holtburger_protocol::messages::CharacterEntry;

use crate::types::{AppAction, UpdateResult};

#[derive(Debug, Default)]
pub struct SelectionState {
    /// List of available characters for selection.
    pub characters: Vec<CharacterEntry>,
    /// Index of character currently selected in selection screen.
    pub selected_character_index: usize,
}

impl SelectionState {
    pub fn handle_view_event(&mut self, _event: ClientViewEvent) -> UpdateResult {
        UpdateResult::default()
    }

    pub fn handle_action(&mut self, _action: AppAction) -> Option<UpdateResult> {
        None
    }

    pub fn handle_tick(&mut self, _elapsed: f64) -> UpdateResult {
        UpdateResult::default()
    }
}
