use crate::pages::selection::SelectionState;
use crate::pages::selection::render_widgets::render_character_selection;
use ratatui::Frame;
use ratatui::layout::Rect;

impl SelectionState {
    pub fn render(&mut self, f: &mut Frame, _area: Rect) {
        // Selection state doesn't need AppState, it renders its own characters.
        render_character_selection(f, self, _area);
    }
}
