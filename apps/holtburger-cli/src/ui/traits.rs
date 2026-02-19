use crossterm::event::KeyEvent;
use holtburger_core::ClientCommand;
use ratatui::Frame;
use ratatui::layout::Rect;

use crate::ui::model::AppState;
use crate::ui::types::CommandTarget;
use crate::ui::widgets::dashboard::Verb;

pub trait TabController {
    /// Renders the tab's content into the given area.
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect);

    /// Returns the list of available verbs for the item at the specified index.
    fn get_verbs(&self, state: &AppState, index: usize) -> Vec<Verb>;

    /// Returns the command target (e.g. Entity, Spell) at the specified index.
    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a>;

    /// Returns the total number of items in the tab.
    fn get_item_count(&self, state: &AppState) -> usize;

    /// Optional: Handles tab-specific input. Returns a list of commands to execute.
    fn handle_input(&self, _key: KeyEvent, _state: &mut AppState) -> Option<Vec<ClientCommand>> {
        None
    }
}
