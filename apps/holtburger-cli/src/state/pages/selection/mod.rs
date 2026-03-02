use holtburger_protocol::messages::CharacterEntry;

#[derive(Debug, Default)]
pub struct SelectionState {
    /// List of available characters for selection.
    pub characters: Vec<CharacterEntry>,
    /// Index of character currently selected in selection screen.
    pub selected_character_index: usize,
}
